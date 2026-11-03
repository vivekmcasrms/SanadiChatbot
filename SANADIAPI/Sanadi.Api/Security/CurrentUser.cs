using System.Security.Claims;
using Sanadi.Domain.Security;

namespace Sanadi.Api.Security;

public sealed class CurrentUser : ICurrentUser
{
    public Guid? UserId { get; init; }
    public string? Email { get; init; }
    public IReadOnlyList<string> Roles { get; init; } = [];
    public bool IsAuthenticated { get; init; }
    public bool IsServiceRole { get; init; }

    public static CurrentUser Anonymous() => new();

    public static CurrentUser ServiceRole() => new()
    {
        IsAuthenticated = true,
        IsServiceRole = true,
        Roles = AppRoles.Staff
    };

    public static CurrentUser FromPrincipal(ClaimsPrincipal principal)
    {
        var sub = principal.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                  ?? principal.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        var email = principal.FindFirst(JwtRegisteredClaimNames.Email)?.Value
                    ?? principal.FindFirst("email")?.Value
                    ?? principal.FindFirst(ClaimTypes.Email)?.Value;
        var roles = principal.FindAll(ClaimTypes.Role).Select(c => c.Value)
            .Concat(principal.FindAll(SanadiClaims.Role).Select(c => c.Value))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        return new CurrentUser
        {
            UserId = Guid.TryParse(sub, out var id) ? id : null,
            Email = email,
            Roles = roles,
            IsAuthenticated = Guid.TryParse(sub, out _)
        };
    }
}

internal static class JwtRegisteredClaimNames
{
    public const string Sub = "sub";
    public const string Email = "email";
}
