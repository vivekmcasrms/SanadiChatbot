using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Sanadi.Application;
using Sanadi.Domain;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Knowledge;

/// <summary>
/// Hybrid retrieval across every active source: keyword + fuzzy + section/heading
/// matching + semantic similarity, with a relevance floor so unrelated passages are
/// never sent to the model.
/// </summary>
public class HybridKnowledgeRetriever(
    SanadiDbContext db,
    IEmbeddingModel embeddings,
    ILogger<HybridKnowledgeRetriever> logger) : IKnowledgeRetriever
{
    private const double RelevanceFloor = 0.18;

    /// <summary>Semantic equivalence groups so "objective" also matches "purpose"/"aim"/"goal".</summary>
    private static readonly string[][] ConceptGroups =
    {
        new[] { "objective", "purpose", "aim", "goal", "intent", "الهدف", "الغرض" },
        new[] { "scope", "applicability", "applies", "coverage", "النطاق" },
        new[] { "eligibility", "eligible", "criteria", "qualify", "requirements", "الأهلية", "الشروط" },
        new[] { "procedure", "procedures", "process", "steps", "how to", "الإجراءات" },
        new[] { "responsibility", "responsibilities", "roles", "المسؤوليات" },
    };

    public async Task<IReadOnlyList<RetrievedPassage>> SearchAsync(string query, Lang lang, int clearance,
        int limit = 6, CancellationToken ct = default)
    {
        var terms = Tokenize(query);
        var concepts = ConceptGroups
            .Where(g => g.Any(w => query.Contains(w, StringComparison.OrdinalIgnoreCase)))
            .SelectMany(g => g).ToHashSet(StringComparer.OrdinalIgnoreCase);

        var candidates = await db.KnowledgeChunks.AsNoTracking()
            .Include(c => c.Source)
            .Where(c => c.Source!.Status == KnowledgeStatus.Active)
            .Where(c => terms.Count == 0 || terms.Any(t => EF.Functions.ILike(c.Content, $"%{t}%"))
                        || (c.SectionTitle != null && terms.Any(t => EF.Functions.ILike(c.SectionTitle, $"%{t}%"))))
            .Take(300)
            .ToListAsync(ct);

        float[]? queryVector = null;
        try { queryVector = await embeddings.EmbedAsync(query, ct); }
        catch (Exception ex) { logger.LogWarning(ex, "Semantic scoring unavailable; using lexical retrieval"); }

        var scored = candidates.Select(c =>
        {
            var lexical = LexicalScore(c.Content, terms);
            var heading = HeadingScore(c.SectionTitle, terms, concepts);
            var semantic = queryVector is null ? 0 : Cosine(queryVector, Parse(c.Embedding));
            var languageBonus = c.Language == (lang == Lang.Ar ? "ar" : "en") ? 0.05 : 0;
            var score = 0.40 * lexical + 0.30 * heading + 0.30 * semantic + languageBonus;
            return new RetrievedPassage(c.SourceId, c.Source!.Title, c.Source.SourceType, c.SectionTitle,
                c.PageNumber, c.Source.SourceUrl, c.Content, Math.Round(score, 4));
        })
        .Where(p => p.Score >= RelevanceFloor)
        .OrderByDescending(p => p.Score)
        .Take(limit)
        .ToList();

        logger.LogInformation("Retrieval '{Query}' candidates={Candidates} kept={Kept} top={Top}",
            query, candidates.Count, scored.Count, scored.FirstOrDefault()?.Score ?? 0);
        return scored;
    }

    private static List<string> Tokenize(string query) =>
        query.ToLowerInvariant()
            .Split(new[] { ' ', ',', '.', '?', '!', '؟', '\n', '\t', '"', '\'' }, StringSplitOptions.RemoveEmptyEntries)
            .Where(t => t.Length > 2)
            .Distinct().Take(12).ToList();

    private static double LexicalScore(string content, List<string> terms)
    {
        if (terms.Count == 0) return 0;
        var lower = content.ToLowerInvariant();
        var hits = terms.Count(t => lower.Contains(t));
        return (double)hits / terms.Count;
    }

    private static double HeadingScore(string? section, List<string> terms, HashSet<string> concepts)
    {
        if (string.IsNullOrWhiteSpace(section)) return 0;
        var lower = section.ToLowerInvariant();
        if (concepts.Any(c => lower.Contains(c))) return 1.0;
        if (terms.Any(t => lower.Contains(t))) return 0.7;
        return 0;
    }

    private static float[] Parse(string? vector)
    {
        if (string.IsNullOrWhiteSpace(vector)) return Array.Empty<float>();
        return vector.Trim('[', ']').Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(v => float.TryParse(v, out var f) ? f : 0f).ToArray();
    }

    private static double Cosine(float[] a, float[] b)
    {
        if (a.Length == 0 || a.Length != b.Length) return 0;
        double dot = 0, na = 0, nb = 0;
        for (var i = 0; i < a.Length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
        return na == 0 || nb == 0 ? 0 : dot / (Math.Sqrt(na) * Math.Sqrt(nb));
    }
}
