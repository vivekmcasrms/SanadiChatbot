using System.Text;
using System.Text.RegularExpressions;

namespace Sanadi.Api.AI;

/// <summary>
/// Voice chat only. Turns the text chatbot's formatted answer (Sanadi Online layout:
/// bold outcome, lists, links, status markers) into plain spoken sentences.
/// The text chatbot answer itself is never changed; this produces a second,
/// speech-only rendering for the voice channel.
/// </summary>
internal static partial class VoiceSpeechFormatter
{
    internal static string ToSpeech(string? answer, string lang)
    {
        if (string.IsNullOrWhiteSpace(answer)) return "";
        var text = answer.Replace("\r\n", "\n");
        text = CodeFence().Replace(text, " ");
        text = MarkdownImage().Replace(text, " ");
        text = MarkdownLink().Replace(text, "$1");
        text = BareUrl().Replace(text, lang == "ar" ? "الرابط" : "the link");
        text = TableRow().Replace(text, m => m.Value.Replace("|", ", "));
        text = TableRule().Replace(text, " ");
        text = Heading().Replace(text, "$1.\n");
        text = Bullet().Replace(text, "");
        text = Emphasis().Replace(text, "");
        text = BlockQuote().Replace(text, "");
        text = Symbols().Replace(text, " ");
        text = text.Replace("&amp;", "and").Replace("&nbsp;", " ");

        // Each line becomes a sentence so lists are read as separate statements.
        var sentences = new StringBuilder();
        foreach (var rawLine in text.Split('\n'))
        {
            var line = Spaces().Replace(rawLine, " ").Trim().TrimStart('.', '،', ',', ':', ';').Trim();
            if (line.Length == 0) continue;
            sentences.Append(line);
            if (!EndsSentence().IsMatch(line)) sentences.Append(lang == "ar" ? "." : ".");
            sentences.Append(' ');
        }
        var spoken = Spaces().Replace(sentences.ToString(), " ").Replace(" .", ".").Replace("..", ".").Trim();
        return spoken;
    }

    /// <summary>
    /// Voice chat only: a short spoken summary of key values. The full answer
    /// stays on screen; long instruction lists are not read aloud.
    /// </summary>
    internal static string ToHighlights(string? answer, string lang)
    {
        if (string.IsNullOrWhiteSpace(answer)) return "";
        var facts = new List<string>();
        foreach (var raw in answer.Replace("\r\n", "\n").Split('\n'))
        {
            var line = Bullet().Replace(raw, "").Replace("**", "").Replace("__", "").Trim();
            var parts = line.Split([':', '：'], 2);
            if (parts.Length != 2) continue;
            var label = Spaces().Replace(parts[0], " ").Trim();
            var value = MarkdownLink().Replace(parts[1], "$1").Trim();
            value = Spaces().Replace(Emphasis().Replace(value, ""), " ").Trim();
            if (label.Length is < 2 or > 40 || value.Length is 0 or > 80) continue;
            if (value.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length > 12) continue;
            if (Regex.IsMatch(label, @"how to|open|select|click|visit|راجع|افتح", RegexOptions.IgnoreCase)) continue;
            facts.Add(lang == "ar" ? $"{label}: {value}." : $"{label} is {value}.");
            if (facts.Count == 5) break;
        }
        var isLong = answer.Length > 280 || answer.Count(c => c == '\n') > 3;
        var screen = lang == "ar" ? " التفاصيل على الشاشة." : " The full details are on the screen.";
        if (facts.Count >= 2)
            return Spaces().Replace(string.Join(" ", facts) + (isLong ? screen : ""), " ").Trim();
        var spoken = ToSpeech(answer, lang);
        var sentences = Regex.Split(spoken, @"(?<=[.!?؟])\s+").Where(s => s.Length > 0).Take(2);
        var brief = string.Join(" ", sentences);
        if (brief.Length > 320) brief = brief[..300].TrimEnd() + ".";
        return (brief + (isLong ? screen : "")).Trim();
    }

    [GeneratedRegex(@"```[\s\S]*?```")] private static partial Regex CodeFence();
    [GeneratedRegex(@"!\[[^\]]*\]\([^)]*\)")] private static partial Regex MarkdownImage();
    [GeneratedRegex(@"\[([^\]]+)\]\([^)]*\)")] private static partial Regex MarkdownLink();
    [GeneratedRegex(@"https?://\S+")] private static partial Regex BareUrl();
    [GeneratedRegex(@"^\s*\|.*\|\s*$", RegexOptions.Multiline)] private static partial Regex TableRow();
    [GeneratedRegex(@"^\s*[,\s:-]*-{2,}[,\s:-]*$", RegexOptions.Multiline)] private static partial Regex TableRule();
    [GeneratedRegex(@"^\s{0,3}#{1,6}\s*(.+?)\s*#*\s*$", RegexOptions.Multiline)] private static partial Regex Heading();
    [GeneratedRegex(@"^\s*(?:[-*•▪◦]|\d+[.)]|[a-z][.)])\s+", RegexOptions.Multiline)] private static partial Regex Bullet();
    [GeneratedRegex(@"(\*\*|__|\*|_|`|~~)")] private static partial Regex Emphasis();
    [GeneratedRegex(@"^\s*>\s?", RegexOptions.Multiline)] private static partial Regex BlockQuote();
    // Status marks, dingbats, emoji (supplementary-plane emoji are surrogate pairs \uD83C-\uD83E + low surrogate), and leftover markdown characters.
    [GeneratedRegex(@"[\u2705\u2714\u2713\u274C\u2716\u26A0\u2728\u2B50\u231B\u23F3\u2600-\u27BF\uFE0F\u200D#|]|[\uD83C-\uD83E][\uDC00-\uDFFF]")] private static partial Regex Symbols();
    [GeneratedRegex(@"[.!?؟…]$")] private static partial Regex EndsSentence();
    [GeneratedRegex(@"\s+")] private static partial Regex Spaces();
}
