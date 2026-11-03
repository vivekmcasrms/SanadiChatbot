using Dapper;
using Sanadi.Application.Security;
using Sanadi.Domain.Security;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Auth;

public sealed class PermissionService(ISqlConnectionFactory connections) : IPermissionService
{
    public async Task<IReadOnlyList<string>> GetRolesAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var conn = connections.Create();
        var rows = await conn.QueryAsync<string>(DbProc.Call("usp_GetUserRoles", new { userId }, cancellationToken));
        return rows.ToList();
    }

    public async Task<bool> HasRoleAsync(Guid userId, string role, CancellationToken cancellationToken)
    {
        await using var conn = connections.Create();
        var has = await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_HasRole", new { userId, role }, cancellationToken));
        if (has == 0) return false;
        if (role == AppRoles.Student) return true;
        return !await IsAccessRevokedAsync(userId, cancellationToken);
    }

    public async Task<bool> IsStaffAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var conn = connections.Create();
        var has = await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_IsStaff", new { userId }, cancellationToken));
        return has == 1 && !await IsAccessRevokedAsync(userId, cancellationToken);
    }

    public async Task<bool> IsManagerAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var conn = connections.Create();
        var has = await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_IsManager", new { userId }, cancellationToken));
        return has == 1 && !await IsAccessRevokedAsync(userId, cancellationToken);
    }

    public async Task<bool> IsAccessRevokedAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var conn = connections.Create();
        return await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_IsAccessRevoked", new { userId }, cancellationToken)) == 1;
    }

    public async Task<bool> CanSeeAllCasesAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var conn = connections.Create();
        var has = await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_CanSeeAllCases", new { userId }, cancellationToken));
        return has == 1 && !await IsAccessRevokedAsync(userId, cancellationToken);
    }

    public async Task<bool> OwnsServiceUnitAsync(Guid userId, Guid? unitId, CancellationToken cancellationToken)
    {
        if (unitId is null) return false;
        await using var conn = connections.Create();
        return await conn.ExecuteScalarAsync<int>(
            DbProc.Call("usp_OwnsServiceUnit", new { userId, unitId }, cancellationToken)) == 1;
    }

    public async Task<bool> CanAccessCaseAsync(Guid caseId, Guid userId, CancellationToken cancellationToken)
    {
        if (await CanSeeAllCasesAsync(userId, cancellationToken)) return true;
        await using var conn = connections.Create();
        var row = await conn.QuerySingleOrDefaultAsync<(Guid StudentId, Guid? AssignedTo, Guid? UnitId)>(
            DbProc.Call("usp_GetCaseAccessRow", new { caseId }, cancellationToken));
        if (row.StudentId == Guid.Empty && row.AssignedTo is null && row.UnitId is null)
        {
            var exists = await conn.ExecuteScalarAsync<int>(
                DbProc.Call("usp_CaseExists", new { caseId }, cancellationToken));
            if (exists == 0) return false;
        }
        if (row.StudentId == userId) return true;
        if (!await IsStaffAsync(userId, cancellationToken)) return false;
        if (row.AssignedTo == userId) return true;
        return await OwnsServiceUnitAsync(userId, row.UnitId, cancellationToken);
    }

    public async Task<bool> CanMonitorAllUnitsAsync(Guid userId, CancellationToken cancellationToken)
    {
        if (await HasRoleAsync(userId, AppRoles.SystemAdmin, cancellationToken)) return true;
        if (await HasRoleAsync(userId, AppRoles.LeadershipViewer, cancellationToken)) return true;
        await using var conn = connections.Create();
        return await conn.ExecuteScalarAsync<int>(
            DbProc.Call("usp_CanMonitorAllUnits", new { userId }, cancellationToken)) == 1;
    }

    public async Task<bool> CanMonitorCasesAsync(Guid userId, CancellationToken cancellationToken)
    {
        if (await CanMonitorAllUnitsAsync(userId, cancellationToken)) return true;
        if (await HasRoleAsync(userId, AppRoles.Auditor, cancellationToken)) return true;
        if (await HasRoleAsync(userId, AppRoles.ServiceManager, cancellationToken)) return true;
        await using var conn = connections.Create();
        return await conn.ExecuteScalarAsync<int>(
            DbProc.Call("usp_HasMonitorGrant", new { userId }, cancellationToken)) == 1;
    }

    public async Task<string?> StaffUnitAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var conn = connections.Create();
        return await conn.ExecuteScalarAsync<string?>(DbProc.Call("usp_StaffUnit", new { userId }, cancellationToken));
    }
}
