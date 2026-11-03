namespace Sanadi.Infrastructure.Auth;

/// <summary>The opaque 48-byte random value issued by JwtTokenService, encoded as Base64.</summary>
public static class RefreshTokenFormat
{
    public static bool IsValid(string? value) => value is { Length: 64 } &&
        value.All(c => char.IsAsciiLetterOrDigit(c) || c is '+' or '/');
}
