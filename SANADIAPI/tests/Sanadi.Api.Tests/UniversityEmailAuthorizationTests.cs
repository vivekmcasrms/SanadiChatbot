using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Sanadi.Api.Notifications;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.Tests;

public sealed class UniversityEmailAuthorizationTests
{
    [Theory]
    [InlineData("token")]
    [InlineData("access_token")]
    [InlineData("accessToken")]
    [InlineData("jwt")]
    public async Task Gateway_uses_JSON_credentials_and_actual_actor_account_not_SSO(string tokenField)
    {
        using var http = new Http { Body = JsonSerializer.Serialize(new Dictionary<string,string>
            { [tokenField] = "issued-gateway-token", ["tokenType"] = "Bearer" }) };
        var repo = new Repository();
        var actor = Guid.NewGuid();
        Assert.Equal("issued-gateway-token", await Service(repo,http).GetAsync(actor,default));
        Assert.Equal(actor,repo.Actor);
        Assert.True(repo.Production);
        Assert.Equal("UniversityEmailAuthorization",http.ClientName);
        Assert.Equal("https://configured-gateway.test/custom/token",http.Url);
        Assert.Equal("POST",http.Method);
        Assert.Equal("application/json",http.ContentType);
        Assert.Null(http.Authorization);
        using var json = JsonDocument.Parse(http.RequestBody!);
        Assert.Equal(3,json.RootElement.EnumerateObject().Count());
        Assert.Equal("configured-client",json.RootElement.GetProperty("clientId").GetString());
        Assert.Equal("synthetic-secret",json.RootElement.GetProperty("clientSecret").GetString());
        Assert.Equal("test.operator",json.RootElement.GetProperty("userAccount").GetString());
        Assert.DoesNotContain("grant_type",http.RequestBody);
    }

    [Theory]
    [InlineData("{\"token\":\"gateway-token\"}")]
    [InlineData("{\"access_token\":\"gateway-token\",\"token_type\":\"bearer\"}")]
    [InlineData("{\"token\":\"gateway-token\",\"tokenType\":null}")]
    public async Task Missing_token_type_defaults_to_Bearer(string response)
    {
        using var http = new Http { Body=response };
        Assert.Equal("gateway-token",await Service(new Repository(),http).GetAsync(Guid.NewGuid(),default));
    }

    [Fact]
    public async Task Each_send_requests_authorization_again_without_shared_token_cache()
    {
        using var http = new Http();
        var service=Service(new Repository(),http);
        await service.GetAsync(Guid.NewGuid(),default);
        await service.GetAsync(Guid.NewGuid(),default);
        Assert.Equal(2,http.Calls);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("false")]
    [InlineData("not JSON")]
    [InlineData("{\"token\":null}")]
    [InlineData("{\"token\":\"bad token\"}")]
    [InlineData("{\"token\":\"token\",\"tokenType\":\"Basic\"}")]
    [InlineData("{\"token\":\"token\",\"tokenType\":12}")]
    public async Task Invalid_token_response_never_becomes_authorization(string response)
    {
        using var http = new Http { Body=response };
        var error=await Assert.ThrowsAsync<SanadiException>(()=>Service(new Repository(),http).GetAsync(Guid.NewGuid(),default));
        Assert.Equal("email_authorization_response_invalid",error.Code);
    }

    [Theory]
    [InlineData(400)]
    [InlineData(401)]
    [InlineData(500)]
    public async Task HTTP_errors_do_not_expose_credentials_or_provider_body(int status)
    {
        using var http = new Http { Status=(HttpStatusCode)status,Body="synthetic-secret private provider details" };
        var error=await Assert.ThrowsAsync<SanadiException>(()=>Service(new Repository(),http).GetAsync(Guid.NewGuid(),default));
        Assert.Equal("email_authorization_http_"+status,error.Code);
        Assert.DoesNotContain("synthetic-secret",error.ToString());
        Assert.DoesNotContain("private provider details",error.ToString());
    }

    [Fact]
    public async Task Missing_or_revoked_actor_never_uses_another_users_account()
    {
        using var http = new Http();
        var error=await Assert.ThrowsAsync<SanadiException>(()=>Service(new Repository { Context=null },http).GetAsync(Guid.NewGuid(),default));
        Assert.Equal("email_authorization_account_unavailable",error.Code);
        Assert.Equal(0,http.Calls);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("http://gateway.test/token")]
    [InlineData("https://user:secret@gateway.test/token")]
    [InlineData("https://gateway.test/token?secret=example")]
    public async Task Invalid_or_missing_endpoint_never_sends_client_secret(string? url)
    {
        using var http = new Http();
        var repo=new Repository { Context=new() { ApiUrl=url,ClientId="client",ClientSecret="secret" } };
        var error=await Assert.ThrowsAsync<SanadiException>(()=>Service(repo,http).GetAsync(Guid.NewGuid(),default));
        Assert.Equal("email_authorization_not_configured",error.Code);
        Assert.Equal(0,http.Calls);
    }

    [Theory]
    [InlineData("test.operator@example.test","example.test","test.operator")]
    [InlineData("202000001@example.test","@example.test","202000001")]
    [InlineData("202000336@aa.uaeut.ac.ae","uaeu.ac.ae","202000336")]
    public void Account_is_derived_from_the_university_login_record(string email,string domain,string account)
        => Assert.Equal(account,UniversityEmailAuthorization.UserAccount(email,domain));

    [Theory]
    [InlineData("Someone <test@example.test>","example.test")]
    [InlineData("test..operator@example.test","example.test")]
    [InlineData("test@example.test",null)]
    public void Untrusted_or_misconfigured_account_is_rejected(string email,string? domain)
        => Assert.Throws<SanadiException>(()=>UniversityEmailAuthorization.UserAccount(email,domain));

    [Fact]
    public void Context_string_does_not_print_the_secret()
        => Assert.DoesNotContain("synthetic-secret",new Repository().Context!.ToString());

    private static UniversityEmailAuthorization Service(Repository repo,Http http) => new(repo,http,
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>
            { ["SsoRouting:IsProductionEntry"]="true" }).Build());

    private sealed class Repository:IUniversityEmailAuthorizationRepository
    {
        public Guid Actor; public bool Production;
        public UniversityEmailAuthorizationContext? Context=new()
        {
            ApiUrl="https://configured-gateway.test/custom/token",ClientId="configured-client",ClientSecret="synthetic-secret",
            AccountEmail="test.operator@example.test",EmailDomain="example.test"
        };
        public Task<UniversityEmailAuthorizationContext?> GetAsync(bool production,Guid actor,CancellationToken ct)
        { Actor=actor;Production=production;return Task.FromResult(Context); }
    }

    private sealed class Http:HttpMessageHandler,IHttpClientFactory
    {
        public string Body="{\"token\":\"gateway-token\"}";
        public HttpStatusCode Status=HttpStatusCode.OK;
        public int Calls;public string? ClientName,Url,Method,ContentType,Authorization,RequestBody;
        public HttpClient CreateClient(string name) { ClientName=name;return new(this,false); }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
        {
            Calls++;Url=request.RequestUri!.ToString();Method=request.Method.Method;
            ContentType=request.Content?.Headers.ContentType?.MediaType;Authorization=request.Headers.Authorization?.ToString();
            RequestBody=await request.Content!.ReadAsStringAsync(ct);
            return new(Status) { Content=new StringContent(Body) };
        }
    }
}
