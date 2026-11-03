using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Buffers.Binary;
using Dapper;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.AI;

/// <summary>Chatterbox on the university AI gateway. Credentials never leave the API.</summary>
public sealed class ConfiguredSpeech(ISqlConnectionFactory connections, IHttpClientFactory clients)
{
    internal sealed record Settings(string Url, string Key);
    internal const int MaximumWavBytes = 8_000_000;

    // Snapshot once per turn; use the same gateway and credential for every sentence.
    internal async Task<Settings> Load(CancellationToken ct)
    {
        await using var connection = connections.Create();
        var row = await connection.QueryFirstOrDefaultAsync(DbProc.Call("usp_Assistant_GetAiSettings", null, ct));
        if (row is null || row.ai_enabled is not true)
            throw new SanadiException("Speech requires active AI settings.", 503, "tts_not_configured");
        var settings = new Settings(((string?)row.api_url ?? "").Trim(), ((string?)row.api_key ?? "").Trim());
        try { _ = AiServerEndpoint.For(settings.Url, "audio/speech"); }
        catch (ArgumentException) { throw new SanadiException("Speech requires a valid AI server URL.", 503, "tts_not_configured"); }
        if (string.IsNullOrWhiteSpace(settings.Key))
            throw new SanadiException("Speech requires the AI server credential.", 503, "tts_not_configured");
        return settings;
    }

    internal Task<byte[]> Speak(Settings settings, string text, string language, string agent, Guid userId, CancellationToken ct)
        => Speak(clients.CreateClient("ConfiguredSpeech"), settings, text, language, agent, userId, ct);

    internal Task<byte[]> SpeakForCall(Settings settings, string text, string language, string agent, Guid userId, CancellationToken ct)
        => SpeakForCall(clients.CreateClient("ConfiguredSpeech"), settings, text, language, agent, userId, ct);

    internal static async Task<byte[]> SpeakForCall(HttpClient client, Settings settings, string text, string language,
        string agent, Guid userId, CancellationToken ct)
    {
        try { return await Speak(client, settings, text, language, agent, userId, ct); }
        catch (Exception error) when (error is SanadiException { Code: "tts_service_unavailable", StatusCode: 502 or 504 }
                or HttpRequestException or IOException)
        {
            // Retry only an unsent WAV after a transient failure. Never rerun the agent/workflow,
            // replay a completed chunk, change voices, or retry invalid settings/authentication.
            ct.ThrowIfCancellationRequested();
            await Task.Delay(200, ct);
            return await Speak(client, settings, text, language, agent, userId, ct);
        }
    }

    internal static HttpRequestMessage Request(Settings settings, string text, string language, string agent, Guid userId)
    {
        if (language is not ("ar" or "en") || agent is not ("mira" or "suhail")
            || string.IsNullOrWhiteSpace(text) || text.Length > 6000 || userId == Guid.Empty)
            throw new ArgumentException("Invalid speech request.");
        var spoken = VoiceNumberPronunciation.ForSpeech(text, language);
        if (spoken.Length > 6000) throw new ArgumentException("Speech pronunciation exceeds the request limit.");
        var request = new HttpRequestMessage(HttpMethod.Post, AiServerEndpoint.For(settings.Url, "audio/speech"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.Key);
        request.Headers.Add("X-LLM-User-ID", userId.ToString());
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("audio/wav"));
        // Identity selects the voice in both languages. The shared "default" voice
        // makes Mira and Suhail sound identical in English.
        request.Content = JsonContent.Create(new
        {
            model = "chatterbox-multilingual", input = spoken, language,
            voice = agent == "mira" ? "female" : "male", response_format = "wav"
        });
        return request;
    }

    internal static async Task<byte[]> Speak(HttpClient client, Settings settings, string text, string language,
        string agent, Guid userId, CancellationToken ct)
    {
        if (language is not ("ar" or "en") || agent is not ("mira" or "suhail") ||
            string.IsNullOrWhiteSpace(text) || text.Length > 6000 || userId == Guid.Empty)
            throw new ArgumentException("Invalid speech request.");
        return await VoiceNumberSpeech.Synthesize(text, language,
            (part, token) => SpeakRaw(client, settings, part, language, agent, userId, token),
            (wav, token) => OllamaVoiceTranscription.Transcribe(client,
                OllamaVoiceTranscription.FromAiSettings(settings.Url, settings.Key), wav, userId, token, language), ct);
    }

    private static async Task<byte[]> SpeakRaw(HttpClient client, Settings settings, string text, string language,
        string agent, Guid userId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        // ResponseHeadersRead otherwise stops HttpClient's timeout at the headers. Keep the
        // existing time budget for the complete WAV, without changing caller cancellation.
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        if (client.Timeout != Timeout.InfiniteTimeSpan) deadline.CancelAfter(client.Timeout);
        try { return await ReadWave(client, settings, text, language, agent, userId, deadline.Token); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        { throw new SanadiException("Speech server timed out.", 504, "tts_service_unavailable"); }
        catch (HttpRequestException) when (!ct.IsCancellationRequested)
        { throw new SanadiException("Speech server is unavailable.", 502, "tts_service_unavailable"); }
    }

    private static async Task<byte[]> ReadWave(HttpClient client, Settings settings, string text, string language,
        string agent, Guid userId, CancellationToken ct)
    {
        using var request = Request(settings, text, language, agent, userId);
        using var response = await Send(client, request, ct);
        if (!response.IsSuccessStatusCode)
            throw new SanadiException("Speech generation failed on the configured AI server.", 502,
                response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden ? "tts_auth_failed"
                : response.StatusCode == HttpStatusCode.NotFound ? "tts_endpoint_missing"
                : response.StatusCode == HttpStatusCode.BadRequest ? "tts_request_rejected" : "tts_service_unavailable");
        // Do not log upstream bodies, credentials, or student text; do not retry with a different voice.
        if (response.Content.Headers.ContentLength > MaximumWavBytes)
            throw new SanadiException("Invalid speech audio.", 502, "tts_invalid_audio");
        await using var input = await response.Content.ReadAsStreamAsync(ct);
        using var output = new MemoryStream();
        var buffer = new byte[32768];
        int count;
        while ((count = await input.ReadAsync(buffer, ct)) > 0)
        {
            if (output.Length + count > MaximumWavBytes)
                throw new SanadiException("Invalid speech audio.", 502, "tts_invalid_audio");
            output.Write(buffer, 0, count);
        }
        var wav = output.ToArray();
        if (!ValidWave(wav))
            throw new SanadiException("Invalid speech audio.", 502, "tts_invalid_audio");
        return VoiceAudioCleanup.Apply(wav);
    }

    private static async Task<HttpResponseMessage> Send(HttpClient client, HttpRequestMessage request, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        try { return await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct); }
        catch (HttpRequestException)
        { throw new SanadiException("Speech server is unavailable.", 502, "tts_service_unavailable"); }
        catch (OperationCanceledException)
        {
            // End Call/interruption is an intentional stop, not failed or empty speech.
            // The turn/preparation boundary handles it quietly; never retry cancelled work.
            if (ct.IsCancellationRequested) throw;
            throw new SanadiException("Speech server timed out.", 504, "tts_service_unavailable");
        }
    }

    internal static bool ValidWave(byte[] wav)
    {
        if (!PrivateVoiceService.ValidWav(wav) || wav.Length <= 44
            || BinaryPrimitives.ReadUInt32LittleEndian(wav.AsSpan(4, 4)) != wav.Length - 8) return false;
        var format = false;
        var data = false;
        var offset = 12;
        while (offset + 8 <= wav.Length)
        {
            var size = BinaryPrimitives.ReadUInt32LittleEndian(wav.AsSpan(offset + 4, 4));
            if (size > wav.Length - offset - 8) return false;
            if (wav.AsSpan(offset, 4).SequenceEqual("fmt "u8)) format = size >= 16;
            if (wav.AsSpan(offset, 4).SequenceEqual("data"u8)) data = size > 0;
            offset += 8 + (int)size + ((int)size & 1);
        }
        return format && data && offset == wav.Length;
    }
}
