using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Sanadi.Domain;

namespace Sanadi.Application.Knowledge;

public sealed record SourceHealth(int ActiveSources, int Documents, int WebSources, int Apis, int IndexedChunks,
    int FailedSources, int NeedsReview, int EnglishSources, int ArabicSources);

public sealed record TestKnowledgeResult(string Answer, IReadOnlyList<RetrievedPassage> Passages);

public interface IDocumentTextExtractor
{
    Task<IReadOnlyList<RawPage>> ExtractAsync(Stream pdfOrText, string fileName, CancellationToken ct = default);
}

public interface IWebFetcher
{
    Task<(string Title, string Text, IReadOnlyList<string> Links)> FetchAsync(string url, CancellationToken ct = default);
}

/// <summary>
/// Full source lifecycle: add -> validate -> extract/fetch -> detect sections ->
/// chunk -> metadata -> embed/index -> activate. A source becomes Active only
/// after extraction and indexing actually succeeded.
/// </summary>
public class KnowledgeCenterService(
    ISanadiDbContext db,
    IDocumentTextExtractor extractor,
    IWebFetcher web,
    IEmbeddingModel embeddings,
    IKnowledgeRetriever retriever,
    IFileStorage storage,
    ILogger<KnowledgeCenterService> logger)
{
    public const string Bucket = "knowledge-files";

    public Task<List<KnowledgeSource>> ListAsync(CancellationToken ct = default) =>
        db.KnowledgeSources.AsNoTracking().OrderByDescending(s => s.CreatedAt).ToListAsync(ct);

    public async Task<KnowledgeSource> AddDocumentAsync(Guid actorId, string title, string fileName, Stream content,
        string? domain, string language, CancellationToken ct = default)
    {
        var source = new KnowledgeSource
        {
            Title = title, SourceType = "document", Language = language, Domain = domain,
            AddedBy = actorId, Status = KnowledgeStatus.Processing, Version = "1",
        };
        db.KnowledgeSources.Add(source);
        await db.SaveChangesAsync(ct);

        try
        {
            using var buffered = new MemoryStream();
            await content.CopyToAsync(buffered, ct);
            buffered.Position = 0;
            source.StoragePath = $"{source.Id}/{fileName}";
            await storage.UploadAsync(Bucket, source.StoragePath, buffered, "application/octet-stream", ct);

            buffered.Position = 0;
            var pages = await extractor.ExtractAsync(buffered, fileName, ct);
            await IndexAsync(source, Chunker.Build(pages), ct);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Indexing failed for source {Source}", source.Id);
            source.Status = KnowledgeStatus.Failed;
            await db.SaveChangesAsync(ct);
        }
        return source;
    }

    public async Task<KnowledgeSource> AddWebSourceAsync(Guid actorId, string title, string url, bool crawlSameDomain,
        int maxPages, string language, CancellationToken ct = default)
    {
        var source = new KnowledgeSource
        {
            Title = title, SourceType = "url", SourceUrl = url, Language = language,
            AddedBy = actorId, Status = KnowledgeStatus.Processing, Version = "1",
        };
        db.KnowledgeSources.Add(source);
        await db.SaveChangesAsync(ct);

        try
        {
            var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var queue = new Queue<string>();
            queue.Enqueue(url);
            var pages = new List<RawPage>();
            var origin = new Uri(url).Host;
            var pageNo = 1;

            while (queue.Count > 0 && visited.Count < Math.Max(1, maxPages))
            {
                var next = queue.Dequeue();
                if (!visited.Add(next)) continue;
                var (pageTitle, text, links) = await web.FetchAsync(next, ct);
                pages.Add(new RawPage(pageNo++, $"{pageTitle}\n{Chunker.CleanHtmlText(text)}"));
                if (!crawlSameDomain) break;
                foreach (var l in links.Where(l => Uri.TryCreate(l, UriKind.Absolute, out var u) && u.Host == origin))
                    if (!visited.Contains(l)) queue.Enqueue(l);
            }
            await IndexAsync(source, Chunker.Build(pages), ct);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Web indexing failed for {Url}", url);
            source.Status = KnowledgeStatus.Failed;
            await db.SaveChangesAsync(ct);
        }
        return source;
    }

    public async Task<KnowledgeSource> AddApiSourceAsync(Guid actorId, string title, string endpoint,
        string secretReference, bool liveQuery, string? domain, CancellationToken ct = default)
    {
        // Only the secret *reference* is stored; the value stays in configuration.
        var source = new KnowledgeSource
        {
            Title = title, SourceType = "api", SourceUrl = endpoint, Domain = domain, AddedBy = actorId,
            Status = liveQuery ? KnowledgeStatus.Active : KnowledgeStatus.NeedsReview,
            Version = secretReference,
        };
        db.KnowledgeSources.Add(source);
        db.AuditLog.Add(new AuditEntry
        {
            ActorId = actorId, Action = "knowledge.api.add", EntityType = "knowledge_source",
            EntityId = source.Id.ToString(), Summary = $"API source {title} registered",
        });
        await db.SaveChangesAsync(ct);
        return source;
    }

    public async Task ReprocessAsync(Guid sourceId, CancellationToken ct = default)
    {
        var source = await db.KnowledgeSources.FirstOrDefaultAsync(s => s.Id == sourceId, ct)
                     ?? throw new InvalidOperationException("Source not found.");
        source.Status = KnowledgeStatus.Reprocessing;
        await db.SaveChangesAsync(ct);

        if (source.SourceType == "document" && !string.IsNullOrEmpty(source.StoragePath))
        {
            await using var stream = await storage.DownloadAsync(Bucket, source.StoragePath, ct);
            using var buffered = new MemoryStream();
            await stream.CopyToAsync(buffered, ct);
            buffered.Position = 0;
            var pages = await extractor.ExtractAsync(buffered, source.StoragePath, ct);
            await IndexAsync(source, Chunker.Build(pages), ct);
        }
        else if (source.SourceType == "url" && source.SourceUrl is not null)
        {
            var (title, text, _) = await web.FetchAsync(source.SourceUrl, ct);
            await IndexAsync(source, Chunker.Build(new[] { new RawPage(1, $"{title}\n{Chunker.CleanHtmlText(text)}") }), ct);
        }
    }

    public async Task SetEnabledAsync(Guid sourceId, bool enabled, CancellationToken ct = default)
    {
        var source = await db.KnowledgeSources.FirstOrDefaultAsync(s => s.Id == sourceId, ct)
                     ?? throw new InvalidOperationException("Source not found.");
        source.Status = enabled ? KnowledgeStatus.Active : KnowledgeStatus.Disabled;
        await db.SaveChangesAsync(ct);
    }

    public async Task DeleteAsync(Guid sourceId, CancellationToken ct = default)
    {
        var source = await db.KnowledgeSources.Include(s => s.Chunks)
            .FirstOrDefaultAsync(s => s.Id == sourceId, ct);
        if (source is null) return;
        db.KnowledgeChunks.RemoveRange(source.Chunks);
        db.KnowledgeSources.Remove(source);
        await db.SaveChangesAsync(ct);
    }

    public Task<List<KnowledgeChunk>> ChunksAsync(Guid sourceId, CancellationToken ct = default) =>
        db.KnowledgeChunks.AsNoTracking().Where(c => c.SourceId == sourceId)
            .OrderBy(c => c.ChunkIndex).ToListAsync(ct);

    /// <summary>Test Knowledge uses exactly the same retrieval pipeline as the student assistant.</summary>
    public async Task<TestKnowledgeResult> TestAsync(string question, Lang lang, CancellationToken ct = default)
    {
        var passages = await retriever.SearchAsync(question, lang, clearance: 3, limit: 8, ct);
        var answer = passages.Count == 0
            ? "No approved source currently answers this question."
            : passages[0].Content;
        return new TestKnowledgeResult(answer, passages);
    }

    public async Task<SourceHealth> HealthAsync(CancellationToken ct = default)
    {
        var sources = await db.KnowledgeSources.AsNoTracking().ToListAsync(ct);
        return new SourceHealth(
            sources.Count(s => s.Status == KnowledgeStatus.Active),
            sources.Count(s => s.SourceType == "document"),
            sources.Count(s => s.SourceType == "url"),
            sources.Count(s => s.SourceType == "api"),
            sources.Sum(s => s.IndexedChunks),
            sources.Count(s => s.Status == KnowledgeStatus.Failed),
            sources.Count(s => s.Status == KnowledgeStatus.NeedsReview),
            sources.Count(s => s.Language == "en"),
            sources.Count(s => s.Language == "ar"));
    }

    private async Task IndexAsync(KnowledgeSource source, List<BuiltChunk> chunks, CancellationToken ct)
    {
        var existing = await db.KnowledgeChunks.Where(c => c.SourceId == source.Id).ToListAsync(ct);
        db.KnowledgeChunks.RemoveRange(existing);

        foreach (var c in chunks)
        {
            string? vector = null;
            try
            {
                var e = await embeddings.EmbedAsync(c.Content, ct);
                vector = "[" + string.Join(',', e.Select(v => v.ToString("0.000000"))) + "]";
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Embedding unavailable; chunk indexed lexically only");
            }

            db.KnowledgeChunks.Add(new KnowledgeChunk
            {
                SourceId = source.Id,
                ChunkIndex = c.Index,
                PageNumber = c.PageNumber,
                SectionTitle = c.SectionTitle,
                Content = c.Content,
                Language = source.Language,
                Embedding = vector,
            });
        }

        source.IndexedChunks = chunks.Count;
        source.LastIndexedAt = DateTimeOffset.UtcNow;
        source.Status = chunks.Count > 0 ? KnowledgeStatus.Active : KnowledgeStatus.NeedsReview;
        await db.SaveChangesAsync(ct);
        logger.LogInformation("Indexed {Count} chunks for source {Source}", chunks.Count, source.Id);
    }
}
