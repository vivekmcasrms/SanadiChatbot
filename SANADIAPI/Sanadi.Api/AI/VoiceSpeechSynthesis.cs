using System.Text;
using System.Text.RegularExpressions;

namespace Sanadi.Api.AI;

/// <summary>
/// Voice chat only: turns a spoken reply into audio on the server so Arabic
/// playback does not depend on Windows / macOS voices installed on the student's PC.
/// The text chatbot never uses this type.
/// </summary>
public sealed class VoiceSpeechSynthesis(ConfiguredSpeech privateSpeech)
{
    private const int MaxChars = 1500;

    public async Task<(byte[] Audio, string ContentType)> Speak(
        string text, string lang, string agent, Guid userId, CancellationToken ct)
    {
        var spoken = Regex.Replace(text.Trim(), @"\s+", " ");
        if (spoken.Length > MaxChars) spoken = spoken[..MaxChars];
        var settings = await privateSpeech.Load(ct);
        var audio = await privateSpeech.Speak(settings, spoken, lang, agent, userId, ct);
        return (audio, "audio/wav");
    }

    internal static IEnumerable<string> Chunks(string text, int max)
    {
        if (text.Length <= max)
        {
            yield return text;
            yield break;
        }
        var buffer = new StringBuilder();
        foreach (var piece in Regex.Split(text, @"(?<=[.!?؟\n])\s*"))
        {
            if (piece.Length == 0) continue;
            if (piece.Length > max)
            {
                if (buffer.Length > 0)
                {
                    yield return buffer.ToString();
                    buffer.Clear();
                }
                foreach (var part in SplitLong(piece, max)) yield return part;
                continue;
            }
            if (buffer.Length > 0 && buffer.Length + 1 + piece.Length > max)
            {
                yield return buffer.ToString();
                buffer.Clear();
            }
            if (buffer.Length > 0) buffer.Append(' ');
            buffer.Append(piece);
        }
        if (buffer.Length > 0) yield return buffer.ToString();
    }

    private static IEnumerable<string> SplitLong(string text, int max)
    {
        var start = 0;
        while (start < text.Length)
        {
            var remaining = text.Length - start;
            if (remaining <= max)
            {
                yield return text[start..].Trim();
                yield break;
            }
            var window = text.AsSpan(start, max);
            var cut = window.LastIndexOf(' ');
            if (cut < 8) cut = max;
            var slice = text.Substring(start, cut).Trim();
            if (slice.Length > 0) yield return slice;
            start += cut;
            while (start < text.Length && text[start] == ' ') start += 1;
        }
    }

}
