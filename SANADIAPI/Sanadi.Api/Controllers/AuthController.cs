using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Sanadi.Application.Auth;
using Sanadi.Api.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Options;
using Sanadi.Infrastructure.Diagnostics;

using Sanadi.Api.Middleware;

namespace Sanadi.Api.Controllers;

[ApiController]
[Route("auth/v1")]
[Route("api/v1/auth")]
public sealed class AuthController(
    IAuthService auth,
    ISsoService sso,
    IOptions<JwtOptions> jwtOptions,
    ILogger<AuthController> logger) : ControllerBase
{
    public const string AccessCookie = "sanadi-access-token";
    public const string RefreshCookie = "sanadi-refresh-token";

    public sealed record PasswordGrant(string? email, string? password, string? refresh_token);
    public sealed record SignUpBody(string? email, string? password, JsonElement? data);

    [AllowAnonymous]
    [EnableRateLimiting("login")]
    [HttpPost("token")]
    [ValidateTokenGrant]
    public async Task<IActionResult> Token([FromQuery] string grant_type, [FromBody] PasswordGrant? body, CancellationToken cancellationToken)
    {
        // Retain the guard for direct/internal calls as well as HTTP requests.
        if (Request.Query["grant_type"].Count > 1 ||
            !ValidateTokenGrantAttribute.IsSupported(grant_type))
            return ValidateTokenGrantAttribute.Rejected();

        body ??= new PasswordGrant(null, null, null);
        if (grant_type == "refresh_token")
        {
            var refreshToken = Request.Cookies[RefreshCookie] ?? body.refresh_token ?? "";
            // Refresh tokens are opaque credentials, never URLs. Reject malformed
            // values before any auth service, database, or provider is invoked.
            if (!Sanadi.Infrastructure.Auth.RefreshTokenFormat.IsValid(refreshToken))
                throw new SanadiException("Invalid refresh token.", 401, "invalid_refresh_token");

            var refreshed = await LogStepAsync("AUTH_REFRESH", () => auth.RefreshAsync(new RefreshRequest(refreshToken), cancellationToken));
            WriteSessionCookies(refreshed);

            return Ok(ToSession(refreshed));
        }

        var tokens = await auth.LoginAsync(new LoginRequest(body.email ?? "", body.password ?? ""), cancellationToken);
        WriteSessionCookies(tokens);
        return Ok(ToSession(tokens));
    }

    [AllowAnonymous]
    [EnableRateLimiting("login")]
    [HttpPost("signup")]
    public async Task<IActionResult> SignUp([FromBody] SignUpBody body, CancellationToken cancellationToken)
    {
        string? name = null;
        string? lang = null;
        if (body.data is { ValueKind: JsonValueKind.Object } data)
        {
            if (data.TryGetProperty("full_name", out var n)) name = n.GetString();
            if (data.TryGetProperty("preferred_language", out var l)) lang = l.GetString();
        }
        var tokens = await auth.SignUpAsync(new SignUpRequest(body.email ?? "", body.password ?? "", name, lang), cancellationToken);
        WriteSessionCookies(tokens);
        return Ok(ToSession(tokens));
    }

    [AllowAnonymous]
    [EnableRateLimiting("sso")]
    [HttpGet("~/api/v1/auth/sso/authorize")]
    public async Task<IActionResult> AuthorizeSso([FromQuery] string? challenge, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        SsoDiagnostics.Step("SSO_AUTHORIZE", "begin");
        if (challenge is null || challenge.Length != 43 || challenge.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '-' && c != '_'))
        {
            SsoDiagnostics.Step("SSO_AUTHORIZE", "error", "sso_invalid_challenge", 400);
            return BadRequest(new { code = "sso_invalid_challenge", message = "A browser sign-in challenge is required." });
        }

        var initiation = await LogStepAsync("SSO_AUTHORIZE_CREATE", () => sso.InitiateAsync(cancellationToken, forceLogin: true, browserChallenge: challenge));

        SsoDiagnostics.Step("SSO_AUTHORIZE", statusCode: 200);
        return Ok(new { authorizationUrl = initiation.AuthorizationUrl });
    }

    public sealed record SsoSessionBody(string? ticket, string? verifier);

    public sealed record SsoTraceBody(string? step, string? code, string? flowId, string? stage = null, double? ms = null);

    [AllowAnonymous]
    [EnableRateLimiting("sso-diagnostics")]
    [RequestSizeLimit(1024)]
    [HttpPost("~/api/v1/auth/sso/trace")]
    public IActionResult TraceSso([FromBody] SsoTraceBody body)
    {
        string[] steps = ["AUTH_SUBMIT", "AUTH_PROVIDER_RESPONSE", "AUTH_SESSION_CREATED", "AUTH_PROFILE_LOADED",
            "AUTH_ROLE_RESOLVED", "AUTH_REDIRECT", "AUTH_COMPLETE", "AUTH_FAILED", "AUTH_BROWSER_PROOF",
            "AUTH_AUTHORIZE_REQUEST", "AUTH_CALLBACK_RECEIVED", "AUTH_TICKET_REQUEST", "AUTH_SESSION_APPLIED",
            "AUTH_REFRESH_REQUEST", "AUTH_REFRESH_RESPONSE"];
        if (!steps.Contains(body.step) || !Guid.TryParse(body.flowId, out _)) return BadRequest();
        string[] stages = ["sso_start", "browser_proof", "authorize", "redirect", "callback", "sso_ticket",
            "session_install", "profile_roles", "refresh", "session_check", "logout"];
        // This is an unauthenticated, diagnostic-only signal. Never accept arbitrary browser text.
        SsoDiagnostics.ClientStep(body.step!, SafeTraceCode(body.code), body.flowId!,
            stages.Contains(body.stage) ? body.stage : null, body.ms);
        return NoContent();
    }

    [AllowAnonymous]
    [EnableRateLimiting("sso")]
    [HttpPost("~/api/v1/auth/sso/session")]
    public async Task<IActionResult> RedeemSsoSession([FromBody] SsoSessionBody body, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        Response.Headers["Pragma"] = "no-cache";
        var tokens = await LogStepAsync("SSO_SESSION_REDEEM", () => sso.RedeemSessionAsync(body.ticket ?? "", cancellationToken, body.verifier));
        WriteSessionCookies(tokens);
        SsoDiagnostics.Step("SSO_SESSION_RESPONSE", statusCode: 200);
        return Ok(ToSession(tokens));
    }

    [AllowAnonymous]
    [EnableRateLimiting("sso")]
    [HttpGet("~/api/v1/auth/sso/initiatesso")]
    public async Task<IActionResult> InitiateSso(CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        SsoDiagnostics.Step("SSO_INITIATE_REDIRECT", "begin");
        try
        {
            var initiation = await sso.InitiateAsync(cancellationToken, forceLogin: true);

            SsoDiagnostics.Step("SSO_PROVIDER_REDIRECT", statusCode: 302);
            return Redirect(initiation.AuthorizationUrl);
        }
        catch (SanadiException ex)
        {
            SsoDiagnostics.Error("SSO_INITIATE_REDIRECT", ex);
            ApiErrorPolicy.LogOnce(logger, ex, HttpContext, nameof(InitiateSso));
            return await RedirectSsoFailureAsync(ex.Code, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            SsoDiagnostics.Error("SSO_INITIATE_REDIRECT", ex);
            ApiErrorPolicy.LogOnce(logger, ex, HttpContext, nameof(InitiateSso));
            return await RedirectSsoFailureAsync("sso_unavailable", cancellationToken);
        }
    }

    [AllowAnonymous]
    [EnableRateLimiting("sso")]
    [HttpGet("~/api/v1/auth/sso/callback")]
    public async Task<IActionResult> SsoCallback(
        [FromQuery] string? code,
        [FromQuery] string? state,
        [FromQuery] string? error,
        [FromQuery(Name = "error_description")] string? errorDescription,
        CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";

        Response.Headers["Referrer-Policy"] = "no-referrer";
        SsoDiagnostics.Step("SSO_CALLBACK_RECEIVED", "begin", reference: SsoDiagnostics.Reference(state));
        try
        {
            var completion = await sso.CompleteAsync(
                new SsoCallbackRequest(code, state, error, errorDescription),
                cancellationToken);
            WriteSessionCookies(completion.Tokens);

            SsoDiagnostics.Step("SSO_APPLICATION_REDIRECT", statusCode: 302);
            return Redirect(completion.ApplicationRedirectUrl);
        }
        catch (SanadiException ex)
        {
            SsoDiagnostics.Error("SSO_CALLBACK", ex);
            ApiErrorPolicy.LogOnce(logger, ex, HttpContext, nameof(SsoCallback));

            if (ex.Code == "sso_expired")
            {
                SsoDiagnostics.Step("SSO_EXPIRED_RESTART", "begin");
                try
                {
                    var initiation = await sso.InitiateAsync(cancellationToken, forceLogin: true);

                    SsoDiagnostics.Step("SSO_EXPIRED_RESTART", statusCode: 302);
                    return Redirect(initiation.AuthorizationUrl);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
                catch (Exception restartError)
                {
                    SsoDiagnostics.Error("SSO_EXPIRED_RESTART", restartError);
                    ApiErrorPolicy.LogOnce(logger, restartError, HttpContext, nameof(SsoCallback));
                    return await RedirectSsoFailureAsync("sso_unavailable", cancellationToken);
                }
            }
            return await RedirectSsoFailureAsync(ex.Code, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            SsoDiagnostics.Error("SSO_CALLBACK", ex);
            ApiErrorPolicy.LogOnce(logger, ex, HttpContext, nameof(SsoCallback));
            return await RedirectSsoFailureAsync("sso_unavailable", cancellationToken);
        }
    }

    [AllowAnonymous]
    [HttpGet("user")]
    public async Task<IActionResult> UserInfo(CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        var current = HttpContext.GetSanadiUser();

        if (current.UserId is null)
        {
            SsoDiagnostics.Step("AUTH_USER_SESSION", "error", "unauthorized", 401);
            return Unauthorized();
        }

        var user = await LogStepAsync("AUTH_USER_PROFILE", () => auth.GetUserAsync(current, cancellationToken));
        return Ok(ToUser(user));
    }

    [AllowAnonymous]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout([FromBody] PasswordGrant? body, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        var header = Request.Headers.Authorization.ToString();
        var accessToken = header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? header[7..].Trim() : Request.Cookies[AccessCookie];
        try
        {
            await auth.SignOutAsync(body?.refresh_token ?? Request.Cookies[RefreshCookie] ?? "", cancellationToken, accessToken);
            // Cookie and browser storage can hold different rotated tokens.
            if (Request.Cookies[RefreshCookie] is { } cookieRefresh && cookieRefresh != body?.refresh_token ||
                Request.Cookies[AccessCookie] is { } cookieAccess && cookieAccess != accessToken)
                await auth.SignOutAsync(Request.Cookies[RefreshCookie] ?? "", cancellationToken, Request.Cookies[AccessCookie]);
        }
        finally { DeleteSessionCookies(); }
        string? logoutUrl = null;
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(3));
            logoutUrl = await sso.LogoutRedirectAsync(timeout.Token);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            SsoDiagnostics.Error("SSO_LOGOUT_REDIRECT", ex);
            ApiErrorPolicy.LogOnce(logger, ex, HttpContext, nameof(Logout));
        }
        return Ok(new { logoutUrl });
    }

    private async Task<IActionResult> RedirectSsoFailureAsync(string code, CancellationToken cancellationToken)
    {
        SsoDiagnostics.Step("SSO_FAILURE_REDIRECT", "begin");
        try
        {
            var target = await sso.FailureRedirectAsync(code, cancellationToken);

            SsoDiagnostics.Step("SSO_FAILURE_REDIRECT", statusCode: 302);
            return Redirect(target);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            SsoDiagnostics.Error("SSO_FAILURE_REDIRECT", ex);
            ApiErrorPolicy.LogOnce(logger, ex, HttpContext, nameof(RedirectSsoFailureAsync));
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                code = "sso_unavailable",
                message = "Single sign-on is temporarily unavailable. Please try again later."
            });
        }
    }

    private void WriteSessionCookies(AuthTokens tokens)
    {
        SsoDiagnostics.Step("AUTH_SESSION_COOKIES", "begin");
        Response.Cookies.Append(AccessCookie, tokens.AccessToken, new CookieOptions
        {
            HttpOnly = true,
            Secure = true,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            MaxAge = TimeSpan.FromSeconds(tokens.ExpiresIn),
            IsEssential = true
        });
        Response.Cookies.Append(RefreshCookie, tokens.RefreshToken, new CookieOptions
        {
            HttpOnly = true,
            Secure = true,
            SameSite = SameSiteMode.Lax,
            Path = "/api/v1/auth",
            MaxAge = TimeSpan.FromDays(Math.Max(1, jwtOptions.Value.RefreshTokenDays)),
            IsEssential = true
        });
        SsoDiagnostics.Step("AUTH_SESSION_COOKIES");
    }

    private static async Task<T> LogStepAsync<T>(string step, Func<Task<T>> action)
    {
        SsoDiagnostics.Step(step, "begin");
        try
        {
            var result = await action();
            SsoDiagnostics.Step(step);
            return result;
        }
        catch (Exception ex)
        {
            SsoDiagnostics.Error(step, ex);
            throw;
        }
    }

    private static string? SafeTraceCode(string? code)
    {
        if (code is null) return null;
        string[] known = ["sso_start", "browser_proof_started", "browser_proof_ready", "authorize_requested",
            "sso_authorize_ok", "sso_provider", "sso_callback_received", "sso_callback_rejected",
            "sso_ticket_requested", "sso_ticket_redeemed", "sso_session_applied", "sso_start_failed",
            "home_after_sso_failure", "sso_login_no_session", "profile_found", "profile_missing",
            "session_check_started", "cookie_or_token_session_restored", "session_refreshed",
            "refresh_requested", "refresh_completed", "logout_complete", "logout_failed",
            "role_access_redirect", "role_content_mounted", "application_redirect",
            "student", "service_officer", "service_owner", "service_manager", "knowledge_manager",
            "knowledge_approver", "integration_admin", "system_admin", "auditor", "leadership_viewer",
            "unknown_error", "network_error", "rate_limited", "invalid_credentials", "email_not_confirmed",
            "unauthorized", "forbidden", "internal", "session_expired", "sso_unavailable", "sso_disabled",
            "sso_not_configured", "sso_expired", "sso_invalid_ticket", "sso_invalid_state", "sso_invalid_nonce",
            "sso_invalid_token", "sso_invalid_code", "sso_invalid_challenge", "sso_invalid_verifier", "unclassified"];
        return known.Contains(code) || code.Length == 8 && code.StartsWith("http_", StringComparison.Ordinal) &&
            int.TryParse(code.AsSpan(5), out var status) && status is >= 100 and <= 599 ? code : "unclassified";
    }

    private void DeleteSessionCookies()
    {
        Response.Cookies.Delete(AccessCookie, new CookieOptions { Path = "/", Secure = true, HttpOnly = true, SameSite = SameSiteMode.Lax });
        Response.Cookies.Delete(RefreshCookie, new CookieOptions { Path = "/api/v1/auth", Secure = true, HttpOnly = true, SameSite = SameSiteMode.Lax });
    }

    private static object ToSession(AuthTokens tokens) => new
    {
        access_token = tokens.AccessToken,
        refresh_token = tokens.RefreshToken,
        token_type = "bearer",
        expires_in = tokens.ExpiresIn,
        expires_at = tokens.ExpiresAt,
        user = ToUser(tokens.User)
    };

    private static object ToUser(AuthUser user) => new
    {
        id = user.Id,
        email = user.Email,
        aud = "authenticated",
        role = "authenticated",
        app_metadata = new { provider = "email", roles = user.Roles },
        user_metadata = user.UserMetadata,
        created_at = DateTime.UtcNow
    };
}
