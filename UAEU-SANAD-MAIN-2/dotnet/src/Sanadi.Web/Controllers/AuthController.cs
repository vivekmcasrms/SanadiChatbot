using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Sanadi.Infrastructure.Auth;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Web.Controllers;

[Route("auth")]
public class AuthController(SupabaseAuthService auth, SanadiDbContext db) : Controller
{
    [HttpGet("")]
    public IActionResult Index(string? returnUrl = null)
    {
        ViewBag.ReturnUrl = returnUrl;
        return View("SignIn");
    }

    [HttpPost("")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> SignIn(string email, string password, string? returnUrl, CancellationToken ct)
    {
        var result = await auth.SignInAsync(email, password, ct);
        if (!result.Success)
        {
            ViewBag.Error = result.Error;
            return View("SignIn");
        }

        var roles = await db.UserRoles.AsNoTracking()
            .Where(r => r.UserId == result.UserId).Select(r => r.Role).ToListAsync(ct);
        if (roles.Count == 0) roles.Add(Domain.Roles.Student);

        var claims = new List<Claim>
        {
            new("sub", result.UserId.ToString()),
            new(ClaimTypes.NameIdentifier, result.UserId.ToString()),
            new(ClaimTypes.Email, result.Email),
            new("access_token", result.AccessToken),
        };
        claims.AddRange(roles.Select(r => new Claim("sanadi_role", r)));

        await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme,
            new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)),
            new AuthenticationProperties { IsPersistent = true });

        return Redirect(string.IsNullOrWhiteSpace(returnUrl) ? "/" : returnUrl);
    }

    [HttpPost("signout")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> SignOutUser()
    {
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return Redirect("/auth");
    }
}
