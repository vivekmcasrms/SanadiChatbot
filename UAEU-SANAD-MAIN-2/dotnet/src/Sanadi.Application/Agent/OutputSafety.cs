using System.Text.RegularExpressions;

namespace Sanadi.Application.Agent;

/// <summary>Strips markup artefacts (stray "svg" text, HTML tags, code fences) and
/// internal tool output before an answer reaches the student.</summary>
public static class OutputSafety
{
    public static string ExtractJson(string raw)
    {
        var text = raw.Trim();
        var fence = Regex.Match(text, @"```(?:json)?\s*(\{[\s\S]*\})\s*```", RegexOptions.IgnoreCase);
        if (fence.Success) return fence.Groups[1].Value;
        var start = text.IndexOf('{');
        var end = text.LastIndexOf('}');
        return start >= 0 && end > start ? text[start..(end + 1)] : text;
    }

    public static string Clean(string answer)
    {
        var text = answer ?? string.Empty;
        text = Regex.Replace(text, @"```[\s\S]*?```", " ");
        text = Regex.Replace(text, @"<[^>]+>", " ");
        text = Regex.Replace(text, @"(?im)^\s*(svg|path|div|span)\s*$", "");
        text = Regex.Replace(text, @"(?im)^\s*TOOL_RESULT.*$", "");
        text = Regex.Replace(text, @"\{\s*""(ok|tool|args)""[\s\S]*?\}", " ");
        text = Regex.Replace(text, @"[ \t]{2,}", " ");
        text = Regex.Replace(text, @"\n{3,}", "\n\n");
        return text.Trim();
    }
}
