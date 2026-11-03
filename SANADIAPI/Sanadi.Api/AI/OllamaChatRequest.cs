using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace Sanadi.Api.AI;

internal static class OllamaChatRequest
{
    internal static HttpRequestMessage Create(
        string apiUrl,
        string appKey,
        Guid userId,
        string modelName,
        string prompt,
        int maxOutputTokens,
        bool enableThinking,
        bool stream = false,
        decimal? temperature = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, AiServerEndpoint.For(apiUrl, "chat/completions"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", appKey);
        request.Headers.Add("X-LLM-User-ID", userId.ToString());
        request.Content = JsonContent.Create(new OllamaChatPayload(
            modelName,
            [new OllamaChatMessage("user", prompt)],
            maxOutputTokens,
            new OllamaChatTemplateOptions(enableThinking),
            stream ? true : null,
            temperature));
        return request;
    }
}

internal sealed record OllamaChatPayload(
    [property: JsonPropertyName("model")] string Model,
    [property: JsonPropertyName("messages")] OllamaChatMessage[] Messages,
    [property: JsonPropertyName("max_tokens")] int MaxTokens,
    [property: JsonPropertyName("chat_template_kwargs")] OllamaChatTemplateOptions ChatTemplateKwargs,
    [property: JsonPropertyName("stream"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Stream = null,
    [property: JsonPropertyName("temperature"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] decimal? Temperature = null);

internal sealed record OllamaChatMessage(
    [property: JsonPropertyName("role")] string Role,
    [property: JsonPropertyName("content")] string Content);

internal sealed record OllamaChatTemplateOptions(
    [property: JsonPropertyName("enable_thinking")] bool EnableThinking);
