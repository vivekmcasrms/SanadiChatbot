using System.Security.Claims;
using Sanadi.Application;

namespace Sanadi.Web;

public static class CurrentUser
{
    public static Guid Id(this ClaimsPrincipal user) =>
        Guid.TryParse(user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier), out var id)
            ? id
            : throw new UnauthorizedAccessException("No authenticated user.");

    public static IReadOnlyList<string> Roles(this ClaimsPrincipal user)
    {
        var roles = user.FindAll("sanadi_role").Select(c => c.Value).ToList();
        return roles.Count > 0 ? roles : new List<string> { Domain.Roles.Student };
    }

    public static Lang Language(this HttpContext ctx) =>
        (ctx.Request.Cookies["lang"] ?? ctx.Request.Query["lang"].FirstOrDefault()) == "ar" ? Lang.Ar : Lang.En;
}
