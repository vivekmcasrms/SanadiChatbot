using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Sanadi.Api.Security;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.Tests;

public sealed class TokenEndpointEgressGuardTests
{
    [Theory]
    [InlineData("")]
    [InlineData("AssistantModel")]
    [InlineData("ConfiguredSpeech")]
    [InlineData("VoiceTranscription")]
    [InlineData("Sso")]
    [InlineData("OclcLibrary")]
    public async Task Token_scope_cannot_bypass_guard_by_selecting_another_named_client(string name)
    {
        var transport = new RecordingTransport();
        var services = new ServiceCollection();
        services.AddHttpClient(name).ConfigurePrimaryHttpMessageHandler(() => transport);
        services.AddTokenEndpointEgressGuard(); // Also covers clients registered earlier by Infrastructure.
        using var provider = services.BuildServiceProvider();
        var accessor = provider.GetRequiredService<IHttpContextAccessor>();
        using var client = provider.GetRequiredService<IHttpClientFactory>().CreateClient(name);
        accessor.HttpContext = Context(true);
        try
        {
            var error = await Assert.ThrowsAsync<SanadiException>(() => client.GetAsync("https://untrusted.invalid/credentials?secret=do-not-log"));
            Assert.Equal("auth_egress_denied", error.Code);
            Assert.DoesNotContain("untrusted", error.Message);
            Assert.DoesNotContain("do-not-log", error.Message);
            Assert.Equal(0, transport.Calls);
            // A pooled handler must use the new request's scope, not retain the token request.
            accessor.HttpContext = Context(false);
            using var allowed = await client.GetAsync("https://configured-service.invalid/endpoint");
            Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
            Assert.Equal(1, transport.Calls);
        }
        finally { accessor.HttpContext = null; }
    }

    [Fact]
    public void Synchronous_sends_are_also_blocked_before_transport()
    {
        var accessor = new HttpContextAccessor { HttpContext = Context(true) };
        var transport = new RecordingTransport();
        using var client = new HttpClient(new TokenEndpointEgressGuard(accessor) { InnerHandler = transport });
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "http://127.0.0.1/private");
            Assert.Equal("auth_egress_denied", Assert.Throws<SanadiException>(() => client.Send(request)).Code);
            Assert.Equal(0, transport.Calls);
        }
        finally { accessor.HttpContext = null; }
    }

    [Fact]
    public async Task Concurrent_voice_and_token_requests_do_not_share_restrictions()
    {
        var accessor = new HttpContextAccessor();
        var transport = new RecordingTransport();
        using var client = new HttpClient(new TokenEndpointEgressGuard(accessor) { InnerHandler = transport });
        async Task Request(bool token)
        {
            accessor.HttpContext = Context(token);
            try
            {
                await Task.Yield();
                if (token) await Assert.ThrowsAsync<SanadiException>(() => client.GetAsync("https://probe.invalid/foo"));
                else using (await client.GetAsync("https://configured-voice.invalid/audio/speech")) { }
            }
            finally { accessor.HttpContext = null; }
        }
        await Task.WhenAll(Enumerable.Range(0, 20).Select(n => Task.Run(() => Request(n % 2 == 0))));
        Assert.Equal(10, transport.Calls);
        using var background = await client.GetAsync("https://configured-worker.invalid/endpoint");
        Assert.Equal(11, transport.Calls);
    }

    [Fact]
    public async Task Cancellation_is_not_reported_as_an_egress_violation()
    {
        var accessor = new HttpContextAccessor { HttpContext = Context(true) };
        var transport = new RecordingTransport();
        using var client = new HttpClient(new TokenEndpointEgressGuard(accessor) { InnerHandler = transport });
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        try { await Assert.ThrowsAnyAsync<OperationCanceledException>(() => client.GetAsync("https://probe.invalid/", cancellation.Token)); }
        finally { accessor.HttpContext = null; }
        Assert.Equal(0, transport.Calls);
    }

    private static DefaultHttpContext Context(bool token)
    {
        var context = new DefaultHttpContext();
        context.SetEndpoint(new Endpoint(_ => Task.CompletedTask,
            token ? new EndpointMetadataCollection(new ValidateTokenGrantAttribute()) : EndpointMetadataCollection.Empty,
            token ? "Token" : "Voice / SSO / other business endpoint"));
        return context;
    }

    private sealed class RecordingTransport : HttpMessageHandler
    {
        public int Calls;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            => Task.FromResult(Send(request, ct));
        protected override HttpResponseMessage Send(HttpRequestMessage request, CancellationToken ct)
        {
            Interlocked.Increment(ref Calls);
            return new(HttpStatusCode.OK);
        }
    }
}
