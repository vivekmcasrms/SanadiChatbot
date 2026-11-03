using System.Text.Json;
using Dapper;
using Sanadi.Application.Rpc;
using Sanadi.Application.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Domain.Security;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Rpc;

public sealed class GetServiceAvailabilityHandler(ISqlConnectionFactory db) : IRpcHandler
{
    public string Name => "get_service_availability";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        var serviceId = RpcArgs.GuidOf(args, "_service_id");
        var at = RpcArgs.Time(args, "_at") ?? DateTimeOffset.UtcNow;
        await using var conn = db.Create();
        var svc = await conn.QuerySingleOrDefaultAsync(DbProc.Call("usp_GetUniversityService",
            new { serviceId }, cancellationToken));
        if (svc is null)
        {
            return new
            {
                service_id = serviceId,
                exists = false,
                is_available = true,
                status = "always_available",
                availability_type = "always_available",
                reminders_enabled = false,
                preliminary_check_allowed = false,
                timezone = "Asia/Dubai"
            };
        }

        var windows = (await conn.QueryAsync(DbProc.Call("usp_GetServiceAvailabilityWindows",
            new { serviceId }, cancellationToken))).ToList();

        if (windows.Count == 0)
        {
            return new
            {
                service_id = (Guid)svc.id,
                exists = true,
                service_code = (string?)svc.code,
                service_name_en = (string?)svc.name_en,
                service_name_ar = (string?)svc.name_ar,
                is_available = true,
                status = "always_available",
                availability_type = "always_available",
                current_window_id = (Guid?)null,
                next_window_id = (Guid?)null,
                opens_at = (DateTimeOffset?)null,
                closes_at = (DateTimeOffset?)null,
                next_open_at = (DateTimeOffset?)null,
                next_close_at = (DateTimeOffset?)null,
                reason_en = (string?)null,
                reason_ar = (string?)null,
                student_message_en = (string?)null,
                student_message_ar = (string?)null,
                reminders_enabled = false,
                preliminary_check_allowed = false,
                timezone = "Asia/Dubai"
            };
        }

        dynamic? blocked = windows.FirstOrDefault(w =>
        {
            var type = (string?)w.availability_type;
            return type is "admin_disabled" or "temporarily_closed";
        });
        if (blocked is not null)
        {
            var type = (string)blocked.availability_type;
            return Shape(svc, false, type == "admin_disabled" ? "admin_disabled" : "temporarily_suspended", blocked, null);
        }

        dynamic? current = windows.FirstOrDefault(w =>
        {
            DateTimeOffset? opens = w.opens_at;
            DateTimeOffset? closes = w.closes_at;
            var type = (string?)w.availability_type;
            if (type == "always_available") return true;
            return (opens is null || opens <= at) && (closes is null || closes >= at);
        });
        if (current is not null)
        {
            return Shape(svc, true, "open", current, null);
        }

        dynamic? next = windows
            .Where(w => w.opens_at is DateTimeOffset o && o > at)
            .OrderBy(w => (DateTimeOffset)w.opens_at)
            .FirstOrDefault();
        return Shape(svc, false, next is null ? "closed" : "opens_soon", null, next);
    }

    private static object Shape(dynamic svc, bool available, string status, dynamic? current, dynamic? next) => new
    {
        service_id = (Guid)svc.id,
        exists = true,
        service_code = (string?)svc.code,
        service_name_en = (string?)svc.name_en,
        service_name_ar = (string?)svc.name_ar,
        is_available = available,
        status,
        availability_type = (string?)(current?.availability_type ?? next?.availability_type) ?? "date_range",
        current_window_id = (Guid?)current?.id,
        next_window_id = (Guid?)next?.id,
        opens_at = (DateTimeOffset?)current?.opens_at,
        closes_at = (DateTimeOffset?)current?.closes_at,
        next_open_at = (DateTimeOffset?)next?.opens_at,
        next_close_at = (DateTimeOffset?)next?.closes_at,
        reason_en = (string?)(current?.reason_en ?? next?.reason_en),
        reason_ar = (string?)(current?.reason_ar ?? next?.reason_ar),
        student_message_en = (string?)(current?.student_message_en ?? next?.student_message_en),
        student_message_ar = (string?)(current?.student_message_ar ?? next?.student_message_ar),
        reminders_enabled = (bool?)(current?.reminders_enabled ?? next?.reminders_enabled) ?? false,
        preliminary_check_allowed = (bool?)(current?.preliminary_check_allowed ?? next?.preliminary_check_allowed) ?? false,
        timezone = (string?)(current?.timezone ?? next?.timezone) ?? "Asia/Dubai"
    };
}

public sealed class GenerateAvailabilitySlotsHandler(ISqlConnectionFactory db) : IRpcHandler
{
    public string Name => "generate_availability_slots";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        if (!user.IsStaff && !user.IsServiceRole) throw new ForbiddenException();
        var ruleId = RpcArgs.GuidOf(args, "_rule_id") ?? throw new SanadiException("Missing _rule_id");
        var weeks = Math.Clamp(RpcArgs.Int(args, "_weeks", 4), 1, 12);
        await using var conn = db.Create();
        var rule = await conn.QuerySingleOrDefaultAsync(DbProc.Call("usp_GetStaffAvailabilityRule",
            new { ruleId }, cancellationToken));
        if (rule is null || !(rule.is_active as bool? ?? false) || rule.appointment_type_id is null) return 0;

        TimeZoneInfo dubai;
        try { dubai = TimeZoneInfo.FindSystemTimeZoneById("Arabian Standard Time"); }
        catch { dubai = TimeZoneInfo.FindSystemTimeZoneById("Asia/Dubai"); }

        var today = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, dubai).Date;
        var validFrom = Convert.ToDateTime(rule.valid_from).Date;
        DateTime? validTo = rule.valid_to == null ? null : Convert.ToDateTime(rule.valid_to);
        var horizon = today.AddDays(weeks * 7);
        if (validTo is DateTime vt && vt.Date < horizon) horizon = vt.Date;
        var d = validFrom > today ? validFrom : today;
        var weekday = Convert.ToInt32(rule.weekday);
        var startMinute = Convert.ToInt32(rule.start_minute);
        var endMinute = Convert.ToInt32(rule.end_minute);
        var slotMinutes = Convert.ToInt32(rule.slot_minutes);
        var capacity = Convert.ToInt32(rule.capacity);
        Guid typeId = (Guid)rule.appointment_type_id;
        Guid? staffId = rule.staff_profile_id == null ? null : (Guid)rule.staff_profile_id;
        string? location = rule.location as string;
        string? meeting = rule.meeting_link as string;
        var created = 0;
        await conn.OpenAsync(cancellationToken);
        for (; d <= horizon; d = d.AddDays(1))
        {
            if ((int)d.DayOfWeek != weekday) continue;
            var midnight = new DateTimeOffset(d.Year, d.Month, d.Day, 0, 0, 0, dubai.GetUtcOffset(d));
            var t = midnight.AddMinutes(startMinute);
            var windowEnd = midnight.AddMinutes(endMinute);
            while (t.AddMinutes(slotMinutes) <= windowEnd)
            {
                var slotEnd = t.AddMinutes(slotMinutes);
                if (t > DateTimeOffset.UtcNow)
                {
                    var exists = await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_AppointmentSlotExists",
                        new { typeId, t, staffId }, cancellationToken));
                    if (exists == 0)
                    {
                        await conn.ExecuteAsync(DbProc.Call("usp_InsertAppointmentSlot",
                            new { typeId, staffId, t, slotEnd, capacity, location, meeting }, cancellationToken));
                        created++;
                    }
                }
                t = slotEnd;
            }
        }
        return created;
    }
}

public sealed class RemoveMyRequestsHandler(ISqlConnectionFactory db) : IRpcHandler
{
    public string Name => "remove_my_requests";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        var uid = RpcArgs.RequireUser(user);
        var ids = RpcArgs.Guids(args, "_case_ids");
        var scope = RpcArgs.Str(args, "_scope") ?? "all_resolved";
        await using var conn = db.Create();
        var n = await conn.ExecuteAsync(DbProc.Call("usp_RemoveMyRequests",
            new { uid, scope, ids = string.Join(",", (ids.Length == 0 ? new[] { Guid.Empty } : ids).Select(g => g.ToString("D"))) },
            cancellationToken));
        return new { requested = n, removed = n, skipped = 0 };
    }
}

public sealed class RemoveMySuggestionsHandler(ISqlConnectionFactory db) : IRpcHandler
{
    public string Name => "remove_my_suggestions";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        var uid = RpcArgs.RequireUser(user);
        var ids = RpcArgs.Guids(args, "_suggestion_ids");
        var scope = RpcArgs.Str(args, "_scope") ?? "all_suggestions";
        await using var conn = db.Create();
        var n = await conn.ExecuteAsync(DbProc.Call("usp_RemoveMySuggestions",
            new { uid, scope, ids = string.Join(",", (ids.Length == 0 ? new[] { Guid.Empty } : ids).Select(g => g.ToString("D"))) },
            cancellationToken));
        return new { requested = n, removed = n, skipped = 0 };
    }
}

public sealed class AdminCaseMonitorSummaryHandler(ISqlConnectionFactory db, IPermissionService permissions) : IRpcHandler
{
    public string Name => "admin_case_monitor_summary";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        await GuardMonitor(permissions, user, cancellationToken);
        await using var conn = db.Create();
        return await conn.QuerySingleAsync(DbProc.Call("usp_AdminCaseMonitorSummary", null, cancellationToken));
    }

    internal static async Task GuardMonitor(IPermissionService permissions, ICurrentUser user, CancellationToken cancellationToken)
    {
        var uid = RpcArgs.RequireUser(user);
        if (!user.IsServiceRole && !await permissions.CanMonitorCasesAsync(uid, cancellationToken))
            throw new ForbiddenException("Not authorised for case monitoring");
    }
}

public sealed class AdminUnitMonitorHandler(ISqlConnectionFactory db, IPermissionService permissions) : IRpcHandler
{
    public string Name => "admin_unit_monitor";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        await AdminCaseMonitorSummaryHandler.GuardMonitor(permissions, user, cancellationToken);
        await using var conn = db.Create();
        var rows = await conn.QueryAsync(DbProc.Call("usp_AdminUnitMonitor", null, cancellationToken));
        return rows.ToList();
    }
}

public sealed class AdminOwnerMonitorHandler(ISqlConnectionFactory db, IPermissionService permissions) : IRpcHandler
{
    public string Name => "admin_owner_monitor";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        await AdminCaseMonitorSummaryHandler.GuardMonitor(permissions, user, cancellationToken);
        await using var conn = db.Create();
        var rows = await conn.QueryAsync(DbProc.Call("usp_AdminOwnerMonitor", null, cancellationToken));
        return rows.ToList();
    }
}

public sealed class AdminCaseMonitorHandler(ISqlConnectionFactory db, IPermissionService permissions) : IRpcHandler
{
    public string Name => "admin_case_monitor";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        await AdminCaseMonitorSummaryHandler.GuardMonitor(permissions, user, cancellationToken);
        var page = Math.Max(1, RpcArgs.Int(args, "_page", 1));
        var pageSize = Math.Clamp(RpcArgs.Int(args, "_page_size", 25), 5, 100);
        var offset = (page - 1) * pageSize;
        var search = RpcArgs.Str(args, "_search");
        var unit = RpcArgs.GuidOf(args, "_unit");
        var type = RpcArgs.Str(args, "_type");
        var status = RpcArgs.Str(args, "_status");
        var sla = RpcArgs.Str(args, "_sla");
        var actor = RpcArgs.Str(args, "_actor");
        var escalation = RpcArgs.Str(args, "_escalation");
        var priority = RpcArgs.Str(args, "_priority");
        var owner = RpcArgs.GuidOf(args, "_owner");
        var view = RpcArgs.Str(args, "_view") ?? "open";
        var since = RpcArgs.Time(args, "_since");
        var sort = RpcArgs.Str(args, "_sort") ?? "risk";
        var pattern = string.IsNullOrWhiteSpace(search) || search.Trim().Length < 2 ? null : "%" + search.Trim() + "%";

        await using var conn = db.Create();
        var filter = new { unit, type, priority, owner, since, actor, sla, status, escalation, view, pattern };
        var total = await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_Rpc_AdminCaseMonitorCount", filter, cancellationToken));
        var items = (await conn.QueryAsync(DbProc.Call("usp_Rpc_AdminCaseMonitorList",
            new { unit, type, priority, owner, since, actor, sla, status, escalation, view, pattern, sort, offset, pageSize },
            cancellationToken))).ToList();
        return new { items, total, page, pageSize };
    }
}

public sealed class AdminCaseMonitorDetailHandler(ISqlConnectionFactory db, IPermissionService permissions) : IRpcHandler
{
    public string Name => "admin_case_monitor_detail";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        await AdminCaseMonitorSummaryHandler.GuardMonitor(permissions, user, cancellationToken);
        var caseId = RpcArgs.GuidOf(args, "_case_id") ?? throw new SanadiException("Missing _case_id");
        await using var conn = db.Create();
        var row = await conn.QuerySingleOrDefaultAsync(DbProc.Call("usp_Rpc_AdminCaseMonitorDetail", new { caseId }, cancellationToken));
        if (row is null) throw new NotFoundException("Case not found in your monitoring scope");

        var responsibility = (await conn.QueryAsync(DbProc.Call("usp_Rpc_ListResponsibility", new { caseId }, cancellationToken))).ToList();
        var statusHistory = (await conn.QueryAsync(DbProc.Call("usp_Rpc_ListStatusHistory", new { caseId }, cancellationToken))).ToList();
        var slaEvents = (await conn.QueryAsync(DbProc.Call("usp_Rpc_ListSlaEvents", new { caseId }, cancellationToken))).ToList();
        var escalations = (await conn.QueryAsync(DbProc.Call("usp_Rpc_ListEscalations", new { caseId }, cancellationToken))).ToList();
        var oversight = (await conn.QueryAsync(DbProc.Call("usp_Rpc_ListOversight", new { caseId }, cancellationToken))).ToList();

        return new { @case = row, responsibility, statusHistory, slaEvents, escalations, oversight };
    }
}

public sealed class AdminGovernanceOverviewHandler(ISqlConnectionFactory db) : IRpcHandler
{
    public string Name => "admin_governance_overview";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        if (!user.IsStaff && !user.IsServiceRole) throw new ForbiddenException();
        await using var conn = db.Create();
        var totals = await conn.QuerySingleAsync(DbProc.Call("usp_Rpc_GovTotals", null, cancellationToken));
        var performance = await conn.QuerySingleAsync(DbProc.Call("usp_Rpc_GovPerformance", null, cancellationToken));
        var units = (await conn.QueryAsync(DbProc.Call("usp_Rpc_GovUnitsAttention", null, cancellationToken))).ToList();
        var recent = (await conn.QueryAsync(DbProc.Call("usp_Rpc_GovRecent", null, cancellationToken))).ToList();
        return new { totals, performance, unitsNeedingAttention = units, recent };
    }
}

public sealed class AdminOwnerPerformanceHandler(ISqlConnectionFactory db) : IRpcHandler
{
    public string Name => "admin_owner_performance";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        if (!user.IsStaff && !user.IsServiceRole) throw new ForbiddenException();
        await using var conn = db.Create();
        var rows = await conn.QueryAsync(DbProc.Call("usp_Rpc_OwnerPerformance", null, cancellationToken));
        return rows.ToList();
    }
}

public sealed class AdminGovernanceReportHandler(ISqlConnectionFactory db) : IRpcHandler
{
    public string Name => "admin_governance_report";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        if (!user.IsStaff && !user.IsServiceRole) throw new ForbiddenException();
        var from = RpcArgs.Time(args, "_from");
        var to = RpcArgs.Time(args, "_to");
        var unit = RpcArgs.GuidOf(args, "_unit");
        var owner = RpcArgs.GuidOf(args, "_owner");
        var type = RpcArgs.Str(args, "_type");
        var status = RpcArgs.Str(args, "_status");
        await using var conn = db.Create();
        var p = new { from, to, unit, owner, type, status };
        var metrics = await conn.QuerySingleAsync(DbProc.Call("usp_Rpc_GovReportMetrics", p, cancellationToken));
        var rows = (await conn.QueryAsync(DbProc.Call("usp_Rpc_GovReportRows", p, cancellationToken))).ToList();
        var byUnit = (await conn.QueryAsync(DbProc.Call("usp_Rpc_GovReportByUnit", p, cancellationToken))).ToList();
        var byOwner = (await conn.QueryAsync(DbProc.Call("usp_Rpc_GovReportByOwner", p, cancellationToken))).ToList();
        return new { metrics, rows, byUnit, byOwner };
    }
}

public sealed class EvaluationMetricsHandler(ISqlConnectionFactory db) : IRpcHandler
{
    public string Name => "evaluation_metrics";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        if (!user.IsStaff && !user.IsServiceRole) throw new ForbiddenException();
        var from = RpcArgs.Time(args, "_from") ?? DateTimeOffset.UtcNow.AddDays(-90);
        var to = RpcArgs.Time(args, "_to") ?? DateTimeOffset.UtcNow;
        await using var conn = db.Create();
        var p = new { from, to };
        var volumes = await conn.QuerySingleAsync(DbProc.Call("usp_Rpc_EvalVolumes", p, cancellationToken));
        var handling = await conn.QuerySingleAsync(DbProc.Call("usp_Rpc_EvalHandling", p, cancellationToken));
        var timing = await conn.QuerySingleAsync(DbProc.Call("usp_Rpc_EvalTiming", p, cancellationToken));
        var sla = await conn.QuerySingleAsync(DbProc.Call("usp_Rpc_EvalSla", p, cancellationToken));
        var effort = await conn.QuerySingleAsync(DbProc.Call("usp_Rpc_EvalEffort", p, cancellationToken));
        var reviews = await conn.QuerySingleAsync(DbProc.Call("usp_Rpc_EvalReviews", p, cancellationToken));
        var evidence = await conn.QuerySingleAsync(DbProc.Call("usp_Rpc_EvalEvidence", p, cancellationToken));
        var kinds = (await conn.QueryAsync<(string kind, int n)>(DbProc.Call("usp_Rpc_EvalReviewKinds", p, cancellationToken)))
            .ToDictionary(x => x.kind, x => x.n, StringComparer.OrdinalIgnoreCase);

        return new
        {
            range = new { from = from.ToString("o"), to = to.ToString("o") },
            volumes,
            handling,
            timing,
            sla,
            effort,
            reviews,
            evidence = new
            {
                baselines = (int)evidence.baselines,
                pilot_sessions = (int)evidence.pilot_sessions,
                pilot_participants = (int)evidence.pilot_participants,
                handovers = (int)evidence.handovers,
                exception_events = (int)evidence.exception_events,
                approvals = (int)evidence.approvals,
                action_receipts = (int)evidence.action_receipts,
                reviews_by_kind = kinds,
                provenance_fields = (int)evidence.provenance_fields,
                issued_documents = (int)evidence.issued_documents,
                revoked_accounts = (int)evidence.revoked_accounts,
                assistant_conversations = (int)evidence.assistant_conversations
            }
        };
    }
}

public sealed class IsAccessRevokedHandler(IPermissionService permissions) : IRpcHandler
{
    public string Name => "is_access_revoked";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken) =>
        await permissions.IsAccessRevokedAsync(RpcArgs.GuidOf(args, "_user_id") ?? RpcArgs.RequireUser(user), cancellationToken);
}
