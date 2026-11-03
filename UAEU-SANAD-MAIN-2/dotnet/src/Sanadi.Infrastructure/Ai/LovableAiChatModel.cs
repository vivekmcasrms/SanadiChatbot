using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Sanadi.Application;

namespace Sanadi.Infrastructure.Ai;

public class AiOptions
{
    /// <summary>OpenAI-compatible endpoint. Defaults to the Lovable AI Gateway.</summary>
    public string BaseUrl { get; set; } = "https://ai.gateway.lovable.dev/v1";
    public string ApiKey { get; set; } = string.Empty;
    public string ChatModel { get; set; } = "google/gemini-2.5-flash";
    public string EmbeddingModel { get; set; } = "text-embedding-3-small";
}

public class LovableAiChatModel(HttpClient http, IOptions<AiOptions> options) : IChatModel
{
    private readonly AiOptions _o = options.Value;

    public async Task<string> CompleteAsync(IReadOnlyList<ModelMessage> messages, ModelOptions? opts = null,
        CancellationToken ct = default)
    {
        var payload = Payload(messages, opts, stream: false);
        using var res = await http.PostAsJsonAsync($"{_o.BaseUrl}/chat/completions", payload, ct);
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException(
                $"AI request failed [{(int)res.StatusCode}]: {await res.Content.ReadAsStringAsync(ct)}");

        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        return doc.RootElement.GetProperty("choices")[0].GetProperty("message")
            .GetProperty("content").GetString() ?? "";
    }

    public async IAsyncEnumerable<string> StreamAsync(IReadOnlyList<ModelMessage> messages, ModelOptions? opts = null,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{_o.BaseUrl}/chat/completions")
        {
            Content = JsonContent.Create(Payload(messages, opts, stream: true)),
        };
        using var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        res.EnsureSuccessStatusCode();

        await using var stream = await res.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream, Encoding.UTF8);
        while (!reader.EndOfStream && !ct.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(ct);
            if (string.IsNullOrWhiteSpace(line) || !line.StartsWith("data:")) continue;
            var data = line[5..].Trim();
            if (data == "[DONE]") yield break;

            string? delta = null;
            try
            {
                using var doc = JsonDocument.Parse(data);
                delta = doc.RootElement.GetProperty("choices")[0].GetProperty("delta")
                    .TryGetProperty("content", out var c) ? c.GetString() : null;
            }
            catch { /* keep-alive frame */ }
            if (!string.IsNullOrEmpty(delta)) yield return delta!;
        }
    }

    private object Payload(IReadOnlyList<ModelMessage> messages, ModelOptions? opts, bool stream) => new
    {
        model = opts?.Model ?? _o.ChatModel,
        temperature = opts?.Temperature ?? 0.2,
        max_tokens = opts?.MaxTokens ?? 1600,
        stream,
        messages = messages.Select(m => new { role = m.Role, content = m.Content }),
    };
}

public class LovableEmbeddingModel(HttpClient http, IOptions<AiOptions> options) : IEmbeddingModel
{
    private readonly AiOptions _o = options.Value;

    public async Task<float[]> EmbedAsync(string text, CancellationToken ct = default)
    {
        using var res = await http.PostAsJsonAsync($"{_o.BaseUrl}/embeddings",
            new { model = _o.EmbeddingModel, input = text }, ct);
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException(
                $"Embedding request failed [{(int)res.StatusCode}]: {await res.Content.ReadAsStringAsync(ct)}");

        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
        return doc.RootElement.GetProperty("data")[0].GetProperty("embedding")
            .EnumerateArray().Select(v => (float)v.GetDouble()).ToArray();
    }
}
