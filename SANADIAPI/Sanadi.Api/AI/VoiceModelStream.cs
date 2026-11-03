using System.Text;
using System.Text.Json;

namespace Sanadi.Api.AI;

/// <summary>Reads the configured gateway's SSE or Ollama NDJSON incrementally.</summary>
internal static class VoiceModelStream
{
    internal static async Task<string> Read(Stream stream, Func<string, Task> onText, CancellationToken ct)
    {
        using var reader = new StreamReader(stream, Encoding.UTF8);
        var answer = new StringBuilder();
        var filter = new ThinkingFilter();
        var finished = false;
        while (await reader.ReadLineAsync(ct) is { } line)
        {
            ct.ThrowIfCancellationRequested();
            if (line.Length > 131072) throw new InvalidOperationException("model_stream_too_large");
            if (string.IsNullOrWhiteSpace(line) || line.StartsWith(':') || line.StartsWith("event:")
                || line.StartsWith("id:") || line.StartsWith("retry:")) continue;
            var data = line.StartsWith("data:") ? line[5..].TrimStart() : line;
            if (data == "[DONE]") { finished = true; break; }
            using var json = JsonDocument.Parse(data);
            var root = json.RootElement;
            if (root.TryGetProperty("error", out _)) throw new InvalidOperationException("model_stream_failed");
            string? delta = null;
            if (root.TryGetProperty("choices", out var choices) && choices.GetArrayLength() > 0)
            {
                var choice = choices[0];
                if (choice.TryGetProperty("delta", out var part) && part.TryGetProperty("content", out var content))
                    delta = content.ValueKind == JsonValueKind.String ? content.GetString() : null;
                if (choice.TryGetProperty("finish_reason", out var reason) && reason.ValueKind == JsonValueKind.String)
                {
                    if (reason.GetString() != "stop") throw new InvalidOperationException("model_reply_incomplete");
                    finished = true;
                }
            }
            else
            {
                if (root.TryGetProperty("message", out var message) && message.TryGetProperty("content", out var content))
                    delta = content.GetString();
                if (root.TryGetProperty("done", out var done) && done.ValueKind == JsonValueKind.True)
                {
                    if (root.TryGetProperty("done_reason", out var reason) && reason.GetString() == "length")
                        throw new InvalidOperationException("model_reply_incomplete");
                    finished = true;
                }
            }
            if (delta?.Length > 32000) throw new InvalidOperationException("model_stream_too_large");
            var visible = filter.Push(delta ?? "");
            if (visible.Length > 0)
            {
                answer.Append(visible);
                if (answer.Length > 32000) throw new InvalidOperationException("model_stream_too_large");
                await onText(visible);
            }
        }
        if (!finished) throw new InvalidOperationException("model_stream_disconnected");
        var tail = filter.Finish();
        if (tail.Length > 0) { answer.Append(tail); await onText(tail); }
        if (answer.Length == 0) throw new InvalidOperationException("model_reply_empty");
        return answer.ToString().Trim();
    }

    // Some gateways put <think> in content instead of a separate reasoning field.
    // Hold partial tags across network chunks; never speak hidden reasoning.
    private sealed class ThinkingFilter
    {
        private string pending = "";
        private bool hidden;
        internal string Push(string text)
        {
            pending += text;
            var output = new StringBuilder();
            var position = 0;
            while (position < pending.Length)
            {
                var tag = hidden ? "</think>" : "<think>";
                var remaining = pending.AsSpan(position);
                if (remaining.StartsWith(tag, StringComparison.OrdinalIgnoreCase))
                { hidden = !hidden; position += tag.Length; continue; }
                if (tag.AsSpan().StartsWith(remaining, StringComparison.OrdinalIgnoreCase)) break;
                if (!hidden) output.Append(pending[position]);
                position++;
            }
            pending = pending[position..];
            return output.ToString();
        }
        internal string Finish() => hidden || pending.StartsWith('<') ? "" : pending;
    }
}
