namespace Sanadi.Domain.Security;

public interface ICurrentUser
{
    Guid? UserId { get; }
    string? Email { get; }
    IReadOnlyList<string> Roles { get; }
    bool IsAuthenticated { get; }
    bool IsServiceRole { get; }

    bool HasRole(string role) =>
        IsServiceRole || Roles.Contains(role, StringComparer.OrdinalIgnoreCase);

    bool IsStaff =>
        IsServiceRole || Roles.Any(r => AppRoles.Staff.Contains(r, StringComparer.OrdinalIgnoreCase));
}
