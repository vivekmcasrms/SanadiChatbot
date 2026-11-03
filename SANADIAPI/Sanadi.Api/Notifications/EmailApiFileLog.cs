using System.Diagnostics;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging.Abstractions;

namespace Sanadi.Api.Notifications;

// Local server diagnostics only. Never expose these files through an API or static files.
public sealed class EmailApiFileLog(string directory, ILogger<EmailApiFileLog>? logger = null)
{
    private static readonly SemaphoreSlim Writes = new(1, 1);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
        { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    private readonly ILogger<EmailApiFileLog> logger = logger ?? NullLogger<EmailApiFileLog>.Instance;
    public string DirectoryPath { get; } = Path.GetFullPath(directory);

    public Task WriteAsync(Guid exchangeId, string phase, Func<Task<object>> details, string? bearer)
    {
        // Email API txt file logging disabled.
        _ = (exchangeId, phase, details, bearer);
        return Task.CompletedTask;
        // Diagnostics must not change the send result, even on cancellation or disk failure.
        // try
        // {
        //     var entry = JsonSerializer.SerializeToNode(new
        //     {
        //         timestampUtc = DateTimeOffset.UtcNow, exchangeId, phase, details = await details()
        //     }, Json)!;
        //     Redact(entry, bearer);
        //     var line = entry.ToJsonString(Json) + Environment.NewLine;
        //     using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        //     await Writes.WaitAsync(timeout.Token);
        //     try
        //     {
        //         Directory.CreateDirectory(DirectoryPath);
        //         // Separate worker processes cannot interleave entries into one file.
        //         var file = Path.Combine(DirectoryPath, $"email-api-{DateTime.UtcNow:yyyy-MM-dd}-{Environment.ProcessId}.txt");
        //         await File.AppendAllTextAsync(file, line, new UTF8Encoding(false), timeout.Token);
        //     }
        //     finally { Writes.Release(); }
        // }
        // catch (Exception error)
        // {
        //     try { logger.LogWarning("Email API text logging failed ({ErrorType}); email processing continues.", error.GetType().Name); }
        //     catch { /* A logging provider must not alter email processing either. */ }
        // }
    }

    internal static async Task<JsonNode?> BodyAsync(HttpContent? content)
    {
        if (content is null) return null;
        var text = await content.ReadAsStringAsync();
        try { return JsonNode.Parse(text); }
        catch (JsonException) { return JsonValue.Create(text); }
    }

    private static bool Sensitive(string name) => name.Replace("_", "").Replace("-", "").ToLowerInvariant()
        is "authorization" or "proxyauthorization" or "token" or "accesstoken" or "refreshtoken"
            or "idtoken" or "jwt" or "clientsecret" or "password" or "apikey" or "cookie" or "setcookie";

    private static void Redact(JsonNode node, string? bearer)
    {
        if (node is JsonObject obj)
        {
            foreach (var (key, value) in obj.ToArray())
                if (Sensitive(key)) obj[key] = "[REDACTED]";
                else if (value is JsonValue scalar && scalar.TryGetValue<string>(out var text)) obj[key] = SafeText(text, bearer);
                else if (value is not null) Redact(value, bearer);
        }
        else if (node is JsonArray array)
            for (var i = 0; i < array.Count; i++)
                if (array[i] is JsonValue scalar && scalar.TryGetValue<string>(out var text)) array[i] = SafeText(text, bearer);
                else if (array[i] is { } value) Redact(value, bearer);
    }

    private static string SafeText(string text, string? bearer)
    {
        if (!string.IsNullOrEmpty(bearer)) text = text.Replace(bearer, "[REDACTED]", StringComparison.Ordinal);
        return Regex.Replace(text, @"(?i)Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[REDACTED]");
    }
}

// Attached exclusively to the Email API HTTP client; SSO and authorization calls are untouched.
public sealed class EmailApiLoggingHandler(EmailApiFileLog log) : DelegatingHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var id = Guid.NewGuid();
        var bearer = request.Headers.Authorization?.Parameter;
        await log.WriteAsync(id, "request", async () => new
        {
            method = request.Method.Method, url = request.RequestUri?.GetLeftPart(UriPartial.Path),
            contentType = request.Content?.Headers.ContentType?.ToString(),
            authorization = request.Headers.Authorization is null ? null : "[REDACTED]",
            parameters = await EmailApiFileLog.BodyAsync(request.Content)
        }, bearer);
        var started = Stopwatch.GetTimestamp();
        try
        {
            var response = await base.SendAsync(request, ct);
            await log.WriteAsync(id, "response", async () => new
            {
                statusCode = (int)response.StatusCode, reason = response.ReasonPhrase,
                elapsedMs = Stopwatch.GetElapsedTime(started).TotalMilliseconds,
                contentType = response.Content.Headers.ContentType?.ToString(),
                body = await EmailApiFileLog.BodyAsync(response.Content)
            }, bearer);
            return response;
        }
        catch (Exception error)
        {
            await log.WriteAsync(id, "error", () => Task.FromResult<object>(new
            {
                errorType = error.GetType().Name, message = error.Message,
                elapsedMs = Stopwatch.GetElapsedTime(started).TotalMilliseconds,
                cancellationRequested = ct.IsCancellationRequested
            }), bearer);
            throw;
        }
    }
}
