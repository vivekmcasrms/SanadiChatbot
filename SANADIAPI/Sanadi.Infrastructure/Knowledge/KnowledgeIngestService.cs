using System.Data.Common;
using System.Text.Json;
using Dapper;
using Sanadi.Application.Storage;
using Sanadi.Domain.Exceptions;
using Sanadi.Domain.Security;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Knowledge;

public sealed record IngestInput(
    string Title,
    string DocumentType,
    Guid? CategoryId,
    Guid? OwnerUnitId,
    string Language,
    string Version,
    string EffectiveDate,
    string? ReviewDate,
    string? ExpiryDate,
    string ConfidentialityLevel,
    string FileName,
    string MimeType,
    long SizeBytes,
    string? TextContent,
    string? StoragePath,
    string? StructuredKind,
    Guid? SupersedesDocumentId,
    string? KnowledgeDomain,
    string? Notes);

public sealed record IngestResult(Guid Id, int Chunks, List<QualityIssue> Issues, string ProcessingStatus);

public sealed class KnowledgeIngestService(KnowledgeEmbeddingsService embeddings, IObjectStorage storage)
{
    public async Task<IngestResult> IngestAsync(DbConnection db, Guid userId, IngestInput data, ICurrentUser? currentUser = null, CancellationToken ct = default)
    {
        data = data with { MimeType = KnowledgeProcessing.ResolveMimeType(data.MimeType, data.FileName) };
        var validation = KnowledgeProcessing.ValidateFile(data.MimeType, data.SizeBytes, data.FileName);
        if (!validation.Ok) throw new SanadiException(validation.Error!);
        var scan = await KnowledgeProcessing.MalwareScanAsync(data.SizeBytes);
        if (!scan.Clean) throw new SanadiException("The file failed the malware scan.");

        var spec = KnowledgeProcessing.SupportedMime[data.MimeType];
        var text = (data.TextContent ?? "").Trim();
        string? extractionError = null;
        if (string.IsNullOrEmpty(text) && !string.IsNullOrWhiteSpace(data.StoragePath) && currentUser is not null)
        {
            var file = await storage.DownloadAsync("knowledge-files", data.StoragePath!, currentUser, ct);
            if (file is null)
            {
                extractionError = "The uploaded file could not be read.";
            }
            else
            {
                await using var stream = file.Content;
                using var ms = new MemoryStream();
                await stream.CopyToAsync(ms, ct);
                var extracted = KnowledgeExtract.ExtractDocumentText(ms.ToArray(), data.MimeType, data.FileName);
                text = extracted.Text.Replace("\0", "").Trim();
                extractionError = extracted.Error;
                if (string.IsNullOrEmpty(text) && extractionError is null)
                    extractionError = $"No selectable text was found in this {spec.Ext.ToUpperInvariant()} file; it may be a scan. Paste the text instead.";
            }
        }

        var extractionOk = text.Length > 0;
        var detected = KnowledgeProcessing.DetectLanguage(text);
        var chunks = extractionOk ? KnowledgeProcessing.ChunkText(text) : [];
        var sum = KnowledgeProcessing.Checksum(string.IsNullOrEmpty(text) ? data.FileName : text);

        var dupe = await db.QuerySingleOrDefaultAsync<(Guid id, string title)?>(
            DbProc.Call("usp_Knowledge_Ingest_FindByChecksum", new { sum }));
        var issues = KnowledgeProcessing.RunQualityChecks(
            text, chunks, detected, data.Language, data.EffectiveDate, data.ExpiryDate, data.Version,
            dupe?.title, 0);
        var injection = KnowledgeProcessing.DetectInjection(text);
        if (injection.Count > 0)
            issues.Add(new QualityIssue("prompt_injection", "warning", $"Instruction-like text detected and neutralised ({injection.Count} pattern(s))."));

        var blocking = issues.Any(i => i.Severity == "blocking");
        var processingStatus = extractionOk && chunks.Count > 0 ? "ready_for_review" : "processing_failed";
        var id = Guid.NewGuid();
        var issuesJson = JsonSerializer.Serialize(issues.Select(i => new { code = i.Code, severity = i.Severity, message = i.Message }));

        await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Ingest_InsertDocument", new
        {
            id,
            data.Title,
            description = text.Length == 0 ? null : text[..Math.Min(400, text.Length)],
            data.DocumentType,
            data.CategoryId,
            data.OwnerUnitId,
            data.KnowledgeDomain,
            data.Language,
            data.Version,
            data.EffectiveDate,
            data.ReviewDate,
            data.ExpiryDate,
            data.ConfidentialityLevel,
            data.FileName,
            data.SizeBytes,
            data.MimeType,
            data.StoragePath,
            sum,
            detected,
            extractionStatus = extractionOk ? "completed" : "failed",
            extractionError = extractionOk ? null : (extractionError ?? $"No text could be extracted from this {spec.Ext.ToUpperInvariant()} file; paste the document text instead."),
            chunkingStatus = chunks.Count > 0 ? "completed" : "failed",
            embeddingStatus = chunks.Count > 0 ? "completed" : "pending",
            indexingStatus = chunks.Count > 0 ? "completed" : "failed",
            qualityStatus = blocking ? "failed" : issues.Count > 0 ? "flagged" : "passed",
            issuesJson,
            processingStatus,
            data.Notes,
            data.SupersedesDocumentId,
            userId
        }));

        if (chunks.Count > 0)
        {
            var inserted = new List<(Guid Id, string Content, string? SectionTitle)>();
            foreach (var c in chunks)
            {
                var chunkId = Guid.NewGuid();
                var meta = JsonSerializer.Serialize(new { structured_kind = data.StructuredKind });
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Ingest_InsertChunk",
                    new { chunkId, id, c.ChunkNumber, c.Content, c.TokenCount, c.SectionTitle, c.SectionPath, c.PageNumber, c.SourceLocator, meta }));
                inserted.Add((chunkId, c.Content, c.SectionTitle));
            }
            try
            {
                await embeddings.EmbedChunkRowsAsync(db, "document_chunks",
                    inserted.Select(r => (r.Id, r.Content, r.SectionTitle, (string?)data.Title)).ToList(), ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch { /* best-effort */ }
        }

        return new IngestResult(id, chunks.Count, issues, processingStatus);
    }
}
