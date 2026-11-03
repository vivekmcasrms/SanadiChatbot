namespace Sanadi.Application.Auth;

public sealed record SsoSettings(
    bool IsEnabled,
    string ClientId,
    string ClientSecret,
    string AuthorizationEndpoint,
    string TokenEndpoint,
    string? UserInfoEndpoint,
    string? IntrospectEndpoint,
    string RedirectUri,
    string Scope,
    string UiOrigin,
    string? RequiredEmailDomain);

public sealed record SsoInitiation(string AuthorizationUrl);

public sealed record SsoCallbackRequest(
    string? Code,
    string? State,
    string? Error,
    string? ErrorDescription);

public sealed record SsoCompletion(AuthTokens Tokens, string ApplicationRedirectUrl);

public interface ISsoSettingsProvider
{
    Task<SsoSettings> GetAsync(CancellationToken cancellationToken);
}

public interface ISsoStateStore
{
    Task StoreAsync(string stateHash, string protectedContext, DateTimeOffset expiresAt, CancellationToken cancellationToken);
    Task<string?> ConsumeAsync(string stateHash, DateTimeOffset now, CancellationToken cancellationToken);
}

public interface ISsoService
{
    Task<SsoInitiation> InitiateAsync(CancellationToken cancellationToken, bool forceLogin = false, string? browserChallenge = null);
    Task<SsoCompletion> CompleteAsync(SsoCallbackRequest request, CancellationToken cancellationToken);
    Task<AuthTokens> RedeemSessionAsync(string ticket, CancellationToken cancellationToken, string? verifier = null);
    Task<string> FailureRedirectAsync(string errorCode, CancellationToken cancellationToken);
    Task<string?> LogoutRedirectAsync(CancellationToken cancellationToken) => Task.FromResult<string?>(null);
}
