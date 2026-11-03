using System.Text.RegularExpressions;

namespace Sanadi.Api.AI;

/// <summary>Speech-only punctuation and boundaries; never rewrites the answer's facts or language.</summary>
internal static class VoicePhrasing
{
    private static readonly Regex Boundary = new("[.!?؟…]+[\"'”’»)*_\\]]*(?=\\s)|\\r?\\n");
    private static readonly Regex Titles = new(@"(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|No)|\b[A-Z]|\b(?:[A-Za-z]\.)+[A-Za-z]|\b[دأ])$", RegexOptions.IgnoreCase);

    internal static IEnumerable<int> Boundaries(string text)
    {
        foreach (Match match in Boundary.Matches(text))
        {
            var lineStart = match.Index == 0 ? 0 : text.LastIndexOf('\n', match.Index - 1) + 1;
            var before = text[lineStart..match.Index].Trim();
            if (match.Value.Contains('\n') && before.Length == 0) continue;
            if (match.Value[0] == '.')
            {
                // Keep titles, abbreviations and numbered list markers with their following words.
                if (Titles.IsMatch(before) || Regex.IsMatch(before, @"^\p{N}{1,3}$")) continue;
                // A link label can contain a title or sentence punctuation.
                if (text.LastIndexOf('[', match.Index) > text.LastIndexOf(']', match.Index)) continue;
            }
            if (match.Value.Contains('\n') &&
                (before.TrimEnd('*', '_', ' ').EndsWith(':') || Regex.IsMatch(before, @"^#{1,6}\s")))
                continue; // Speak a heading and its first detail together.
            yield return match.Index + match.Length;
        }
    }

    internal static string Format(string text, string language, bool continuation)
    {
        // A heading is a spoken lead-in, not a standalone fragment followed by a full stop.
        text = Regex.Replace(text, @"^\s{0,3}#{1,6}\s*(.+?)\s*#*\r?\n", "$1:\n", RegexOptions.Multiline);
        var spoken = VoiceSpeechFormatter.ToSpeech(text, language);
        spoken = Regex.Replace(spoken, @"([,،:;؛])\.", "$1");
        spoken = Regex.Replace(spoken, "([.!?؟…][\"'”’»)])\\.", "$1");
        if (continuation && spoken.Length > 0 && !Regex.IsMatch(spoken, @"[,،:;؛]$"))
            spoken = spoken.TrimEnd('.') + (language == "ar" ? "،" : ",");
        return spoken;
    }
}
