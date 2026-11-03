using System.Data.Common;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using Sanadi.Application.Storage;
using Sanadi.Domain.Exceptions;
using Sanadi.Domain.Security;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Knowledge;

public sealed class KnowledgeDocumentOpsService(
    KnowledgeEmbeddingsService embeddings,
    KnowledgeRetrievalService retrieval,
    IObjectStorage storage)
{
    public static List<string> RetrievalBlockers(dynamic doc)
    {
        var today = DateTime.UtcNow.ToString("yyyy-MM-dd");
        var blockers = new List<string>();
        var approval = (string?)doc.approval_status;
        if (approval != "approved" && approval != "published")
            blockers.Add($"Approval status is \"{approval ?? "unknown"}\" — only approved documents are searchable.");
        if (doc.is_active is bool a && !a) blockers.Add("The document is not active.");
        if (doc.is_current is bool c && !c) blockers.Add("The document is not marked as the current version.");
        if (doc.deleted_at is not null) blockers.Add("The document is deleted.");
        if (doc.superseded_by_document_id is not null) blockers.Add("The document has been superseded by a newer version.");
        var effective = doc.effective_date is DateTime edt ? edt.ToString("yyyy-MM-dd") : doc.effective_date as string;
        var expiry = doc.expiry_date is DateTime xdt ? xdt.ToString("yyyy-MM-dd") : doc.expiry_date as string;
        if (!string.IsNullOrEmpty(effective) && string.CompareOrdinal(effective, today) > 0)
            blockers.Add($"The effective date ({effective}) is in the future.");
        if (!string.IsNullOrEmpty(expiry) && string.CompareOrdinal(expiry, today) < 0)
            blockers.Add($"The document expired on {expiry}.");
        return blockers;
    }

    public async Task<DocumentReprocessResult> ReprocessAsync(DbConnection db, Guid documentId, ICurrentUser? user = null, CancellationToken ct = default)
    {
        var doc = await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Knowledge_DocOps_GetForReprocess", new { documentId }, ct))
            ?? throw new NotFoundException("Document not found.");

        var text = "";
        var source = "existing_chunks";
        if (doc.storage_path is string path && !string.IsNullOrWhiteSpace(path) && doc.mime_type is string mime && user is not null)
        {
            var file = await storage.DownloadAsync("knowledge-files", path, user, ct);
            if (file is not null)
            {
                await using var stream = file.Content;
                using var ms = new MemoryStream();
                await stream.CopyToAsync(ms, ct);
                var extracted = KnowledgeExtract.ExtractDocumentText(ms.ToArray(), mime, path);
                if (extracted.Error is not null) throw new SanadiException(extracted.Error);
                text = extracted.Text.Replace("\0", "").Trim();
                if (!string.IsNullOrEmpty(text)) source = "storage";
            }
            else throw new SanadiException("The uploaded file could not be read; re-upload it. The previous index was preserved.");
        }
        if (string.IsNullOrEmpty(text))
        {
            var rows = await db.QueryAsync<(int chunk_index, string content)>(
                DbProc.Call("usp_Knowledge_DocOps_ListChunkContents", new { documentId }, ct));
            var seen = new HashSet<string>();
            var parts = new List<string>();
            foreach (var row in rows)
            {
                var body = (row.content ?? "").Trim();
                if (string.IsNullOrEmpty(body) || !seen.Add(body)) continue;
                parts.Add(body);
            }
            text = string.Join("\n\n", parts);
        }
        if (string.IsNullOrWhiteSpace(text)) throw new SanadiException("No text is available for this document; re-upload the file.");

        var chunks = KnowledgeProcessing.ChunkText(text);
        if (chunks.Count == 0) throw new SanadiException("Re-processing produced no chunks.");

        var detected = KnowledgeProcessing.DetectLanguage(text);
        var declaredLanguage = Convert.ToString((object?)doc.language) ?? "en";
        var version = Convert.ToString((object?)doc.version);
        string? effectiveDate = doc.effective_date is DateTime edt ? edt.ToString("yyyy-MM-dd") : Convert.ToString((object?)doc.effective_date);
        string? expiryDate = doc.expiry_date is DateTime xdt ? xdt.ToString("yyyy-MM-dd") : Convert.ToString((object?)doc.expiry_date);
        List<QualityIssue> issues = KnowledgeProcessing.RunQualityChecks(
            text, chunks, detected, declaredLanguage, effectiveDate, expiryDate, version, null, 0);
        var blocking = issues.Any(i => i.Severity == "blocking");
        var issuesJson = JsonSerializer.Serialize(issues.Select(i => new { code = i.Code, severity = i.Severity, message = i.Message }));
        // Finish remote work before taking database locks. Replacing rows and status
        // is one transaction, so a failed/cancelled insert cannot destroy the old index.
        var vectors = await embeddings.EmbedTextsAsync(chunks.Select(c =>
            string.Join("\n", new[] { (string?)doc.title, c.SectionTitle, c.Content }.Where(s => !string.IsNullOrWhiteSpace(s)))).ToList(), ct);
        ct.ThrowIfCancellationRequested();
        if (db.State != System.Data.ConnectionState.Open) await db.OpenAsync(ct);
        await using var transaction = await db.BeginTransactionAsync(ct);
        await db.ExecuteAsync(DbProc.Call("usp_Knowledge_DocOps_DeleteChunks", new { documentId }, ct, transaction));
        for (var i = 0; i < chunks.Count; i++)
        {
            var c = chunks[i];
            var chunkId = Guid.NewGuid();
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_DocOps_InsertChunk",
                new { chunkId, documentId, c.ChunkNumber, c.Content, c.TokenCount, c.SectionTitle, c.SectionPath, c.PageNumber, c.SourceLocator }, ct, transaction));
            if (vectors[i] is { } vec)
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Embeddings_UpdateDocumentChunk", new { vec, id = chunkId }, ct, transaction));
        }
        await db.ExecuteAsync(DbProc.Call("usp_Knowledge_DocOps_UpdateAfterReprocess", new
        {
            detected, documentId, issuesJson,
            qualityStatus = blocking ? "failed" : issues.Count > 0 ? "flagged" : "passed",
            processingStatus = blocking ? "processing_failed" : "ready_for_review"
        }, ct, transaction));
        await transaction.CommitAsync(ct);
        KnowledgeRetrievalService.InvalidateCache("document_reindexed");

        var sections = chunks.Select(c => c.SectionTitle).Where(s => !string.IsNullOrWhiteSpace(s)).Distinct().Cast<string>().ToList();
        var blockers = RetrievalBlockers(doc);
        var maxPage = chunks.Max(c => c.PageNumber ?? 0);
        return new DocumentReprocessResult(
            documentId,
            (string)doc.title,
            source,
            chunks.Count,
            sections,
            maxPage > 0 ? maxPage : (int?)null,
            blockers.Count == 0,
            blockers);
    }

    public async Task<DocumentActivateResult> ActivateAsync(DbConnection db, Guid documentId, CenterPermissions perms, string lang = "en", CancellationToken ct = default)
    {
        var doc = await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Knowledge_DocOps_GetForActivate", new { documentId }, ct))
            ?? throw new NotFoundException("Document not found.");

        var chunkRows = (await db.QueryAsync<(string? section_title, string content)>(
            DbProc.Call("usp_Knowledge_DocOps_ListChunkSections", new { documentId }, ct))).ToList();
        var sections = chunkRows.Select(c => (c.section_title ?? "").Trim()).Where(s => s.Length > 0).Distinct().ToList();
        var characters = chunkRows.Sum(c => (c.content ?? "").Length);
        var title = (string)doc.title;

        var lifecycleDoc = new
        {
            approval_status = "approved",
            is_active = true,
            is_current = true,
            deleted_at = doc.deleted_at,
            effective_date = doc.effective_date,
            expiry_date = doc.expiry_date,
            superseded_by_document_id = doc.superseded_by_document_id
        };
        var lifecycle = RetrievalBlockers(lifecycleDoc);
        var checks = new List<ActivationCheck>
        {
            new("Text extracted", characters > 200, $"{characters} characters of extracted text"),
            new("Indexed into chunks", chunkRows.Count > 0, $"{chunkRows.Count} chunks"),
            new("Headings preserved", sections.Count > 0, string.Join(", ", sections.Take(8)) is { Length: > 0 } d ? d : "no headings detected"),
            new("Lifecycle clear", lifecycle.Count == 0, lifecycle.Count == 0 ? "dates and versioning are valid" : string.Join(" ", lifecycle))
        };
        if (checks.Any(c => !c.Ok))
            return new DocumentActivateResult(documentId, title, false, checks, Array.Empty<ActivationProbe>());

        var previous = new { approval_status = (string?)doc.approval_status, is_active = (bool?)doc.is_active, is_current = (bool?)doc.is_current };
        await db.ExecuteAsync(DbProc.Call("usp_Knowledge_DocOps_Activate", new { documentId }, ct));
        KnowledgeRetrievalService.InvalidateCache("document_activated");

        var probes = new List<ActivationProbe>();
        foreach (var question in ProbeQuestions(title, sections))
        {
            var results = await retrieval.RetrieveAsync(db, question, perms, lang, 6, useCache: false, ct: ct);
            var hit = results.FirstOrDefault(r => r.SourceId.Equals(documentId.ToString(), StringComparison.OrdinalIgnoreCase));
            probes.Add(new ActivationProbe(question, hit is not null, hit?.SectionTitle, hit is null ? 0 : Math.Round(hit.Score, 3)));
        }
        var retrieved = probes.Count == 0 || probes.Any(p => p.Hit);
        checks.Add(new ActivationCheck(
            "Retrieval verified",
            retrieved,
            probes.Count == 0
                ? "no headings available to probe"
                : $"{probes.Count(p => p.Hit)}/{probes.Count} section probes returned this document"));
        if (!retrieved)
        {
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_DocOps_RevertActivation",
                new { documentId, previous.approval_status, previous.is_active, previous.is_current }, ct));
            KnowledgeRetrievalService.InvalidateCache("document_activation_reverted");
            return new DocumentActivateResult(documentId, title, false, checks, probes);
        }
        return new DocumentActivateResult(documentId, title, true, checks, probes);
    }

    public async Task<object> DiagnoseAsync(DbConnection db, Guid documentId, string query, CenterPermissions perms, CancellationToken ct = default)
    {
        var doc = await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Knowledge_DocOps_GetForDiagnose", new { documentId }, ct))
            ?? throw new NotFoundException("Document not found.");

        var rows = (await db.QueryAsync(DbProc.Call("usp_Knowledge_DocOps_ListChunksForDiagnose", new { documentId }, ct))).ToList();

        var words = Regex.Replace(query.ToLowerInvariant(), @"[^\p{L}\p{N}\s]", " ")
            .Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(w => w.Length > 2).ToList();
        var terms = KnowledgeRetrievalService.SectionTermsFor(query);
        var matches = rows.Select(r =>
        {
            var body = (string)(r.content ?? "");
            var heading = ((string?)r.section_title ?? "").ToLowerInvariant();
            var haystack = $"{heading} {body}".ToLowerInvariant();
            var hits = words.Count(w => haystack.Contains(w));
            var headingMatch = terms.Any(t => heading.Contains(t)) || words.Any(w => heading.Contains(w));
            var score = (words.Count > 0 ? hits / (double)words.Count : 0) * 0.7 + (headingMatch ? 0.3 : 0);
            return new
            {
                chunkIndex = (int)r.chunk_index,
                sectionTitle = (string?)r.section_title,
                sectionPath = (string?)r.section_path,
                pageNumber = (int?)r.page_number,
                score = Math.Round(score, 3),
                headingMatch,
                preview = body.Length > 240 ? body[..240] : body
            };
        }).OrderByDescending(m => m.score).Where(m => m.score > 0).Take(8).ToList();

        var blockers = RetrievalBlockers(doc);
        var live = await retrieval.RetrieveAsync(db, query, perms, "en", 5, useCache: false, ct: ct);
        return new
        {
            title = (string)doc.title,
            searchable = blockers.Count == 0,
            blockers,
            sectionTerms = terms,
            totalChunks = rows.Count,
            matches,
            live = live.Select(p => new
            {
                title = p.Title,
                sectionTitle = p.SectionTitle,
                pageNumber = p.PageNumber,
                score = Math.Round(p.Score, 3),
                lexical = Math.Round(p.Lexical, 3),
                fuzzy = Math.Round(p.Fuzzy, 3),
                snippet = p.Snippet.Length > 220 ? p.Snippet[..220] : p.Snippet
            }).ToList()
        };
    }

    private static List<string> ProbeQuestions(string title, List<string> sections)
    {
        string[] wanted = ["objective", "purpose", "scope", "eligibility", "responsibilit", "procedure"];
        var picked = sections.Where(s => wanted.Any(w => s.Contains(w, StringComparison.OrdinalIgnoreCase))).Take(3).ToList();
        var bas = picked.Count > 0 ? picked : sections.Take(2).ToList();
        return bas.Select(s => $"What is the {s.ToLowerInvariant()} of the {title}?").ToList();
    }
}
