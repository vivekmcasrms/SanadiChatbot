using Sanadi.Domain.Security;

namespace Sanadi.Application.Auth;

public sealed record LoginRequest(string Email, string Password);

public sealed record SignUpRequest(string Email, string Password, string? FullName, string? PreferredLanguage);

public sealed record RefreshRequest(string RefreshToken);

public sealed record SsoLoginRequest(string Email, string? Name);

public sealed record AuthTokens(
    string AccessToken,
    string RefreshToken,
    int ExpiresIn,
    long ExpiresAt,
    AuthUser User);

public sealed record AuthUser(
    Guid Id,
    string Email,
    IReadOnlyList<string> Roles,
    IReadOnlyDictionary<string, object?> UserMetadata);

public interface IAuthService
{
    Task<AuthTokens> LoginAsync(LoginRequest request, CancellationToken cancellationToken);
    Task<AuthTokens> SignUpAsync(SignUpRequest request, CancellationToken cancellationToken);
    Task<AuthTokens> RefreshAsync(RefreshRequest request, CancellationToken cancellationToken);
    Task<AuthTokens> LoginWithSsoAsync(SsoLoginRequest request, CancellationToken cancellationToken);
    Task SignOutAsync(string refreshToken, CancellationToken cancellationToken, string? accessToken = null);
    Task<AuthUser> GetUserAsync(ICurrentUser current, CancellationToken cancellationToken);
}
