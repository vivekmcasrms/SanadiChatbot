using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Sanadi.Application.Auth;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Options;

namespace Sanadi.Infrastructure.Auth;

public sealed class SsoEmailTokens(ISsoEmailTokenStore store, ISsoSettingsProvider settingsProvider,
    IHttpClientFactory clients, IOptions<JwtOptions> jwt, TimeProvider clock,
    ILogger<SsoEmailTokens> logger) : ISsoEmailTokens
{
    private sealed class Grant
    {
        public string AccessToken { get; set; } = "";
        public string? RefreshToken { get; set; }
        public DateTimeOffset ExpiresAt { get; set; }
        public string TokenEndpoint { get; set; } = "";
        public string ClientId { get; set; } = "";
    }
    public async Task CaptureAsync(AuthTokens session, SsoSettings settings, string accessToken,
        string? refreshToken, DateTimeOffset expiresAt, CancellationToken ct)
    {
        var local = new JwtSecurityTokenHandler().ReadJwtToken(session.AccessToken);
        if (!Guid.TryParse(local.Claims.FirstOrDefault(c => c.Type == "sid")?.Value, out var sid) ||
            !Guid.TryParse(local.Subject, out var subject) || subject != session.User.Id || string.IsNullOrWhiteSpace(accessToken))
            throw Unavailable("sso_email_session_missing");
        await store.StoreAsync(subject, sid, Protect(new Grant
        {
            AccessToken = accessToken, RefreshToken = refreshToken, ExpiresAt = expiresAt,
            ClientId = settings.ClientId, TokenEndpoint = settings.TokenEndpoint
        }, subject, sid), ct);
    }
    public async Task<string> GetAsync(Guid actorId, CancellationToken ct)
    {
        // Never borrow a different user's grant. SQL also checks logout and local session expiry.
        var lease = await store.AcquireAsync(actorId, ct) ?? throw Unavailable("sso_email_token_unavailable");
        try
        {
            var settings = await settingsProvider.GetAsync(ct);
            var grant = Unprotect(lease.ProtectedTokens, actorId, lease.SessionId);
            if (!settings.IsEnabled || grant.ClientId != settings.ClientId || grant.TokenEndpoint != settings.TokenEndpoint)
                throw Unavailable("sso_email_configuration_changed");
            if (grant.ExpiresAt > clock.GetUtcNow().AddSeconds(30)) return grant.AccessToken;
            if (string.IsNullOrWhiteSpace(grant.RefreshToken)) throw Unavailable("sso_email_refresh_token_missing");
            if (!Uri.TryCreate(settings.TokenEndpoint, UriKind.Absolute, out var endpoint) ||
                endpoint.Scheme != "https" || endpoint.UserInfo.Length != 0 || endpoint.Fragment.Length != 0)
                throw Unavailable("sso_email_configuration_invalid");
            using var response = await SsoTokenRequests.PostAsync(clients.CreateClient("SsoEmailToken"),
                settings.TokenEndpoint, settings, new Dictionary<string, string>
                { ["grant_type"] = "refresh_token", ["refresh_token"] = grant.RefreshToken },
                "sso_email_refresh_failed", "Email authorization could not be refreshed.", ct);
            var root = response.RootElement;
            var access = Text(root, "access_token");
            var expires = Expiry(root, clock.GetUtcNow());
            if (string.IsNullOrWhiteSpace(access) || expires <= clock.GetUtcNow().AddSeconds(30) ||
                !string.Equals(Text(root, "token_type"), "Bearer", StringComparison.OrdinalIgnoreCase))
                throw Unavailable("sso_email_refresh_response_invalid");
            grant.AccessToken = access;
            grant.RefreshToken = Text(root, "refresh_token") ?? grant.RefreshToken;
            grant.ExpiresAt = expires;
            await store.SaveAsync(actorId, lease.SessionId, lease.LeaseId, Protect(grant, actorId, lease.SessionId), ct);
            return access;
        }
        catch (SanadiException) { throw; }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch { throw Unavailable("sso_email_token_unavailable"); }
        finally
        {
            try { await store.ReleaseAsync(actorId, lease.SessionId, lease.LeaseId, CancellationToken.None); }
            catch { logger.LogWarning("Email token lease release failed; its lease will expire automatically."); }
        }
    }
    public static DateTimeOffset Expiry(JsonElement root, DateTimeOffset now)
    {
        if (root.TryGetProperty("expires_in", out var value) && value.ValueKind == JsonValueKind.Number &&
            value.TryGetInt64(out var seconds) && seconds > 0 && seconds <= 366 * 24 * 60 * 60) return now.AddSeconds(seconds);
        // Do not invent an expiry for opaque tokens.
        return now;
    }
    private static string? Text(JsonElement root, string key) => root.TryGetProperty(key, out var value) &&
        value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(value.GetString()) ? value.GetString() : null;
    private byte[] Key()
    {
        if (string.IsNullOrWhiteSpace(jwt.Value.SigningKey) || jwt.Value.SigningKey.Length < 32)
            throw Unavailable("sso_email_encryption_unavailable");
        return SHA256.HashData(Encoding.UTF8.GetBytes("Sanadi.SsoEmailTokens.v1|" + jwt.Value.SigningKey));
    }
    private static byte[] Context(Guid user, Guid session) => Encoding.UTF8.GetBytes($"{user:D}|{session:D}");
    private string Protect(Grant grant, Guid user, Guid session)
    {
        var plain = JsonSerializer.SerializeToUtf8Bytes(grant);
        try
        {
            var bytes = new byte[29 + plain.Length]; bytes[0] = 1;
            RandomNumberGenerator.Fill(bytes.AsSpan(1, 12));
            using var aes = new AesGcm(Key(), 16);
            aes.Encrypt(bytes.AsSpan(1, 12), plain, bytes.AsSpan(29), bytes.AsSpan(13, 16), Context(user, session));
            return Convert.ToBase64String(bytes);
        }
        finally { CryptographicOperations.ZeroMemory(plain); }
    }
    private Grant Unprotect(string value, Guid user, Guid session)
    {
        var bytes = Convert.FromBase64String(value);
        if (bytes.Length < 30 || bytes[0] != 1) throw Unavailable("sso_email_token_invalid");
        var plain = new byte[bytes.Length - 29];
        try
        {
            using var aes = new AesGcm(Key(), 16);
            aes.Decrypt(bytes.AsSpan(1, 12), bytes.AsSpan(29), bytes.AsSpan(13, 16), plain, Context(user, session));
            return JsonSerializer.Deserialize<Grant>(plain) ?? throw Unavailable("sso_email_token_invalid");
        }
        finally { CryptographicOperations.ZeroMemory(plain); }
    }
    private static SanadiException Unavailable(string code) => new("Email authorization is unavailable for this session.", 503, code);
}
