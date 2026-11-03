using System.Reflection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Sanadi.Application.Auth;
using Sanadi.Api.Controllers;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Options;

namespace Sanadi.Api.Tests;

public sealed class AuthControllerRouteTests
{
    [Fact]
    public void Client_diagnostics_reject_unknown_events_and_invalid_flow_ids()
    {
        var controller = new AuthController(null!, null!, Options.Create(new JwtOptions()), NullLogger<AuthController>.Instance)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        Assert.IsType<BadRequestResult>(controller.TraceSso(new("untrusted-event", "test", Guid.NewGuid().ToString())));
        Assert.IsType<BadRequestResult>(controller.TraceSso(new("AUTH_COMPLETE", "test", "invalid")));
        Assert.IsType<NoContentResult>(controller.TraceSso(new("AUTH_COMPLETE", "role_content_mounted", Guid.NewGuid().ToString())));
    }

    [Fact]
    public void Sso_routes_are_the_exact_required_absolute_routes()
    {
        Assert.Equal("~/api/v1/auth/sso/initiatesso", RouteOf(nameof(AuthController.InitiateSso)));
        Assert.Equal("~/api/v1/auth/sso/callback", RouteOf(nameof(AuthController.SsoCallback)));
        Assert.Equal("~/api/v1/auth/sso/authorize", RouteOf(nameof(AuthController.AuthorizeSso)));

        var ssoRoutes = typeof(AuthController).GetMethods(BindingFlags.Instance | BindingFlags.Public)
            .SelectMany(method => method.GetCustomAttributes<HttpGetAttribute>())
            .Select(attribute => attribute.Template)
            .Where(template => template?.Contains("/sso/", StringComparison.OrdinalIgnoreCase) == true)
            .ToArray();

        Assert.Equal(3, ssoRoutes.Length);
    }

    [Theory]
    [InlineData("sso_invalid_state")]
    [InlineData("sso_invalid_nonce")]
    [InlineData("sso_invalid_code")]
    [InlineData("sso_invalid_token")]
    [InlineData("sso_invalid_identity")]
    [InlineData("sso_provider_error")]
    public async Task Invalid_callback_returns_to_ui_without_restarting_sso(string errorCode)
    {
        var sso = new CallbackSsoService(errorCode);
        var controller = new AuthController(
            null!,
            sso,
            Options.Create(new JwtOptions()),
            NullLogger<AuthController>.Instance)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };

        var result = Assert.IsType<RedirectResult>(
            await controller.SsoCallback("expired", "state", null, null, default));

        Assert.Equal($"https://app.test/auth?sso_error={errorCode}", result.Url);
        Assert.Equal(0, sso.InitiationCount);
        Assert.Equal(0, controller.Response.Headers.SetCookie.Count);
    }

    [Fact]
    public async Task Refresh_prefers_current_cookie_over_stale_browser_storage()
    {
        var auth = new RefreshAuthService();
        var controller = new AuthController(
            auth, new CallbackSsoService(null), Options.Create(new JwtOptions()), NullLogger<AuthController>.Instance)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        var cookie = Convert.ToBase64String(new byte[48]);
        controller.Request.Headers.Cookie = AuthController.RefreshCookie + "=" + cookie;
        await controller.Token("refresh_token", new(null, null, "stale-storage-token"), default);
        Assert.Equal(cookie, auth.ReceivedToken);
    }

    private sealed class RefreshAuthService : IAuthService
    {
        public string? ReceivedToken { get; private set; }
        public Task<AuthTokens> RefreshAsync(RefreshRequest request, CancellationToken cancellationToken)
        {
            ReceivedToken = request.RefreshToken;
            return Task.FromResult(new AuthTokens("access", "refresh", 3600, 1,
                new AuthUser(Guid.NewGuid(), "student@uaeu.ac.ae", ["student"], new Dictionary<string, object?>())));
        }
        public Task<AuthTokens> LoginAsync(LoginRequest request, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<AuthTokens> SignUpAsync(SignUpRequest request, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<AuthTokens> LoginWithSsoAsync(SsoLoginRequest request, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task SignOutAsync(string token, CancellationToken cancellationToken, string? accessToken = null) => throw new NotSupportedException();
        public Task<AuthUser> GetUserAsync(Sanadi.Domain.Security.ICurrentUser current, CancellationToken cancellationToken) => throw new NotSupportedException();
    }

    [Fact]
    public async Task Authorize_returns_provider_url_without_redirecting_the_fetch_request()
    {
        var sso = new CallbackSsoService(null);
        var controller = new AuthController(null!, sso, Options.Create(new JwtOptions()), NullLogger<AuthController>.Instance)
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        var result = Assert.IsType<OkObjectResult>(await controller.AuthorizeSso(new string('c', 43), default));
        Assert.Contains("https://idp.test/authorize", System.Text.Json.JsonSerializer.Serialize(result.Value));
        Assert.True(sso.ForcedLogin);
        Assert.Equal("no-store", controller.Response.Headers.CacheControl.ToString());
    }

    [Fact]
    public async Task Authorize_rejects_missing_browser_challenge()
    {
        var sso = new CallbackSsoService(null);
        var controller = new AuthController(null!, sso, Options.Create(new JwtOptions()), NullLogger<AuthController>.Instance)
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        Assert.IsType<BadRequestObjectResult>(await controller.AuthorizeSso(null, default));
        Assert.Equal(0, sso.InitiationCount);
    }

    [Fact]
    public async Task Ticket_redemption_returns_session_and_disables_caching()
    {
        var controller = new AuthController(null!, new CallbackSsoService(null), Options.Create(new JwtOptions()), NullLogger<AuthController>.Instance)
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        var result = Assert.IsType<OkObjectResult>(await controller.RedeemSsoSession(new("ticket", "verifier"), default));
        using var json = System.Text.Json.JsonDocument.Parse(System.Text.Json.JsonSerializer.Serialize(result.Value));
        Assert.Equal("access", json.RootElement.GetProperty("access_token").GetString());
        Assert.Equal("student", json.RootElement.GetProperty("user").GetProperty("app_metadata").GetProperty("roles")[0].GetString());
        Assert.Equal("no-store", controller.Response.Headers.CacheControl.ToString());
        Assert.Equal(2, controller.Response.Headers.SetCookie.Count);
    }

    [Fact]
    public async Task Start_with_sanadi_requests_fresh_provider_login()
    {
        var sso = new CallbackSsoService(null);
        var controller = new AuthController(
            null!, sso, Options.Create(new JwtOptions()), NullLogger<AuthController>.Instance)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        var result = Assert.IsType<RedirectResult>(await controller.InitiateSso(default));
        Assert.Equal("https://idp.test/authorize", result.Url);
        Assert.True(sso.ForcedLogin);
        Assert.Equal(1, sso.InitiationCount);
    }

    [Fact]
    public async Task Expired_callback_forces_fresh_sso_login()
    {
        var sso = new CallbackSsoService("sso_expired");
        var controller = new AuthController(
            null!, sso, Options.Create(new JwtOptions()), NullLogger<AuthController>.Instance)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };

        var result = Assert.IsType<RedirectResult>(
            await controller.SsoCallback("expired", "state", null, null, default));

        Assert.Equal("https://idp.test/authorize", result.Url);
        Assert.Equal(1, sso.InitiationCount);
        Assert.True(sso.ForcedLogin);
    }

    [Fact]
    public async Task Valid_callback_sets_session_cookies_and_redirects_to_application()
    {
        var sso = new CallbackSsoService(null);
        var controller = new AuthController(
            null!, sso, Options.Create(new JwtOptions()), NullLogger<AuthController>.Instance)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        controller.Request.Scheme = "https";

        var result = Assert.IsType<RedirectResult>(
            await controller.SsoCallback("valid", "state", null, null, default));

        Assert.Equal("https://app.test/auth", result.Url);
        Assert.Equal(0, sso.InitiationCount);
        Assert.Contains(controller.Response.Headers.SetCookie, cookie =>
            cookie!.StartsWith(AuthController.AccessCookie + "=access;", StringComparison.Ordinal));
        Assert.Contains(controller.Response.Headers.SetCookie, cookie =>
            cookie!.StartsWith(AuthController.RefreshCookie + "=refresh;", StringComparison.Ordinal));
    }

    private static string? RouteOf(string methodName) =>
        typeof(AuthController).GetMethod(methodName)?.GetCustomAttribute<HttpGetAttribute>()?.Template;

    private sealed class CallbackSsoService(string? errorCode) : ISsoService
    {
        public int InitiationCount { get; private set; }
        public bool ForcedLogin { get; private set; }

        public Task<SsoInitiation> InitiateAsync(CancellationToken cancellationToken, bool forceLogin = false, string? browserChallenge = null)
        {
            InitiationCount++;
            ForcedLogin = forceLogin;
            return Task.FromResult(new SsoInitiation("https://idp.test/authorize"));
        }

        public Task<SsoCompletion> CompleteAsync(SsoCallbackRequest request, CancellationToken cancellationToken)
        {
            if (errorCode is not null) throw new SanadiException("SSO callback failed", 401, errorCode);
            return Task.FromResult(new SsoCompletion(
                new AuthTokens("access", "refresh", 3600, 1,
                    new AuthUser(Guid.NewGuid(), "student@uaeu.ac.ae", ["student"], new Dictionary<string, object?>())),
                "https://app.test/auth"));
        }

        public Task<string> FailureRedirectAsync(string errorCode, CancellationToken cancellationToken) =>
            Task.FromResult($"https://app.test/auth?sso_error={errorCode}");

        public Task<AuthTokens> RedeemSessionAsync(string ticket, CancellationToken cancellationToken, string? verifier = null) =>
            Task.FromResult(new AuthTokens("access", "refresh", 3600, 1,
                new AuthUser(Guid.NewGuid(), "student@uaeu.ac.ae", ["student"], new Dictionary<string, object?>())));
    }
}
