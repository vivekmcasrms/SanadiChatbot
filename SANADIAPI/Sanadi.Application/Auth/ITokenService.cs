using Sanadi.Domain.Security;

namespace Sanadi.Application.Auth;

public interface ITokenService
{
    string CreateAccessToken(Guid userId, string email, IReadOnlyList<string> roles, Guid? sessionId = null);
    string CreateRefreshToken();
    Guid? ValidateAccessToken(string token, out IReadOnlyList<string> roles, out string? email);
}
