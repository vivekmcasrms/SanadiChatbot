using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Sanadi.Api.Controllers;
using Sanadi.Api.Middleware;
using Sanadi.Api.Security;
using Sanadi.Application.Auth;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Auth;
using Sanadi.Infrastructure.Options;

namespace Sanadi.Api.Tests;

// Real HTTP/model binding/CORS, using isolated in-memory auth substitutes.
// No database, IdP, hosted email worker or external HTTP service is started.
public sealed class SecurityRescanTests
{
    // Synthetic untrusted values are submitted only to the isolated loopback
    // API. The reserved .invalid hostname is never resolved or contacted.
    private const string UntrustedUrl = "https://514f5e8d-5fea-43c1-b36f-5d23d3f2e5f9.example.invalid/foo";
    private const string EncodedUntrustedUrl = "https%3a%2f%2f514f5e8d-5fea-43c1-b36f-5d23d3f2e5f9.example.invalid%2ffoo";

    [Theory]
    [InlineData("")]
    [InlineData("https://probe.invalid/foo")]
    [InlineData("https%3a%2f%2fprobe.invalid%2ffoo")]
    [InlineData("//probe.invalid/foo")]
    [InlineData("file:///etc/passwd")]
    [InlineData("A\r\nB")]
    [InlineData(UntrustedUrl)]
    [InlineData(EncodedUntrustedUrl)]
    [InlineData("https://sanadiapi.uaeu.ac.ae/api/v1/auth/token")]
    public async Task Invalid_refresh_input_never_reaches_database_or_token_service(string value)
    {
        // Null dependencies guarantee a missed guard fails instead of making I/O.
        var service = new SqlAuthService(null!, null!, null!, Options.Create(new JwtOptions()), NullLogger<SqlAuthService>.Instance);
        var error = await Assert.ThrowsAsync<SanadiException>(() => service.RefreshAsync(new(value), default));
        Assert.Equal(401, error.StatusCode);
        Assert.Equal("invalid_refresh_token", error.Code);
    }

    [Fact]
    public void Issued_refresh_tokens_keep_the_existing_format()
    {
        var issuer = new JwtTokenService(Options.Create(new JwtOptions()));
        for (var n = 0; n < 100; n++) Assert.True(RefreshTokenFormat.IsValid(issuer.CreateRefreshToken()));
    }

    [Fact]
    public async Task Auth_replay_cors_errors_cookies_downloads_and_streams_remain_correct()
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Production" });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.AddControllers().AddApplicationPart(typeof(AuthController).Assembly)
            .ConfigureApiBehaviorOptions(ApiRequestValidation.Configure);
        builder.Services.Configure<Microsoft.AspNetCore.Routing.RouteOptions>(o =>
            o.ConstraintMap["notreserved"] = typeof(Sanadi.Api.Routing.NotReservedStorageBucketConstraint));
        builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o => o.IncludeErrorDetails = false);
        builder.Services.AddAuthorization();
        builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins("https://sanadi-beta.uaeu.ac.ae")
            .AllowAnyHeader().AllowAnyMethod().AllowCredentials()));
        builder.Services.AddRateLimiter(o => {
            foreach (var name in new[] { "login", "sso", "sso-diagnostics" })
                o.AddFixedWindowLimiter(name, cfg => { cfg.PermitLimit = 1000; cfg.Window = TimeSpan.FromMinutes(1); });
        });
        var auth = new FakeAuth();
        var outbound = new RecordingTransport();
        builder.Services.AddTokenEndpointEgressGuard();
        builder.Services.AddHttpClient("AuthRegressionProbe").ConfigurePrimaryHttpMessageHandler(() => outbound);
        builder.Services.AddSingleton<IAuthService>(auth);
        builder.Services.AddSingleton<ISsoService>(new FakeSso());
        await using var app = builder.Build();
        auth.HttpClients = app.Services.GetRequiredService<IHttpClientFactory>();
        app.UseMiddleware<ApiSecurityHeadersMiddleware>();
        app.UseRouting();
        app.UseCors();
        app.UseMiddleware<ExceptionHandlingMiddleware>();
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseRateLimiter();
        app.MapControllers();
        app.MapGet("/protected", () => "private").RequireAuthorization();
        app.MapGet("/download", () => Results.File([1, 2, 3], "application/pdf", "test.pdf"));
        app.MapGet("/stream", () => Results.Text("data: ok\n\n", "text/event-stream"));
        app.MapGet("/bad-http", (HttpContext _) => throw new BadHttpRequestException("PRIVATE-PARSER-DIAGNOSTIC", 400));
        await app.StartAsync();
        using var client = new HttpClient(new HttpClientHandler { UseCookies = false }) { BaseAddress = new Uri(app.Urls.Single()) };

        foreach (var path in new[] { "/api/v1/auth/token", "/auth/v1/token" })
        {
            foreach (var grant in new[] { "https://probe.invalid/foo", "refresh_token&grant_type=password", "", "PASSWORD" })
            {
                // Duplicate query values are intentionally not escaped in this case.
                var query = grant.Contains('&') ? grant : Uri.EscapeDataString(grant);
                using var rejected = await client.PostAsJsonAsync(path + "?grant_type=" + query, new { refresh_token = (string?)null });
                Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
            }
            foreach (var query in new[] {
                "grant_type=" + EncodedUntrustedUrl,
                "grant_type=" + Uri.EscapeDataString(EncodedUntrustedUrl),
                "grant_type=" + Uri.EscapeDataString(Uri.EscapeDataString(EncodedUntrustedUrl)),
                "grant_type=https%3A%2F%2Fsanadiapi.uaeu.ac.ae%2Fapi%2Fv1%2Fauth%2Ftoken",
                "grant_type=http%3A%2F%2F127.0.0.1%2Fadmin",
                "grant_type=http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data%2F",
                "grant_type=%2F%2Fprobe.invalid%2Ffoo",
                "grant_type=file%3A%2F%2F%2Fetc%2Fpasswd",
                "grant_type=password&GRANT_TYPE=" + EncodedUntrustedUrl,
                "grant_type=password&grant_type=password",
                "grant_type=password%00", "grant_type=%20password", "grant_type=password%20",
                "grant_type=%2570assword", "grant_type=authorization_code", ""
            })
            {
                // Malformed JSON demonstrates the resource filter runs before
                // model binding: the response must be the grant error, not a
                // JSON/parser error. No auth dependency may be invoked.
                using var rejected = await client.PostAsync(path + "?" + query,
                    new StringContent("not-json", Encoding.UTF8, "application/json"));
                Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
                var result = await rejected.Content.ReadFromJsonAsync<Dictionary<string, string>>();
                Assert.Equal("unsupported_grant_type", result!["error"]);
                Assert.DoesNotContain("example.invalid", await rejected.Content.ReadAsStringAsync());
                Assert.Equal(0, auth.Calls);
            }
            foreach (var token in new[] { "https://probe.invalid/foo", "https%3a%2f%2fprobe.invalid", "//probe.invalid", "", new string('A', 4096), UntrustedUrl, EncodedUntrustedUrl })
            {
                using var rejected = await client.PostAsJsonAsync(path + "?grant_type=refresh_token", new { refresh_token = token });
                Assert.Equal(HttpStatusCode.Unauthorized, rejected.StatusCode);
                Assert.Equal("Bearer", rejected.Headers.WwwAuthenticate.Single().Scheme);
                Assert.DoesNotContain("probe.invalid", await rejected.Content.ReadAsStringAsync());
            }
            using var invalidCookie = new HttpRequestMessage(HttpMethod.Post, path + "?grant_type=refresh_token");
            invalidCookie.Headers.Add("Cookie", AuthController.RefreshCookie + "=" + EncodedUntrustedUrl);
            invalidCookie.Content = JsonContent.Create(new { refresh_token = Convert.ToBase64String(new byte[48]) });
            using var cookieRejected = await client.SendAsync(invalidCookie);
            Assert.Equal(HttpStatusCode.Unauthorized, cookieRejected.StatusCode);
        }
        Assert.Equal(0, auth.Calls);

        using (var oversized = await client.PostAsync("/api/v1/auth/sso/trace", new StringContent(new string('A', 2100), Encoding.UTF8, "application/json")))
        {
            Assert.Equal(HttpStatusCode.RequestEntityTooLarge, oversized.StatusCode);
            Assert.DoesNotContain("System.", await oversized.Content.ReadAsStringAsync());
        }
        using (var invalid = await client.PostAsync("/api/v1/auth/sso/trace", new StringContent(new string('A', 500), Encoding.UTF8, "application/json")))
        {
            Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
            var body = await invalid.Content.ReadAsStringAsync();
            Assert.Contains("invalid_request", body);
            Assert.DoesNotContain("System.", body);
            Assert.DoesNotContain("AAAA", body);
        }
        using (var invalid = await client.GetAsync("/bad-http"))
        {
            Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
            Assert.DoesNotContain("PRIVATE-PARSER", await invalid.Content.ReadAsStringAsync());
        }
        using (var preflight = new HttpRequestMessage(HttpMethod.Options, "/api/v1/auth/token?grant_type=refresh_token"))
        {
            preflight.Headers.Add("Origin", "https://sanadi-beta.uaeu.ac.ae");
            preflight.Headers.Add("Access-Control-Request-Method", "POST");
            preflight.Headers.Add("Access-Control-Request-Headers", "content-type");
            using var response = await client.SendAsync(preflight);
            Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
            Assert.Equal("https://sanadi-beta.uaeu.ac.ae", response.Headers.GetValues("Access-Control-Allow-Origin").Single());
            Assert.NotNull(response.Content.Headers.ContentType);
            Assert.False(response.Headers.Contains("X-XSS-Protection"));
            Assert.True(response.Headers.CacheControl!.NoStore);
        }
        using (var unauthorized = await client.GetAsync("/protected"))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
            Assert.Equal("Bearer", unauthorized.Headers.WwwAuthenticate.Single().Scheme);
        }
        var cookie = Convert.ToBase64String(Enumerable.Repeat((byte)255, 48).ToArray());
        using (var refresh = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/token?grant_type=refresh_token"))
        {
            refresh.Headers.Add("Cookie", AuthController.RefreshCookie + "=" + cookie);
            refresh.Content = JsonContent.Create(new { refresh_token = "stale-local-storage" });
            using var response = await client.SendAsync(refresh);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal(cookie, auth.LastRefresh);
            foreach (var header in response.Headers.GetValues("Set-Cookie"))
            {
                Assert.Contains("secure", header.ToLowerInvariant());
                Assert.Contains("httponly", header.ToLowerInvariant());
                Assert.Contains("samesite=lax", header.ToLowerInvariant());
            }
        }
        // Scope validation to operation/token fields. A valid user's password
        // is opaque and must not be altered by a blanket URL-content filter.
        using (var login = await client.PostAsJsonAsync("/api/v1/auth/token?grant_type=password", new { email = "test@uaeu.ac.ae", password = "https://password.example.test/value", refresh_token = "ignored" }))
            Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        Assert.Equal(2, auth.Calls);
        Assert.Equal("https://password.example.test/value", auth.LastLogin!.Password);
        using (var trace = await client.PostAsJsonAsync("/api/v1/auth/sso/trace", new { step = "AUTH_COMPLETE", code = "role_content_mounted", flowId = Guid.NewGuid() }))
            Assert.Equal(HttpStatusCode.NoContent, trace.StatusCode);
        using (var pdf = await client.GetAsync("/download"))
        {
            Assert.Equal("application/pdf", pdf.Content.Headers.ContentType!.MediaType);
            Assert.Equal(new byte[] { 1, 2, 3 }, await pdf.Content.ReadAsByteArrayAsync());
        }
        using (var stream = await client.GetAsync("/stream"))
        {
            Assert.Equal("text/event-stream", stream.Content.Headers.ContentType!.MediaType);
            Assert.Equal("data: ok\n\n", await stream.Content.ReadAsStringAsync());
        }

        // Defense in depth: even a future auth implementation that tries HTTP is
        // stopped before the transport/DNS stage. No external address is contacted.
        auth.TryOutbound = true;
        foreach (var path in new[] { "/api/v1/auth/token", "/auth/v1/token", "/API/V1/AUTH/TOKEN/" })
        foreach (var grant in new[] { "password", "refresh_token" })
        {
            using var blocked = await client.PostAsJsonAsync(path + "?grant_type=" + grant,
                new { email = "test@uaeu.ac.ae", password = "unchanged", refresh_token = Convert.ToBase64String(new byte[48]) });
            Assert.Equal(HttpStatusCode.ServiceUnavailable, blocked.StatusCode);
            Assert.Contains("auth_egress_denied", await blocked.Content.ReadAsStringAsync());
        }
        Assert.Equal(0, outbound.Calls);
        await app.StopAsync();
    }

    private sealed class FakeAuth : IAuthService
    {
        public int Calls;
        public string? LastRefresh;
        public LoginRequest? LastLogin;
        public IHttpClientFactory? HttpClients;
        public bool TryOutbound;
        private static AuthTokens Tokens() => new("synthetic-access", Convert.ToBase64String(new byte[48]), 3600, 1,
            new AuthUser(Guid.NewGuid(), "test@uaeu.ac.ae", ["student"], new Dictionary<string, object?>()));
        public async Task<AuthTokens> RefreshAsync(RefreshRequest request, CancellationToken ct)
        {
            Calls++; LastRefresh = request.RefreshToken;
            await ProbeOutbound(ct);
            return Tokens();
        }
        public async Task<AuthTokens> LoginAsync(LoginRequest request, CancellationToken ct)
        {
            Calls++; LastLogin = request;
            await ProbeOutbound(ct);
            return Tokens();
        }
        private async Task ProbeOutbound(CancellationToken ct)
        {
            if (TryOutbound)
            {
                using var response = await HttpClients!.CreateClient("AuthRegressionProbe").GetAsync("https://probe.invalid/foo", ct);
            }
        }
        public Task<AuthTokens> SignUpAsync(SignUpRequest request, CancellationToken ct) => throw new NotSupportedException();
        public Task<AuthTokens> LoginWithSsoAsync(SsoLoginRequest request, CancellationToken ct) => throw new NotSupportedException();
        public Task<AuthUser> GetUserAsync(Sanadi.Domain.Security.ICurrentUser user, CancellationToken ct) => throw new NotSupportedException();
        public Task SignOutAsync(string refreshToken, CancellationToken ct, string? accessToken = null) => Task.CompletedTask;
    }
    private sealed class RecordingTransport : HttpMessageHandler
    {
        public int Calls;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));
        }
    }
    private sealed class FakeSso : ISsoService
    {
        public Task<SsoInitiation> InitiateAsync(CancellationToken ct, bool forceLogin = false, string? browserChallenge = null) => throw new NotSupportedException();
        public Task<SsoCompletion> CompleteAsync(SsoCallbackRequest request, CancellationToken ct) => throw new NotSupportedException();
        public Task<AuthTokens> RedeemSessionAsync(string ticket, CancellationToken ct, string? verifier = null) => throw new NotSupportedException();
        public Task<string> FailureRedirectAsync(string code, CancellationToken ct) => throw new NotSupportedException();
        public Task<string?> LogoutRedirectAsync(CancellationToken ct) => Task.FromResult<string?>(null);
    }
}
