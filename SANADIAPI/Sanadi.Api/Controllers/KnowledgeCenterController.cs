using System.Data.Common;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Sanadi.Api.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Domain.Security;
using Sanadi.Infrastructure.Knowledge;
using Sanadi.Infrastructure.Persistence;

using Sanadi.Api.Middleware;

namespace Sanadi.Api.Controllers;

[ApiController, Route("api/knowledge")]
public sealed class KnowledgeCenterController(
    ISqlConnectionFactory sql,
    KnowledgeIngestService ingest,
    KnowledgeDocumentOpsService documentOps,
    KnowledgeWebCrawlService webCrawl,
    KnowledgeConnectorsService connectors,
    KnowledgeRetrievalService retrieval,
    KnowledgeSourcesService sources,
    KnowledgeEmbeddingsService embeddings,
    KnowledgeSeedService seed,
    ILogger<KnowledgeCenterController> logger) : ControllerBase
{
    private ICurrentUser Current() => HttpContext.GetSanadiUser();

    private Guid UserId()
    {
        var u = Current();
        if (!u.IsAuthenticated || u.UserId is not Guid id) throw new UnauthorizedException();
        return id;
    }

    private async Task<(Guid UserId, CenterPermissions Perms, DbConnection Db)> Ctx()
    {
        var id = UserId();
        var db = sql.Create();
        var perms = await KnowledgePermissions.LoadAsync(db, id);
        KnowledgePermissions.Assert(perms.CanViewCenter, "You do not have access to the Knowledge & Integrations Center.");
        return (id, perms, db);
    }

    private static object MapIngest(IngestResult r) => new
    {
        id = r.Id,
        chunks = r.Chunks,
        issues = r.Issues.Select(i => new { code = i.Code, severity = i.Severity, message = i.Message }),
        processingStatus = r.ProcessingStatus
    };

    private static object MapPassage(RetrievedSource s, int? rank = null, bool? wouldBeSelected = null) => new
    {
        sourceType = s.SourceType,
        sourceId = s.SourceId,
        chunkId = s.ChunkId,
        title = s.Title,
        snippet = s.Snippet,
        sectionTitle = s.SectionTitle,
        pageNumber = s.PageNumber,
        citationUrl = s.CitationUrl,
        owningUnit = s.OwningUnit,
        version = s.Version,
        effectiveDate = s.EffectiveDate,
        confidentiality = s.Confidentiality,
        domain = s.Domain,
        documentType = s.DocumentType,
        relevance = s.Relevance,
        lexical = s.Lexical,
        fuzzy = s.Fuzzy,
        semantic = s.Semantic,
        authority = s.Authority,
        score = s.Score,
        language = s.Language,
        stale = s.Stale,
        rank,
        wouldBeSelected
    };

    private static List<string> AsStringList(object? value)
    {
        if (value is null) return [];
        if (value is IEnumerable<string> ss) return ss.Where(x => !string.IsNullOrWhiteSpace(x)).ToList();
        if (value is IEnumerable<object> oo) return oo.Select(x => x?.ToString() ?? "").Where(x => x.Length > 0).ToList();
        if (value is string s)
        {
            try
            {
                using var doc = JsonDocument.Parse(s);
                if (doc.RootElement.ValueKind == JsonValueKind.Array)
                    return doc.RootElement.EnumerateArray().Select(e => e.GetString() ?? "").Where(x => x.Length > 0).ToList();
            }
            catch { /* ignore */ }
        }
        return [];
    }

    private static string IsoDate(object? v) => v switch
    {
        DateTime dt => dt.ToString("yyyy-MM-dd"),
        DateTimeOffset dto => dto.UtcDateTime.ToString("yyyy-MM-dd"),
        string s => s.Length >= 10 ? s[..10] : s,
        _ => ""
    };

    /* ------------------------------------------------------------------ overview */

    [HttpGet("overview")]
    public async Task<object> Overview()
    {
        var (_, perms, db) = await Ctx();
        await using (db)
        {
            var today = DateTime.UtcNow.ToString("yyyy-MM-dd");
            var soon = DateTime.UtcNow.AddDays(30).ToString("yyyy-MM-dd");

            var m = await db.QuerySingleAsync(DbProc.Call("usp_Knowledge_CenterOverview_GetMetrics", new { soon, today }));
            int activeDocs = (int)m.activeDocs, publishedDocs = (int)m.publishedDocs, pendingDocs = (int)m.pendingDocs;
            int dueReview = (int)m.dueReview, expiredDocs = (int)m.expiredDocs, supersededDocs = (int)m.supersededDocs;
            int failedExtraction = (int)m.failedExtraction, failedIndexing = (int)m.failedIndexing;
            int conflicts = (int)m.conflicts, criticalConflicts = (int)m.criticalConflicts, activeFaqs = (int)m.activeFaqs;
            int webSources = (int)m.webSources, webChanged = (int)m.webChanged;
            int healthy = (int)m.healthy, degraded = (int)m.degraded, offline = (int)m.offline, gaps = (int)m.gaps;

            var activity = (await db.QueryAsync(DbProc.Call("usp_Knowledge_CenterOverview_ListActivity", null))).ToArray();
            var approvals = (await db.QueryAsync(DbProc.Call("usp_Knowledge_CenterOverview_ListApprovals", null))).ToArray();
            var failures = (await db.QueryAsync(DbProc.Call("usp_Knowledge_CenterOverview_ListFailures", null))).ToArray();
            var recentSources = (await db.QueryAsync(DbProc.Call("usp_Knowledge_CenterOverview_ListRecentWebSources", null))).ToArray();
            var latencies = (await db.QueryAsync<int?>(DbProc.Call("usp_Knowledge_CenterOverview_ListLatencies", null)))
                .Where(x => x is > 0).Select(x => x!.Value).ToList();
            var avgLatency = latencies.Count > 0 ? (int)Math.Round(latencies.Average()) : 0;

            return new
            {
                permissions = KnowledgePermissions.ToDto(perms),
                metrics = new
                {
                    activeDocs, publishedDocs, pendingDocs, dueReview, expiredDocs, supersededDocs,
                    failedExtraction, failedIndexing, conflicts, criticalConflicts, activeFaqs,
                    webSources, webChanged, healthy, degraded, offline, gaps, avgLatency
                },
                activity,
                approvals,
                failures,
                recentSources
            };
        }
    }

    /* ----------------------------------------------------------------- documents */

    public sealed record ListDocumentsInput(string? Search, string? Status);

    [HttpPost("documents/list")]
    public async Task<object> ListDocuments([FromBody] ListDocumentsInput? data)
    {
        var (_, _, db) = await Ctx();
        await using (db)
        {
            var search = data?.Search;
            var status = data?.Status;
            var rows = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Documents_List", new { status, search }))).ToArray();
            var categories = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Documents_ListCategories", null))).ToArray();
            var units = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Documents_ListUnits", null))).ToArray();
            return new { documents = rows, categories, units };
        }
    }

    public sealed record UploadInput(
        string Title, string DocumentType, Guid? CategoryId, Guid? OwnerUnitId,
        string Language, string Version, string EffectiveDate, string? ReviewDate, string? ExpiryDate,
        string ConfidentialityLevel, string FileName, string MimeType, long SizeBytes,
        string? TextContent, string? StoragePath, string? StructuredKind,
        Guid? SupersedesDocumentId, string? KnowledgeDomain, string? Notes);

    [HttpPost("documents/upload")]
    public async Task<object> Upload([FromBody] UploadInput data, CancellationToken ct)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanManageKnowledge, "Only knowledge managers may upload documents.");
            var result = await ingest.IngestAsync(db, userId, ToIngest(data), Current(), ct);
            await KnowledgePermissions.AuditAsync(db, userId, "document.upload", "knowledge_document", result.Id,
                $"Uploaded \"{data.Title}\" (v{data.Version})",
                new { chunks = result.Chunks, issues = result.Issues.Count, structuredKind = data.StructuredKind });
            return MapIngest(result);
        }
    }

    public sealed record DocumentIdInput(Guid DocumentId);

    [HttpPost("documents/approval/request")]
    public async Task<object> RequestApproval([FromBody] DocumentIdInput data)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanManageKnowledge, "Only knowledge managers may submit documents for approval.");
            var doc = await db.QuerySingleOrDefaultAsync(
                DbProc.Call("usp_Knowledge_Documents_GetQualityRow", data))
                ?? throw new NotFoundException("Document not found.");
            if ((string?)doc.quality_status == "failed")
                throw new SanadiException("This document failed material quality checks and cannot be submitted.");
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Documents_SetPendingReview", data));
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Documents_InsertApprovalRequest",
                new { data.DocumentId, title = (string)doc.title, userId }));
            await KnowledgePermissions.AuditAsync(db, userId, "document.submit_for_approval", "knowledge_document", data.DocumentId,
                $"Submitted \"{doc.title}\" for approval");
            return new { ok = true };
        }
    }

    public sealed record DecideInput(Guid DocumentId, string Decision, string? Notes);

    [HttpPost("documents/approval/decide")]
    public async Task<object> DecideApproval([FromBody] DecideInput data)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanApproveKnowledge, "Only knowledge approvers may decide approvals.");
            if (data.Decision is not ("approved" or "rejected" or "returned_for_revision"))
                throw new SanadiException("Invalid decision.");
            var doc = await db.QuerySingleOrDefaultAsync(
                DbProc.Call("usp_Knowledge_Documents_GetDecideRow", new { data.DocumentId }))
                ?? throw new NotFoundException("Document not found.");
            var now = DateTime.UtcNow;
            var today = now.ToString("yyyy-MM-dd");

            if (data.Decision == "approved")
            {
                var effectiveNow = string.IsNullOrEmpty(IsoDate(doc.effective_date)) || string.CompareOrdinal(IsoDate(doc.effective_date), today) <= 0;
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Documents_Approve", new
                {
                    data.DocumentId, userId, now,
                    status = effectiveNow ? "published" : "approved",
                    publishedAt = effectiveNow ? now : (DateTime?)null,
                    active = effectiveNow
                }));
                if (effectiveNow)
                {
                    var supersededRaw = doc.supersedes_document_id;
                    if (supersededRaw is Guid supersededId)
                    {
                        await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Documents_MarkSuperseded",
                            new { data.DocumentId, supersededId }));
                    }
                }
            }
            else
            {
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Documents_SetApprovalStatus",
                    new { data.DocumentId, status = data.Decision == "rejected" ? "rejected" : "needs_revision" }));
            }

            var reqStatus = data.Decision == "approved" ? "approved" : data.Decision == "rejected" ? "rejected" : "returned_for_revision";
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Documents_DecideApprovalRequest",
                new { data.DocumentId, reqStatus, now, userId, data.Notes }));

            KnowledgeRetrievalService.InvalidateCache("document_decision");
            await KnowledgePermissions.AuditAsync(db, userId, $"document.{data.Decision}", "knowledge_document", data.DocumentId,
                $"{data.Decision} \"{doc.title}\"", new { notes = data.Notes });
            return new { ok = true };
        }
    }

    public sealed record RetireInput(Guid DocumentId, string Reason, Guid? ReplacementId);

    [HttpPost("documents/retire")]
    public async Task<object> Retire([FromBody] RetireInput data)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanManageKnowledge, "Only knowledge managers may retire content.");
            if (string.IsNullOrWhiteSpace(data.Reason) || data.Reason.Trim().Length < 3)
                throw new SanadiException("A retirement reason is required.");
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Documents_Retire", data));
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Documents_DeactivateChunks", new { data.DocumentId }));
            await KnowledgePermissions.AuditAsync(db, userId, "document.retire", "knowledge_document", data.DocumentId, "Retired document", new { reason = data.Reason });
            return new { ok = true };
        }
    }

    public sealed record RollbackInput(Guid CurrentId, Guid PreviousId);

    [HttpPost("documents/rollback")]
    public async Task<object> Rollback([FromBody] RollbackInput data)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanApproveKnowledge, "Only knowledge approvers may roll back a version.");
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Documents_RollbackCurrent", new { data.CurrentId }));
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Documents_RollbackPrevious", new { data.PreviousId }));
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Documents_ActivateChunks", new { data.PreviousId }));
            await KnowledgePermissions.AuditAsync(db, userId, "document.rollback", "knowledge_document", data.PreviousId,
                "Rolled back to the previous approved version", new { from = data.CurrentId });
            return new { ok = true };
        }
    }

    [HttpPost("documents/reprocess")]
    public async Task<object> Reprocess([FromBody] DocumentIdInput data, CancellationToken ct)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanManageKnowledge, "Only knowledge managers may re-index documents.");
            var result = await documentOps.ReprocessAsync(db, data.DocumentId, Current(), ct);
            KnowledgeRetrievalService.InvalidateCache("document_reprocess");
            await KnowledgePermissions.AuditAsync(db, userId, "document.reprocess", "knowledge_document", data.DocumentId,
                $"Re-indexed \"{result.Title}\"", new { chunks = result.Chunks, sections = result.Sections.Count, source = result.Source });
            return result;
        }
    }

    public sealed record ActivateInput(Guid DocumentId, string? Lang);

    [HttpPost("documents/activate")]
    public async Task<object> Activate([FromBody] ActivateInput data, CancellationToken ct)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanManageKnowledge, "Only knowledge managers may activate sources.");
            var lang = data.Lang is "ar" ? "ar" : "en";
            var result = await documentOps.ActivateAsync(db, data.DocumentId, perms, lang, ct);
            await KnowledgePermissions.AuditAsync(db, userId,
                result.Activated ? "document.activate" : "document.activate_failed",
                "knowledge_document", data.DocumentId,
                $"{(result.Activated ? "Activated" : "Activation blocked for")} \"{result.Title}\"",
                new { checks = result.Checks, probes = result.Probes });
            return result;
        }
    }

    public sealed record DiagnoseInput(Guid DocumentId, string Query);

    [HttpPost("documents/diagnose")]
    public async Task<object> Diagnose([FromBody] DiagnoseInput data, CancellationToken ct)
    {
        var (_, perms, db) = await Ctx();
        await using (db)
        {
            if (string.IsNullOrWhiteSpace(data.Query) || data.Query.Trim().Length < 2)
                throw new SanadiException("Query is required.");
            return await documentOps.DiagnoseAsync(db, data.DocumentId, data.Query.Trim(), perms, ct);
        }
    }

    public sealed record ReplaceInput(
        Guid TargetDocumentId,
        string Title, string DocumentType, Guid? CategoryId, Guid? OwnerUnitId,
        string Language, string Version, string EffectiveDate, string? ReviewDate, string? ExpiryDate,
        string ConfidentialityLevel, string FileName, string MimeType, long SizeBytes,
        string? TextContent, string? StoragePath, string? StructuredKind,
        Guid? SupersedesDocumentId, string? KnowledgeDomain, string? Notes);

    [HttpPost("documents/replace")]
    public async Task<object> Replace([FromBody] ReplaceInput data, CancellationToken ct)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanManageKnowledge, "Only knowledge managers may replace documents.");
            var target = await db.QuerySingleOrDefaultAsync(
                DbProc.Call("usp_Knowledge_Documents_GetReplaceTarget", new { data.TargetDocumentId }))
                ?? throw new NotFoundException("The document being replaced no longer exists.");

            var ingestInput = new IngestInput(
                data.Title, data.DocumentType, data.CategoryId, data.OwnerUnitId, data.Language, data.Version,
                data.EffectiveDate, data.ReviewDate, data.ExpiryDate, data.ConfidentialityLevel,
                data.FileName, data.MimeType, data.SizeBytes, data.TextContent, data.StoragePath,
                data.StructuredKind, data.TargetDocumentId, data.KnowledgeDomain, data.Notes);
            var result = await ingest.IngestAsync(db, userId, ingestInput, Current(), ct);
            var failed = result.ProcessingStatus != "ready_for_review" || result.Issues.Any(i => i.Severity == "blocking");
            if (failed)
            {
                await KnowledgePermissions.AuditAsync(db, userId, "document.replace_failed", "knowledge_document", data.TargetDocumentId,
                    $"Replacement of \"{target.title}\" failed validation — the previous version stays active",
                    new { newDocumentId = result.Id });
                return new { id = result.Id, chunks = result.Chunks, issues = result.Issues.Select(i => new { code = i.Code, severity = i.Severity, message = i.Message }), processingStatus = result.ProcessingStatus, activated = false, previousKeptActive = true };
            }

            var activate = perms.CanApproveKnowledge;
            if (activate)
            {
                var now = DateTime.UtcNow;
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Documents_PublishReplacement",
                    new { userId, now, id = result.Id }));
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Documents_SupersedeTarget",
                    new { id = result.Id, now, reason = $"Replaced by version {data.Version}", data.TargetDocumentId }));
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Documents_DeactivateChunksByTarget", new { data.TargetDocumentId }));
                KnowledgeRetrievalService.InvalidateCache("document_replace");
            }
            await KnowledgePermissions.AuditAsync(db, userId, "document.replace", "knowledge_document", result.Id,
                $"Replaced \"{target.title}\" v{target.version ?? "?"} with v{data.Version}",
                new { previousDocumentId = data.TargetDocumentId, activated = activate, chunks = result.Chunks });
            return new { id = result.Id, chunks = result.Chunks, issues = result.Issues.Select(i => new { code = i.Code, severity = i.Severity, message = i.Message }), processingStatus = result.ProcessingStatus, activated = activate, previousKeptActive = !activate };
        }
    }

    private static IngestInput ToIngest(UploadInput data) => new(
        data.Title, data.DocumentType, data.CategoryId, data.OwnerUnitId, data.Language, data.Version,
        data.EffectiveDate, data.ReviewDate, data.ExpiryDate, data.ConfidentialityLevel,
        data.FileName, data.MimeType, data.SizeBytes, data.TextContent, data.StoragePath,
        data.StructuredKind, data.SupersedesDocumentId, data.KnowledgeDomain, data.Notes);

    /* ---------------------------------------------------------------- web sources */

    [HttpGet("web/sources")]
    public async Task<object> ListWebSources()
    {
        var (_, _, db) = await Ctx();
        await using (db)
        {
            var sourcesList = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Web_ListSources", null))).ToArray();
            var changes = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Web_ListChanges", null))).ToArray();
            return new { sources = sourcesList, changes };
        }
    }

    public sealed record IdInput(Guid Id);

    [HttpPost("web/pages")]
    public async Task<object> ListWebPages([FromBody] IdInput data)
    {
        var (_, _, db) = await Ctx();
        await using (db)
        {
            var pages = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Web_ListPages", data))).ToArray();
            return new { pages };
        }
    }

    public sealed record SaveWebInput(
        Guid? Id, string Title, string Url, string Language, string SourceCategory, string ConfidentialityLevel,
        string RefreshFrequency, Guid? OwnerUnitId, bool TrustedAutoRefresh = false, string? KnowledgeDomain = null,
        string CrawlScope = "single_page", int MaxDepth = 1, int MaxPages = 25,
        List<string>? SeedUrls = null, List<string>? AllowedPaths = null, List<string>? ExcludedPaths = null);

    [HttpPost("web/save")]
    public async Task<object> SaveWeb([FromBody] SaveWebInput data)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanManageKnowledge, "Only knowledge managers may register web sources.");
            var check = KnowledgeWebCrawlService.ValidateSourceUrl(data.Url);
            if (!check.Ok) throw new SanadiException(check.Error!);
            var seedUrls = (data.SeedUrls ?? []).Select(s => s.Trim()).Where(s => s.Length > 0).Take(50).ToList();
            foreach (var seedUrl in seedUrls)
            {
                var abs = new Uri(new Uri(data.Url), seedUrl).ToString();
                var seedCheck = KnowledgeWebCrawlService.ValidateSourceUrl(abs);
                if (!seedCheck.Ok) throw new SanadiException($"{seedUrl}: {seedCheck.Error}");
            }
            var allowed = (data.AllowedPaths ?? []).Select(p => p.Trim()).Where(p => p.Length > 0).Take(30).ToList();
            var excluded = (data.ExcludedPaths ?? []).Select(p => p.Trim()).Where(p => p.Length > 0).Take(30).ToList();
            var seedJson = JsonSerializer.Serialize(seedUrls);
            var allowedJson = JsonSerializer.Serialize(allowed);
            var excludedJson = JsonSerializer.Serialize(excluded);
            var maxDepth = data.CrawlScope == "same_domain" ? data.MaxDepth : 0;
            var maxPages = data.CrawlScope == "single_page" ? 1 : data.MaxPages;

            if (data.Id is Guid id)
            {
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Web_UpdateSource",
                    new { data.Title, data.Url, data.Language, data.SourceCategory, data.ConfidentialityLevel, data.RefreshFrequency, data.OwnerUnitId, data.TrustedAutoRefresh, data.KnowledgeDomain, data.CrawlScope, maxDepth, maxPages, seedJson, allowedJson, excludedJson, id }));
                await KnowledgePermissions.AuditAsync(db, userId, "web_source.update", "web_knowledge_source", id, $"Updated web source {data.Title}");
                return new { id };
            }

            var newId = Guid.NewGuid();
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Web_InsertSource",
                new { newId, data.Title, data.Url, data.Language, data.SourceCategory, data.ConfidentialityLevel, data.RefreshFrequency, data.OwnerUnitId, data.TrustedAutoRefresh, data.KnowledgeDomain, data.CrawlScope, maxDepth, maxPages, seedJson, allowedJson, excludedJson, userId }));
            await KnowledgePermissions.AuditAsync(db, userId, "web_source.create", "web_knowledge_source", newId, $"Registered web source {data.Title}", new { url = data.Url });
            return new { id = newId };
        }
    }

    public sealed record RefreshWebInput(Guid Id, string? RevisionSeed);

    [HttpPost("web/refresh")]
    public async Task<object> RefreshWeb([FromBody] RefreshWebInput data, CancellationToken ct)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanManageKnowledge, "Only knowledge managers may refresh web sources.");
            var source = await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Knowledge_Web_GetSourceForRefresh", new { data.Id }))
                ?? throw new NotFoundException("Web source not found.");

            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Web_SetCrawling", new { data.Id }));

            WebCrawlReport report;
            try
            {
                report = await webCrawl.CrawlAndIndexAsync(
                    db, (Guid)source.id, (string)source.url, (string)source.title, (string?)source.knowledge_domain,
                    (string?)source.crawl_scope ?? "single_page",
                    (int?)source.max_depth ?? 1,
                    (int?)source.max_pages ?? 25,
                    AsStringList(source.seed_urls),
                    AsStringList(source.allowed_paths),
                    AsStringList(source.excluded_path_patterns),
                    ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception ex)
            {
                ApiErrorPolicy.LogOnce(logger, ex, HttpContext, nameof(RefreshWeb));
                var message = ex.Message;
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Web_MarkFetchFailed",
                    new { data.Id, err = message.Length > 500 ? message[..500] : message }));
                await KnowledgePermissions.AuditAsync(db, userId, "web_source.fetch_failed", "web_knowledge_source", data.Id, $"Crawl failed for {source.title}", new { error = message });
                return new { ok = false, error = message, changeType = "access_failed", indexed = 0, chunks = 0 };
            }

            var indexed = report.Indexed;
            var failed = report.Failed;
            var chunks = report.Chunks;
            var discovered = report.Discovered;
            var removed = report.Removed;
            var truncated = report.Truncated;
            var pages = report.Pages;
            var collegeNames = report.CollegeNames.ToList();

            if (indexed == 0)
            {
                var reason = report.Error
                    ?? pages.Select(p => p.Error).FirstOrDefault(e => !string.IsNullOrEmpty(e))
                    ?? "No page could be indexed.";
                var health = pages.Any(p => p.Status == "removed") ? "removed" : "failed";
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Web_MarkCrawlEmpty",
                    new { data.Id, health, err = reason.Length > 500 ? reason[..500] : reason, discovered, failed }));
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Web_InsertAccessFailedChange",
                    new { data.Id, hash = (string?)source.content_hash, reason }));
                await KnowledgePermissions.AuditAsync(db, userId, "web_source.fetch_failed", "web_knowledge_source", data.Id, $"Crawl produced no content for {source.title}", new { error = reason });
                return new { ok = false, error = reason, changeType = "access_failed", indexed = 0, chunks = 0 };
            }

            var combined = string.Join("\n", pages.Where(p => p.Ok)
                .Select(p => $"{p.Url}:{p.Hash}")
                .OrderBy(x => x));
            var corpusHash = KnowledgeProcessing.Checksum(combined);
            var changed = (string?)source.content_hash != corpusHash;
            var diff = KnowledgeWebCrawlService.ClassifyChange((string?)source.extracted_text ?? "", combined);
            var policyLike = new[] { "policy", "regulation" }.Contains((string?)source.source_category);
            var autoPublish = source.trusted_auto_refresh is true && !policyLike && diff.ChangeType == "minor";

            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Web_UpdateAfterCrawl", new
            {
                data.Id, corpusHash,
                text = combined.Length > 200_000 ? combined[..200_000] : combined,
                ingestion = failed > 0 ? "partial" : "indexed",
                health = failed > 0 && indexed == 0 ? "degraded" : "healthy",
                lastError = truncated ? "Crawl stopped at the time budget; run refresh again to continue." : null,
                discovered, indexed, failed, chunks,
                changeDetected = changed && !autoPublish,
                approval = changed && !autoPublish ? "changed_pending_review" : "approved",
                changed, autoPublish
            }));

            if (changed)
            {
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Web_InsertChange", new
                {
                    data.Id, prev = (string?)source.content_hash, corpusHash,
                    changeType = diff.ChangeType,
                    summary = $"{indexed} page(s) indexed, {chunks} passage(s). {diff.Summary}",
                    pct = diff.Percentage,
                    review = autoPublish ? "auto_approved" : "pending",
                    approvedAt = autoPublish ? DateTime.UtcNow : (DateTime?)null
                }));
            }

            var colleges = 0;
            try
            {
                var facts = await webCrawl.RefreshUniversityCollegesAsync(db, data.Id, collegeNames);
                colleges = facts.Stored;
            }
            catch (Exception ex)
            {
                ApiErrorPolicy.LogOnce(logger, ex, HttpContext, nameof(RefreshWeb));
            }

            KnowledgeRetrievalService.InvalidateCache("web_source_refresh");
            await KnowledgePermissions.AuditAsync(db, userId, "web_source.refresh", "web_knowledge_source", data.Id, $"Crawled {source.title}",
                new { changed, indexed, failed, chunks, colleges });
            return new
            {
                ok = true, changed,
                changeType = diff.ChangeType,
                percentage = diff.Percentage,
                summary = diff.Summary,
                discovered, indexed, failed, chunks, removed, truncated, colleges
            };
        }
    }

    public sealed record ReviewWebInput(Guid ChangeId, string Decision);

    [HttpPost("web/review-change")]
    public async Task<object> ReviewWebChange([FromBody] ReviewWebInput data)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanApproveKnowledge || perms.CanManageKnowledge, "Not authorised.");
            if (data.Decision is not ("approved" or "rejected")) throw new SanadiException("Invalid decision.");
            var change = await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Knowledge_Web_GetChangeSourceId", new { data.ChangeId }));
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Web_ReviewChange",
                new { data.ChangeId, data.Decision, userId }));
            if (change is not null)
            {
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Web_ApplyChangeDecision", new
                {
                    web = (Guid)change.web_source_id,
                    status = data.Decision == "approved" ? "approved" : "rejected",
                    active = data.Decision == "approved"
                }));
            }
            KnowledgeRetrievalService.InvalidateCache("web_source_change");
            await KnowledgePermissions.AuditAsync(db, userId, $"web_source.change_{data.Decision}", "web_source_change", data.ChangeId, $"Web source change {data.Decision}");
            return new { ok = true };
        }
    }

    /* ---------------------------------------------------------------- connectors */

    [HttpGet("connectors")]
    public async Task<object> ListConnectors()
    {
        var (_, _, db) = await Ctx();
        await using (db)
        {
            var connectorsList = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Connectors_List", null))).ToArray();
            var tools = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Connectors_ListTools", null))).ToArray();
            var mappings = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Connectors_ListMappings", null))).ToArray();
            var tests = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Connectors_ListTests", null))).ToArray();
            var health = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Connectors_ListHealth", null))).ToArray();
            return new { connectors = connectorsList, tools, mappings, tests, health };
        }
    }

    public sealed record UpdateConnectorInput(Guid Id, bool? IsActive, bool? ReadEnabled, bool? WriteEnabled, string? HealthStatus, int? TimeoutMs);

    [HttpPost("connectors/update")]
    public async Task<object> UpdateConnector([FromBody] UpdateConnectorInput data)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanManageIntegrations, "Only integration administrators may change connectors.");
            var connector = await db.QuerySingleOrDefaultAsync(
                DbProc.Call("usp_Knowledge_Connectors_GetEnvRow", new { data.Id }))
                ?? throw new NotFoundException("Connector not found.");
            if (data.WriteEnabled == true && (string?)connector.environment == "production" && !perms.IsAdmin)
                throw new SanadiException("Enabling production write access requires a system administrator.");

            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Connectors_Update", data));
            if (!string.IsNullOrEmpty(data.HealthStatus))
            {
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Connectors_InsertManualHealth",
                    new { data.Id, data.HealthStatus }));
            }
            await KnowledgePermissions.AuditAsync(db, userId, "connector.update", "integration_connector", data.Id,
                $"Updated connector {connector.connector_name}", data);
            return new { ok = true };
        }
    }

    public sealed record CreateConnectorInput(
        string DisplayNameEn, string? DisplayNameAr, string SourceSystem, string ConnectorType = "rest_api",
        string Environment = "development", string BaseUrl = "", string AuthenticationType = "none",
        string? CredentialSecretName = null, string DataClassification = "internal", string Usage = "live");

    [HttpPost("connectors/create")]
    public async Task<object> CreateConnector([FromBody] CreateConnectorInput data)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanManageIntegrations, "Only integration administrators may add data connections.");
            if (string.IsNullOrWhiteSpace(data.DisplayNameEn) || data.DisplayNameEn.Trim().Length < 3)
                throw new SanadiException("Display name is required.");
            if (!Uri.TryCreate(data.BaseUrl, UriKind.Absolute, out _))
                throw new SanadiException("A valid base URL is required.");
            var connectorName = System.Text.RegularExpressions.Regex.Replace(data.DisplayNameEn.ToLowerInvariant(), @"[^a-z0-9]+", "_").Trim('_');
            if (connectorName.Length > 60) connectorName = connectorName[..60];
            if (string.IsNullOrEmpty(connectorName)) connectorName = $"connector_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            var id = Guid.NewGuid();
            var cachePolicy = JsonSerializer.Serialize(new { ttl_seconds = data.Usage == "knowledge" ? 3600 : 60, usage = data.Usage });
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Connectors_Insert", new
            {
                id, connectorName, data.DisplayNameEn,
                displayAr = string.IsNullOrWhiteSpace(data.DisplayNameAr) ? data.DisplayNameEn : data.DisplayNameAr,
                data.SourceSystem, data.ConnectorType, data.Environment, data.BaseUrl, data.AuthenticationType,
                data.CredentialSecretName, credConfigured = !string.IsNullOrWhiteSpace(data.CredentialSecretName),
                data.DataClassification, cachePolicy, userId
            }));
            await KnowledgePermissions.AuditAsync(db, userId, "connector.create", "integration_connector", id,
                $"Registered data connection {data.DisplayNameEn}", new { source_system = data.SourceSystem, usage = data.Usage });
            return new { id };
        }
    }

    public sealed record UpdateToolInput(Guid Id, bool? Enabled, bool? ConfirmationRequired, bool? HumanApprovalRequired);

    [HttpPost("connectors/tools/update")]
    public async Task<object> UpdateTool([FromBody] UpdateToolInput data)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanManageIntegrations, "Only integration administrators may change connector tools.");
            var tool = await db.QuerySingleOrDefaultAsync(
                DbProc.Call("usp_Knowledge_Connectors_GetToolRow", new { data.Id }))
                ?? throw new NotFoundException("Tool not found.");
            var confirm = data.ConfirmationRequired;
            var human = data.HumanApprovalRequired;
            if ((string?)tool.operation_type != "read") { confirm = true; human = true; }
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Connectors_UpdateTool",
                new { data.Id, data.Enabled, confirm, human }));
            await KnowledgePermissions.AuditAsync(db, userId, "connector_tool.update", "integration_tool", data.Id,
                $"Updated tool {tool.tool_name}", data);
            return new { ok = true };
        }
    }

    public sealed record SaveMappingInput(
        Guid? Id, Guid ConnectorId, Guid? ToolId, string ExternalField, string InternalField,
        string DataType, string? TransformationRule, bool Sensitive = false, string? MaskingRule = null);

    [HttpPost("connectors/mappings/save")]
    public async Task<object> SaveMapping([FromBody] SaveMappingInput data)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanManageIntegrations, "Only integration administrators may change field mappings.");
            if (data.Id is Guid id)
            {
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Connectors_UpdateMapping",
                    new { id, data.ConnectorId, data.ToolId, data.ExternalField, data.InternalField, data.DataType, data.TransformationRule, data.Sensitive, data.MaskingRule }));
            }
            else
            {
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Connectors_InsertMapping", data));
            }
            await KnowledgePermissions.AuditAsync(db, userId, "field_mapping.save", "integration_field_mapping", data.Id,
                $"Mapped {data.ExternalField} → {data.InternalField}", data);
            return new { ok = true };
        }
    }

    public sealed record TestConnectorInput(Guid ConnectorId, string? ToolName);

    [HttpPost("connectors/test")]
    public async Task<object> TestConnector([FromBody] TestConnectorInput data)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanManageIntegrations, "Only integration administrators may test connectors.");
            var connector = await db.QuerySingleOrDefaultAsync(
                DbProc.Call("usp_Knowledge_Connectors_GetForTest", new { data.ConnectorId }))
                ?? throw new NotFoundException("Connector not found.");
            var toolName = data.ToolName;
            if (string.IsNullOrWhiteSpace(toolName))
                toolName = await db.ExecuteScalarAsync<string?>(DbProc.Call("usp_Knowledge_Connectors_GetDefaultToolName", new { data.ConnectorId }));
            if (string.IsNullOrWhiteSpace(toolName))
                throw new SanadiException("This connector has no enabled tool to test.");

            var roles = new List<string> { "system_admin" };
            roles.AddRange(perms.Roles);
            var result = await connectors.RunToolAsync(db, userId, roles, toolName!, null, preview: true);
            var dataObj = result.Data;
            var snapshot = KnowledgeConnectorsService.DescribeShape(dataObj);
            var hash = KnowledgeConnectorsService.SchemaHash(snapshot);
            var current = await db.QuerySingleOrDefaultAsync(
                DbProc.Call("usp_Knowledge_Connectors_GetCurrentSchema", new { data.ConnectorId }));
            var schemaChanged = false;
            if (current is null)
            {
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Connectors_InsertSchemaVersion",
                    new { data.ConnectorId, hash, snap = JsonSerializer.Serialize(snapshot) }));
            }
            else if ((string?)current.schema_hash != hash)
            {
                schemaChanged = true;
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Connectors_ClearCurrentSchema",
                    new { id = (Guid)current.id }));
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Connectors_InsertSchemaVersion",
                    new { data.ConnectorId, hash, snap = JsonSerializer.Serialize(snapshot) }));
            }

            var statusStr = result.Status;
            var status = statusStr == "success" ? (schemaChanged ? "schema_changed" : "passed") : "failed";
            var health = statusStr == "success" ? (schemaChanged ? "schema_changed" : "healthy")
                : statusStr == "denied" ? "authentication_failed" : "degraded";
            var latency = result.LatencyMs;
            var error = result.Error;

            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Connectors_InsertTestRun", new
            {
                data.ConnectorId, status, latency,
                schemaValid = !schemaChanged,
                authValid = statusStr != "denied",
                error,
                preview = JsonSerializer.Serialize(snapshot),
                userId
            }));
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Connectors_UpdateHealthAfterTest",
                new { data.ConnectorId, health }));
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Connectors_InsertHealthEvent",
                new { data.ConnectorId, health, latency, error }));
            await KnowledgePermissions.AuditAsync(db, userId, "connector.test", "integration_connector", data.ConnectorId,
                $"Tested {connector.connector_name} via {toolName}", new { status, latency });

            var masked = result.MaskedFields as IEnumerable<string> ?? Array.Empty<string>();
            return new
            {
                status, health, latencyMs = latency, schemaChanged,
                maskedFields = masked.ToArray(),
                freshness = result.DataFreshness,
                error,
                shape = JsonSerializer.Serialize(snapshot)
            };
        }
    }

    public sealed record PreviewToolInput(string ToolName);

    [HttpPost("connectors/preview")]
    public async Task<object> PreviewTool([FromBody] PreviewToolInput data)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanManageIntegrations, "Only integration administrators may preview connector tools.");
            var result = await connectors.RunToolAsync(db, userId, perms.Roles, data.ToolName, null, preview: true);
            var dict = result.Data as IDictionary<string, object?>;
            var fields = dict?.Keys.ToArray() ?? Array.Empty<string>();
            var masked = result.MaskedFields as IEnumerable<string> ?? Array.Empty<string>();
            return new
            {
                status = result.Status,
                source = result.Source,
                freshness = result.DataFreshness,
                latencyMs = result.LatencyMs,
                maskedFields = masked.ToArray(),
                fields,
                normalised = new
                {
                    status = result.Status,
                    source = result.Source,
                    retrieved_at = result.RetrievedAt,
                    data_freshness = result.DataFreshness,
                    data = JsonSerializer.Serialize(result.Data)
                },
                error = result.Error
            };
        }
    }

    /* ------------------------------------------------------------ knowledge health */

    [HttpGet("health")]
    public async Task<object> Health()
    {
        var (_, _, db) = await Ctx();
        await using (db)
        {
            var gapsList = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Health_ListGaps", null))).ToArray();
            var conflictsList = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Health_ListConflicts", null))).ToArray();
            var issuesList = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Health_ListIssues", null))).ToArray();
            var retrievalLogs = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Health_ListRetrievalLogs", null))).ToArray();
            var coverage = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Health_ListCoverage", null))).ToArray();
            var servicesList = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Health_ListServices", null))).ToArray();

            var usage = new Dictionary<string, (int Retrieved, int Cited)>();
            foreach (var r in retrievalLogs)
            {
                var key = $"{r.source_type}:{r.source_id}";
                usage.TryGetValue(key, out var entry);
                entry.Retrieved += 1;
                if (r.citation_used is true) entry.Cited += 1;
                usage[key] = entry;
            }
            var topSources = usage.Select(kv => new { key = kv.Key, retrieved = kv.Value.Retrieved, cited = kv.Value.Cited })
                .OrderByDescending(x => x.retrieved).Take(10).ToArray();

            var mx = await db.QuerySingleAsync(DbProc.Call("usp_Knowledge_Health_GetIndexMetrics", null));
            int activeDocuments = (int)mx.activeDocuments, needsReviewDocuments = (int)mx.needsReviewDocuments;
            int failedDocuments = (int)mx.failedDocuments, docChunks = (int)mx.docChunks, docChunksEmbedded = (int)mx.docChunksEmbedded;
            int activeWebSources = (int)mx.activeWebSources, webPagesIndexed = (int)mx.webPagesIndexed;
            int webChunks = (int)mx.webChunks, webChunksEmbedded = (int)mx.webChunksEmbedded;
            int activeApis = (int)mx.activeApis, failedApis = (int)mx.failedApis;
            int englishDocuments = (int)mx.englishDocuments, arabicDocuments = (int)mx.arabicDocuments;
            int emptyRetrievals = (int)mx.emptyRetrievals;

            var index = new
            {
                activeSources = activeDocuments + activeWebSources + activeApis,
                activeDocuments,
                needsReviewDocuments,
                failedSources = failedDocuments + failedApis,
                activeWebSources,
                webPagesIndexed,
                activeApis,
                indexedChunks = docChunks + webChunks,
                embeddedChunks = docChunksEmbedded + webChunksEmbedded,
                unembeddedChunks = docChunks + webChunks - docChunksEmbedded - webChunksEmbedded,
                englishDocuments,
                arabicDocuments,
                unusedRetrievals = emptyRetrievals
            };

            return new { index, gaps = gapsList, conflicts = conflictsList, issues = issuesList, coverage, services = servicesList, topSources };
        }
    }

    public sealed record ResolveConflictInput(Guid Id, string Notes);

    [HttpPost("conflicts/resolve")]
    public async Task<object> ResolveConflict([FromBody] ResolveConflictInput data)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanApproveKnowledge || perms.CanManageKnowledge, "Not authorised.");
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Conflicts_Resolve",
                new { data.Id, userId, data.Notes }));
            await KnowledgePermissions.AuditAsync(db, userId, "conflict.resolve", "knowledge_conflict", data.Id, "Resolved knowledge conflict", new { notes = data.Notes });
            return new { ok = true };
        }
    }

    public sealed record GapStatusInput(Guid Id, string Status);

    [HttpPost("gaps/status")]
    public async Task<object> GapStatus([FromBody] GapStatusInput data)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanManageKnowledge, "Only knowledge managers may update gaps.");
            var allowed = new HashSet<string> { "detected", "under_review", "assigned", "content_requested", "content_added", "resolved", "dismissed" };
            if (!allowed.Contains(data.Status)) throw new SanadiException("Invalid gap status.");
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Gaps_SetStatus", data));
            await KnowledgePermissions.AuditAsync(db, userId, "gap.update", "knowledge_gap", data.Id, $"Gap marked {data.Status}");
            return new { ok = true };
        }
    }

    public sealed record ReportIssueInput(
        string SourceType, Guid? SourceId, string IssueType, string? Description,
        Guid? RelatedConversationId, string Priority = "medium");

    [HttpPost("issues/report")]
    public async Task<object> ReportIssue([FromBody] ReportIssueInput data)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.IsStaff, "Only staff may report knowledge issues.");
            var id = Guid.NewGuid();
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Issues_Insert",
                new { id, data.SourceType, data.SourceId, userId, data.IssueType, data.Description, data.RelatedConversationId, data.Priority }));
            await KnowledgePermissions.AuditAsync(db, userId, "knowledge_issue.report", "knowledge_issue_report", id, $"Reported {data.IssueType}");
            return new { id };
        }
    }

    /* --------------------------------------------------------------- preview/test */

    public sealed record PreviewInput(string Question, string? Lang);

    [HttpPost("preview")]
    public async Task<object> Preview([FromBody] PreviewInput data, CancellationToken ct)
    {
        var (_, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanManageKnowledge || perms.CanManageIntegrations, "Not authorised.");
            var lang = data.Lang is "ar" ? "ar" : "en";
            var outcome = await retrieval.RetrieveForGroundingAsync(db, data.Question, perms, lang, 8, false, ct);
            var grounded = outcome.Passages.ToList();
            var sourcesList = grounded.Count > 0
                ? grounded
                : await retrieval.RetrieveAsync(db, data.Question, perms, lang, 8, useCache: false, ct: ct);
            var conflicts = KnowledgeRetrievalService.DetectConflicts(sourcesList);
            var selected = grounded.FirstOrDefault();
            var groundedIds = grounded.Select(g => g.ChunkId ?? g.SourceId).ToHashSet();
            return new
            {
                groundingStatus = outcome.GroundingStatus,
                sources = sourcesList.Select((s, i) => MapPassage(s, i + 1, grounded.Contains(s) || groundedIds.Contains(s.ChunkId ?? s.SourceId))).ToList(),
                conflicts = conflicts.Select(c => new
                {
                    topic = c.Topic,
                    severity = c.Severity,
                    one = c.One.Title,
                    two = c.Two.Title,
                    statementOne = c.StatementOne,
                    statementTwo = c.StatementTwo
                }).ToList(),
                expectedCitation = selected is null ? null : new
                {
                    title = selected.Title,
                    section = selected.SectionTitle,
                    version = selected.Version,
                    effectiveDate = selected.EffectiveDate,
                    url = selected.CitationUrl
                },
                draftAnswer = selected is null
                    ? "No approved source currently answers this question — this is a knowledge gap."
                    : $"{(selected.Snippet.Length > 600 ? selected.Snippet[..600] : selected.Snippet)}\n\n_Source: {selected.Title}{(selected.Version is null ? "" : $" v{selected.Version}")}_"
            };
        }
    }

    /* ------------------------------------------------------------- export & demo */

    [HttpGet("export")]
    public async Task<object> Export()
    {
        var (_, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanManageKnowledge || perms.CanManageIntegrations, "Not authorised.");
            var docs = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Export_ListDocuments", null))).ToArray();
            var faqs = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Export_ListFaqs", null))).ToArray();
            var connectorsList = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Export_ListConnectors", null))).ToArray();
            var tools = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Export_ListTools", null))).ToArray();
            var mappings = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Export_ListMappings", null))).ToArray();
            var rules = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Export_ListAuthorityRules", null))).ToArray();
            return new
            {
                exportedAt = DateTime.UtcNow.ToString("O"),
                documents = docs,
                faqs,
                connectors = connectorsList,
                tools,
                fieldMappings = mappings,
                authorityRules = rules
            };
        }
    }

    [HttpPost("seed")]
    public async Task<object> Seed()
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.IsAdmin || (perms.CanManageKnowledge && perms.CanManageIntegrations),
                "Only a system administrator may seed demonstration data.");
            var result = await seed.SeedAsync(db, userId);
            await KnowledgePermissions.AuditAsync(db, userId, "center.seed_demo", "system", null,
                "Seeded Knowledge & Integrations Center demonstration data", result);
            return result;
        }
    }

    /* --------------------------------------------------------- unified source library */

    public sealed record ListSourcesInput(string? Search, string? Kind, string? Status, string? Language, string? Domain, int Page = 1, int PageSize = 20);

    [HttpPost("sources/list")]
    public async Task<object> ListSources([FromBody] ListSourcesInput? data)
    {
        var (_, _, db) = await Ctx();
        await using (db)
        {
            data ??= new ListSourcesInput(null, null, null, null, null);
            return await sources.ListAsync(db, data.Search, data.Kind, data.Status, data.Language, data.Domain, data.Page, data.PageSize);
        }
    }

    public sealed record GetSourceInput(string Kind, Guid Id);

    [HttpPost("sources/get")]
    public async Task<object> GetSource([FromBody] GetSourceInput data)
    {
        var (_, perms, db) = await Ctx();
        await using (db)
        {
            if (data.Kind is not ("document" or "web" or "api")) throw new SanadiException("Invalid source kind.");
            if (data.Kind == "api")
                KnowledgePermissions.Assert(perms.CanManageIntegrations || perms.IsStaff, "Not authorised.");
            return await sources.GetAsync(db, data.Kind, data.Id);
        }
    }

    public sealed record EnableSourceInput(string Kind, Guid Id, bool Enabled);

    [HttpPost("sources/enable")]
    public async Task<object> EnableSource([FromBody] EnableSourceInput data)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(data.Kind == "api" ? perms.CanManageIntegrations : perms.CanManageKnowledge,
                "You are not authorised to change this source.");
            await sources.SetEnabledAsync(db, data.Kind, data.Id, data.Enabled);
            await KnowledgePermissions.AuditAsync(db, userId, $"source.{(data.Enabled ? "enable" : "disable")}", data.Kind, data.Id,
                $"{(data.Enabled ? "Enabled" : "Disabled")} {data.Kind} source");
            return new { ok = true };
        }
    }

    public sealed record DeleteSourceInput(string Kind, Guid Id, string? Reason);

    [HttpPost("sources/delete")]
    public async Task<object> DeleteSource([FromBody] DeleteSourceInput data, CancellationToken ct)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(data.Kind == "api" ? perms.CanManageIntegrations : perms.CanManageKnowledge,
                "You are not authorised to delete this source.");
            var result = await sources.DeleteAsync(db, data.Kind, data.Id, Current(), ct);
            await KnowledgePermissions.AuditAsync(db, userId, "source.delete", data.Kind, data.Id, $"Deleted {data.Kind} source",
                new { reason = data.Reason, removedChunks = ((dynamic)result).removedChunks });
            return result;
        }
    }

    public sealed record TestSourceInput(string Kind, Guid Id, string Question, string? Lang);

    [HttpPost("sources/test")]
    public async Task<object> TestSource([FromBody] TestSourceInput data, CancellationToken ct)
    {
        var (_, perms, db) = await Ctx();
        await using (db)
        {
            var lang = data.Lang is "ar" ? "ar" : "en";
            var passages = await retrieval.RetrieveAsync(db, data.Question, perms, lang, 8, useCache: false, ct: ct);
            var ranked = passages.Select((p, i) => new
            {
                rank = i + 1,
                fromThisSource = string.Equals(p.SourceId, data.Id.ToString(), StringComparison.OrdinalIgnoreCase),
                title = p.Title,
                sectionTitle = p.SectionTitle,
                pageNumber = p.PageNumber,
                score = Math.Round(p.Score, 3),
                snippet = p.Snippet.Length > 300 ? p.Snippet[..300] : p.Snippet
            }).ToList();
            var best = ranked.FirstOrDefault(r => r.fromThisSource);
            var top = passages.FirstOrDefault();
            return new
            {
                passages = ranked,
                retrievedFromSource = best is not null,
                bestRank = best?.rank,
                answer = top is null
                    ? "No approved source currently answers this question."
                    : $"{(top.Snippet.Length > 600 ? top.Snippet[..600] : top.Snippet)}\n\n_Source: {top.Title}{(top.Version is null ? "" : $" v{top.Version}")}{(top.SectionTitle is null ? "" : $" § {top.SectionTitle}")}_"
            };
        }
    }

    public sealed record RebuildInput(int? Limit);

    [HttpPost("index/rebuild")]
    public async Task<object> RebuildIndex([FromBody] RebuildInput? data, CancellationToken ct)
    {
        var (userId, perms, db) = await Ctx();
        await using (db)
        {
            KnowledgePermissions.Assert(perms.CanManageKnowledge, "Only knowledge managers may rebuild the semantic index.");
            var limit = data?.Limit ?? 300;
            var result = await embeddings.BackfillAsync(db, limit, ct);
            KnowledgeRetrievalService.InvalidateCache("semantic_index_rebuild");
            await KnowledgePermissions.AuditAsync(db, userId, "knowledge.rebuild_semantic_index", "knowledge_document", null,
                $"Embedded {result.Documents + result.Web} chunk(s)", result);
            return result;
        }
    }
}
