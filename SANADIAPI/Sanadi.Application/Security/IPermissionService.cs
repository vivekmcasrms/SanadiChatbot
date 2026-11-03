using Sanadi.Domain.Security;

namespace Sanadi.Application.Security;

public interface IPermissionService
{
    Task<IReadOnlyList<string>> GetRolesAsync(Guid userId, CancellationToken cancellationToken);
    Task<bool> HasRoleAsync(Guid userId, string role, CancellationToken cancellationToken);
    Task<bool> IsStaffAsync(Guid userId, CancellationToken cancellationToken);
    Task<bool> IsManagerAsync(Guid userId, CancellationToken cancellationToken);
    Task<bool> IsAccessRevokedAsync(Guid userId, CancellationToken cancellationToken);
    Task<bool> CanSeeAllCasesAsync(Guid userId, CancellationToken cancellationToken);
    Task<bool> CanAccessCaseAsync(Guid caseId, Guid userId, CancellationToken cancellationToken);
    Task<bool> CanMonitorCasesAsync(Guid userId, CancellationToken cancellationToken);
    Task<bool> CanMonitorAllUnitsAsync(Guid userId, CancellationToken cancellationToken);
    Task<bool> OwnsServiceUnitAsync(Guid userId, Guid? unitId, CancellationToken cancellationToken);
    Task<string?> StaffUnitAsync(Guid userId, CancellationToken cancellationToken);
}
