using System.Data.Common;
using Dapper;
using Sanadi.Application.Storage;
using Sanadi.Domain.Exceptions;
using Sanadi.Domain.Security;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Knowledge;

public sealed class KnowledgeSourcesService(IObjectStorage storage)
{
    private static readonly Dictionary<string, string> Format = new(StringComparer.OrdinalIgnoreCase)
    {
        ["application/pdf"] = "PDF",
        ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"] = "DOCX",
        ["application/vnd.openxmlformats-officedocument.presentationml.presentation"] = "PPTX",
        ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] = "XLSX",
        ["text/csv"] = "CSV",
        ["text/markdown"] = "MD",
        ["text/plain"] = "TXT",
    };

    public async Task<object> ListAsync(DbConnection db, string? search, string? kind, string? status, string? language, string? domain, int page, int pageSize)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 5, 50);
        var wantKind = string.IsNullOrWhiteSpace(kind) || kind == "all" ? null : kind;

        var docs = wantKind is not null and not "document"
            ? []
            : (await db.QueryAsync(DbProc.Call("usp_Knowledge_Sources_ListDocuments", null))).ToList();
        var webs = wantKind is not null and not "web"
            ? []
            : (await db.QueryAsync(DbProc.Call("usp_Knowledge_Sources_ListWeb", null))).ToList();
        var apis = wantKind is not null and not "api"
            ? []
            : (await db.QueryAsync(DbProc.Call("usp_Knowledge_Sources_ListApis", null))).ToList();
        var units = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Sources_ListUnits", null))).ToList();
        var unitCode = units.ToDictionary(u => (Guid)u.id, u => (string?)u.code ?? (string?)u.name_en ?? "");

        var rows = new List<SourceRow>();
        foreach (var d in docs)
        {
            var st = DocumentStatus(d);
            var blockers = KnowledgeDocumentOpsService.RetrievalBlockers(d);
            rows.Add(new SourceRow(
                $"document:{d.id}", "document", (Guid)d.id, (string)d.title,
                Format.GetValueOrDefault((string?)d.mime_type ?? "", ((string?)d.document_type ?? "DOC").Replace('_', ' ').ToUpperInvariant()),
                (string?)d.knowledge_domain ?? (d.owner_unit_id is Guid ou ? unitCode.GetValueOrDefault(ou) : null),
                ((string?)d.language ?? "en").ToUpperInvariant(), st, (string?)d.version,
                d.created_by is Guid cb ? cb.ToString() : null, Iso(d.created_at), Iso(d.updated_at), Iso(d.updated_at),
                null, "chunks", blockers.Count == 0, blockers.Count == 0 ? "Searchable by the assistant" : blockers[0],
                d.is_active is bool a && a && d.deleted_at is null));
        }
        foreach (var s in webs)
        {
            var st = WebStatus(s);
            rows.Add(new SourceRow(
                $"web:{s.id}", "web", (Guid)s.id, (string)s.title, "URL",
                s.owner_unit_id is Guid ou ? unitCode.GetValueOrDefault(ou) ?? (string?)s.source_category : (string?)s.source_category,
                ((string?)s.language ?? "en").ToUpperInvariant(), st, null,
                s.created_by is Guid cb ? cb.ToString() : null, Iso(s.created_at), Iso(s.updated_at), Iso(s.last_successful_fetch_at),
                null, "pages", st == "active", st == "active" ? "Searchable by the assistant" : $"Web source is {st.Replace('_', ' ')}",
                s.is_active is bool a && a));
        }
        foreach (var c in apis)
        {
            var st = ApiStatus(c);
            rows.Add(new SourceRow(
                $"api:{c.id}", "api", (Guid)c.id, (string?)c.display_name_en ?? (string)c.connector_name,
                ((string?)c.connector_type ?? "API").ToUpperInvariant(), (string?)c.source_system, "—", st, null,
                null, Iso(c.created_at), Iso(c.updated_at), Iso(c.last_health_check_at),
                null, "tools", st == "active", st == "active" ? "Available to the assistant at request time" : $"Connection is {st.Replace('_', ' ')}",
                c.is_active is bool a && a));
        }

        var searchQ = (search ?? "").Trim().ToLowerInvariant();
        var filtered = rows.Where(r =>
        {
            if (!string.IsNullOrEmpty(searchQ) && !$"{r.Name} {r.Domain ?? ""} {r.Format}".ToLowerInvariant().Contains(searchQ)) return false;
            if (!string.IsNullOrEmpty(status) && status != "all" && r.Status != status) return false;
            if (!string.IsNullOrEmpty(language) && language != "all" && !string.Equals(r.Language, language, StringComparison.OrdinalIgnoreCase)) return false;
            if (!string.IsNullOrEmpty(domain) && domain != "all" && (r.Domain ?? "") != domain) return false;
            return true;
        }).OrderByDescending(r => r.UpdatedAt ?? "").ToList();

        var summary = new
        {
            total = rows.Count,
            documents = rows.Count(r => r.Kind == "document"),
            web = rows.Count(r => r.Kind == "web"),
            apis = rows.Count(r => r.Kind == "api"),
            active = rows.Count(r => r.Status == "active"),
            needsReview = rows.Count(r => r.Status == "needs_review"),
            failed = rows.Count(r => r.Status == "failed"),
            disabled = rows.Count(r => r.Status == "disabled")
        };
        var total = filtered.Count;
        var pageRows = filtered.Skip((page - 1) * pageSize).Take(pageSize).ToList();
        var actorIds = pageRows.Where(r => Guid.TryParse(r.AddedBy, out _)).Select(r => Guid.Parse(r.AddedBy!)).Distinct().ToArray();
        var names = new Dictionary<Guid, string>();
        if (actorIds.Length > 0)
        {
            var profiles = await db.QueryAsync(DbProc.Call("usp_Knowledge_Sources_ListProfiles",
                new { actorIds = string.Join(",", actorIds.Select(a => a.ToString("D"))) }));
            foreach (var p in profiles) names[(Guid)p.id] = (string?)p.full_name ?? (string?)p.email ?? "—";
        }

        var resultRows = new List<object>();
        foreach (var r in pageRows)
        {
            int? unitsCount = r.Units;
            if (r.Kind == "document")
                unitsCount = await db.ExecuteScalarAsync<int>(DbProc.Call("usp_Knowledge_Sources_CountActiveChunks", new { id = r.Id }));
            else if (r.Kind == "api")
                unitsCount = await db.ExecuteScalarAsync<int>(DbProc.Call("usp_Knowledge_Sources_CountEnabledTools", new { id = r.Id }));
            else
                unitsCount = string.IsNullOrEmpty(r.LastIndexedAt) ? 0 : 1;

            var addedBy = Guid.TryParse(r.AddedBy, out var ab) ? names.GetValueOrDefault(ab, "—") : r.AddedBy;
            resultRows.Add(new
            {
                key = r.Key, kind = r.Kind, id = r.Id, name = r.Name, format = r.Format, domain = r.Domain,
                language = r.Language, status = r.Status, version = r.Version, addedBy, addedAt = r.AddedAt,
                updatedAt = r.UpdatedAt, lastIndexedAt = r.LastIndexedAt, units = unitsCount, unitLabel = r.UnitLabel,
                retrievable = r.Retrievable, retrievalNote = r.RetrievalNote, enabled = r.Enabled
            });
        }

        return new
        {
            rows = resultRows, total, page, pageSize, summary,
            domains = rows.Select(r => r.Domain).Where(d => !string.IsNullOrEmpty(d)).Distinct().Cast<string>().ToList()
        };
    }

    public async Task<object> GetAsync(DbConnection db, string kind, Guid id)
    {
        if (kind == "document") return new { document = await GetDocumentDetail(db, id), web = (object?)null, api = (object?)null };
        if (kind == "web") return new { document = (object?)null, web = await GetWebDetail(db, id), api = (object?)null };
        return new { document = (object?)null, web = (object?)null, api = await GetApiDetail(db, id) };
    }

    public async Task SetEnabledAsync(DbConnection db, string kind, Guid id, bool enabled)
    {
        if (kind == "document")
        {
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Sources_EnableDocument", new { id, enabled }));
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Sources_SetChunksActive", new { id, enabled }));
        }
        else if (kind == "web")
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Sources_EnableWeb", new { id, enabled }));
        else
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Sources_EnableApi", new { id, enabled }));
        KnowledgeRetrievalService.InvalidateCache($"source_{(enabled ? "enable" : "disable")}");
    }

    public async Task<object> DeleteAsync(DbConnection db, string kind, Guid id, ICurrentUser? user = null, CancellationToken ct = default)
    {
        var removedChunks = 0;
        if (kind == "document")
        {
            removedChunks = await db.ExecuteScalarAsync<int>(DbProc.Call("usp_Knowledge_Sources_CountChunks", new { id }, ct));
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Sources_DeleteChunks", new { id }, ct));
            var path = await db.ExecuteScalarAsync<string?>(DbProc.Call("usp_Knowledge_Sources_GetStoragePath", new { id }, ct));
            if (!string.IsNullOrWhiteSpace(path) && user is not null)
            {
                try { await storage.DeleteAsync("knowledge-files", [path!], user, ct); }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
                catch { /* ignore */ }
            }
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Sources_SoftDeleteDocument", new { id }, ct));
        }
        else if (kind == "web")
        {
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Sources_DeleteWebChanges", new { id }, ct));
            try { await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Sources_DeleteWeb", new { id }, ct)); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch
            {
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Sources_SoftDeleteWeb", new { id }, ct));
            }
        }
        else
        {
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Sources_DisableApiTools", new { id }, ct));
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_Sources_DisableApi", new { id }, ct));
        }
        KnowledgeRetrievalService.InvalidateCache("source_delete");
        return new { removedChunks };
    }

    private async Task<object> GetDocumentDetail(DbConnection db, Guid id)
    {
        var doc = await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Knowledge_Sources_GetDocument", new { id }))
            ?? throw new NotFoundException("Source not found.");
        var chunks = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Sources_ListDocChunks", new { id }))).ToList();
        var count = await db.ExecuteScalarAsync<int>(DbProc.Call("usp_Knowledge_Sources_CountChunks", new { id }));
        var logs = await db.QueryAsync(DbProc.Call("usp_Knowledge_Sources_ListRetrievalLogs", new { id }));
        var trail = await db.QueryAsync(DbProc.Call("usp_Knowledge_Sources_ListAudit", new { id }));
        var versions = await db.QueryAsync(DbProc.Call("usp_Knowledge_Sources_ListDocVersions", new { id }));
        var headings = chunks.Select(c => (string?)c.section_title).Where(s => !string.IsNullOrEmpty(s)).Distinct().ToList();
        return new
        {
            kind = "document", id, title = (string)doc.title, documentType = (string?)doc.document_type,
            fileName = (string?)doc.file_name, storagePath = (string?)doc.storage_path, mimeType = (string?)doc.mime_type,
            language = (string?)doc.language, detectedLanguage = (string?)doc.detected_language,
            knowledgeDomain = (string?)doc.knowledge_domain, ownerUnitId = (Guid?)doc.owner_unit_id,
            version = (string?)doc.version, effectiveDate = Iso(doc.effective_date), expiryDate = Iso(doc.expiry_date),
            reviewDate = Iso(doc.review_date), approvalStatus = (string?)doc.approval_status,
            processingStatus = (string?)doc.processing_status, extractionStatus = (string?)doc.extraction_status,
            extractionError = (string?)doc.extraction_error, indexingStatus = (string?)doc.indexing_status,
            qualityStatus = (string?)doc.quality_status, qualityIssues = ParseJson(doc.quality_issues),
            confidentiality = (string?)doc.confidentiality_level, status = DocumentStatus(doc),
            blockers = KnowledgeDocumentOpsService.RetrievalBlockers(doc), chunkCount = count,
            pages = chunks.Select(c => (int?)c.page_number ?? 0).DefaultIfEmpty(0).Max() is var p && p > 0 ? p : (int?)null,
            headings,
            chunks = chunks.Select(c => new
            {
                index = (int)c.chunk_index, sectionTitle = (string?)c.section_title, pageNumber = (int?)c.page_number,
                tokens = (int?)c.token_count, active = (bool?)c.is_active,
                preview = ((string)c.content).Length > 600 ? ((string)c.content)[..600] : (string)c.content
            }),
            extractedText = string.Join("\n\n", chunks.Select(c => (string)c.content)).Length is var len
                ? string.Join("\n\n", chunks.Select(c => (string)c.content))[..Math.Min(40000, len)]
                : "",
            retrieval = logs, audit = trail, versions, updatedAt = Iso(doc.updated_at), createdAt = Iso(doc.created_at)
        };
    }

    private async Task<object> GetWebDetail(DbConnection db, Guid id)
    {
        var s = await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Knowledge_Sources_GetWeb", new { id }))
            ?? throw new NotFoundException("Source not found.");
        var changes = await db.QueryAsync(DbProc.Call("usp_Knowledge_Sources_ListWebChanges", new { id }));
        var trail = await db.QueryAsync(DbProc.Call("usp_Knowledge_Sources_ListAudit", new { id }));
        var text = (string?)s.extracted_text ?? "";
        string? domain = null;
        try { domain = new Uri((string)s.url).Host; } catch { /* ignore */ }
        return new
        {
            kind = "web", id, title = (string)s.title, url = (string)s.url, domain,
            language = (string?)s.language, category = (string?)s.source_category,
            refreshFrequency = (string?)s.refresh_frequency, trustedAutoRefresh = s.trusted_auto_refresh is bool t && t,
            contentHash = (string?)s.content_hash, lastCheckedAt = Iso(s.last_checked_at), lastChangedAt = Iso(s.last_changed_at),
            lastFetchAt = Iso(s.last_successful_fetch_at), healthStatus = (string?)s.health_status,
            approvalStatus = (string?)s.approval_status, changeDetected = s.change_detected is bool cd && cd,
            isActive = s.is_active is bool a && a, status = WebStatus(s),
            extractedText = text.Length > 20000 ? text[..20000] : text, textLength = text.Length,
            changes, audit = trail
        };
    }

    private async Task<object> GetApiDetail(DbConnection db, Guid id)
    {
        var c = await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Knowledge_Sources_GetApi", new { id }))
            ?? throw new NotFoundException("Source not found.");
        var tools = await db.QueryAsync(DbProc.Call("usp_Knowledge_Sources_ListApiTools", new { id }));
        var tests = (await db.QueryAsync(DbProc.Call("usp_Knowledge_Sources_ListApiTests", new { id }))).ToList();
        var health = await db.QueryAsync(DbProc.Call("usp_Knowledge_Sources_ListApiHealth", new { id }));
        var trail = await db.QueryAsync(DbProc.Call("usp_Knowledge_Sources_ListAudit", new { id }));
        var lastSuccess = tests.FirstOrDefault(t => (string?)t.status == "passed");
        var lastError = tests.FirstOrDefault(t => t.error_message is not null);
        return new
        {
            kind = "api", id, name = (string?)c.display_name_en ?? (string)c.connector_name,
            connectorName = (string)c.connector_name, sourceSystem = (string?)c.source_system,
            connectorType = (string?)c.connector_type,
            usage = (string?)c.connector_type == "knowledge_api" || (string?)c.data_classification == "reference" ? "knowledge" : "live_operational",
            environment = (string?)c.environment, baseUrl = (string?)c.base_url,
            authenticationType = (string?)c.authentication_type,
            credentialMask = c.credential_configured is bool cc && cc ? "••••••••" : null,
            credentialLastTestedAt = Iso(c.credential_last_tested_at), dataClassification = (string?)c.data_classification,
            readEnabled = c.read_enabled is bool re && re, writeEnabled = c.write_enabled is bool we && we,
            isActive = c.is_active is bool a && a, healthStatus = (string?)c.health_status,
            lastHealthCheckAt = Iso(c.last_health_check_at),
            lastSuccessAt = lastSuccess is null ? null : Iso(lastSuccess.started_at),
            lastError = lastError is null ? null : new { message = (string)lastError.error_message, at = Iso(lastError.started_at) },
            status = ApiStatus(c), tools, tests, health, audit = trail
        };
    }

    private static string DocumentStatus(dynamic doc)
    {
        if (doc.deleted_at is not null) return "deleted";
        if (doc.superseded_by_document_id is not null) return "replaced";
        if ((string?)doc.extraction_status == "failed" || (string?)doc.indexing_status == "failed" || (string?)doc.quality_status == "failed") return "failed";
        if ((string?)doc.processing_status is "processing" or "reprocessing") return "processing";
        if ((string?)doc.approval_status == "retired") return "disabled";
        if ((string?)doc.approval_status is "approved" or "published")
        {
            if (doc.is_active is not true || doc.is_current is not true) return "disabled";
            return KnowledgeDocumentOpsService.RetrievalBlockers(doc).Count == 0 ? "active" : "needs_review";
        }
        return (string?)doc.indexing_status == "completed" ? "needs_review" : "indexed";
    }

    private static string WebStatus(dynamic s)
    {
        if ((string?)s.health_status is "failed" or "removed") return "failed";
        if (s.is_active is not true) return "disabled";
        if (s.change_detected is true) return "needs_review";
        return (string?)s.approval_status == "approved" ? "active" : "needs_review";
    }

    private static string ApiStatus(dynamic c)
    {
        if (c.is_active is not true) return "disabled";
        if ((string?)c.health_status is "offline" or "authentication_failed" or "failed") return "failed";
        if ((string?)c.health_status is "degraded" or "schema_changed") return "needs_review";
        return "active";
    }

    private static string? Iso(object? value) => value switch
    {
        null => null,
        DateTime dt => dt.ToString("O"),
        DateTimeOffset dto => dto.ToString("O"),
        _ => value.ToString()
    };

    private static object ParseJson(object? value)
    {
        if (value is null) return Array.Empty<object>();
        if (value is string s)
        {
            try { return System.Text.Json.JsonSerializer.Deserialize<object>(s) ?? Array.Empty<object>(); }
            catch { return Array.Empty<object>(); }
        }
        return value;
    }

    private sealed record SourceRow(
        string Key, string Kind, Guid Id, string Name, string Format, string? Domain, string Language, string Status,
        string? Version, string? AddedBy, string? AddedAt, string? UpdatedAt, string? LastIndexedAt,
        int? Units, string UnitLabel, bool Retrievable, string RetrievalNote, bool Enabled);
}
