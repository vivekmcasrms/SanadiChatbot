using System.Reflection;
using Microsoft.Extensions.Options;
using Sanadi.Application.Auth;
using Sanadi.Domain.Security;
using Sanadi.Infrastructure.Auth;
using Sanadi.Infrastructure.Options;

namespace Sanadi.Api.Tests;

public sealed class JwtAuthorizationTests
{
    [Fact]
    public void Access_tokens_are_bound_to_the_login_session_for_revocation()
    {
        var sessionId = Guid.NewGuid();
        var token = TokenService().CreateAccessToken(Guid.NewGuid(), "user@uaeu.ac.ae", [AppRoles.Student], sessionId);
        var jwt = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().ReadJwtToken(token);
        Assert.Equal(sessionId.ToString(), jwt.Claims.Single(c => c.Type == "sid").Value);
    }
    [Theory]
    [InlineData(AppRoles.Student)]
    [InlineData(AppRoles.ServiceOfficer)]
    [InlineData(AppRoles.SystemAdmin)]
    public void Application_jwt_contains_only_the_roles_resolved_by_the_server(string role)
    {
        var service = TokenService();
        var token = service.CreateAccessToken(Guid.NewGuid(), "user@uaeu.ac.ae", [role]);

        var userId = service.ValidateAccessToken(token, out var roles, out var email);

        Assert.NotNull(userId);
        Assert.Equal("user@uaeu.ac.ae", email);
        Assert.Contains(role, roles);
        Assert.DoesNotContain(roles, value => !string.Equals(value, role, StringComparison.Ordinal));
    }

    [Fact]
    public void Invalid_token_is_unauthorized()
    {
        var userId = TokenService().ValidateAccessToken("not-a-jwt", out var roles, out var email);
        Assert.Null(userId);
        Assert.Empty(roles);
        Assert.Null(email);
    }

    [Fact]
    public void Callback_contract_does_not_accept_frontend_identity_role_permission_or_ownership()
    {
        var names = typeof(SsoCallbackRequest).GetProperties(BindingFlags.Instance | BindingFlags.Public)
            .Select(property => property.Name)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        Assert.Equal(4, names.Count);
        Assert.Contains("Code", names);
        Assert.Contains("State", names);
        Assert.DoesNotContain("Email", names);
        Assert.DoesNotContain("UserId", names);
        Assert.DoesNotContain("Role", names);
        Assert.DoesNotContain("Permissions", names);
        Assert.DoesNotContain("OwnerId", names);
    }

    private static JwtTokenService TokenService() => new(Options.Create(new JwtOptions
    {
        Issuer = "tests",
        Audience = "tests",
        SigningKey = new string('s', 48),
        AccessTokenMinutes = 5
    }));
}
