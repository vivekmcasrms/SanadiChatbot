using System.Net.Http.Headers;
using System.Text.Json;

namespace Sanadi.Api.AI;

/// <summary>Dedicated advisor audio transport. No public TTS or voice substitution.</summary>
public sealed class PrivateVoiceService(IConfiguration config, IHttpClientFactory clients)
{
    public bool Enabled => config.GetValue("Voice:Enabled", true);
    public bool Configured => Enabled
        && !string.IsNullOrWhiteSpace(config["Voice:WhisperBaseUrl"])
        && !string.IsNullOrWhiteSpace(config["Voice:TtsBaseUrl"])
        && !string.IsNullOrWhiteSpace(config["Voice:FemaleVoice"])
        && !string.IsNullOrWhiteSpace(config["Voice:MaleVoice"])
        && config["Voice:FemaleVoice"] != config["Voice:MaleVoice"];

    public async Task<(string Text, string Language)> Transcribe(byte[] wav, CancellationToken ct)
    {
        using var request = Request("Whisper", "/v1/audio/transcriptions");
        var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(wav);
        file.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        form.Add(file, "file", "question.wav");
        form.Add(new StringContent("whisper-1"), "model");
        form.Add(new StringContent("json"), "response_format");
        // No language hint: private Whisper detects Arabic or English each turn.
        request.Content = form;
        using var response = await clients.CreateClient("VoiceInference").SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        var text = json.RootElement.GetProperty("text").GetString()?.Trim() ?? "";
        var language = json.RootElement.TryGetProperty("language", out var detected) ? detected.GetString() : null;
        if (language is not ("ar" or "en")) throw new InvalidOperationException("unsupported_spoken_language");
        if (text.Length > 6000) throw new InvalidOperationException("transcript_too_long");
        return (text, language);
    }

    public async Task<byte[]> Speak(string text, string language, string agent, CancellationToken ct)
    {
        if (agent is not ("mira" or "suhail") || language is not ("ar" or "en"))
            throw new ArgumentException("invalid_voice_identity_or_language");
        if (!Configured) throw new InvalidOperationException("private_voice_not_configured");
        return await VoiceNumberSpeech.Synthesize(text, language,
            (part, token) => SpeakRaw(part, language, agent, token),
            async (wav, token) => (await Transcribe(wav, token)).Text, ct);
    }

    private async Task<byte[]> SpeakRaw(string text, string language, string agent, CancellationToken ct)
    {
        using var request = Request("Tts", "/v1/audio/speech");
        request.Content = JsonContent.Create(new {
            model = config["Voice:TtsModel"] ?? "chatterbox-multilingual-v3",
            input = VoiceNumberPronunciation.ForSpeech(text, language),
            voice = config[agent == "mira" ? "Voice:FemaleVoice" : "Voice:MaleVoice"],
            language_id = language,
            response_format = "wav"
        });
        using var response = await clients.CreateClient("VoiceInference").SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        var audio = await response.Content.ReadAsByteArrayAsync(ct);
        if (!ValidWav(audio) || audio.Length > 24_000_000)
            throw new InvalidOperationException("invalid_speech_audio");
        return VoiceAudioCleanup.Apply(audio);
    }

    internal static bool ValidWav(byte[] audio) => audio.Length >= 44
        && audio.AsSpan(0, 4).SequenceEqual("RIFF"u8)
        && audio.AsSpan(8, 4).SequenceEqual("WAVE"u8);

    private HttpRequestMessage Request(string service, string path)
    {
        if (!Configured) throw new InvalidOperationException("private_voice_not_configured");
        var request = new HttpRequestMessage(HttpMethod.Post, config[$"Voice:{service}BaseUrl"]!.TrimEnd('/') + path);
        var key = config[$"Voice:{service}ApiKey"];
        if (!string.IsNullOrWhiteSpace(key)) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        return request;
    }
}
