using System.Collections.Concurrent;
using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Sanadi.Application.Auth;
using Sanadi.Domain.Exceptions;
using Sanadi.Domain.Security;
using Sanadi.Infrastructure.Auth;
using Sanadi.Infrastructure.Options;

namespace Sanadi.Api.Tests;

public sealed class SsoServiceTests
{
    [Fact]
    public async Task Email_token_capture_is_server_only_and_failure_does_not_break_existing_login()
    {
        var capture = new CaptureTokens();
        using var fixture = new Fixture(emailTokens: capture);
        var (state, nonce) = await fixture.StartAsync();
        var completion = await fixture.Service.CompleteAsync(new(nonce, state, null, null), default);
        Assert.Equal(1,capture.Calls);
        Assert.Equal(nonce,capture.Access);
        Assert.Equal("provider-refresh",capture.Refresh);
        Assert.DoesNotContain("provider-refresh",completion.ApplicationRedirectUrl);
        Assert.Equal("student@uaeu.ac.ae",completion.Tokens.User.Email);
    }
    private sealed class CaptureTokens : ISsoEmailTokens
    {
        public int Calls;public string? Access,Refresh;
        public Task CaptureAsync(AuthTokens session,SsoSettings settings,string access,string? refresh,DateTimeOffset expires,CancellationToken ct)
        {Calls++;Access=access;Refresh=refresh;throw new InvalidOperationException("Simulated email storage outage");}
        public Task<string> GetAsync(Guid userId,CancellationToken ct)=>throw new NotSupportedException();
    }
    [Theory]
    [InlineData(null)]
    [InlineData("https://untrusted.test/logout")]
    public async Task Logout_does_not_guess_or_trust_an_unrelated_provider_endpoint(string? endpoint)
    {
        using var fixture = new Fixture();
        fixture.Provider.EndSessionEndpoint = endpoint;
        Assert.Null(await fixture.Service.LogoutRedirectAsync(default));
    }

    [Fact]
    public async Task Logout_uses_discovered_endpoint_and_new_login_requires_fresh_authentication()
    {
        using var fixture = new Fixture();
        fixture.Provider.EndSessionEndpoint = "https://idp.test/logout";
        var target = await fixture.Service.LogoutRedirectAsync(default);
        Assert.StartsWith("https://idp.test/logout?", target);
        Assert.Equal("client", Query(target!)["client_id"]);
        Assert.Equal("https://app.test/auth", Query(target!)["post_logout_redirect_uri"]);
        var login = await fixture.Service.InitiateAsync(default, forceLogin: true);
        Assert.Equal("login", Query(login.AuthorizationUrl)["prompt"]);
        Assert.Equal("0", Query(login.AuthorizationUrl)["max_age"]);
    }
    [Fact]
    public async Task Initiation_builds_provider_redirect_with_state_nonce_and_pkce()
    {
        using var fixture = new Fixture();
        var result = await fixture.Service.InitiateAsync(default);
        var query = Query(result.AuthorizationUrl);

        Assert.Equal("client", query["client_id"]);
        Assert.Equal("code", query["response_type"]);
        Assert.Contains("email", query["scope"].Split(' '), StringComparer.OrdinalIgnoreCase);
        Assert.Equal("S256", query["code_challenge_method"]);
        Assert.False(string.IsNullOrWhiteSpace(query["state"]));
        Assert.False(string.IsNullOrWhiteSpace(query["nonce"]));
        Assert.False(string.IsNullOrWhiteSpace(query["code_challenge"]));
        Assert.DoesNotContain("secret", result.AuthorizationUrl, StringComparison.OrdinalIgnoreCase);
        Assert.False(query.ContainsKey("prompt"));
    }

    [Fact]
    public async Task Restart_initiation_forces_fresh_provider_login()
    {
        using var fixture = new Fixture();

        var result = await fixture.Service.InitiateAsync(default, forceLogin: true);

        Assert.Equal("login", Query(result.AuthorizationUrl)["prompt"]);
    }

    [Fact]
    public async Task Valid_callback_uses_trusted_email_and_returns_current_sql_roles()
    {
        using var fixture = new Fixture();
        var (state, nonce) = await fixture.StartAsync();
        fixture.Provider.Emails[nonce] = "Student@UAEU.AC.AE";

        var result = await fixture.Service.CompleteAsync(new(nonce, state, null, null), default);

        Assert.Equal("student@uaeu.ac.ae", Assert.Single(fixture.Auth.SsoEmails));
        Assert.Equal(["student"], result.Tokens.User.Roles);
        Assert.StartsWith("https://app.test/auth/callback?ssoTicket=", result.ApplicationRedirectUrl);
    }

    [Fact]
    public async Task Mapped_upn_email_completes_login_without_userinfo()
    {
        using var fixture = new Fixture();
        fixture.Provider.UsernameClaim = "student";
        fixture.Provider.EmailClaimType = "upn";
        var (state, nonce) = await fixture.StartAsync();
        fixture.Provider.Emails[nonce] = "Student@uaeu.ac.ae";
        var result = await fixture.Service.CompleteAsync(new(nonce, state, null, null), default);
        Assert.Equal("student@uaeu.ac.ae", result.Tokens.User.Email);
        Assert.DoesNotContain("/userinfo", fixture.Provider.RequestPaths);
    }

    [Fact]
    public async Task Session_ticket_is_opaque_and_can_be_redeemed_only_once()
    {
        using var fixture = new Fixture();
        var (state, nonce) = await fixture.StartAsync();
        var completion = await fixture.Service.CompleteAsync(new(nonce, state, null, null), default);
        var ticket = Query(completion.ApplicationRedirectUrl)["ssoTicket"];
        Assert.Equal(43, ticket.Length);
        Assert.DoesNotContain("access", completion.ApplicationRedirectUrl);
        Assert.DoesNotContain("refresh", completion.ApplicationRedirectUrl);
        var session = await fixture.Service.RedeemSessionAsync(ticket, default);
        Assert.Equal(completion.Tokens.User.Id, session.User.Id);
        Assert.Equal(completion.Tokens.AccessToken, session.AccessToken);
        Assert.Equal(completion.Tokens.User.Roles, session.User.Roles);
        var replay = await Assert.ThrowsAsync<SanadiException>(() => fixture.Service.RedeemSessionAsync(ticket, default));
        Assert.Equal("sso_invalid_ticket", replay.Code);
    }

    [Fact]
    public async Task Concurrent_redemptions_issue_only_one_session()
    {
        using var fixture = new Fixture();
        var (state, nonce) = await fixture.StartAsync();
        var completion = await fixture.Service.CompleteAsync(new(nonce, state, null, null), default);
        var ticket = Query(completion.ApplicationRedirectUrl)["ssoTicket"];
        var outcomes = await Task.WhenAll(Enumerable.Range(0, 20).Select(async _ =>
        {
            try { await fixture.Service.RedeemSessionAsync(ticket, default); return true; }
            catch (SanadiException ex) when (ex.Code == "sso_invalid_ticket") { return false; }
        }));
        Assert.Equal(1, outcomes.Count(success => success));
    }

    [Fact]
    public async Task Expired_or_unknown_ticket_cannot_create_session()
    {
        using var fixture = new Fixture();
        var (state, nonce) = await fixture.StartAsync();
        var completion = await fixture.Service.CompleteAsync(new(nonce, state, null, null), default);
        fixture.States.ExpireAll = true;
        foreach (var ticket in new[] { Query(completion.ApplicationRedirectUrl)["ssoTicket"], new string('z', 43), "" })
        {
            var error = await Assert.ThrowsAsync<SanadiException>(() => fixture.Service.RedeemSessionAsync(ticket, default));
            Assert.Equal("sso_invalid_ticket", error.Code);
        }
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Browser_bound_ticket_requires_original_verifier(bool correctBrowser)
    {
        using var fixture = new Fixture();
        var verifier = new string('v', 43);
        var challenge = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        var start = Query((await fixture.Service.InitiateAsync(default, browserChallenge: challenge)).AuthorizationUrl);
        var completion = await fixture.Service.CompleteAsync(new(start["nonce"], start["state"], null, null), default);
        var ticket = Query(completion.ApplicationRedirectUrl)["ssoTicket"];
        if (correctBrowser)
        {
            var tokens = await fixture.Service.RedeemSessionAsync(ticket, default, verifier);
            Assert.Equal(completion.Tokens.User.Id, tokens.User.Id);
        }
        else
        {
            var error = await Assert.ThrowsAsync<SanadiException>(() => fixture.Service.RedeemSessionAsync(ticket, default, new string('x', 43)));
            Assert.Equal("sso_invalid_ticket", error.Code);
        }
    }

    [Fact]
    public async Task Failure_redirect_targets_ticket_callback_without_a_ticket()
    {
        using var fixture = new Fixture();
        Assert.Equal("https://app.test/auth/callback?ssoError=forbidden",
            await fixture.Service.FailureRedirectAsync("forbidden", default));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Validated_email_is_looked_up_in_sql_regardless_of_configured_domain(bool useUserInfo)
    {
        using var fixture = new Fixture();
        fixture.Provider.OmitTokenEmail = useUserInfo;
        var (state, nonce) = await fixture.StartAsync();
        fixture.Provider.Emails[nonce] = "Student@Example.com";

        var result = await fixture.Service.CompleteAsync(new(nonce, state, null, null), default);

        Assert.Equal("student@example.com", Assert.Single(fixture.Auth.SsoEmails));
        Assert.Equal(["student"], result.Tokens.User.Roles);
        Assert.StartsWith("https://app.test/auth/callback?ssoTicket=", result.ApplicationRedirectUrl);
    }

    [Fact]
    public async Task Different_domain_does_not_bypass_sql_account_authorization()
    {
        using var fixture = new Fixture();
        fixture.Auth.DeniedEmails.Add("unknown@example.com");
        var (state, nonce) = await fixture.StartAsync();
        fixture.Provider.Emails[nonce] = "unknown@example.com";

        var ex = await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.Service.CompleteAsync(new(nonce, state, null, null), default));

        Assert.Equal("forbidden", ex.Code);
    }

    [Fact]
    public async Task Missing_token_email_uses_matching_userinfo_identity()
    {
        using var fixture = new Fixture();
        fixture.Provider.OmitTokenEmail = true;
        var (state, nonce) = await fixture.StartAsync();
        fixture.Provider.Emails[nonce] = "Student@uaeu.ac.ae";

        var result = await fixture.Service.CompleteAsync(new(nonce, state, null, null), default);

        Assert.Equal("student@uaeu.ac.ae", result.Tokens.User.Email);
        Assert.Contains("/userinfo", fixture.Provider.RequestPaths);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Username_only_provider_resolves_account_using_configured_domain(bool inIdToken)
    {
        using var fixture = new Fixture();
        fixture.Provider.OmitTokenEmail = true;
        fixture.Provider.OmitUserInfoEmail = true;
        fixture.Provider.TokenUsername = inIdToken ? "Vivek.Sharma" : null;
        fixture.Provider.UserInfoUsername = "vivek.sharma";
        var (state, nonce) = await fixture.StartAsync();

        var result = await fixture.Service.CompleteAsync(new(nonce, state, null, null), default);

        Assert.Equal("vivek.sharma@uaeu.ac.ae", Assert.Single(fixture.Auth.SsoEmails));
        Assert.Equal("vivek.sharma@uaeu.ac.ae", result.Tokens.User.Email);
        Assert.Contains("/userinfo", fixture.Provider.RequestPaths);
    }

    [Fact]
    public async Task Username_fallback_still_requires_sql_account_authorization()
    {
        using var fixture = new Fixture();
        fixture.Provider.OmitTokenEmail = true;
        fixture.Provider.OmitUserInfoEmail = true;
        fixture.Provider.TokenUsername = "unregistered";
        fixture.Auth.DeniedEmails.Add("unregistered@uaeu.ac.ae");
        var (state, nonce) = await fixture.StartAsync();

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.Service.CompleteAsync(new(nonce, state, null, null), default));
        Assert.Empty(fixture.Auth.SsoEmails);
    }

    [Theory]
    [InlineData(null, "uaeu.ac.ae")]
    [InlineData("Vivek Sharma", "uaeu.ac.ae")]
    [InlineData("vivek.sharma@other.test", "uaeu.ac.ae")]
    [InlineData("UAEU\\vivek.sharma", "uaeu.ac.ae")]
    [InlineData("vivek..sharma", "uaeu.ac.ae")]
    [InlineData("vivek.sharma", null)]
    [InlineData("vivek.sharma", "")]
    [InlineData("vivek.sharma", "https://uaeu.ac.ae")]
    [InlineData("vivek.sharma", "@uaeu.ac.ae")]
    public async Task Username_fallback_rejects_missing_or_malformed_mapping(string? username, string? domain)
    {
        using var fixture = new Fixture(domain);
        fixture.Provider.OmitTokenEmail = true;
        fixture.Provider.OmitUserInfoEmail = true;
        fixture.Provider.TokenUsername = username;
        fixture.Provider.UserInfoName = "Vivek Sharma";
        var (state, nonce) = await fixture.StartAsync();

        var error = await Assert.ThrowsAsync<SanadiException>(() =>
            fixture.Service.CompleteAsync(new(nonce, state, null, null), default));
        Assert.Equal("sso_invalid_identity", error.Code);
        Assert.Empty(fixture.Auth.SsoEmails);
    }

    [Theory]
    [InlineData("different-subject", "vivek.sharma")]
    [InlineData(null, "vivek.sharma")]
    [InlineData("student-subject", "another.user")]
    public async Task Username_fallback_rejects_mismatched_userinfo(string? subject, string username)
    {
        using var fixture = new Fixture();
        fixture.Provider.OmitTokenEmail = true;
        fixture.Provider.OmitUserInfoEmail = true;
        fixture.Provider.TokenUsername = "vivek.sharma";
        fixture.Provider.UserInfoUsername = username;
        fixture.Provider.UserInfoSubject = subject;
        var (state, nonce) = await fixture.StartAsync();

        var error = await Assert.ThrowsAsync<SanadiException>(() =>
            fixture.Service.CompleteAsync(new(nonce, state, null, null), default));
        Assert.Equal("sso_invalid_identity", error.Code);
        Assert.Empty(fixture.Auth.SsoEmails);
    }

    [Fact]
    public async Task Validated_email_takes_precedence_over_username_mapping()
    {
        using var fixture = new Fixture();
        fixture.Provider.TokenUsername = "vivek.sharma";
        var (state, nonce) = await fixture.StartAsync();
        fixture.Provider.Emails[nonce] = "registered@example.com";

        var result = await fixture.Service.CompleteAsync(new(nonce, state, null, null), default);

        Assert.Equal("registered@example.com", result.Tokens.User.Email);
    }

    [Fact]
    public async Task Sso_username_claim_is_passed_to_account_validation()
    {
        using var fixture = new Fixture();
        fixture.Provider.UsernameClaim = "vivek.sharma";
        var (state, nonce) = await fixture.StartAsync();
        fixture.Provider.Emails[nonce] = "student@uaeu.ac.ae";

        await fixture.Service.CompleteAsync(new(nonce, state, null, null), default);

        Assert.Equal("vivek.sharma", Assert.Single(fixture.Auth.SsoNames));
    }

    [Fact]
    public async Task Missing_token_name_uses_name_from_matching_userinfo_identity()
    {
        using var fixture = new Fixture();
        fixture.Provider.UserInfoName = "Vivek Sharma";
        var (state, nonce) = await fixture.StartAsync();
        fixture.Provider.Emails[nonce] = "student@uaeu.ac.ae";

        await fixture.Service.CompleteAsync(new(nonce, state, null, null), default);

        Assert.Equal("Vivek Sharma", Assert.Single(fixture.Auth.SsoNames));
        Assert.Contains("/userinfo", fixture.Provider.RequestPaths);
    }

    [Theory]
    [InlineData("different-user", "student@uaeu.ac.ae")]
    [InlineData(null, "student@uaeu.ac.ae")]
    [InlineData("student-subject", "700013884")]
    public async Task Userinfo_fallback_rejects_mismatched_subject_or_invalid_email(string? subject, string email)
    {
        using var fixture = new Fixture();
        fixture.Provider.OmitTokenEmail = true;
        fixture.Provider.UserInfoSubject = subject;
        var (state, nonce) = await fixture.StartAsync();
        fixture.Provider.Emails[nonce] = email;

        var ex = await Assert.ThrowsAsync<SanadiException>(() =>
            fixture.Service.CompleteAsync(new(nonce, state, null, null), default));

        Assert.Equal("sso_invalid_identity", ex.Code);
        Assert.Empty(fixture.Auth.SsoEmails);
    }

    [Fact]
    public async Task Valid_callback_does_not_revalidate_the_authenticated_identity()
    {
        using var fixture = new Fixture();
        fixture.Provider.UsernameClaim = "student";
        var (state, nonce) = await fixture.StartAsync();
        fixture.Provider.Emails[nonce] = "student@uaeu.ac.ae";

        await fixture.Service.CompleteAsync(new(nonce, state, null, null), default);

        Assert.DoesNotContain("/introspect", fixture.Provider.RequestPaths);
        Assert.DoesNotContain("/userinfo", fixture.Provider.RequestPaths);
    }

    [Fact]
    public async Task Invalid_or_replayed_state_is_denied()
    {
        using var fixture = new Fixture();
        var ex = await Assert.ThrowsAsync<SanadiException>(() =>
            fixture.Service.CompleteAsync(new("code", "unknown", null, null), default));
        Assert.Equal("sso_invalid_state", ex.Code);

        var (state, nonce) = await fixture.StartAsync();
        fixture.Provider.Emails[nonce] = "student@uaeu.ac.ae";
        await fixture.Service.CompleteAsync(new(nonce, state, null, null), default);
        var replay = await Assert.ThrowsAsync<SanadiException>(() =>
            fixture.Service.CompleteAsync(new(nonce, state, null, null), default));
        Assert.Equal("sso_invalid_state", replay.Code);
    }

    [Fact]
    public async Task Expired_state_is_distinct_from_unknown_or_replayed_state()
    {
        using var fixture = new Fixture();
        var (state, nonce) = await fixture.StartAsync();
        fixture.States.ExpireAll = true;

        var ex = await Assert.ThrowsAsync<SanadiException>(() =>
            fixture.Service.CompleteAsync(new(nonce, state, null, null), default));
        Assert.Equal("sso_expired", ex.Code);
        var replay = await Assert.ThrowsAsync<SanadiException>(() =>
            fixture.Service.CompleteAsync(new(nonce, state, null, null), default));
        Assert.Equal("sso_invalid_state", replay.Code);
    }

    [Theory]
    [InlineData("login_required", "sso_expired")]
    [InlineData("access_denied", "sso_provider_error")]
    public async Task Provider_session_expiry_is_distinct_from_other_errors(string error, string expected)
    {
        using var fixture = new Fixture();
        var (state, _) = await fixture.StartAsync();
        var ex = await Assert.ThrowsAsync<SanadiException>(() =>
            fixture.Service.CompleteAsync(new(null, state, error, null), default));
        Assert.Equal(expected, ex.Code);
    }

    [Fact]
    public async Task Expired_identity_token_is_reported_as_expiry()
    {
        using var fixture = new Fixture();
        var (state, nonce) = await fixture.StartAsync();
        fixture.Provider.ExpiredToken = true;
        var ex = await Assert.ThrowsAsync<SanadiException>(() =>
            fixture.Service.CompleteAsync(new(nonce, state, null, null), default));
        Assert.Equal("sso_expired", ex.Code);
    }

    [Fact]
    public async Task Invalid_nonce_is_denied()
    {
        using var fixture = new Fixture();
        var (state, _) = await fixture.StartAsync();
        fixture.Provider.Emails["different-nonce"] = "student@uaeu.ac.ae";

        var ex = await Assert.ThrowsAsync<SanadiException>(() =>
            fixture.Service.CompleteAsync(new("different-nonce", state, null, null), default));
        Assert.Equal("sso_invalid_nonce", ex.Code);
    }

    [Fact]
    public async Task Invalid_or_expired_authorization_code_is_denied()
    {
        using var fixture = new Fixture();
        var (state, _) = await fixture.StartAsync();

        var ex = await Assert.ThrowsAsync<SanadiException>(() =>
            fixture.Service.CompleteAsync(new("expired-code", state, null, null), default));
        Assert.Equal("sso_invalid_code", ex.Code);
    }

    [Theory]
    [InlineData("unknown@uaeu.ac.ae")]
    [InlineData("inactive@uaeu.ac.ae")]
    public async Task Unknown_or_inactive_sql_user_is_denied(string email)
    {
        using var fixture = new Fixture();
        fixture.Auth.DeniedEmails.Add(email);
        var (state, nonce) = await fixture.StartAsync();
        fixture.Provider.Emails[nonce] = email;

        var ex = await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.Service.CompleteAsync(new(nonce, state, null, null), default));
        Assert.Equal("forbidden", ex.Code);
    }

    [Fact]
    public async Task One_thousand_concurrent_flows_have_no_state_or_identity_collisions()
    {
        using var fixture = new Fixture();
        const int count = 1000;
        var starts = await Task.WhenAll(Enumerable.Range(0, count).Select(async i =>
        {
            var (state, nonce) = await fixture.StartAsync();
            fixture.Provider.Emails[nonce] = $"user{i}@uaeu.ac.ae";
            return (state, nonce);
        }));

        Assert.Equal(count, starts.Select(x => x.state).Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(count, starts.Select(x => x.nonce).Distinct(StringComparer.Ordinal).Count());

        await Task.WhenAll(starts.Select(x =>
            fixture.Service.CompleteAsync(new(x.nonce, x.state, null, null), default)));

        Assert.Equal(count, fixture.Auth.SsoEmails.Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(count, fixture.Auth.SsoEmails.Count);
    }

    private sealed class Fixture : IDisposable
    {
        public FakeProvider Provider { get; } = new();
        public FakeAuthService Auth { get; } = new();
        public MemoryStateStore States { get; } = new();
        public SsoService Service { get; }

        public Fixture(string? accountDomain = "uaeu.ac.ae", ISsoEmailTokens? emailTokens = null)
        {
            var settings = new SsoSettings(
                true,
                "client",
                "secret",
                "https://idp.test/authorize",
                "https://idp.test/token",
                "https://idp.test/userinfo",
                "https://idp.test/introspect",
                "https://api.test/api/v1/auth/sso/callback",
                "openid profile",
                "https://app.test",
                accountDomain);
            Service = new SsoService(
                new FakeSettingsProvider(settings),
                States,
                Auth,
                Provider,
                Options.Create(new JwtOptions { SigningKey = new string('k', 48) }),
                TimeProvider.System, emailTokens);
        }

        public async Task<(string state, string nonce)> StartAsync()
        {
            var start = await Service.InitiateAsync(default);
            var query = Query(start.AuthorizationUrl);
            return (query["state"], query["nonce"]);
        }

        public void Dispose() => Provider.Dispose();
    }

    private sealed class FakeSettingsProvider(SsoSettings settings) : ISsoSettingsProvider
    {
        public Task<SsoSettings> GetAsync(CancellationToken cancellationToken) => Task.FromResult(settings);
    }

    private sealed class MemoryStateStore : ISsoStateStore
    {
        public bool ExpireAll { get; set; }
        private readonly ConcurrentDictionary<string, (string context, DateTimeOffset expires)> _states = new();

        public Task StoreAsync(string stateHash, string protectedContext, DateTimeOffset expiresAt, CancellationToken cancellationToken)
        {
            if (!_states.TryAdd(stateHash, (protectedContext, expiresAt)))
                throw new InvalidOperationException("Duplicate state");
            return Task.CompletedTask;
        }

        public Task<string?> ConsumeAsync(string stateHash, DateTimeOffset now, CancellationToken cancellationToken)
        {
            if (!_states.TryRemove(stateHash, out var value))
                return Task.FromResult<string?>(null);
            if (ExpireAll || value.expires < now) return Task.FromResult<string?>("sso_expired");
            return Task.FromResult<string?>(value.context);
        }
    }

    private sealed class FakeAuthService : IAuthService
    {
        public ConcurrentBag<string> SsoEmails { get; } = [];
        public ConcurrentBag<string?> SsoNames { get; } = [];
        public HashSet<string> DeniedEmails { get; } = new(StringComparer.OrdinalIgnoreCase);

        public Task<AuthTokens> LoginWithSsoAsync(SsoLoginRequest request, CancellationToken cancellationToken)
        {
            if (DeniedEmails.Contains(request.Email)) throw new ForbiddenException();
            SsoEmails.Add(request.Email);
            SsoNames.Add(request.Name);
            return Task.FromResult(new AuthTokens(
                "access", "refresh", 3600, 1,
                new AuthUser(Guid.NewGuid(), request.Email, [AppRoles.Student], new Dictionary<string, object?>())));
        }

        public Task<AuthTokens> LoginAsync(LoginRequest request, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<AuthTokens> SignUpAsync(SignUpRequest request, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<AuthTokens> RefreshAsync(RefreshRequest request, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task SignOutAsync(string refreshToken, CancellationToken cancellationToken, string? accessToken = null) => throw new NotSupportedException();
        public Task<AuthUser> GetUserAsync(ICurrentUser current, CancellationToken cancellationToken) => throw new NotSupportedException();
    }

    private sealed class FakeProvider : IHttpClientFactory, IDisposable
    {
        private readonly RSA _rsa = RSA.Create(2048);
        private readonly HttpClient _client;
        public ConcurrentDictionary<string, string> Emails { get; } = new(StringComparer.Ordinal);
        public ConcurrentBag<string> RequestPaths { get; } = [];
        public bool ExpiredToken { get; set; }
        public bool OmitTokenEmail { get; set; }
        public bool OmitUserInfoEmail { get; set; }
        public string? TokenUsername { get; set; }
        public string? UserInfoUsername { get; set; }
        public string? UsernameClaim { get; set; }
        public string? UserInfoName { get; set; }
        public string EmailClaimType { get; set; } = "email";
        public string? UserInfoSubject { get; set; } = "student-subject";
        public string? EndSessionEndpoint { get; set; }

        public FakeProvider() => _client = new HttpClient(new Handler(this));
        public HttpClient CreateClient(string name) => _client;

        private string Token(string nonce, string email)
        {
            var key = new RsaSecurityKey(_rsa) { KeyId = "test-key" };
            var claims = new List<Claim>
            {
                new("nonce", nonce),
                new("sub", "student-subject"),
                new(OmitTokenEmail ? "preferred_username" : EmailClaimType, OmitTokenEmail ? "700013884" : email),
            };
            if (!string.IsNullOrWhiteSpace(UsernameClaim)) claims.Add(new Claim("preferred_username", UsernameClaim));
            if (TokenUsername is not null) claims.Add(new Claim("username", TokenUsername));
            var token = new JwtSecurityToken(
                "https://idp.test",
                "client",
                claims,
                DateTime.UtcNow.AddMinutes(-10),
                DateTime.UtcNow.AddMinutes(ExpiredToken ? -5 : 5),
                new SigningCredentials(key, SecurityAlgorithms.RsaSha256));
            return new JwtSecurityTokenHandler().WriteToken(token);
        }

        private string Jwks()
        {
            var parameters = _rsa.ExportParameters(false);
            return JsonSerializer.Serialize(new
            {
                keys = new[]
                {
                    new
                    {
                        kty = "RSA", use = "sig", alg = "RS256", kid = "test-key",
                        n = Base64Url(parameters.Modulus!), e = Base64Url(parameters.Exponent!)
                    }
                }
            });
        }

        public void Dispose()
        {
            _client.Dispose();
            _rsa.Dispose();
        }

        private sealed class Handler(FakeProvider owner) : HttpMessageHandler
        {
            protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            {
                var path = request.RequestUri!.AbsolutePath;
                owner.RequestPaths.Add(path);
                if (path == "/token")
                {
                    var form = ParseForm(await request.Content!.ReadAsStringAsync(cancellationToken));
                    var code = form["code"];
                    if (code == "expired-code") return Json(HttpStatusCode.BadRequest, new { error = "invalid_grant" });
                    var email = owner.Emails.GetValueOrDefault(code, "student@uaeu.ac.ae");
                    return Json(HttpStatusCode.OK, new { access_token = code, id_token = owner.Token(code, email), refresh_token="provider-refresh",expires_in=3600,token_type="Bearer" });
                }
                if (path == "/introspect") return Json(HttpStatusCode.OK, new { active = true });
                if (path == "/userinfo")
                {
                    var code = request.Headers.Authorization?.Parameter ?? "";
                    return Json(HttpStatusCode.OK, new
                    {
                        sub = owner.UserInfoSubject,
                        email = owner.OmitUserInfoEmail ? null : owner.Emails.GetValueOrDefault(code, "student@uaeu.ac.ae"),
                        name = owner.UserInfoName,
                        username = owner.UserInfoUsername
                    });
                }
                if (path.EndsWith("/.well-known/openid-configuration", StringComparison.Ordinal))
                    return Json(HttpStatusCode.OK, new { issuer = "https://idp.test", jwks_uri = "https://idp.test/jwks", end_session_endpoint = owner.EndSessionEndpoint });
                if (path == "/jwks") return Json(HttpStatusCode.OK, JsonDocument.Parse(owner.Jwks()).RootElement);
                return new HttpResponseMessage(HttpStatusCode.NotFound);
            }
        }
    }

    private static HttpResponseMessage Json(HttpStatusCode status, object value) => new(status)
    {
        Content = new StringContent(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json")
    };

    private static Dictionary<string, string> ParseForm(string form) => form.Split('&')
        .Select(part => part.Split('=', 2))
        .ToDictionary(part => Uri.UnescapeDataString(part[0]), part => Uri.UnescapeDataString(part[1].Replace('+', ' ')));

    private static Dictionary<string, string> Query(string url) => new Uri(url).Query.TrimStart('?').Split('&')
        .Select(part => part.Split('=', 2))
        .ToDictionary(part => Uri.UnescapeDataString(part[0]), part => Uri.UnescapeDataString(part[1]));

    private static string Base64Url(byte[] value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
