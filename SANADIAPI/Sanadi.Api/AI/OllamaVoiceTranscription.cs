using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Dapper;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.AppFunctions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.AI;

/// <summary>Voice recognition on the configured private speech server, never the text chat model.</summary>
public sealed class OllamaVoiceTranscription(ISqlConnectionFactory connections, IHttpClientFactory clients,
    VoiceActivityDetector? activityDetector = null, IConfiguration? configuration = null) : IVoiceTranscriber
{
    internal sealed record Settings(string Url, string Key, string Model);
    internal const string TranscriptionModel = "whisper-large-v3";

    public async Task<string> Transcribe(byte[] wav, Guid userId, CancellationToken ct, string language = "auto")
    {
        if (userId == Guid.Empty) throw new UnauthorizedException();
        ct.ThrowIfCancellationRequested();
        if (language is not ("auto" or "en" or "ar"))
            throw new SanadiException("language: Invalid enum value");
        if ((configuration?.GetValue("Voice:ValidateTranscriptionSpeech", true) ?? true)
            && VoiceInputSpeechGuard.HasSpeech(wav, activityDetector, ct) == false)
            return "";
        var settings = await Load(ct);
        return await Transcribe(clients.CreateClient("VoiceTranscription"), settings, wav, userId, ct, language);
    }

    internal async Task<Settings> Load(CancellationToken ct)
    {
        // Use the same active gateway/credential as chat and TTS, not the chat
        // model_name and not browser-visible settings or legacy Whisper config.
        await using var connection = connections.Create();
        var row = await connection.QueryFirstOrDefaultAsync(DbProc.Call("usp_Assistant_GetAiSettings", null, ct));
        if (row is null || row.ai_enabled is not true)
            throw NotConfigured();
        return FromAiSettings((string?)row.api_url ?? "", (string?)row.api_key ?? "");
    }

    internal static Settings FromAiSettings(string url, string key)
    {
        if (string.IsNullOrWhiteSpace(key)) throw NotConfigured();
        try
        {
            return new Settings(AiServerEndpoint.For(url, "audio/transcriptions").AbsoluteUri,
                key.Trim(), TranscriptionModel);
        }
        catch (ArgumentException) { throw NotConfigured(); }
    }

    internal static async Task<string> Transcribe(
        HttpClient client, Settings settings, byte[] wav, Guid userId, CancellationToken ct, string language = "auto")
    {
        if (!Uri.TryCreate(settings.Url.Trim(), UriKind.Absolute, out var endpoint)
            || endpoint.Scheme is not ("http" or "https")
            || !string.IsNullOrEmpty(endpoint.UserInfo)
            || !endpoint.AbsolutePath.EndsWith("/audio/transcriptions", StringComparison.OrdinalIgnoreCase)
            || string.IsNullOrWhiteSpace(settings.Model)
            || string.IsNullOrWhiteSpace(settings.Key)
            || userId == Guid.Empty)
            throw new SanadiException("Speech recognition requires a private transcription endpoint and model.", 503, "stt_not_configured");
        if (language is not ("auto" or "en" or "ar"))
            throw new SanadiException("language: Invalid enum value");

        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.Key.Trim());
        request.Headers.Add("X-LLM-User-ID", userId.ToString());
        using var form = new MultipartFormDataContent();
        using var audio = new ByteArrayContent(wav);
        audio.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        form.Add(audio, "file", "question.wav");
        form.Add(new StringContent(settings.Model.Trim()), "model");
        form.Add(new StringContent("json"), "response_format");
        if (language is "en" or "ar") form.Add(new StringContent(language), "language");
        request.Content = form;

        HttpResponseMessage response;
        try { response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct); }
        catch (HttpRequestException)
        { throw new SanadiException("Private speech recognition is unavailable.", 502, "stt_service_unavailable"); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        { throw new SanadiException("Private speech recognition timed out.", 504, "stt_service_unavailable"); }

        using (response)
        {
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                throw new SanadiException("Private speech recognition access was rejected.", 502, "stt_auth_failed");
            if (!response.IsSuccessStatusCode)
                throw new SanadiException("Private speech recognition could not complete.", 502, "stt_service_unavailable");
            if (response.Content.Headers.ContentLength > 32_768)
                throw new SanadiException("The speech server returned an invalid transcript.", 502, "stt_service_unavailable");
            try
            {
                await using var stream = await response.Content.ReadAsStreamAsync(ct);
                using var buffer = new MemoryStream();
                var chunk = new byte[4096];
                int count;
                while ((count = await stream.ReadAsync(chunk, ct)) > 0)
                {
                    if (buffer.Length + count > 32_768)
                        throw new SanadiException("The speech server returned an invalid transcript.", 502, "stt_service_unavailable");
                    buffer.Write(chunk, 0, count);
                }
                using var json = JsonDocument.Parse(buffer.ToArray(), new JsonDocumentOptions { MaxDepth = 16 });
                if (json.RootElement.ValueKind != JsonValueKind.Object ||
                    !json.RootElement.TryGetProperty("text", out var content) || content.ValueKind != JsonValueKind.String)
                    throw new SanadiException("The speech server returned an invalid transcript.", 502, "stt_service_unavailable");
                var text = content.GetString()?.Trim() ?? "";
                if (text.Length > 6000)
                    throw new SanadiException("The speech server returned an invalid transcript.", 502, "stt_service_unavailable");
                VoiceTranscriptLanguage.RequireSupported(text);
                // Some gateways return a language label; never discard evidence that auto detection
                // chose a third language, including one that also uses Latin/Arabic script.
                if (text.Length > 0 && json.RootElement.TryGetProperty("language", out var detected)
                    && detected.ValueKind == JsonValueKind.String
                    && detected.GetString()?.Trim().ToLowerInvariant() is { Length: > 0 } code
                    && code is not ("en" or "ar" or "english" or "arabic"))
                    throw VoiceTranscriptLanguage.Unsupported();
                return text;
            }
            catch (JsonException)
            { throw new SanadiException("The speech server returned an invalid transcript.", 502, "stt_service_unavailable"); }
        }
    }

    private static SanadiException NotConfigured() => new("Speech recognition requires active AI gateway settings and a server credential.", 503, "stt_not_configured");
}
