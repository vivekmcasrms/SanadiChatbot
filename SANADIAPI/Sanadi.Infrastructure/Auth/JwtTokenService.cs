using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Sanadi.Application.Auth;
using Sanadi.Domain.Security;
using Sanadi.Infrastructure.Options;

namespace Sanadi.Infrastructure.Auth;

public sealed class JwtTokenService(IOptions<JwtOptions> options) : ITokenService
{
    public string CreateAccessToken(Guid userId, string email, IReadOnlyList<string> roles, Guid? sessionId = null)
    {
        var cfg = options.Value;
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(RequireKey(cfg.SigningKey)));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new(ClaimTypes.NameIdentifier, userId.ToString()),
            new(SanadiClaims.LoginId, userId.ToString()),
            new(JwtRegisteredClaimNames.Email, email),
            new("email", email),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };
        if (sessionId.HasValue) claims.Add(new Claim("sid", sessionId.Value.ToString()));
        foreach (var role in roles)
            claims.Add(new Claim(ClaimTypes.Role, role));
        foreach (var role in roles)
            claims.Add(new Claim(SanadiClaims.Role, role));

        var token = new JwtSecurityToken(
            issuer: cfg.Issuer,
            audience: cfg.Audience,
            claims: claims,
            notBefore: DateTime.UtcNow,
            expires: DateTime.UtcNow.AddMinutes(Math.Max(5, cfg.AccessTokenMinutes)),
            signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public string CreateRefreshToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(48);
        return Convert.ToBase64String(bytes);
    }

    public Guid? ValidateAccessToken(string token, out IReadOnlyList<string> roles, out string? email)
    {
        roles = [];
        email = null;
        var cfg = options.Value;
        var handler = new JwtSecurityTokenHandler();
        try
        {
            var principal = handler.ValidateToken(token, new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidIssuer = cfg.Issuer,
                ValidateAudience = true,
                ValidAudience = cfg.Audience,
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(RequireKey(cfg.SigningKey))),
                ValidateLifetime = true,
                ClockSkew = TimeSpan.FromMinutes(1)
            }, out _);
            var sub = principal.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                      ?? principal.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            email = principal.FindFirst(JwtRegisteredClaimNames.Email)?.Value
                    ?? principal.FindFirst("email")?.Value
                    ?? principal.FindFirst(ClaimTypes.Email)?.Value;
            roles = principal.FindAll(ClaimTypes.Role).Select(c => c.Value)
                .Concat(principal.FindAll(SanadiClaims.Role).Select(c => c.Value))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            return Guid.TryParse(sub, out var id) ? id : null;
        }
        catch
        {
            return null;
        }
    }

    private static string RequireKey(string key)
    {
        if (string.IsNullOrWhiteSpace(key) || key.Length < 32)
            throw new InvalidOperationException("Jwt:SigningKey must be at least 32 characters.");
        return key;
    }
}
