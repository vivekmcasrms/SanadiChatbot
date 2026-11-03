using System.Text.RegularExpressions;

namespace Sanadi.Api.AI;

/// <summary>
/// Deterministic retrieval ranking and final-answer grounding. This deliberately
/// uses no embedding or external model: the only generative model remains the
/// Qwen model selected by ai_settings.
/// </summary>
internal static class AssistantEvidenceSafety
{
    private static readonly Regex Words = new(@"[\p{L}\p{N}]{2,}", RegexOptions.Compiled);
    private static readonly Regex SentenceBreak = new(@"(?<=[.!?؟])\s+|[\r\n]+", RegexOptions.Compiled);
    private static readonly Regex InstitutionalClaim = new(
        @"\b(must|required?|deadline|fee|cost|eligible|eligibility|prohibited|allowed|working days?|credit hours?|contact|email|phone|policy)\b|يجب|يشترط|موعد|رسوم|تكلفة|مؤهل|أهلية|ممنوع|مسموح|يوم عمل|ساعة معتمدة|تواصل|بريد|هاتف|سياسة|\d",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex NumberOrContact = new(
        @"(?<!\p{L})\d[\d.,:/-]*|https?://\S+|\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly HashSet<string> StopWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "the", "and", "for", "with", "from", "that", "this", "your", "you", "are", "was", "were",
        "have", "has", "can", "will", "would", "should", "into", "about", "according", "university",
        "student", "students", "service", "uaeu", "على", "إلى", "الى", "عن", "في", "من", "هذا",
        "هذه", "ذلك", "التي", "الذي", "يكون", "يمكن", "الجامعة", "الطالب", "الخدمة"
    };

    internal sealed record GroundingResult(
        bool Passed,
        decimal Score,
        int ClaimCount,
        int SupportedClaimCount,
        IReadOnlyList<string> UnsupportedClaims,
        string CleanedAnswer);

    internal static decimal Rank(string query, string title, string content, decimal databaseScore)
    {
        var queryTerms = Terms(query);
        if (queryTerms.Count == 0) return databaseScore;
        var titleTerms = Terms(title);
        var sourceTerms = Terms($"{title} {content}");
        var covered = queryTerms.Count(q => SimilarToken(q, sourceTerms));
        var titleCovered = queryTerms.Count(q => SimilarToken(q, titleTerms));
        var lexical = (decimal)covered / queryTerms.Count;
        var heading = (decimal)titleCovered / queryTerms.Count;
        return Math.Clamp(databaseScore * .45m + lexical * .4m + heading * .15m, 0m, 1m);
    }

    internal static GroundingResult Validate(string answer, IEnumerable<string> evidence)
    {
        var sources = evidence.Where(s => !string.IsNullOrWhiteSpace(s)).ToArray();
        if (string.IsNullOrWhiteSpace(answer))
            return new(false, 0, 0, 0, ["empty_answer"], "");
        if (sources.Length == 0)
            return new(false, 0, 1, 0, [answer.Trim()], "");

        var corpus = string.Join("\n", sources);
        var corpusTerms = Terms(corpus);
        var corpusFolded = Fold(corpus);
        var kept = new List<string>();
        var unsupported = new List<string>();
        var claims = 0;
        var supported = 0;

        foreach (var raw in SentenceBreak.Split(answer))
        {
            var sentence = raw.Trim();
            if (sentence.Length == 0) continue;
            if (!InstitutionalClaim.IsMatch(sentence))
            {
                kept.Add(sentence);
                continue;
            }

            claims++;
            var exactValues = NumberOrContact.Matches(sentence).Select(m => Fold(m.Value)).ToArray();
            var valuesSupported = exactValues.All(v => corpusFolded.Contains(v, StringComparison.Ordinal));
            var terms = Terms(sentence);
            var distinctive = terms.Where(t => !StopWords.Contains(t)).ToArray();
            var overlap = distinctive.Count(t => SimilarToken(t, corpusTerms));
            var textSupported = distinctive.Length == 0 || overlap >= Math.Min(2, distinctive.Length);
            if (valuesSupported && textSupported)
            {
                supported++;
                kept.Add(sentence);
            }
            else
            {
                unsupported.Add(sentence);
            }
        }

        var score = claims == 0 ? 1m : (decimal)supported / claims;
        var cleaned = string.Join("\n\n", kept).Trim();
        return new(unsupported.Count == 0, score, claims, supported, unsupported, cleaned);
    }

    private static HashSet<string> Terms(string text) => Words.Matches(Fold(text))
        .Select(m => m.Value)
        .Where(w => w.Length >= 2 && !StopWords.Contains(w))
        .ToHashSet(StringComparer.OrdinalIgnoreCase);

    private static bool SimilarToken(string query, HashSet<string> candidates)
    {
        if (candidates.Contains(query)) return true;
        if (query.Length < 4) return false;
        return candidates.Any(candidate =>
            candidate.Length >= 4 &&
            (candidate.StartsWith(query, StringComparison.OrdinalIgnoreCase)
             || query.StartsWith(candidate, StringComparison.OrdinalIgnoreCase)
             || TrigramSimilarity(query, candidate) >= .72));
    }

    private static double TrigramSimilarity(string left, string right)
    {
        var a = Trigrams(left);
        var b = Trigrams(right);
        if (a.Count == 0 || b.Count == 0) return 0;
        var intersection = a.Count(b.Contains);
        return 2d * intersection / (a.Count + b.Count);
    }

    private static HashSet<string> Trigrams(string value)
    {
        var folded = Fold(value);
        var result = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i + 3 <= folded.Length; i++) result.Add(folded.Substring(i, 3));
        return result;
    }

    private static string Fold(string value)
    {
        var folded = value.ToLowerInvariant()
            .Replace('أ', 'ا').Replace('إ', 'ا').Replace('آ', 'ا').Replace('ٱ', 'ا')
            .Replace('ى', 'ي').Replace('ة', 'ه').Replace('ؤ', 'و').Replace('ئ', 'ي');
        return Regex.Replace(folded, @"[\u064B-\u065F\u0670\u06D6-\u06ED]", "");
    }
}
