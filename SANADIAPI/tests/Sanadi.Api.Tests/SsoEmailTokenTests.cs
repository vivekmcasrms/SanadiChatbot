using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Sanadi.Application.Auth;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Auth;
using Sanadi.Infrastructure.Options;

namespace Sanadi.Api.Tests;

public sealed class SsoEmailTokenTests
{
    private static readonly Guid User = Guid.NewGuid(), Session = Guid.NewGuid();
    private static readonly SsoSettings Settings = new(true,"configured-client","configured-secret",
        "https://idp.test/authorize","https://idp.test/token",null,null,"https://api.test/callback","openid profile","https://app.test",null);

    [Fact]
    public async Task Valid_login_token_is_encrypted_and_reused_without_another_provider_call()
    {
        using var f = new Fixture();
        await f.Capture("provider-access", "provider-refresh", DateTimeOffset.UtcNow.AddHours(1));
        Assert.DoesNotContain("provider-access", f.Store.Value!);
        Assert.DoesNotContain("provider-refresh", f.Store.Value!);
        Assert.Equal("provider-access", await f.Service.GetAsync(User, default));
        Assert.Equal(0, f.Http.Calls);
        Assert.Equal(1, f.Store.Releases);
    }
    [Fact]
    public async Task Expired_token_refreshes_with_original_SSO_credentials_and_persists_rotation()
    {
        using var f = new Fixture();
        await f.Capture("old-access", "old-refresh", DateTimeOffset.UtcNow.AddMinutes(-1));
        f.Http.Body = "{\"access_token\":\"new-access\",\"refresh_token\":\"new-refresh\",\"expires_in\":3600,\"token_type\":\"Bearer\"}";
        var oldCipher = f.Store.Value;
        Assert.Equal("new-access", await f.Service.GetAsync(User, default));
        Assert.Equal("grant_type=refresh_token&refresh_token=old-refresh", f.Http.Form);
        Assert.Equal("https://idp.test/token", f.Http.Url);
        Assert.Equal("Basic " + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("configured-client:configured-secret")), f.Http.Authorization);
        Assert.NotEqual(oldCipher, f.Store.Value);
        Assert.DoesNotContain("new-refresh", f.Store.Value!);
        Assert.Equal("new-access", await f.Service.GetAsync(User, default));
        Assert.Equal(1, f.Http.Calls);
    }
    [Fact]
    public async Task Provider_may_keep_refresh_token_when_it_does_not_rotate_it()
    {
        using var f = new Fixture();
        await f.Capture("old", "refresh-kept", DateTimeOffset.UtcNow.AddMinutes(-1));
        f.Http.Body = "{\"access_token\":\"new\",\"expires_in\":3600,\"token_type\":\"Bearer\"}";
        Assert.Equal("new", await f.Service.GetAsync(User, default));
        Assert.Equal(1, f.Store.Saves);
    }
    [Fact]
    public async Task Missing_refresh_token_never_starts_login_or_uses_client_credentials()
    {
        using var f = new Fixture();
        await f.Capture("old", null, DateTimeOffset.UtcNow.AddMinutes(-1));
        var error = await Assert.ThrowsAsync<SanadiException>(() => f.Service.GetAsync(User, default));
        Assert.Equal("sso_email_refresh_token_missing", error.Code);
        Assert.Equal(0, f.Http.Calls);
    }
    [Fact]
    public async Task Revoked_or_missing_session_cannot_supply_an_email_token()
    {
        using var f = new Fixture();
        f.Store.Active = false;
        await Assert.ThrowsAsync<SanadiException>(() => f.Service.GetAsync(User, default));
        Assert.Equal(0, f.Http.Calls);
    }
    [Fact]
    public async Task Ciphertext_is_bound_to_user_and_session()
    {
        using var f = new Fixture();
        await f.Capture("token", "refresh", DateTimeOffset.UtcNow.AddHours(1));
        f.Store.AllowOtherUsers = true;
        await Assert.ThrowsAsync<SanadiException>(() => f.Service.GetAsync(Guid.NewGuid(), default));
        f.Store.ReturnSession = Guid.NewGuid();
        await Assert.ThrowsAsync<SanadiException>(() => f.Service.GetAsync(User, default));
        Assert.Equal(0, f.Http.Calls);
    }
    [Fact]
    public async Task Tampering_or_changed_configuration_is_rejected()
    {
        using var f = new Fixture();
        await f.Capture("token", "refresh", DateTimeOffset.UtcNow.AddHours(1));
        var cipher = f.Store.Value!;
        f.Store.Value = cipher[..40] + (cipher[40]=='A' ? 'B':'A') + cipher[41..];
        await Assert.ThrowsAsync<SanadiException>(() => f.Service.GetAsync(User, default));
        f.Store.Value = cipher;
        f.Provider.Value = Settings with { ClientId = "another-client" };
        await Assert.ThrowsAsync<SanadiException>(() => f.Service.GetAsync(User, default));
    }
    [Theory]
    [InlineData(400,"{\"error\":\"invalid_grant\"}")]
    [InlineData(200,"{\"access_token\":\"secret\",\"expires_in\":0,\"token_type\":\"Bearer\"}")]
    [InlineData(200,"{\"access_token\":\"secret\",\"expires_in\":3600,\"token_type\":\"Other\"}")]
    public async Task Failed_refresh_does_not_replace_stored_tokens_or_expose_provider_body(int status,string body)
    {
        using var f = new Fixture();
        await f.Capture("old", "refresh", DateTimeOffset.UtcNow.AddMinutes(-1));
        var original = f.Store.Value;
        f.Http.Status = (HttpStatusCode)status; f.Http.Body = body;
        var error = await Assert.ThrowsAsync<SanadiException>(() => f.Service.GetAsync(User, default));
        Assert.DoesNotContain("secret", error.Message);
        Assert.Equal(original, f.Store.Value);
        Assert.Equal(0, f.Store.Saves);
    }
    private sealed class Fixture : IDisposable
    {
        public MemoryStore Store { get; }=new(); public Provider Provider { get; }=new(); public Http Http { get; }=new();
        public SsoEmailTokens Service { get; }
        public Fixture() => Service=new(Store,Provider,Http,Options.Create(new JwtOptions { SigningKey=new string('k',48) }),TimeProvider.System,NullLogger<SsoEmailTokens>.Instance);
        public Task Capture(string access,string? refresh,DateTimeOffset expires)
        {
            var jwt=new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(claims:[new Claim("sub",User.ToString()),new Claim("sid",Session.ToString())]));
            return Service.CaptureAsync(new AuthTokens(jwt,"local-refresh",3600,0,new AuthUser(User,"student@example.test",[],new Dictionary<string,object?>())),Settings,access,refresh,expires,default);
        }
        public void Dispose()=>Http.Dispose();
    }
    private sealed class Provider : ISsoSettingsProvider
    { public SsoSettings Value=Settings; public Task<SsoSettings> GetAsync(CancellationToken ct)=>Task.FromResult(Value); }
    private sealed class MemoryStore : ISsoEmailTokenStore
    {
        public string? Value; public bool Active=true,AllowOtherUsers; public int Saves,Releases; public Guid ReturnSession=Session;
        public Task StoreAsync(Guid u,Guid s,string p,CancellationToken ct){Value=p;return Task.CompletedTask;}
        public Task<SsoEmailTokenLease?> AcquireAsync(Guid u,CancellationToken ct)=>Task.FromResult(Active&&Value is not null&&(u==User||AllowOtherUsers)?new SsoEmailTokenLease(ReturnSession,Guid.NewGuid(),Value):null);
        public Task SaveAsync(Guid u,Guid s,Guid l,string p,CancellationToken ct){Value=p;Saves++;return Task.CompletedTask;}
        public Task ReleaseAsync(Guid u,Guid s,Guid l,CancellationToken ct){Releases++;return Task.CompletedTask;}
    }
    private sealed class Http : HttpMessageHandler,IHttpClientFactory
    {
        public int Calls; public string? Form,Authorization,Url; public string Body="{}"; public HttpStatusCode Status=HttpStatusCode.OK;
        public HttpClient CreateClient(string name)=>new(this,false);
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
        { Calls++;Form=await request.Content!.ReadAsStringAsync(ct);Authorization=request.Headers.Authorization?.ToString();Url=request.RequestUri!.ToString();return new(Status){Content=new StringContent(Body)}; }
    }
}
