using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Sanadi.Api.Controllers;
using Sanadi.Application.Auth;
using Sanadi.Domain.Security;
using Sanadi.Infrastructure.Options;

namespace Sanadi.Api.Tests;

public sealed class LogoutTests
{
    [Fact]
    public async Task Logout_revokes_browser_and_cookie_credentials_and_expires_both_cookies()
    {
        var auth = new LogoutAuth();
        var controller = Controller(auth);
        controller.Request.Headers.Authorization = "Bearer browser-access";
        controller.Request.Headers.Cookie = "sanadi-access-token=cookie-access; sanadi-refresh-token=cookie-refresh";
        await controller.Logout(new(null, null, "browser-refresh"), default);
        Assert.Contains(("browser-refresh", "browser-access"), auth.Revocations);
        Assert.Contains(("cookie-refresh", "cookie-access"), auth.Revocations);
        Assert.Equal("no-store", controller.Response.Headers.CacheControl);
        Assert.Contains(controller.Response.Headers.SetCookie, c => c!.StartsWith("sanadi-access-token=;") && c.Contains("path=/"));
        Assert.Contains(controller.Response.Headers.SetCookie, c => c!.StartsWith("sanadi-refresh-token=;") && c.Contains("path=/api/v1/auth"));
    }

    [Fact]
    public async Task Logout_clears_cookies_even_when_revocation_fails_and_does_not_report_success()
    {
        var controller = Controller(new LogoutAuth { Fail = true });
        await Assert.ThrowsAsync<InvalidOperationException>(() => controller.Logout(new(null, null, "refresh"), default));
        Assert.Equal(2, controller.Response.Headers.SetCookie.Count);
    }

    private static AuthController Controller(IAuthService auth) => new(auth, null!, Options.Create(new JwtOptions()), NullLogger<AuthController>.Instance)
    { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };

    private sealed class LogoutAuth : IAuthService
    {
        public bool Fail { get; init; }
        public List<(string Refresh, string? Access)> Revocations { get; } = [];
        public Task SignOutAsync(string refreshToken, CancellationToken ct, string? accessToken = null)
        {
            if (Fail) throw new InvalidOperationException("Database unavailable");
            Revocations.Add((refreshToken, accessToken));
            return Task.CompletedTask;
        }
        public Task<AuthTokens> LoginAsync(LoginRequest request, CancellationToken ct) => throw new NotSupportedException();
        public Task<AuthTokens> SignUpAsync(SignUpRequest request, CancellationToken ct) => throw new NotSupportedException();
        public Task<AuthTokens> RefreshAsync(RefreshRequest request, CancellationToken ct) => throw new NotSupportedException();
        public Task<AuthTokens> LoginWithSsoAsync(SsoLoginRequest request, CancellationToken ct) => throw new NotSupportedException();
        public Task<AuthUser> GetUserAsync(ICurrentUser current, CancellationToken ct) => throw new NotSupportedException();
    }
}
