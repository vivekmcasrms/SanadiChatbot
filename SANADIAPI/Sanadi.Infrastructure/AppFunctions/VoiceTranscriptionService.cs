using System.Text.RegularExpressions;
using System.Text.Json;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Infrastructure.AppFunctions;

/// <summary>The configured university AI adapter; never a public-cloud fallback.</summary>
public interface IVoiceTranscriber
{
    Task<string> Transcribe(byte[] wav, Guid userId, CancellationToken ct, string language = "auto");
}

public interface IVoiceTranscriptTranslator
{
    Task<string> Translate(string text, string targetLanguage, Guid userId, CancellationToken ct);
}

/// <summary>Preserves the microphone endpoint's input and response contract.</summary>
public sealed class VoiceTranscriptionService(IVoiceTranscriber transcriber, IVoiceTranscriptTranslator? translator = null)
{
    public async Task<object> Transcribe(FunctionInput input, Guid userId, CancellationToken ct)
    {
        if (userId == Guid.Empty) throw new UnauthorizedException();
        var audio = input.String("audioBase64", 64, 14_000_000);
        var language = input.Value.TryGetProperty("language", out _) ? input.String("language") : "auto";
        if (language is not ("auto" or "en" or "ar")) throw new SanadiException("language: Invalid enum value");
        var targetLanguage = input.Value.TryGetProperty("targetLanguage", out var target) && target.ValueKind != JsonValueKind.Null
            ? input.String("targetLanguage") : null;
        if (targetLanguage is not (null or "en" or "ar")) throw new SanadiException("targetLanguage: Invalid enum value");
        var recognitionHint = input.Value.TryGetProperty("recognitionHint", out var hint) && hint.ValueKind != JsonValueKind.Null
            ? input.String("recognitionHint") : null;
        if (recognitionHint is not (null or "en" or "ar")) throw new SanadiException("recognitionHint: Invalid enum value");
        var bytes = DecodeBase64(audio);
        if (bytes.Length < 2048) throw new SanadiException("empty_recording");
        if (bytes.Length > 10 * 1024 * 1024) throw new SanadiException("recording_too_long");
        ct.ThrowIfCancellationRequested();

        // A target is a display preference, not the language of the recording.
        // Older clients keep their existing explicit recognition-language behavior.
        async Task<string> Recognize(string sourceLanguage)
        {
            var transcript = await transcriber.Transcribe(bytes, userId, ct, sourceLanguage);
            ct.ThrowIfCancellationRequested();
            VoiceTranscriptLanguage.RequireSupported(transcript);
            return transcript;
        }
        var recognitionLanguage = targetLanguage is null ? language : "auto";
        // Recognition recovery is independent of translation. Preserve compatibility
        // for older clients that supplied their preference as targetLanguage.
        var recoveryLanguage = recognitionHint ?? targetLanguage;
        string text;
        try { text = await Recognize(recognitionLanguage); }
        catch (SanadiException error) when (error.Code == VoiceTranscriptLanguage.ErrorCode
            && recognitionLanguage == "auto" && recoveryLanguage is "en" or "ar")
        {
            // Re-read the original recording, never translate or guess from a misdetected script.
            // The normal EN/AR path remains a single request. Recovery is bounded to one attempt.
            ct.ThrowIfCancellationRequested();
            text = await Recognize(recoveryLanguage);
        }
        var sourceText = text;
        if (targetLanguage is not null && !string.IsNullOrWhiteSpace(text))
        {
            if (translator is null) throw new SanadiException("Voice translation is unavailable.", 503, "stt_translation_unavailable");
            text = await translator.Translate(text.Trim(), targetLanguage, userId, ct);
            VoiceTranscriptLanguage.RequireSupported(text);
        }
        if (input.Value.TryGetProperty("includeFeedbackContext", out var feedback) && feedback.ValueKind == JsonValueKind.True)
            return new { text = text.Trim(), confidence = (double?)null, sourceText };
        return new { text = text.Trim(), confidence = (double?)null };
    }

    internal static byte[] DecodeBase64(string audio)
    {
        // Keep the existing URL-safe/whitespace-tolerant microphone payload handling.
        var encoded = Regex.Replace(audio.Split('=')[0].Replace('-', '+').Replace('_', '/'), "[^A-Za-z0-9+/]", "");
        if (encoded.Length % 4 == 1) encoded = encoded[..^1];
        encoded = encoded.PadRight(encoded.Length + (4 - encoded.Length % 4) % 4, '=');
        return Convert.FromBase64String(encoded);
    }
}
