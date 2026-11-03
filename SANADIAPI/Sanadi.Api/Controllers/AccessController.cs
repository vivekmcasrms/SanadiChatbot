using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Sanadi.Api.Security;
using Sanadi.Application.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

/// <summary>Administrative access withdrawal with atomic workload-balanced reassignment.</summary>
[ApiController, Route("api/admin/access")]
public sealed class AccessController(ISqlConnectionFactory sql, IPermissionService permissions) : ControllerBase
{
    private static readonly string[] OpenStatuses = ["draft", "submitted", "acknowledged", "classified", "routed", "assigned", "in_progress", "in_review", "ai_processing", "resolution_proposed", "escalated", "on_hold", "waiting_external", "reopened", "transferred", "awaiting_student", "student_confirmation"];

    [HttpGet]
    public async Task<object> List(CancellationToken ct)
    {
        await RequireAdmin(ct); await using var db = sql.Create();
        var rows = await db.QueryAsync<StaffRow>(DbProc.Call("usp_Access_ListStaff", new { open = DbProc.Csv(OpenStatuses) }, ct));
        var result = new List<object>();
        foreach (var row in rows)
        {
            var roles = (await db.QueryAsync<string>(DbProc.Call("usp_Access_ListRoles", new { id = row.UserId }, ct))).ToArray();
            result.Add(new { row.UserId, row.FullName, row.Email, roles, row.RevokedAt, row.RevokedReason, row.OpenCases });
        }
        return result;
    }

    [HttpPost("revoke")]
    public async Task<object> Revoke([FromBody] RevokeInput input, CancellationToken ct)
    {
        var actor = await RequireAdmin(ct);
        if (input.UserId == actor) throw new SanadiException("You cannot withdraw your own access.");
        var reason = input.Reason?.Trim() ?? "";
        if (reason.Length is < 3 or > 500) throw new SanadiException("Reason must contain between 3 and 500 characters.");
        await using var db = sql.Create(); await db.OpenAsync(ct); await using var tx = await db.BeginTransactionAsync(ct);
        var now = DateTimeOffset.UtcNow;
        await db.ExecuteAsync(DbProc.Call("usp_Access_Revoke", new { now, actor, reason, id = input.UserId }, ct, tx));
        var reassigned = 0; var flagged = 0;
        if (input.ReassignOpenCases)
        {
            var cases = await db.QueryAsync<OpenCase>(DbProc.Call("usp_Access_ListOpenCases", new { id = input.UserId, open = DbProc.Csv(OpenStatuses) }, ct, tx));
            foreach (var item in cases)
            {
                var next = item.UnitId is null ? null : await Pick(db, (SqlTransaction)tx, item.Id, item.UnitId.Value, input.UserId, ct);
                await db.ExecuteAsync(DbProc.Call("usp_Access_ReassignCase", new { next = next?.Id, load = next?.Workload, now, caseId = item.Id, unitId = item.UnitId, actor }, ct, tx));
                if (next is null) { flagged++; continue; }
                reassigned++;
                await db.ExecuteAsync(DbProc.Call("usp_Access_NotifyReassign", new { caseId = item.Id, next = next.Id, number = item.CaseNumber, actor }, ct, tx));
            }
        }
        await Audit(db, (SqlTransaction)tx, actor, input.UserId, "staff_access_revoked", new { reason, reassigned, flagged }, ct);
        await tx.CommitAsync(ct); return new { ok = true, reassigned, flagged };
    }

    [HttpPost("restore")]
    public async Task<object> Restore([FromBody] UserInput input, CancellationToken ct)
    {
        var actor = await RequireAdmin(ct); await using var db = sql.Create(); await db.OpenAsync(ct); await using var tx = await db.BeginTransactionAsync(ct);
        await db.ExecuteAsync(DbProc.Call("usp_Access_Restore", new { id = input.UserId }, ct, tx));
        await Audit(db, (SqlTransaction)tx, actor, input.UserId, "staff_access_restored", new { }, ct); await tx.CommitAsync(ct); return new { ok = true };
    }

    [HttpGet("audit")]
    public async Task<object> AuditLog(CancellationToken ct)
    {
        await RequireAdmin(ct); await using var db = sql.Create();
        return await db.QueryAsync(DbProc.Call("usp_Access_ListAudit", null, ct));
    }

    [HttpGet("workload/{unitId:guid}")]
    public async Task<object> Workload(Guid unitId, CancellationToken ct)
    {
        var user = HttpContext.GetSanadiUser();
        if (!user.IsAuthenticated || user.UserId is not Guid userId) throw new UnauthorizedException();
        if (!await permissions.IsStaffAsync(userId, ct)) throw new ForbiddenException();
        await using var db = sql.Create();
        return await db.QueryAsync(DbProc.Call("usp_Access_ListWorkload", new { unitId, open = DbProc.Csv(OpenStatuses) }, ct));
    }

    private async Task<Guid> RequireAdmin(CancellationToken ct)
    {
        var user = HttpContext.GetSanadiUser(); if (!user.IsAuthenticated || user.UserId is not Guid id) throw new UnauthorizedException();
        if (!await permissions.HasRoleAsync(id, "system_admin", ct)) throw new ForbiddenException(); return id;
    }

    private static async Task<PickRow?> Pick(SqlConnection db, SqlTransaction tx, Guid caseId, Guid unitId, Guid excluded, CancellationToken ct, bool allowDesk = true)
    {
        var pick = await db.QuerySingleOrDefaultAsync<PickRow>(DbProc.Call("usp_Access_PickCandidate", new { unitId, excluded, caseId, open = DbProc.Csv(OpenStatuses) }, ct, tx));
        if (pick is not null) return pick;

        var owner = await db.QuerySingleOrDefaultAsync<Guid?>(DbProc.Call("usp_Access_PickOwner", new { unitId, excluded }, ct, tx));
        if (owner is Guid ownerId)
        {
            var load = await db.ExecuteScalarAsync<decimal>(DbProc.Call("usp_Access_OwnerWorkload", new { ownerId, open = DbProc.Csv(OpenStatuses) }, ct, tx));
            return new(ownerId, load);
        }
        if (!allowDesk) return null;
        var desk = await db.QuerySingleOrDefaultAsync<Guid?>(DbProc.Call("usp_Access_FindDesk", new { unitId }, ct, tx));
        return desk is Guid deskId ? await Pick(db, tx, caseId, deskId, excluded, ct, false) : null;
    }

    private static Task Audit(SqlConnection db, SqlTransaction tx, Guid actor, Guid subject, string action, object metadata, CancellationToken ct = default) =>
        db.ExecuteAsync(DbProc.Call("usp_Access_Audit", new { actor, action, subject, metadata = JsonSerializer.Serialize(metadata) }, ct, tx));

    public sealed record RevokeInput(Guid UserId, string? Reason, bool ReassignOpenCases = true);
    public sealed record UserInput(Guid UserId);
    private sealed record StaffRow(Guid UserId, string? FullName, string? Email, DateTimeOffset? RevokedAt, string? RevokedReason, int OpenCases);
    private sealed record OpenCase(Guid Id, Guid? UnitId, string? CaseNumber);
    private sealed record PickRow(Guid Id, decimal Workload);
}
