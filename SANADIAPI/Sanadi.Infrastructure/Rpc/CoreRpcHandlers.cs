using System.Text.Json;
using Dapper;
using Sanadi.Application.Rpc;
using Sanadi.Application.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Domain.Security;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Rpc;

internal static class RpcArgs
{
    public static Guid? GuidOf(JsonElement args, string name)
    {
        if (!args.TryGetProperty(name, out var p) || p.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return null;
        return p.ValueKind == JsonValueKind.String && System.Guid.TryParse(p.GetString(), out var g) ? g : p.TryGetGuid(out var g2) ? g2 : null;
    }

    public static string? Str(JsonElement args, string name) =>
        args.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;

    public static int Int(JsonElement args, string name, int fallback) =>
        args.TryGetProperty(name, out var p) && p.TryGetInt32(out var n) ? n : fallback;

    public static bool Bool(JsonElement args, string name, bool fallback = false) =>
        args.TryGetProperty(name, out var p) && p.ValueKind is JsonValueKind.True or JsonValueKind.False ? p.GetBoolean() : fallback;

    public static Guid[] Guids(JsonElement args, string name)
    {
        if (!args.TryGetProperty(name, out var p) || p.ValueKind != JsonValueKind.Array) return [];
        return p.EnumerateArray()
            .Select(x => x.ValueKind == JsonValueKind.String && Guid.TryParse(x.GetString(), out var g) ? g : (Guid?)null)
            .Where(g => g is not null)
            .Select(g => g!.Value)
            .ToArray();
    }

    public static DateTimeOffset? Time(JsonElement args, string name)
    {
        var s = Str(args, name);
        return DateTimeOffset.TryParse(s, out var t) ? t : null;
    }

    public static Guid RequireUser(ICurrentUser user) =>
        user.UserId ?? throw new UnauthorizedException();
}

public sealed class HasRoleHandler(IPermissionService permissions) : IRpcHandler
{
    public string Name => "has_role";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        var uid = RpcArgs.GuidOf(args, "_user_id") ?? RpcArgs.RequireUser(user);
        var role = RpcArgs.Str(args, "_role") ?? "";
        return await permissions.HasRoleAsync(uid, role, cancellationToken);
    }
}

public sealed class IsStaffHandler(IPermissionService permissions) : IRpcHandler
{
    public string Name => "is_staff";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken) =>
        await permissions.IsStaffAsync(RpcArgs.GuidOf(args, "_user_id") ?? RpcArgs.RequireUser(user), cancellationToken);
}

public sealed class IsManagerHandler(IPermissionService permissions) : IRpcHandler
{
    public string Name => "is_manager";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken) =>
        await permissions.IsManagerAsync(RpcArgs.GuidOf(args, "_user_id") ?? RpcArgs.RequireUser(user), cancellationToken);
}

public sealed class CanAccessCaseHandler(IPermissionService permissions) : IRpcHandler
{
    public string Name => "can_access_case";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        var caseId = RpcArgs.GuidOf(args, "_case_id") ?? throw new SanadiException("Missing _case_id");
        var uid = RpcArgs.GuidOf(args, "_user_id") ?? RpcArgs.RequireUser(user);
        return await permissions.CanAccessCaseAsync(caseId, uid, cancellationToken);
    }
}

public sealed class CanMonitorCasesHandler(IPermissionService permissions) : IRpcHandler
{
    public string Name => "can_monitor_cases";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken) =>
        await permissions.CanMonitorCasesAsync(RpcArgs.GuidOf(args, "_user_id") ?? RpcArgs.RequireUser(user), cancellationToken);
}

public sealed class CanMonitorAllUnitsHandler(IPermissionService permissions) : IRpcHandler
{
    public string Name => "can_monitor_all_units";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken) =>
        await permissions.CanMonitorAllUnitsAsync(RpcArgs.GuidOf(args, "_user_id") ?? RpcArgs.RequireUser(user), cancellationToken);
}

public sealed class StaffUnitHandler(IPermissionService permissions) : IRpcHandler
{
    public string Name => "staff_unit";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken) =>
        await permissions.StaffUnitAsync(RpcArgs.GuidOf(args, "_user_id") ?? RpcArgs.RequireUser(user), cancellationToken);
}

public sealed class ListAppointmentAvailabilityHandler(ISqlConnectionFactory db) : IRpcHandler
{
    public string Name => "list_appointment_availability";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        RpcArgs.RequireUser(user);
        var limit = Math.Clamp(RpcArgs.Int(args, "_limit", 60), 1, 200);
        var unit = RpcArgs.Str(args, "_unit_code");
        var typeQuery = RpcArgs.Str(args, "_type_query");
        await using var conn = db.Create();
        var rows = await conn.QueryAsync(DbProc.Call("usp_ListAppointmentAvailability",
            new { limit, unit, q = typeQuery }, cancellationToken));
        return rows.ToList();
    }
}

public sealed class MyAppointmentsHandler(ISqlConnectionFactory db) : IRpcHandler
{
    public string Name => "my_appointments";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        var uid = RpcArgs.RequireUser(user);
        var includePast = RpcArgs.Bool(args, "_include_past");
        await using var conn = db.Create();
        var rows = await conn.QueryAsync(DbProc.Call("usp_MyAppointments",
            new { uid, includePast = includePast ? 1 : 0 }, cancellationToken));
        return rows.ToList();
    }
}

public sealed class BookAppointmentHandler(ISqlConnectionFactory db) : IRpcHandler
{
    public string Name => "book_appointment_slot";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        var uid = RpcArgs.RequireUser(user);
        var slotId = RpcArgs.GuidOf(args, "_slot_id") ?? throw new SanadiException("Missing _slot_id");
        await using var conn = db.Create();
        await conn.OpenAsync(cancellationToken);
        using var tx = conn.BeginTransaction();
        var slot = await conn.QuerySingleOrDefaultAsync(DbProc.Call("usp_GetAppointmentSlotForUpdate",
            new { slotId }, cancellationToken, tx));
        if (slot is null) throw new NotFoundException("Slot not found");
        var id = Guid.NewGuid();
        var code = Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
        await conn.ExecuteAsync(DbProc.Call("usp_BookAppointment",
            new { id, uid, slotId, purpose = RpcArgs.Str(args, "_purpose"), code }, cancellationToken, tx));
        tx.Commit();
        return await conn.QuerySingleAsync(DbProc.Call("usp_GetStudentAppointment", new { id }, cancellationToken));
    }
}

public sealed class CancelAppointmentHandler(ISqlConnectionFactory db) : IRpcHandler
{
    public string Name => "cancel_appointment_booking";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        var uid = RpcArgs.RequireUser(user);
        var appointmentId = RpcArgs.GuidOf(args, "_appointment_id") ?? throw new SanadiException("Missing _appointment_id");
        await using var conn = db.Create();
        await conn.ExecuteAsync(DbProc.Call("usp_CancelAppointment", new { appointmentId, uid }, cancellationToken));
        return true;
    }
}

public sealed class RescheduleAppointmentHandler(ISqlConnectionFactory db) : IRpcHandler
{
    public string Name => "reschedule_appointment_booking";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        var uid = RpcArgs.RequireUser(user);
        var appointmentId = RpcArgs.GuidOf(args, "_appointment_id") ?? throw new SanadiException("Missing _appointment_id");
        var newSlot = RpcArgs.GuidOf(args, "_new_slot_id") ?? throw new SanadiException("Missing _new_slot_id");
        await using var conn = db.Create();
        await conn.ExecuteAsync(DbProc.Call("usp_RescheduleAppointment",
            new { appointmentId, uid, newSlot }, cancellationToken));
        return true;
    }
}

public sealed class SearchKnowledgeHandler(ISqlConnectionFactory db) : IRpcHandler
{
    public string Name => "search_knowledge_passages";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        var query = RpcArgs.Str(args, "p_query") ?? "";
        var lang = RpcArgs.Str(args, "p_lang") ?? "en";
        var limit = Math.Clamp(RpcArgs.Int(args, "p_limit", 8), 1, 50);
        var domain = RpcArgs.Str(args, "p_domain");
        await using var conn = db.Create();
        var rows = await conn.QueryAsync(DbProc.Call("usp_SearchKnowledgePassages",
            new { limit, domain, lang, query }, cancellationToken));
        return rows.ToList();
    }
}

public sealed class NextDocumentReferenceHandler(ISqlConnectionFactory db) : IRpcHandler
{
    public string Name => "next_document_reference";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        var code = RpcArgs.Str(args, "_doc_code") ?? RpcArgs.Str(args, "_prefix");
        if (string.IsNullOrWhiteSpace(code))
            throw new SanadiException("A document code is required to issue a reference number.");

        await using var conn = db.Create();
        return await conn.ExecuteScalarAsync<string>(DbProc.Call("usp_NextDocumentReference",
            new { code }, cancellationToken));
    }
}

public sealed class VerifyStudentDocumentHandler(ISqlConnectionFactory db) : IRpcHandler
{
    public string Name => "verify_student_document";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        var token = RpcArgs.Str(args, "_token") ?? "";
        await using var conn = db.Create();
        var doc = await conn.QuerySingleOrDefaultAsync(DbProc.Call("usp_VerifyStudentDocument",
            new { token }, cancellationToken));
        if (doc is null) return new { found = false };
        return MapVerification(doc);
    }

    private static object MapVerification(dynamic doc)
    {
        IDictionary<string, object> row = doc is IDictionary<string, object> dict
            ? dict
            : throw new SanadiException("The verification record could not be read.");

        var documentStatus = Str(row, "document_status") ?? "";
        var verificationStatus = Str(row, "verification_status") ?? "";
        var deletedBy = Str(row, "deleted_by");
        var now = DateTimeOffset.UtcNow;
        var retention = Time(row, "retention_expires_at");
        var expires = Time(row, "expires_at");
        var effective =
            string.Equals(documentStatus, "deleted_by_student", StringComparison.OrdinalIgnoreCase) || deletedBy is not null
                ? "withdrawn"
                : string.Equals(verificationStatus, "revoked", StringComparison.OrdinalIgnoreCase)
                  || string.Equals(documentStatus, "revoked", StringComparison.OrdinalIgnoreCase)
                    ? "withdrawn"
                    : string.Equals(documentStatus, "expired", StringComparison.OrdinalIgnoreCase)
                        ? "expired"
                        : retention is { } r && r < now
                            ? "expired"
                            : expires is { } e && e < now
                                ? "expired"
                                : documentStatus;

        if (!string.Equals(effective, "valid", StringComparison.OrdinalIgnoreCase))
            return new { found = true, status = "unavailable", reference = Str(row, "reference_number") };

        var snap = ParseSnapshot(Str(row, "snapshot"));
        var studentName = snap.StudentName;
        var parts = studentName.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length > 2)
            studentName = $"{parts[0]} {parts[1][0]}. {parts[^1]}";

        return new
        {
            found = true,
            status = "valid",
            documentType = Str(row, "document_type"),
            titleEn = Str(row, "title_en"),
            titleAr = Str(row, "title_ar"),
            reference = Str(row, "reference_number"),
            studentName,
            studentNameAr = snap.StudentNameAr,
            programme = snap.ProgrammeEn,
            programmeAr = snap.ProgrammeAr,
            college = snap.CollegeEn,
            collegeAr = snap.CollegeAr,
            issuedAt = Time(row, "issued_at")?.ToString("o"),
            expiresAt = retention?.ToString("o"),
            language = Str(row, "language"),
            documentHash = Str(row, "document_hash"),
            digitallySigned = Flag(row, "digitally_signed"),
            isDemoDocument = Flag(row, "is_demo_document")
        };
    }

    private static string? Str(IDictionary<string, object> row, string key)
    {
        foreach (var kv in row)
        {
            if (!string.Equals(kv.Key, key, StringComparison.OrdinalIgnoreCase)) continue;
            return kv.Value is null or DBNull ? null : Convert.ToString(kv.Value, System.Globalization.CultureInfo.InvariantCulture);
        }
        return null;
    }

    private static DateTimeOffset? Time(IDictionary<string, object> row, string key)
    {
        foreach (var kv in row)
        {
            if (!string.Equals(kv.Key, key, StringComparison.OrdinalIgnoreCase)) continue;
            return kv.Value switch
            {
                null or DBNull => null,
                DateTimeOffset dto => dto,
                DateTime dt => new DateTimeOffset(DateTime.SpecifyKind(dt, DateTimeKind.Utc)),
                _ => DateTimeOffset.TryParse(Convert.ToString(kv.Value), out var parsed) ? parsed : null
            };
        }
        return null;
    }

    private static bool Flag(IDictionary<string, object> row, string key)
    {
        foreach (var kv in row)
        {
            if (!string.Equals(kv.Key, key, StringComparison.OrdinalIgnoreCase)) continue;
            return kv.Value switch
            {
                null or DBNull => false,
                bool b => b,
                byte by => by != 0,
                _ => Convert.ToBoolean(kv.Value)
            };
        }
        return false;
    }

    private static (string StudentName, string? StudentNameAr, string? ProgrammeEn, string? ProgrammeAr, string? CollegeEn, string? CollegeAr)
        ParseSnapshot(string? json)
    {
        if (string.IsNullOrWhiteSpace(json) || json is "{}")
            return ("", null, null, null, null, null);
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            return (
                Prop(root, "studentName") ?? "",
                Prop(root, "studentNameAr"),
                Prop(root, "programmeEn"),
                Prop(root, "programmeAr"),
                Prop(root, "collegeEn"),
                Prop(root, "collegeAr"));
        }
        catch (JsonException)
        {
            return ("", null, null, null, null, null);
        }
    }

    private static string? Prop(JsonElement root, string name) =>
        root.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
}

public sealed class PurgeExpiredDocumentsHandler(ISqlConnectionFactory db) : IRpcHandler
{
    public string Name => "purge_expired_documents";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        if (!user.IsServiceRole && !user.HasRole(AppRoles.SystemAdmin)) throw new ForbiddenException();
        var limit = RpcArgs.Int(args, "_limit", 50);
        await using var conn = db.Create();
        var n = await conn.ExecuteAsync(DbProc.Call("usp_PurgeExpiredDocuments", new { limit }, cancellationToken));
        return n;
    }
}

public sealed class PurgeMyIssuedDocumentHandler(ISqlConnectionFactory db) : IRpcHandler
{
    public string Name => "purge_my_issued_document";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        var uid = RpcArgs.RequireUser(user);
        var id = RpcArgs.GuidOf(args, "_document_id") ?? throw new SanadiException("Missing _document_id");
        await using var conn = db.Create();
        await conn.ExecuteAsync(DbProc.Call("usp_PurgeMyIssuedDocument", new { id, uid }, cancellationToken));
        return true;
    }
}

public sealed class ClaimNotificationDeliveriesHandler(ISqlConnectionFactory db) : IRpcHandler
{
    public string Name => "claim_notification_deliveries";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        if (!user.IsServiceRole) throw new ForbiddenException();
        var limit = RpcArgs.Int(args, "_limit", 25);
        await using var conn = db.Create();
        var rows = await conn.QueryAsync(DbProc.Call("usp_ClaimNotificationDeliveries",
            new { limit }, cancellationToken));
        return rows.ToList();
    }
}

public sealed class ChangeInternshipAssignmentHandler(ISqlConnectionFactory db, IPermissionService permissions) : IRpcHandler
{
    public string Name => "change_internship_assignment";
    public async Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        var uid = RpcArgs.RequireUser(user);
        if (!await permissions.IsStaffAsync(uid, cancellationToken) && !user.IsServiceRole)
            throw new ForbiddenException();
        var assignmentId = RpcArgs.GuidOf(args, "_assignment_id") ?? throw new SanadiException("Missing _assignment_id");
        var opportunityId = RpcArgs.GuidOf(args, "_opportunity_id");
        await using var conn = db.Create();
        await conn.ExecuteAsync(DbProc.Call("usp_ChangeInternshipAssignment",
            new { assignmentId, opportunityId }, cancellationToken));
        return true;
    }
}
