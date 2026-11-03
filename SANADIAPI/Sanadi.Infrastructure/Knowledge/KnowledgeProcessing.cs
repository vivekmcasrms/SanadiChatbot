using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Sanadi.Infrastructure.Knowledge;

public sealed record KnowledgeChunk(
    int ChunkNumber,
    string? SectionTitle,
    string? SectionPath,
    string Content,
    int? PageNumber,
    string SourceLocator,
    int TokenCount);

public sealed record QualityIssue(string Code, string Severity, string Message);

public static class KnowledgeProcessing
{
    public static readonly Dictionary<string, (string Ext, bool TextExtractable, bool Structured)> SupportedMime = new(StringComparer.OrdinalIgnoreCase)
    {
        ["application/pdf"] = ("pdf", true, false),
        ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"] = ("docx", true, false),
        ["application/vnd.openxmlformats-officedocument.presentationml.presentation"] = ("pptx", true, false),
        ["text/plain"] = ("txt", true, false),
        ["text/markdown"] = ("md", true, false),
        ["text/csv"] = ("csv", true, true),
        ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] = ("xlsx", true, true),
    };

    public const long MaxFileBytes = 20 * 1024 * 1024;

    public static string ResolveMimeType(string? mimeType, string? fileName)
    {
        var mime = (mimeType ?? "").Split(';')[0].Trim().ToLowerInvariant();
        if (SupportedMime.ContainsKey(mime)) return mime;
        if (mime is "" or "application/octet-stream" or "binary/octet-stream")
        {
            var extension = Path.GetExtension(fileName ?? "").TrimStart('.');
            return SupportedMime.FirstOrDefault(p => p.Value.Ext.Equals(extension, StringComparison.OrdinalIgnoreCase)).Key ?? mime;
        }
        return mime;
    }

    private static readonly HashSet<string> SectionLabels = new(StringComparer.OrdinalIgnoreCase)
    {
        "objective","objectives","purpose","purposes","aim","aims","goal","goals",
        "scope","applicability","scope and applicability","subject","title",
        "policy","policy statement","statement of policy","general provisions","provisions",
        "definitions","terminology","abbreviations",
        "procedure","procedures","process","implementation",
        "responsibility","responsibilities","roles and responsibilities","accountability",
        "eligibility","requirements","conditions","exceptions","penalties","sanctions",
        "references","related policies","related documents","appendix","appendices","annex",
        "introduction","background","overview","summary","review","revision history",
        "effective date","contact","contacts","enquiries","compliance","enforcement",
        "الهدف","الأهداف","الغرض","الغاية","النطاق","نطاق التطبيق","الموضوع",
        "السياسة","بيان السياسة","التعريفات","المصطلحات","الإجراءات","الإجراء",
        "المسؤوليات","المسؤولية","الأهلية","الشروط","المتطلبات","الاستثناءات",
        "المراجع","الملاحق","المقدمة","نبذة","المراجعة","تاريخ السريان"
    };

    private static readonly Regex StructuralHeading = new(
        @"^\s*(#{1,6}\s+.+|(?:Article|Section|Chapter)\s+\(?\d+\)?[.:)]?.*|\d+(\.\d+)*[.)]?\s+[A-Z\u0600-\u06FF].{2,80}|Q\s*[:.].+)$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex[] InjectionPatterns =
    [
        new(@"ignore (all )?previous instructions", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"disregard (the )?(system|prior) (prompt|instructions)", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"reveal (the )?(api|secret|service) key", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"you are now", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"change your system prompt", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"access (another|other) student", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"call this url", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"تجاهل التعليمات", RegexOptions.Compiled),
    ];

    public static (bool Ok, string? Error) ValidateFile(string mimeType, long sizeBytes, string fileName)
    {
        mimeType = ResolveMimeType(mimeType, fileName);
        if (!SupportedMime.ContainsKey(mimeType)) return (false, $"Unsupported file type: {mimeType}");
        if (sizeBytes <= 0) return (false, "Empty file");
        if (sizeBytes > MaxFileBytes) return (false, "File exceeds the 20 MB limit");
        if (fileName.Any(c => c < 32)) return (false, "Invalid file name");
        return (true, null);
    }

    public static Task<(bool Clean, string Scanner)> MalwareScanAsync(long _) =>
        Task.FromResult((true, "placeholder"));

    public static string DetectLanguage(string text)
    {
        var letters = Regex.Replace(text, @"[^\p{L}]", "");
        if (letters.Length < 20) return "unknown";
        var arabic = Regex.Matches(text, @"[\u0600-\u06FF]").Count;
        var ratio = (double)arabic / letters.Length;
        if (ratio > 0.7) return "ar";
        if (ratio < 0.05) return "en";
        return "mixed";
    }

    public static string Checksum(string text)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(text));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    public static List<string> DetectInjection(string text) =>
        InjectionPatterns.Where(p => p.IsMatch(text)).Select(p => p.ToString()).ToList();

    public static string NeutraliseForPrompt(string text)
    {
        var outText = text;
        foreach (var p in InjectionPatterns)
            outText = p.Replace(outText, "[removed instruction-like text]");
        return outText;
    }

    public static List<QualityIssue> RunQualityChecks(
        string text,
        IReadOnlyList<KnowledgeChunk> chunks,
        string detectedLanguage,
        string declaredLanguage,
        string? effectiveDate,
        string? expiryDate,
        string? version,
        string? duplicateOfTitle,
        int duplicateChunkCount)
    {
        var issues = new List<QualityIssue>();
        void Push(string code, string severity, string message) => issues.Add(new QualityIssue(code, severity, message));

        if (string.IsNullOrWhiteSpace(text)) Push("empty_extraction", "blocking", "No text could be extracted from the file.");
        else if (text.Trim().Length < 200) Push("very_short", "warning", "Extracted content is unusually short.");
        if (chunks.Count == 0) Push("incomplete_indexing", "blocking", "No chunks were produced for indexing.");
        if (string.IsNullOrWhiteSpace(effectiveDate)) Push("missing_effective_date", "blocking", "An effective date is required before publication.");
        if (string.IsNullOrWhiteSpace(version)) Push("missing_version", "warning", "No version number was recorded.");
        if (detectedLanguage == "unknown") Push("unsupported_language", "warning", "Language could not be detected.");
        else if (detectedLanguage is not "mixed" && !string.Equals(detectedLanguage, declaredLanguage, StringComparison.OrdinalIgnoreCase))
            Push("language_mismatch", "warning", $"Detected {detectedLanguage} but the document is declared as {declaredLanguage}.");
        if (!string.IsNullOrWhiteSpace(duplicateOfTitle))
            Push("duplicate_document", "warning", $"A document with the same content already exists: {duplicateOfTitle}.");
        if (duplicateChunkCount > 0) Push("duplicate_chunks", "info", $"{duplicateChunkCount} chunk(s) duplicate existing content.");
        if (!string.IsNullOrWhiteSpace(expiryDate) && DateTime.TryParse(expiryDate, out var exp) && exp.Date < DateTime.UtcNow.Date)
            Push("expired", "blocking", "The expiry date is already in the past.");

        var suspicious = Regex.Matches(text, @"[^\p{L}\p{N}\s\p{P}]").Count;
        if (text.Length > 0 && suspicious / (double)text.Length > 0.05)
            Push("ocr_quality", "warning", "The extracted text contains many unreadable characters (possible OCR problem).");

        return issues;
    }

    public static List<KnowledgeChunk> ChunkText(string text, int maxChars = 1400)
    {
        var lines = text.Replace("\r\n", "\n").Split('\n');
        var sections = new List<(string? Title, string? Path, int Page, List<string> Body)>
        {
            (null, null, 1, new List<string>())
        };
        var trail = new List<string>();
        var page = 1;

        var counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in lines)
        {
            var key = line.Replace("\f", "").Trim().ToLowerInvariant();
            if (key.Length is > 0 and <= 120)
                counts[key] = counts.TryGetValue(key, out var existingCount) ? existingCount + 1 : 1;
        }
        var furniture = counts.Where(kv => kv.Value >= 3 && !IsHeading(kv.Key)).Select(kv => kv.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var line in lines)
        {
            var breaks = line.Count(c => c == '\f');
            if (breaks > 0)
            {
                page += breaks;
                // Do not attach the next PDF page to a section carrying the old page number.
                var previous = sections[^1];
                sections.Add((previous.Title, previous.Path, page, new List<string>()));
            }
            var bare = line.Replace("\f", "").Trim().ToLowerInvariant();
            if (!string.IsNullOrEmpty(bare) && furniture.Contains(bare))
            {
                continue;
            }
            if (IsHeading(line))
            {
                var title = Regex.Replace(line.Replace("\f", ""), @"^\s*#+\s*", "").Trim();
                if (trail.Count >= 2) trail.RemoveRange(1, trail.Count - 1);
                trail.Add(title);
                sections.Add((title, string.Join(" › ", trail), page, new List<string>()));
            }
            else
            {
                sections[^1].Body.Add(line.Replace("\f", ""));
            }
        }

        var chunks = new List<KnowledgeChunk>();
        var n = 0;
        var overlap = Math.Min(180, (int)Math.Floor(maxChars * 0.15));

        foreach (var section in sections)
        {
            var body = string.Join("\n", section.Body).Trim();
            if (string.IsNullOrEmpty(body)) continue;
            var header = section.Title is null ? "" : $"{section.Title}\n\n";
            var budget = Math.Max(400, maxChars - header.Length);
            var paragraphs = Regex.Split(body, @"\n{2,}");
            var blocks = new List<string>();
            var buffer = "";
            foreach (var p in paragraphs)
            {
                if (!string.IsNullOrEmpty(buffer) && buffer.Length + 2 + p.Length > budget)
                {
                    blocks.Add(buffer);
                    buffer = "";
                }
                buffer = string.IsNullOrEmpty(buffer) ? p : $"{buffer}\n\n{p}";
                if (buffer.Length > budget)
                {
                    var parts = SplitOnWhitespace(buffer, budget);
                    buffer = parts.Count > 0 ? parts[^1] : "";
                    if (parts.Count > 1) blocks.AddRange(parts.Take(parts.Count - 1));
                }
            }
            if (!string.IsNullOrWhiteSpace(buffer)) blocks.Add(buffer);

            for (var i = 0; i < blocks.Count; i++)
            {
                var tail = i > 0 && overlap > 0
                    ? $"{blocks[i - 1][^Math.Min(overlap, blocks[i - 1].Length)..].Trim()}\n…\n"
                    : "";
                var content = $"{header}{tail}{blocks[i]}".Trim();
                if (string.IsNullOrEmpty(content)) continue;
                n += 1;
                chunks.Add(new KnowledgeChunk(
                    n,
                    section.Title,
                    section.Path ?? (section.Title ?? $"part {n}"),
                    content,
                    section.Page == 0 ? null : section.Page,
                    section.Title is null ? $"p.{section.Page} · chunk {n}" : $"{section.Title} · p.{section.Page} · chunk {n}",
                    (int)Math.Ceiling(content.Length / 4.0)));
            }
        }
        return chunks;
    }

    private static List<string> SplitOnWhitespace(string text, int maxChars)
    {
        var outList = new List<string>();
        var rest = text;
        while (rest.Length > maxChars)
        {
            var window = rest[..maxChars];
            var cut = Math.Max(Math.Max(window.LastIndexOf('\n'), window.LastIndexOf(". ", StringComparison.Ordinal)), window.LastIndexOf(' '));
            if (cut < maxChars * 0.5) cut = maxChars;
            outList.Add(rest[..cut].Trim());
            rest = rest[cut..].Trim();
        }
        if (!string.IsNullOrWhiteSpace(rest)) outList.Add(rest.Trim());
        return outList;
    }

    private static bool IsHeading(string line)
    {
        var raw = line.Replace("\f", "").Trim();
        if (string.IsNullOrEmpty(raw) || raw.Length > 100) return false;
        if (Regex.IsMatch(raw, @"\.{4,}")) return false; // table-of-contents leader, not a section
        if (StructuralHeading.IsMatch(raw)) return true;
        var label = NormaliseHeading(raw);
        if (string.IsNullOrEmpty(label)) return false;
        if (SectionLabels.Contains(label)) return true;
        var words = label.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (words.Length > 6) return false;
        if (Regex.IsMatch(raw, @"[.!?؟]$")) return false;
        var letters = Regex.Replace(raw, @"[^\p{L}]", "");
        if (string.IsNullOrEmpty(letters)) return false;
        if (raw == raw.ToUpperInvariant() && letters.Length > 2 && Regex.IsMatch(raw, "[A-Z]")) return true;
        return false;
    }

    private static string NormaliseHeading(string line) =>
        Regex.Replace(
            Regex.Replace(
                Regex.Replace(line, @"^[\s#*\-–—•]+", ""),
                @"[\s:：.،,;)]+$", ""),
            @"^\d+(\.\d+)*[.)]?\s*", "").Trim().ToLowerInvariant();
}
