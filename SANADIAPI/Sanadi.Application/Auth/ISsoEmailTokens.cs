namespace Sanadi.Application.Auth;

// Server-only delegated tokens; never include them in AuthTokens or API responses.
public interface ISsoEmailTokens
{
    Task CaptureAsync(AuthTokens session, SsoSettings settings, string accessToken,
        string? refreshToken, DateTimeOffset expiresAt, CancellationToken ct);
    Task<string> GetAsync(Guid actorId, CancellationToken ct);
}

public sealed record SsoEmailTokenLease(Guid SessionId, Guid LeaseId, string ProtectedTokens);

public interface ISsoEmailTokenStore
{
    Task StoreAsync(Guid userId, Guid sessionId, string protectedTokens, CancellationToken ct);
    Task<SsoEmailTokenLease?> AcquireAsync(Guid userId, CancellationToken ct);
    Task SaveAsync(Guid userId, Guid sessionId, Guid leaseId, string protectedTokens, CancellationToken ct);
    Task ReleaseAsync(Guid userId, Guid sessionId, Guid leaseId, CancellationToken ct);
}
