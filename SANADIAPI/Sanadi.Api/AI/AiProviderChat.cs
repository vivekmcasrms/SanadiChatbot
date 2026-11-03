using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace Sanadi.Api.AI;

internal enum AiProviderKind
{
    OpenAiCompatible,
    AzureOpenAi,
    Gemini,
    Anthropic,
    Ollama
}

internal static class AiProviderChat
{
    internal static AiProviderKind? Resolve(string? provider) => provider?.Trim().ToLowerInvariant() switch
    {
        "openai" or "lovable" or "custom" => AiProviderKind.OpenAiCompatible,
        "azure" or "azure_openai" => AiProviderKind.AzureOpenAi,
        "gemini" or "google" => AiProviderKind.Gemini,
        "anthropic" => AiProviderKind.Anthropic,
        "ollama" => AiProviderKind.Ollama,
        _ => null
    };

    internal static HttpRequestMessage CreateRequest(
        AiProviderKind provider,
        string apiUrl,
        string apiKey,
        Guid userId,
        string model,
        string prompt,
        decimal temperature,
        int maxOutputTokens,
        bool? enableThinking,
        bool stream = false)
    {
        if (provider == AiProviderKind.Ollama)
        {
            if (enableThinking is null)
                throw new InvalidOperationException("The enabled Ollama configuration requires enable_thinking.");

            return OllamaChatRequest.Create(
                apiUrl, apiKey, userId, model, prompt, maxOutputTokens, enableThinking.Value,
                stream: stream, temperature: temperature);
        }

        var request = provider switch
        {
            AiProviderKind.Gemini => CreateGemini(apiUrl, apiKey, model, prompt, temperature, maxOutputTokens),
            AiProviderKind.Anthropic => CreateAnthropic(apiUrl, apiKey, model, prompt, temperature, maxOutputTokens),
            AiProviderKind.AzureOpenAi => CreateOpenAiCompatible(
                apiUrl, apiKey, model, prompt, temperature, maxOutputTokens, azure: true, stream),
            AiProviderKind.OpenAiCompatible => CreateOpenAiCompatible(
                apiUrl, apiKey, model, prompt, temperature, maxOutputTokens, azure: false, stream),
            _ => throw new InvalidOperationException("Unsupported AI provider configuration.")
        };

        return request;
    }

    internal static string? ReadText(AiProviderKind provider, JsonElement root)
    {
        if (provider == AiProviderKind.Gemini)
        {
            if (!root.TryGetProperty("candidates", out var candidates) || candidates.GetArrayLength() == 0 ||
                !candidates[0].TryGetProperty("content", out var content) ||
                !content.TryGetProperty("parts", out var parts))
                return null;

            return string.Concat(parts.EnumerateArray()
                .Select(part => part.TryGetProperty("text", out var text) ? text.GetString() : null)).Trim();
        }

        if (provider == AiProviderKind.Anthropic)
        {
            if (!root.TryGetProperty("content", out var content)) return null;
            return string.Concat(content.EnumerateArray()
                .Select(part => part.TryGetProperty("text", out var text) ? text.GetString() : null)).Trim();
        }

        if (!root.TryGetProperty("choices", out var choices) || choices.GetArrayLength() == 0 ||
            !choices[0].TryGetProperty("message", out var message) ||
            !message.TryGetProperty("content", out var responseText))
            return null;

        return responseText.GetString()?.Trim();
    }

    private static HttpRequestMessage CreateGemini(
        string apiUrl, string apiKey, string model, string prompt, decimal temperature, int maxOutputTokens)
    {
        var providerModel = model.StartsWith("google/", StringComparison.OrdinalIgnoreCase) ? model[7..] : model;
        var request = new HttpRequestMessage(
            HttpMethod.Post, WithPath(apiUrl, $"models/{providerModel}:generateContent"));
        request.Headers.Add("x-goog-api-key", apiKey);
        request.Content = JsonContent.Create(new
        {
            contents = new[] { new { parts = new[] { new { text = prompt } } } },
            generationConfig = new { temperature, maxOutputTokens }
        });
        return request;
    }

    private static HttpRequestMessage CreateAnthropic(
        string apiUrl, string apiKey, string model, string prompt, decimal temperature, int maxOutputTokens)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, WithPath(apiUrl, "messages"));
        request.Headers.Add("x-api-key", apiKey);
        request.Headers.Add("anthropic-version", "2023-06-01");
        request.Content = JsonContent.Create(new
        {
            model,
            max_tokens = maxOutputTokens,
            temperature,
            messages = new[] { new { role = "user", content = prompt } }
        });
        return request;
    }

    private static HttpRequestMessage CreateOpenAiCompatible(
        string apiUrl,
        string apiKey,
        string model,
        string prompt,
        decimal temperature,
        int maxOutputTokens,
        bool azure,
        bool stream)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, AiServerEndpoint.For(apiUrl, "chat/completions"));
        if (azure)
            request.Headers.Add("api-key", apiKey);
        else
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        request.Content = JsonContent.Create(new
        {
            model,
            temperature,
            max_tokens = maxOutputTokens,
            stream,
            messages = new[] { new { role = "user", content = prompt } }
        });
        return request;
    }

    private static string WithPath(string apiUrl, string path)
    {
        var queryIndex = apiUrl.IndexOf('?');
        var query = queryIndex < 0 ? "" : apiUrl[queryIndex..];
        var baseUrl = (queryIndex < 0 ? apiUrl : apiUrl[..queryIndex]).TrimEnd('/');
        var endpoint = baseUrl.EndsWith($"/{path}", StringComparison.OrdinalIgnoreCase)
            ? baseUrl
            : $"{baseUrl}/{path}";
        return endpoint + query;
    }
}
