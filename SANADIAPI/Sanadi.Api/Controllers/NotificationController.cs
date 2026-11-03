using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Sanadi.Api.Security;
using Sanadi.Application.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Domain.Security;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

/// <summary>
/// Replaces UAEU-SANAD-MAIN-2/src/lib/notifications/{notifications,student}.functions.ts.
/// Student notification centre + the notification ops console (overview, deliveries,
/// settings, dispatch pause, emergency broadcasts). Actual outbound email transmission
/// (dispatch.server.ts / queueEmail) is not implemented here: no SMTP/email-provider
/// integration exists in Sanadi.Infrastructure yet, so broadcast approval queues
/// notification_deliveries rows (status = 'queued') but does not send email. Wire a
/// mail provider and a background dispatch worker separately to complete delivery.
/// </summary>
[ApiController]
[Authorize]
[Route("api/notifications")]
public sealed class NotificationController(ISqlConnectionFactory sql, IPermissionService permissions) : ControllerBase
{
    private static readonly JsonSerializerOptions CamelJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private static readonly string[] OpsViewerRoles =
    [
        AppRoles.SystemAdmin, AppRoles.ServiceManager, AppRoles.LeadershipViewer, AppRoles.Auditor,
    ];

    private Guid RequireUserId()
    {
        var user = HttpContext.GetSanadiUser();
        if (!user.IsAuthenticated || user.UserId is not Guid userId) throw new UnauthorizedException();
        return userId;
    }

    private async Task<(bool CanView, bool CanManage)> ResolveOpsAccessAsync(Guid userId, CancellationToken ct)
    {
        var canManage = await permissions.HasRoleAsync(userId, AppRoles.SystemAdmin, ct);
        if (canManage) return (true, true);
        foreach (var role in OpsViewerRoles)
        {
            if (await permissions.HasRoleAsync(userId, role, ct)) return (true, false);
        }
        return (false, false);
    }

    // ---------------- Student notification centre ----------------

    private sealed class NotificationEventRow
    {
        public Guid Id { get; init; }
        public string EventType { get; init; } = "";
        public string? Title { get; init; }
        public string? Body { get; init; }
        public string? ActionUrl { get; init; }
        public DateTimeOffset CreatedAt { get; init; }
        public DateTimeOffset? ReadAt { get; init; }
        public Guid? CaseId { get; init; }
        public string? EntityType { get; init; }
        public Guid? EntityId { get; init; }
        public string? CaseNumber { get; init; }
        public string? CaseType { get; init; }
    }

    [HttpGet("me")]
    public async Task<IActionResult> ListMine(CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        await using var conn = sql.Create();
        var rows = await conn.QueryAsync<NotificationEventRow>(DbProc.Call("usp_Notify_ListMine", new { userId }, cancellationToken));

        var items = rows.Select(r => new
        {
            id = r.Id,
            eventType = r.EventType,
            title = r.Title,
            body = r.Body,
            actionUrl = r.ActionUrl,
            createdAt = r.CreatedAt,
            readAt = r.ReadAt,
            caseId = r.CaseId ?? (r.EntityType == "case" ? r.EntityId : null),
            caseReference = r.CaseNumber,
            caseType = r.CaseType,
        });
        return new JsonResult(items, CamelJson);
    }

    [HttpGet("me/unread-count")]
    public async Task<IActionResult> UnreadCount(CancellationToken ct)
    {
        var userId = RequireUserId();
        await using var conn = sql.Create();
        var unreadCount = await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_Notify_CountUnread", new { userId }, ct));
        return new JsonResult(new { unreadCount }, CamelJson);
    }

    public sealed class MarkReadRequest
    {
        public List<Guid> Ids { get; set; } = [];
        public Guid? CaseId { get; set; }
        public bool All { get; set; }
    }

    [HttpPost("me/read")]
    public async Task<IActionResult> MarkRead([FromBody] MarkReadRequest request, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        await using var conn = sql.Create();
        if (request.All)
        {
            await conn.ExecuteAsync(DbProc.Call("usp_Notify_MarkAllRead", new { userId }, cancellationToken));
        }
        else if (request.CaseId is Guid caseId)
        {
            await conn.ExecuteAsync(DbProc.Call("usp_Notify_MarkCaseRead", new { userId, caseId }, cancellationToken));
        }
        else if (request.Ids.Count > 0)
        {
            await conn.ExecuteAsync(DbProc.Call("usp_Notify_MarkIdsRead", new { userId, ids = DbProc.Csv(request.Ids) }, cancellationToken));
        }
        return new JsonResult(new { ok = true });
    }

    // ---------------- Ops console ----------------

    [HttpGet("ops/access")]
    public async Task<IActionResult> OpsAccess(CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        var (canView, canManage) = await ResolveOpsAccessAsync(userId, cancellationToken);
        return new JsonResult(new { canView, canManage }, CamelJson);
    }

    [HttpGet("ops/overview")]
    public async Task<IActionResult> OpsOverview(CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        var (canView, _) = await ResolveOpsAccessAsync(userId, cancellationToken);
        if (!canView) throw new ForbiddenException();

        await using var conn = sql.Create();
        var since = DateTimeOffset.UtcNow.AddDays(-7);
        var recent = await conn.QueryAsync<(string Status, string Severity)>(DbProc.Call("usp_Notify_ListRecentDeliveries", new { since }, cancellationToken));

        var byStatus = recent.GroupBy(r => r.Status).ToDictionary(g => g.Key, g => g.Count());
        var bySeverity = recent.GroupBy(r => r.Severity).ToDictionary(g => g.Key, g => g.Count());

        var state = await conn.QuerySingleOrDefaultAsync(DbProc.Call("usp_Notify_GetDispatchState", null, cancellationToken));
        var settings = await conn.QuerySingleOrDefaultAsync(DbProc.Call("usp_Notify_GetSettings", null, cancellationToken));

        return new JsonResult(new { byStatus, bySeverity, state, settings, windowDays = 7 }, CamelJson);
    }

    private sealed class DeliveryRow
    {
        public Guid Id { get; init; }
        public string EventType { get; init; } = "";
        public string Severity { get; init; } = "";
        public string Status { get; init; } = "";
        public string Language { get; init; } = "";
        public string TemplateCode { get; init; } = "";
        public string? RecipientEmail { get; init; }
        public string? RecipientRole { get; init; }
        public string? Subject { get; init; }
        public int RetryCount { get; init; }
        public string? FailureCode { get; init; }
        public string? FailureReason { get; init; }
        public DateTimeOffset QueuedAt { get; init; }
        public DateTimeOffset? SentAt { get; init; }
        public DateTimeOffset? NextAttemptAt { get; init; }
    }

    private static string MaskEmail(string? email)
    {
        if (string.IsNullOrEmpty(email)) return "—";
        var at = email.IndexOf('@');
        if (at < 0) return email;
        var local = email[..at];
        var domain = email[(at + 1)..];
        var head = local.Length > 2 ? local[..2] + "***" : local;
        return $"{head}@{domain}";
    }

    [HttpGet("ops/deliveries")]
    public async Task<IActionResult> ListDeliveries(
        [FromQuery] string q = "", [FromQuery] string status = "all", [FromQuery] string severity = "all",
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken cancellationToken = default)
    {
        var userId = RequireUserId();
        var (canView, _) = await ResolveOpsAccessAsync(userId, cancellationToken);
        if (!canView) throw new ForbiddenException();

        page = Math.Clamp(page, 1, 500);
        pageSize = Math.Clamp(pageSize, 5, 50);

        await using var conn = sql.Create();
        var args = new
        {
            status,
            severity,
            q,
            qLike = $"%{q}%",
            offset = (page - 1) * pageSize,
            take = pageSize,
        };

        var total = await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_Notify_CountDeliveries", args, cancellationToken));
        var rows = await conn.QueryAsync<DeliveryRow>(DbProc.Call("usp_Notify_ListDeliveries", args, cancellationToken));

        var mapped = rows.Select(r => new
        {
            id = r.Id,
            eventType = r.EventType,
            severity = r.Severity,
            status = r.Status,
            language = r.Language,
            templateCode = r.TemplateCode,
            recipientMasked = MaskEmail(r.RecipientEmail),
            recipientRole = r.RecipientRole,
            subject = r.Subject,
            retryCount = r.RetryCount,
            failureCode = r.FailureCode,
            failureReason = r.FailureReason,
            queuedAt = r.QueuedAt,
            sentAt = r.SentAt,
            nextAttemptAt = r.NextAttemptAt,
        });
        return new JsonResult(new { rows = mapped, total }, CamelJson);
    }

    public sealed class SettingsPatchRequest
    {
        public bool? EmailsEnabled { get; set; }
        public bool? DemoEmailMode { get; set; }
        public string? DemoRedirectEmail { get; set; }
        public bool? DigestEnabled { get; set; }
        public string? PublicAppUrl { get; set; }
        public int? BatchSize { get; set; }
    }

    [HttpPost("ops/settings")]
    public async Task<IActionResult> UpdateSettings([FromBody] SettingsPatchRequest request, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        var (_, canManage) = await ResolveOpsAccessAsync(userId, cancellationToken);
        if (!canManage) throw new ForbiddenException();

        await using var conn = sql.Create();
        await conn.ExecuteAsync(DbProc.Call("usp_Notify_UpdateSettings", request, cancellationToken));
        return new JsonResult(new { ok = true });
    }

    public sealed class DispatchPauseRequest
    {
        public bool Paused { get; set; }
        public string? Reason { get; set; }
    }

    [HttpPost("ops/dispatch-pause")]
    public async Task<IActionResult> SetDispatchPaused([FromBody] DispatchPauseRequest request, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        var (_, canManage) = await ResolveOpsAccessAsync(userId, cancellationToken);
        if (!canManage) throw new ForbiddenException();

        await using var conn = sql.Create();
        await conn.ExecuteAsync(DbProc.Call("usp_Notify_SetDispatchPaused", new { paused = request.Paused, reason = request.Reason }, cancellationToken));
        return new JsonResult(new { ok = true });
    }

    // ---------------- Emergency broadcasts ----------------

    private sealed class BroadcastRow
    {
        public Guid Id { get; init; }
        public string TitleEn { get; init; } = "";
        public string TitleAr { get; init; } = "";
        public string Status { get; init; } = "";
        public string Audience { get; init; } = "";
        public int RecipientCount { get; init; }
        public DateTimeOffset CreatedAt { get; init; }
        public DateTimeOffset? SentAt { get; init; }
    }

    [HttpGet("ops/broadcasts")]
    public async Task<IActionResult> ListBroadcasts(CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        var (canView, _) = await ResolveOpsAccessAsync(userId, cancellationToken);
        if (!canView) throw new ForbiddenException();

        await using var conn = sql.Create();
        var rows = await conn.QueryAsync<BroadcastRow>(DbProc.Call("usp_Notify_ListBroadcasts", null, cancellationToken));
        return new JsonResult(rows, CamelJson);
    }

    public sealed class CreateBroadcastRequest
    {
        public string TitleEn { get; set; } = "";
        public string TitleAr { get; set; } = "";
        public string MessageEn { get; set; } = "";
        public string MessageAr { get; set; } = "";
        public string Audience { get; set; } = "";
        public Guid? UnitId { get; set; }
        public string? GroupCode { get; set; }
        public string? ActionUrl { get; set; }
    }

    [HttpPost("ops/broadcasts")]
    public async Task<IActionResult> CreateBroadcast([FromBody] CreateBroadcastRequest request, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        var (_, canManage) = await ResolveOpsAccessAsync(userId, cancellationToken);
        if (!canManage) throw new ForbiddenException();

        var audienceConfig = JsonSerializer.Serialize(new { unit_id = request.UnitId, group_code = request.GroupCode });
        await using var conn = sql.Create();
        var id = await conn.ExecuteScalarAsync<Guid>(DbProc.Call("usp_Notify_CreateBroadcast", new
        {
            request.TitleEn, request.TitleAr, request.MessageEn, request.MessageAr, request.Audience,
            audienceConfig, request.ActionUrl, userId,
        }, cancellationToken));
        return new JsonResult(new { id }, CamelJson);
    }

    /// <summary>
    /// Resolves the audience and queues one notification_deliveries row per recipient
    /// (status = 'queued'). Does not send email: no mail provider is wired yet, so a
    /// separate dispatch worker must pick these rows up once one is configured.
    /// </summary>
    [HttpPost("ops/broadcasts/{id:guid}/approve")]
    public async Task<IActionResult> ApproveBroadcast(Guid id, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        var (_, canManage) = await ResolveOpsAccessAsync(userId, cancellationToken);
        if (!canManage) throw new ForbiddenException();

        await using var conn = sql.Create();
        var broadcast = await conn.QuerySingleOrDefaultAsync<(string Status, string Audience, string AudienceConfig, string TitleEn, string TitleAr, string MessageEn, string MessageAr, string? ActionUrl)>(
            DbProc.Call("usp_Notify_GetBroadcast", new { id }, cancellationToken));
        if (broadcast.Status is null) return NotFound();
        if (broadcast.Status is "sent" or "sending")
            return new JsonResult(new { queued = 0, alreadySent = true }, CamelJson);

        using var configDoc = JsonDocument.Parse(broadcast.AudienceConfig);
        var unitId = configDoc.RootElement.TryGetProperty("unit_id", out var u) && u.ValueKind == JsonValueKind.String
            ? Guid.Parse(u.GetString()!) : (Guid?)null;
        var groupCode = configDoc.RootElement.TryGetProperty("group_code", out var g) && g.ValueKind == JsonValueKind.String
            ? g.GetString() : null;

        const int maxRecipients = 2000;
        List<Guid> recipientIds = broadcast.Audience switch
        {
            "all_students" => (await conn.QueryAsync<Guid>(DbProc.Call("usp_Notify_ListAllStudents", new { max = maxRecipients }, cancellationToken))).ToList(),
            "unit_students" when unitId is not null => (await conn.QueryAsync<Guid>(DbProc.Call("usp_Notify_ListUnitStudents", new { unitId, max = maxRecipients }, cancellationToken))).ToList(),
            "group" when groupCode is not null => (await conn.QueryAsync<Guid>(DbProc.Call("usp_Notify_ListGroupMembers", new { groupCode, max = maxRecipients }, cancellationToken))).ToList(),
            _ => [],
        };

        await conn.ExecuteAsync(DbProc.Call("usp_Notify_MarkBroadcastSending", new { id, userId }, cancellationToken));

        var templateVars = JsonSerializer.Serialize(new
        {
            alert_title = broadcast.TitleEn,
            alert_title_ar = broadcast.TitleAr,
            approved_emergency_message = broadcast.MessageEn,
            approved_emergency_message_ar = broadcast.MessageAr,
        });

        var queued = 0;
        foreach (var recipientId in recipientIds)
        {
            var dedupeKey = $"broadcast:{id}:{recipientId}";
            var inserted = await conn.ExecuteAsync(DbProc.Call("usp_Notify_QueueBroadcastDelivery", new { recipientId, templateVars, actionUrl = broadcast.ActionUrl ?? "/alerts", id, dedupeKey }, cancellationToken));
            if (inserted > 0) queued++;
        }

        await conn.ExecuteAsync(DbProc.Call("usp_Notify_MarkBroadcastSent", new { id, queued }, cancellationToken));

        var metadata = JsonSerializer.Serialize(new { recipients = queued, audience = broadcast.Audience });
        await conn.ExecuteAsync(DbProc.Call("usp_Notify_InsertBroadcastAudit", new { userId, id, metadata }, cancellationToken));

        return new JsonResult(new { queued, alreadySent = false }, CamelJson);
    }
}
