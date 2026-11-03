using System.Text;
using System.Text.RegularExpressions;

namespace Sanadi.Application.Knowledge;

public sealed record RawPage(int PageNumber, string Text);

public sealed record BuiltChunk(int Index, int? PageNumber, string? SectionTitle, string Content);

/// <summary>
/// Heading-aware chunking. A detected heading (Objective, Scope, Eligibility,
/// Procedures, Responsibilities, ...) always stays attached to the paragraphs
/// beneath it, and page furniture is dropped.
/// </summary>
public static class Chunker
{
    private const int TargetChars = 1200;
    private const int MinChars = 200;

    private static readonly string[] KnownSections =
    {
        "objective", "purpose", "aim", "goal", "scope", "definitions", "eligibility",
        "criteria", "procedures", "procedure", "process", "responsibilities", "policy",
        "references", "appendix", "الهدف", "النطاق", "الأهلية", "الإجراءات", "المسؤوليات",
    };

    private static readonly Regex Furniture = new(
        @"^(page\s+\d+(\s+of\s+\d+)?|\d+\s*/\s*\d+|confidential|uaeu\s*-?\s*internal)\s*$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static bool IsHeading(string line)
    {
        var t = line.Trim().TrimEnd(':', '：').Trim();
        if (t.Length is 0 or > 80) return false;
        if (t.EndsWith('.')) return false;
        var lower = t.ToLowerInvariant();
        if (KnownSections.Any(s => lower == s || lower.StartsWith(s + " ") || lower.EndsWith(" " + s))) return true;
        if (Regex.IsMatch(t, @"^\d+(\.\d+)*\s+\S")) return true;                 // 3.1 Eligibility
        if (t.ToUpperInvariant() == t && Regex.IsMatch(t, @"[A-Z]{3,}")) return true;
        return false;
    }

    public static List<BuiltChunk> Build(IEnumerable<RawPage> pages)
    {
        var chunks = new List<BuiltChunk>();
        var buffer = new StringBuilder();
        string? section = null;
        int? page = null;
        var index = 0;

        void Flush()
        {
            var body = buffer.ToString().Trim();
            buffer.Clear();
            if (body.Length < MinChars && chunks.Count > 0 && body.Length > 0)
            {
                var last = chunks[^1];
                chunks[^1] = last with { Content = last.Content + "\n" + body };
                return;
            }
            if (body.Length == 0) return;
            var header = section is null ? "" : section + "\n";
            chunks.Add(new BuiltChunk(index++, page, section, header + body));
        }

        foreach (var p in pages)
        {
            page ??= p.PageNumber;
            foreach (var rawLine in p.Text.Replace("\r", "").Split('\n'))
            {
                var line = rawLine.Trim();
                if (line.Length == 0) { buffer.Append('\n'); continue; }
                if (Furniture.IsMatch(line)) continue;

                if (IsHeading(line))
                {
                    Flush();
                    section = line.TrimEnd(':', '：').Trim();
                    page = p.PageNumber;
                    continue;
                }

                buffer.Append(line).Append('\n');
                if (buffer.Length >= TargetChars)
                {
                    page = p.PageNumber;
                    Flush();
                }
            }
            page = p.PageNumber;
        }
        Flush();
        return chunks;
    }

    /// <summary>Removes navigation / footer noise from fetched web pages.</summary>
    public static string CleanHtmlText(string text)
    {
        var lines = text.Replace("\r", "").Split('\n')
            .Select(l => l.Trim())
            .Where(l => l.Length > 0)
            .Where(l => !Regex.IsMatch(l, @"^(home|menu|search|login|sign in|skip to content|cookie|©|all rights reserved)",
                RegexOptions.IgnoreCase));
        return string.Join('\n', lines);
    }
}
