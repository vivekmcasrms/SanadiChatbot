using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

/// <summary>
/// Replaces UAEU-SANAD-MAIN-2/src/lib/{chat-history,chat-continuity,chat-actions}.functions.ts.
/// A student's own chat list, message history, continuity recap and completed
/// one-time actions. Every query is scoped to the caller's own user id (the
/// C# equivalent of the Postgres RLS these serverFn's relied on).
/// </summary>
[ApiController]
[Route("api/chats")]
public sealed class ChatController(ISqlConnectionFactory sql) : ControllerBase
{
    private static readonly JsonSerializerOptions CamelJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private Guid RequireUserId()
    {
        var user = HttpContext.GetSanadiUser();
        if (!user.IsAuthenticated || user.UserId is not Guid userId) throw new UnauthorizedException();
        return userId;
    }

    // ---------------- Chat list ----------------

    [HttpGet]
    public async Task<IActionResult> ListMine(CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        await using var conn = sql.Create();
        var rows = await conn.QueryAsync<(Guid Id, string? Title, DateTimeOffset UpdatedAt)>(
            DbProc.Call("usp_Chat_ListMine", new { userId }, cancellationToken));
        return new JsonResult(rows.Select(r => new { id = r.Id, title = r.Title, updatedAt = r.UpdatedAt }), CamelJson);
    }

    [HttpGet("paged")]
    public async Task<IActionResult> ListMinePaged(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20, [FromQuery] string? search = null,
        [FromQuery] string filter = "all", CancellationToken cancellationToken = default)
    {
        var userId = RequireUserId();
        page = Math.Clamp(page, 1, 10_000);
        pageSize = Math.Clamp(pageSize, 5, 100);
        var term = string.IsNullOrWhiteSpace(search) ? null : search.Trim();

        await using var conn = sql.Create();
        var args = new { userId, filter, termLike = term is null ? null : $"%{term}%", offset = (page - 1) * pageSize, take = pageSize };
        var total = await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_Chat_CountPaged", new { args.userId, args.filter, args.termLike }, cancellationToken));
        var rows = await conn.QueryAsync<(Guid Id, string? Title, DateTimeOffset UpdatedAt, Guid? RelatedCaseId)>(
            DbProc.Call("usp_Chat_ListPaged", args, cancellationToken));

        return new JsonResult(new
        {
            items = rows.Select(r => new { id = r.Id, title = r.Title, updatedAt = r.UpdatedAt, caseId = r.RelatedCaseId }),
            total,
            page,
            pageSize,
        }, CamelJson);
    }

    [HttpDelete("{conversationId:guid}")]
    public async Task<IActionResult> DeleteMine(Guid conversationId, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        await using var conn = sql.Create();
        await conn.ExecuteAsync(DbProc.Call("usp_Chat_DeleteOne", new { conversationId, userId }, cancellationToken));
        return new JsonResult(new { deleted = true });
    }

    [HttpDelete]
    public async Task<IActionResult> DeleteAllMine(CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        await using var conn = sql.Create();
        var ids = (await conn.QueryAsync<Guid>(DbProc.Call("usp_Chat_DeleteAll", new { userId }, cancellationToken))).ToList();
        var metadata = JsonSerializer.Serialize(new { deleted_count = ids.Count, result = "success" });
        await conn.ExecuteAsync(DbProc.Call("usp_Chat_InsertDeleteAllAudit", new { userId, metadata }, cancellationToken));

        return new JsonResult(new { deleted = ids.Count });
    }

    // ---------------- Messages ----------------

    private sealed class MessageRow
    {
        public Guid Id { get; init; }
        public string Role { get; init; } = "";
        public string Content { get; init; } = "";
        public DateTimeOffset CreatedAt { get; init; }
        public string Metadata { get; init; } = "{}";
    }

    private sealed class IssuedDocRow
    {
        public Guid Id { get; init; }
        public Guid? MessageId { get; init; }
        public string ReferenceNumber { get; init; } = "";
        public string? TitleEn { get; init; }
        public string? TitleAr { get; init; }
        public string? Language { get; init; }
        public DateTimeOffset IssuedAt { get; init; }
        public string? SecureVerificationToken { get; init; }
        public string? DocumentHash { get; init; }
        public string? DocumentStatus { get; init; }
        public string? VerificationStatus { get; init; }
    }

    private sealed class LinkedCaseInfo
    {
        public Guid CaseId { get; init; }
        public string LiveStatus { get; init; } = "";
        public string? AssignedStaffName { get; init; }
        public string? AssignedStaffEmail { get; init; }
        public string? Outcome { get; init; }
        public string? Unit { get; init; }
    }

    private static readonly string[] CompletedStatuses = ["resolved", "closed"];

    [HttpGet("{conversationId:guid}/messages")]
    public async Task<IActionResult> Messages(Guid conversationId, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        await using var conn = sql.Create();

        var owns = await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_Chat_OwnsConversation", new { conversationId, userId }, cancellationToken));
        if (owns == 0) throw new NotFoundException("Chat not found");

        var rows = await conn.QueryAsync<MessageRow>(DbProc.Call("usp_Chat_ListMessages", new { conversationId }, cancellationToken));

        var docs = await conn.QueryAsync<IssuedDocRow>(DbProc.Call("usp_Chat_ListIssuedDocs", new { userId, conversationId }, cancellationToken));
        var byId = docs.ToDictionary(d => d.Id, d => d);

        // Live case state for anything this chat created, keyed by case_number
        // (the reference number stored in receipt/caseResult metadata), so a
        // reopened chat never shows a stale status, outcome or assignee.
        var linkedCases = await conn.QueryAsync<(Guid Id, string CaseNumber, string Status, Guid? AssignedTo, string? OutcomeEn, string? UnitNameEn)>(
            DbProc.Call("usp_Chat_ListLinkedCases", new { userId, conversationId }, cancellationToken));

        var staffIds = linkedCases.Select(c => c.AssignedTo).Where(id => id is not null).Select(id => id!.Value).Distinct().ToList();
        var staffNames = new Dictionary<Guid, string?>();
        var staffEmails = new Dictionary<Guid, string?>();
        if (staffIds.Count > 0)
        {
            var staff = await conn.QueryAsync<(Guid Id, string? FullName, string? Email)>(
                DbProc.Call("usp_Chat_ListProfilesByIds", new { staffIds = DbProc.Csv(staffIds) }, cancellationToken));
            foreach (var s in staff) { staffNames[s.Id] = s.FullName; staffEmails[s.Id] = s.Email; }
        }

        var caseByNumber = linkedCases.ToDictionary(c => c.CaseNumber, c => new LinkedCaseInfo
        {
            CaseId = c.Id,
            LiveStatus = c.Status,
            AssignedStaffName = c.AssignedTo is Guid a ? staffNames.GetValueOrDefault(a) : null,
            AssignedStaffEmail = c.AssignedTo is Guid a2 ? staffEmails.GetValueOrDefault(a2) : null,
            Outcome = c.OutcomeEn,
            Unit = c.UnitNameEn,
        });

        var items = rows
            .Where(m => m.Role is "user" or "assistant")
            .Select(m =>
            {
                var meta = JsonNode.Parse(string.IsNullOrWhiteSpace(m.Metadata) ? "{}" : m.Metadata)!.AsObject();

                object? issuedDocument = null;
                if (meta["issuedDocument"] is JsonObject storedDoc &&
                    storedDoc["documentId"]?.GetValue<string>() is { } docIdStr &&
                    Guid.TryParse(docIdStr, out var docId) && byId.TryGetValue(docId, out var d))
                {
                    issuedDocument = new
                    {
                        documentId = d.Id,
                        referenceNumber = d.ReferenceNumber,
                        titleEn = d.TitleEn ?? "Official letter",
                        titleAr = d.TitleAr ?? "وثيقة رسمية",
                        language = d.Language ?? "en",
                        issuedAt = d.IssuedAt,
                        verifyToken = d.SecureVerificationToken,
                        fileName = $"{d.ReferenceNumber}.pdf",
                        documentHash = d.DocumentHash,
                        status = d.VerificationStatus ?? d.DocumentStatus ?? "valid",
                    };
                }

                var receipt = EnrichReceipt(meta["receipt"] as JsonObject, caseByNumber);
                var caseResult = RefreshCaseResult(meta["caseResult"] as JsonObject, caseByNumber);

                return new
                {
                    role = m.Role,
                    content = m.Content,
                    messageId = m.Id,
                    metadata = m.Role == "assistant"
                        ? new
                        {
                            verified = meta["verified"]?.GetValue<bool>() ?? false,
                            responseType = meta["responseType"]?.GetValue<string>() ?? "answer",
                            citations = meta["citations"] ?? new JsonArray(),
                            proposedActions = meta["proposedActions"] ?? new JsonArray(),
                            nextSteps = meta["nextSteps"] ?? new JsonArray(),
                            toolsUsed = meta["toolsUsed"] ?? new JsonArray(),
                            activity = meta["activity"] ?? new JsonArray(),
                            receipt,
                            issuedDocument,
                            careerInsight = meta["careerInsight"],
                            libraryResults = meta["libraryResults"],
                            caseResult,
                        }
                        : null,
                };
            });

        return new JsonResult(items, CamelJson);
    }

    /// <summary>Ports enrichReceipt() from chat-history.functions.ts.</summary>
    private static JsonObject? EnrichReceipt(JsonObject? receipt, Dictionary<string, LinkedCaseInfo> cases)
    {
        if (receipt is null) return null;
        var refNumber = receipt["referenceNumber"]?.GetValue<string>();
        if (refNumber is null || !cases.TryGetValue(refNumber, out var live)) return receipt;
        receipt["caseId"] = live.CaseId.ToString();
        receipt["liveStatus"] = live.LiveStatus;
        receipt["assignedStaffName"] = live.AssignedStaffName;
        receipt["outcome"] = live.Outcome;
        receipt["responsibleUnit"] ??= live.Unit;
        receipt["trackingUrl"] ??= $"/requests/{live.CaseId}";
        return receipt;
    }

    /// <summary>Ports refreshCaseResult() from chat-history.functions.ts.</summary>
    private static JsonObject? RefreshCaseResult(JsonObject? card, Dictionary<string, LinkedCaseInfo> cases)
    {
        if (card is null) return null;
        var reference = card["reference"]?.GetValue<string>();
        if (reference is null || !cases.TryGetValue(reference, out var live)) return card;
        card["caseId"] = live.CaseId.ToString();
        card["statusLabel"] = StatusLabels.En(live.LiveStatus);
        card["outcome"] = live.Outcome ?? card["outcome"]?.GetValue<string?>();
        card["staffName"] = live.AssignedStaffName ?? card["staffName"]?.GetValue<string?>();
        card["staffEmail"] = live.AssignedStaffEmail ?? card["staffEmail"]?.GetValue<string?>();
        card["unitName"] ??= live.Unit;
        card["canObject"] = CompletedStatuses.Contains(live.LiveStatus);
        card["trackingUrl"] = $"/requests/{live.CaseId}";
        return card;
    }

    // ---------------- Continuity ----------------

    [HttpGet("continuity")]
    public async Task<IActionResult> Continuity([FromQuery] Guid? conversationId, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        await using var conn = sql.Create();

        var convId = conversationId;
        if (convId is null)
        {
            convId = await conn.ExecuteScalarAsync<Guid?>(DbProc.Call("usp_Chat_LatestOpenConversation", new { userId }, cancellationToken));
        }
        if (convId is null) return new JsonResult(EmptyContinuity(), CamelJson);

        var conv = await conn.QuerySingleOrDefaultAsync<(Guid Id, string? Title, DateTimeOffset UpdatedAt, Guid? RelatedCaseId)>(
            DbProc.Call("usp_Chat_GetConversation", new { convId, userId }, cancellationToken));
        if (conv.Id == Guid.Empty) return new JsonResult(EmptyContinuity(), CamelJson);

        var state = await conn.QuerySingleOrDefaultAsync<(string? Summary, string PendingQuestions, string? PendingConfirmationType, Guid? CurrentServiceId, Guid? CurrentServiceUnitId, Guid? RelatedCaseId)>(
            DbProc.Call("usp_Chat_GetConversationState", new { convId, userId }, cancellationToken));

        var documentCount = await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_Chat_CountIssuedDocs", new { userId, convId }, cancellationToken));

        string? firstQuestion = null;
        if (!string.IsNullOrWhiteSpace(state.PendingQuestions))
        {
            using var doc = JsonDocument.Parse(state.PendingQuestions);
            if (doc.RootElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var q in doc.RootElement.EnumerateArray())
                {
                    if (q.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(q.GetString()))
                    {
                        firstQuestion = q.GetString();
                        break;
                    }
                }
            }
        }

        string? topicEn = null, topicAr = null;
        var unitId = state.CurrentServiceUnitId;
        if (unitId is not null)
        {
            var unit = await conn.QuerySingleOrDefaultAsync<(string? NameEn, string? NameAr)>(
                DbProc.Call("usp_Chat_GetUnitNames", new { unitId }, cancellationToken));
            topicEn = unit.NameEn;
            topicAr = unit.NameAr;
        }
        if (topicEn is null && state.CurrentServiceId is not null)
        {
            var service = await conn.QuerySingleOrDefaultAsync<(string? NameEn, string? NameAr)>(
                DbProc.Call("usp_Chat_GetServiceNames", new { serviceId = state.CurrentServiceId }, cancellationToken));
            topicEn = service.NameEn;
            topicAr = service.NameAr;
        }

        object? linkedCase = null;
        var caseId = conv.RelatedCaseId ?? state.RelatedCaseId;
        if (caseId is not null)
        {
            var row = await conn.QuerySingleOrDefaultAsync<(Guid Id, string CaseNumber, string Status, Guid? AssignedTo, string? UnitNameEn, string? UnitNameAr)>(
                DbProc.Call("usp_Chat_GetLinkedCase", new { caseId, userId }, cancellationToken));
            if (row.Id != Guid.Empty)
            {
                string? staffName = null;
                if (row.AssignedTo is not null)
                {
                    staffName = await conn.ExecuteScalarAsync<string?>(
                        DbProc.Call("usp_Chat_GetStaffName", new { staffId = row.AssignedTo }, cancellationToken));
                }
                linkedCase = new
                {
                    caseId = row.Id,
                    caseNumber = row.CaseNumber,
                    statusEn = StatusLabels.En(row.Status),
                    statusAr = StatusLabels.Ar(row.Status),
                    staffName,
                    unitEn = row.UnitNameEn,
                    unitAr = row.UnitNameAr,
                };
            }
        }

        return new JsonResult(new
        {
            conversationId = conv.Id,
            title = conv.Title,
            updatedAt = conv.UpdatedAt,
            summary = state.Summary,
            topicEn,
            topicAr,
            openQuestion = firstQuestion,
            awaitingApproval = !string.IsNullOrWhiteSpace(state.PendingConfirmationType),
            linkedCase,
            documentCount,
        }, CamelJson);
    }

    private static object EmptyContinuity() => new
    {
        conversationId = (Guid?)null,
        title = (string?)null,
        updatedAt = (DateTimeOffset?)null,
        summary = (string?)null,
        topicEn = (string?)null,
        topicAr = (string?)null,
        openQuestion = (string?)null,
        awaitingApproval = false,
        linkedCase = (object?)null,
        documentCount = 0,
    };

    // ---------------- Completed actions ----------------

    [HttpGet("{conversationId:guid}/completed-actions")]
    public async Task<IActionResult> CompletedActions(Guid conversationId, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        await using var conn = sql.Create();
        var rows = await conn.QueryAsync(DbProc.Call("usp_Chat_ListCompletedActions", new { userId, conversationId }, cancellationToken));
        return new JsonResult(rows, CamelJson);
    }
}

/// <summary>Minimal EN/AR labels mirroring src/lib/cases/status-labels.ts.</summary>
internal static class StatusLabels
{
    private static readonly Dictionary<string, (string En, string Ar)> Map = new(StringComparer.OrdinalIgnoreCase)
    {
        ["draft"] = ("Draft", "مسودة"),
        ["submitted"] = ("Received", "تم الاستلام"),
        ["acknowledged"] = ("Acknowledged", "تم الإقرار"),
        ["classified"] = ("Being routed", "قيد التوجيه"),
        ["routed"] = ("With the responsible unit", "لدى الجهة المسؤولة"),
        ["assigned"] = ("Assigned to a staff member", "مُسند إلى موظف"),
        ["in_progress"] = ("In progress", "قيد المعالجة"),
        ["in_review"] = ("Under review", "قيد المراجعة"),
        ["ai_processing"] = ("In progress", "قيد المعالجة"),
        ["resolution_proposed"] = ("Resolution proposed", "تم اقتراح حل"),
        ["escalated"] = ("Escalated", "تم التصعيد"),
        ["on_hold"] = ("On hold", "معلّق"),
        ["waiting_external"] = ("Waiting on another party", "بانتظار جهة أخرى"),
        ["awaiting_student"] = ("Waiting for your reply", "بانتظار ردك"),
        ["student_confirmation"] = ("Waiting for your confirmation", "بانتظار تأكيدك"),
        ["reopened"] = ("Reopened", "أُعيد فتحه"),
        ["transferred"] = ("Transferred", "تم تحويله"),
        ["resolved"] = ("Resolved", "تم الحل"),
        ["closed"] = ("Closed", "مغلق"),
    };

    public static string En(string status) => Map.TryGetValue(status, out var v) ? v.En : status.Replace('_', ' ');
    public static string Ar(string status) => Map.TryGetValue(status, out var v) ? v.Ar : status.Replace('_', ' ');
}
