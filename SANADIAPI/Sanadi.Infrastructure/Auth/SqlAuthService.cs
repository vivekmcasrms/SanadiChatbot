using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using System.Text;
using Dapper;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Sanadi.Application.Auth;
using Sanadi.Application.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Domain.Security;
using Sanadi.Infrastructure.Diagnostics;
using Sanadi.Infrastructure.Options;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Auth;

public sealed class SqlAuthService(
    ISqlConnectionFactory connections,
    ITokenService tokens,
    IPermissionService permissions,
    IOptions<JwtOptions> jwtOptions,
    ILogger<SqlAuthService> logger) : IAuthService
{
    public async Task<AuthTokens> LoginAsync(LoginRequest request, CancellationToken cancellationToken)
    {
        var email = Normalize(request.Email);
        await using var conn = connections.Create();
        var user = await conn.QuerySingleOrDefaultAsync<(Guid Id, string? Email, string? Password)>(
            DbProc.Call("usp_AuthGetUserByEmail", new { email }, cancellationToken));

        if (user.Id == Guid.Empty || string.IsNullOrEmpty(user.Password) || !VerifyPassword(request.Password, user.Password))
            throw new SanadiException("Invalid login credentials", 401, "invalid_credentials");

        if (await permissions.IsAccessRevokedAsync(user.Id, cancellationToken))
            throw new ForbiddenException("Access has been revoked.");

        return await IssueAsync(user.Id, user.Email ?? email, cancellationToken);
    }

    public async Task<AuthTokens> SignUpAsync(SignUpRequest request, CancellationToken cancellationToken)
    {
        var email = Normalize(request.Email);
        if (string.IsNullOrWhiteSpace(request.Password) || request.Password.Length < 8)
            throw new SanadiException("Password must be at least 8 characters.");

        var id = Guid.NewGuid();
        var hash = BCrypt.Net.BCrypt.HashPassword(request.Password, workFactor: 12);
        await using var conn = connections.Create();
        await conn.OpenAsync(cancellationToken);
        using var tx = conn.BeginTransaction();
        try
        {
            await conn.ExecuteAsync(DbProc.Call("usp_AuthInsertUser",
                new { id, email, hash },
                cancellationToken, tx));

            await conn.ExecuteAsync(DbProc.Call("usp_AuthInsertProfile",
                new { id, name = request.FullName, email, lang = request.PreferredLanguage ?? "en" },
                cancellationToken, tx));

            await conn.ExecuteAsync(DbProc.Call("usp_AuthInsertStudentRole", new { id }, cancellationToken, tx));

            tx.Commit();
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            tx.Rollback();
            throw;
        }
        catch
        {
            tx.Rollback();
            throw new SanadiException("Could not create the account. The email may already be in use.");
        }

        return await IssueAsync(id, email, cancellationToken);
    }

    public async Task<AuthTokens> RefreshAsync(RefreshRequest request, CancellationToken cancellationToken)
    {
        if (!RefreshTokenFormat.IsValid(request.RefreshToken))
            throw new SanadiException("Invalid refresh token.", 401, "invalid_refresh_token");

        var step = "AUTH_REFRESH_LOOKUP";
        SsoDiagnostics.Step(step, "begin", "usp_AuthGetSessionRefreshToken");
        try
        {
            var hash = Sha256(request.RefreshToken);
            await using var conn = connections.Create();
            SsoDiagnostics.SqlTarget(conn.DataSource, conn.Database);

            var row = await conn.QuerySingleOrDefaultAsync<(Guid UserId, DateTimeOffset ExpiresAt, DateTimeOffset? RevokedAt, Guid? SessionId)>(
                DbProc.Call("usp_AuthGetSessionRefreshToken", new { hash }, cancellationToken));
            SsoDiagnostics.Step(step, operation: "usp_AuthGetSessionRefreshToken");

            step = "AUTH_REFRESH_VALIDATION";
            SsoDiagnostics.Step(step, "begin");
            if (row.UserId == Guid.Empty || row.RevokedAt is not null)
                throw new UnauthorizedException();
            if (row.ExpiresAt < DateTimeOffset.UtcNow)
                throw new SanadiException("Your session has expired.", 401, "session_expired");
            SsoDiagnostics.Step(step);

            step = "AUTH_REFRESH_EMAIL_READ";
            SsoDiagnostics.Step(step, "begin", "usp_AuthGetEmailById");
            var email = await conn.ExecuteScalarAsync<string>(
                DbProc.Call("usp_AuthGetEmailById", new { id = row.UserId }, cancellationToken))
                ?? "";
            SsoDiagnostics.Step(step, operation: "usp_AuthGetEmailById");
            step = "AUTH_REFRESH_ROLES_READ";
            SsoDiagnostics.Step(step, "begin", "usp_GetUserRoles");
            var roles = await permissions.GetRolesAsync(row.UserId, cancellationToken);
            SsoDiagnostics.Step(step, operation: "usp_GetUserRoles");
            step = "AUTH_REFRESH_SESSION_ISSUE";
            return await IssueAsync(row.UserId, email, roles, cancellationToken, row.SessionId, hash);
        }
        catch (SanadiException ex) when (ex.StatusCode is >= 400 and < 500)
        {
            SsoDiagnostics.Error(step, ex);
            // Preserve the existing session/authorization response needed by the UI.
            throw;
        }
        catch (OperationCanceledException ex) when (cancellationToken.IsCancellationRequested)
        {
            SsoDiagnostics.Error(step, ex);
            // The shared API handler completes a cancelled request quietly.
            throw;
        }
        catch (Exception ex)
        {
            SsoDiagnostics.Error(step, ex);
            ErrorLogging.LogOnce(logger, ex, nameof(RefreshAsync));
            // A failed refresh must reach the UI as an error, never as empty/successful tokens.
            throw;
        }
    }

    public async Task<AuthTokens> LoginWithSsoAsync(SsoLoginRequest request, CancellationToken cancellationToken)
    {
        var step = "SSO_USER_LOOKUP";
        SsoDiagnostics.Step(step, "begin", "usp_AuthGetSsoUserByEmail_v2");
        try
        {
            var email = Normalize(request.Email);
            await using var conn = connections.Create();
            SsoDiagnostics.SqlTarget(conn.DataSource, conn.Database);
            using var results = await conn.QueryMultipleAsync(
                DbProc.Call("usp_AuthGetSsoUserByEmail_v2", new { email, name = request.Name }, cancellationToken));

            var user = await results.ReadSingleOrDefaultAsync<SsoUserRow>();
            var roles = (await results.ReadAsync<string>()).ToList();
            SsoDiagnostics.Step(step, operation: "usp_AuthGetSsoUserByEmail_v2");

            step = "SSO_USER_REGISTERED_CHECK";
            SsoDiagnostics.Step(step, "begin");
            if (user is null || user.Id == Guid.Empty)
                throw new ForbiddenException("Your university account is not registered for Sanadi.");
            SsoDiagnostics.Step(step);
            step = "SSO_USER_ACTIVE_CHECK";
            SsoDiagnostics.Step(step, "begin");
            if (!user.IsActive)
                throw new ForbiddenException("Your Sanadi account is inactive. Please contact support.");
            SsoDiagnostics.Step(step);
            step = "SSO_USER_ROLES_CHECK";
            SsoDiagnostics.Step(step, "begin");
            if (roles.Count == 0)
                throw new ForbiddenException("No application role is assigned to your Sanadi account.");
            SsoDiagnostics.Step(step);

            step = "SSO_USER_SESSION_ISSUE";
            return await IssueAsync(user.Id, user.Email ?? email, roles, cancellationToken);
        }
        catch (Exception ex)
        {
            SsoDiagnostics.Error(step, ex);
            throw;
        }
    }

    public async Task SignOutAsync(string refreshToken, CancellationToken cancellationToken, string? accessToken = null)
    {
        Guid? sessionId = null;
        string? accessHash = null;
        DateTimeOffset? expiresAt = null;
        if (!string.IsNullOrWhiteSpace(accessToken) && tokens.ValidateAccessToken(accessToken, out _, out _) is not null)
        {
            var jwt = new JwtSecurityTokenHandler().ReadJwtToken(accessToken);
            sessionId = Guid.TryParse(jwt.Claims.FirstOrDefault(c => c.Type == "sid")?.Value, out var sid) ? sid : null;
            accessHash = Sha256(accessToken);
            expiresAt = new DateTimeOffset(jwt.ValidTo, TimeSpan.Zero).AddMinutes(1);
        }
        await using var conn = connections.Create();
        await conn.ExecuteAsync(DbProc.Call("usp_AuthEndSession", new
        {
            hash = string.IsNullOrWhiteSpace(refreshToken) ? null : Sha256(refreshToken),
            sessionId, accessHash, expiresAt
        }, cancellationToken));
    }

    public async Task<AuthUser> GetUserAsync(ICurrentUser current, CancellationToken cancellationToken)
    {
        var step = "AUTH_PROFILE_READ";
        SsoDiagnostics.Step(step, "begin");
        try
        {
            if (current.UserId is null) throw new UnauthorizedException();
            step = "AUTH_PROFILE_ROLES_READ";
            SsoDiagnostics.Step(step, "begin", "usp_GetUserRoles");
            var roles = await permissions.GetRolesAsync(current.UserId.Value, cancellationToken);
            SsoDiagnostics.Step(step, operation: "usp_GetUserRoles");
            SsoDiagnostics.Step("AUTH_PROFILE_READ");
            return new AuthUser(current.UserId.Value, current.Email ?? "", roles, new Dictionary<string, object?>());
        }
        catch (Exception ex)
        {
            SsoDiagnostics.Error(step, ex);
            throw;
        }
    }

    private async Task<AuthTokens> IssueAsync(Guid userId, string email, CancellationToken cancellationToken)
    {
        var roles = await permissions.GetRolesAsync(userId, cancellationToken);
        return await IssueAsync(userId, email, roles, cancellationToken);
    }

    private async Task<AuthTokens> IssueAsync(
        Guid userId,
        string email,
        IReadOnlyList<string> roles,
        CancellationToken cancellationToken, Guid? sessionId = null, string? previousHash = null)
    {
        var step = "AUTH_ACCESS_TOKEN_CREATE";
        SsoDiagnostics.Step(step, "begin");
        try
        {
            var sid = sessionId ?? Guid.NewGuid();
            var access = tokens.CreateAccessToken(userId, email, roles, sid);
            SsoDiagnostics.Step(step);
            step = "AUTH_REFRESH_TOKEN_CREATE";
            SsoDiagnostics.Step(step, "begin");
            var refresh = tokens.CreateRefreshToken();
            SsoDiagnostics.Step(step);
            step = "AUTH_SESSION_TOKENS_STORE";
            SsoDiagnostics.Step(step, "begin", "usp_AuthCreateSessionTokens");
            var days = Math.Max(1, jwtOptions.Value.RefreshTokenDays);
            await using var conn = connections.Create();
            SsoDiagnostics.SqlTarget(conn.DataSource, conn.Database);
            try
            {
                await conn.ExecuteAsync(DbProc.Call("usp_AuthCreateSessionTokens",
                    new { userId, sessionId = sid, hash = Sha256(refresh), days, previousHash }, cancellationToken));
            }
            catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number == 51001)
            {
                SsoDiagnostics.Error(step, ex, "usp_AuthCreateSessionTokens");
                throw new SanadiException("Your session has expired.", 401, "session_expired");
            }
            SsoDiagnostics.Step(step, operation: "usp_AuthCreateSessionTokens");

            var expiresIn = Math.Max(5, jwtOptions.Value.AccessTokenMinutes) * 60;
            var expiresAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + expiresIn;
            SsoDiagnostics.Step("AUTH_SESSION_TOKENS_ISSUED");
            return new AuthTokens(access, refresh, expiresIn, expiresAt, new AuthUser(userId, email, roles, new Dictionary<string, object?>()));
        }
        catch (Exception ex)
        {
            SsoDiagnostics.Error(step, ex);
            throw;
        }
    }

    private sealed record SsoUserRow(Guid Id, string? Email, bool IsActive);

    private static string Normalize(string email) => email.Trim().ToLowerInvariant();

    private static bool VerifyPassword(string password, string stored)
    {
        try
        {
            if (stored.StartsWith("$2", StringComparison.Ordinal))
                return BCrypt.Net.BCrypt.Verify(password, stored);
        }
        catch
        {
            return false;
        }
        return false;
    }

    private static string Sha256(string value)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(bytes);
    }
}
