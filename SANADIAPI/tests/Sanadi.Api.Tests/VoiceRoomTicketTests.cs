using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Sanadi.Api.AI;
using Sanadi.Api.Controllers;
using Sanadi.Api.Security;
using Sanadi.Infrastructure;

namespace Sanadi.Api.Tests;

public sealed class VoiceRoomTicketTests
{
    [Fact]
    public void Voice_controller_activates_with_real_infrastructure_dependencies()
    {
        var config = new ConfigurationBuilder().Build();
        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(config);
        services.AddLogging();
        services.AddSanadiInfrastructure(config);
        services.AddScoped<PrivateVoiceService>();
        services.AddScoped<OllamaVoiceTranscription>();
        services.AddScoped<AdvisorSpeech>();
        services.AddScoped<ConfiguredSpeech>();
        services.AddSingleton<VoiceWelcomeAudio>();
        services.AddSingleton<VoiceRoomTickets>();
        services.AddSingleton<VoiceMetricsStore>();
        services.AddScoped<AssistantController>();
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        var controller = ActivatorUtilities.CreateInstance<VoiceRoomController>(scope.ServiceProvider);
        controller.ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() };
        Assert.IsType<UnauthorizedObjectResult>(controller.Ticket());
        var call = ActivatorUtilities.CreateInstance<VoiceCallController>(scope.ServiceProvider);
        call.ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() };
        Assert.IsType<UnauthorizedObjectResult>(call.Ticket());
    }

    [Fact]
    public void Persistent_call_ticket_uses_authenticated_id_and_origin_without_installed_speech_voices()
    {
        var userId = Guid.NewGuid();
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", userId.ToString())], "Cookie"));
        var tickets = new VoiceRoomTickets();
        var controller = new VoiceCallController(tickets, null!, null!, new ConfigurationBuilder().Build(),
            new VoiceMetricsStore(), NullLogger<VoiceCallController>.Instance, new VoiceWelcomeAudio())
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = principal } } };
        controller.Request.Headers.Origin = "https://ui.test";
        var result = Assert.IsType<OkObjectResult>(controller.Ticket());
        var ticket = JsonSerializer.SerializeToElement(result.Value).GetProperty("ticket").GetString()!;
        Assert.Equal(userId, CurrentUser.FromPrincipal(tickets.Take(ticket, "https://ui.test")!.Principal).UserId);
        Assert.Null(tickets.Take(ticket, "https://ui.test"));
        Assert.Equal("no-store", controller.Response.Headers.CacheControl.ToString());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Validated_cookie_or_bearer_session_can_obtain_a_single_use_ticket(bool bearer)
    {
        var userId = Guid.NewGuid();
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim("sub", userId.ToString())], "Bearer"));
        var (controller, tickets) = Create(principal);
        // Cookie authentication has a validated principal but no bearer header,
        // so the existing CurrentUserMiddleware leaves its legacy user anonymous.
        controller.HttpContext.Items[CurrentUserMiddleware.ItemKey] = bearer
            ? CurrentUser.FromPrincipal(principal) : CurrentUser.Anonymous();
        if (bearer) controller.Request.Headers.Authorization = "Bearer test-only";

        var result = Assert.IsType<OkObjectResult>(controller.Ticket());
        var ticket = JsonSerializer.SerializeToElement(result.Value).GetProperty("ticket").GetString()!;
        var redeemed = tickets.Take(ticket, "https://ui.example");
        Assert.NotNull(redeemed);
        Assert.Equal(userId, CurrentUser.FromPrincipal(redeemed.Principal).UserId);
        Assert.Null(tickets.Take(ticket, "https://ui.example"));
        Assert.Equal("no-store", controller.Response.Headers.CacheControl.ToString());
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public void Missing_authentication_or_invalid_user_is_rejected(bool authenticated, bool validId)
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim("sub", validId ? Guid.NewGuid().ToString() : "invalid")],
            authenticated ? "Bearer" : null));
        var (controller, _) = Create(principal);
        // A stale legacy context must not substitute for validated authentication.
        controller.HttpContext.Items[CurrentUserMiddleware.ItemKey] = new CurrentUser
        { UserId = Guid.NewGuid(), IsAuthenticated = true };
        Assert.IsType<UnauthorizedObjectResult>(controller.Ticket());
    }

    [Fact]
    public void Disabled_voice_does_not_issue_a_ticket()
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim("sub", Guid.NewGuid().ToString())], "Bearer"));
        var (controller, _) = Create(principal, enabled: false);
        Assert.Equal(503, Assert.IsType<ObjectResult>(controller.Ticket()).StatusCode);
        Assert.Equal(503, Assert.IsType<ObjectResult>(controller.Ticket(browserSpeech: true)).StatusCode);
    }

    [Fact]
    public void Browser_playback_ticket_does_not_require_a_configured_speech_provider()
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim("sub", Guid.NewGuid().ToString())], "Bearer"));
        var config = new ConfigurationBuilder().Build();
        var speech = new AdvisorSpeech(new PrivateVoiceService(config, new NoHttp()), config);
        var controller = new VoiceRoomController(new VoiceRoomTickets(), speech,
            null!, null!, new VoiceMetricsStore(), NullLogger<VoiceRoomController>.Instance)
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = principal } } };
        Assert.IsType<OkObjectResult>(controller.Ticket(browserSpeech: true));
    }

    private static (VoiceRoomController, VoiceRoomTickets) Create(ClaimsPrincipal principal, bool enabled = true)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Voice:Enabled"] = enabled.ToString(),
            ["Voice:WhisperBaseUrl"] = "https://speech.example",
            ["Voice:TtsBaseUrl"] = "https://speech.example",
            ["Voice:FemaleVoice"] = "female",
            ["Voice:MaleVoice"] = "male",
        }).Build();
        var speech = new PrivateVoiceService(config, new NoHttp());
        var tickets = new VoiceRoomTickets();
        var controller = new VoiceRoomController(tickets, new AdvisorSpeech(speech, config),
            null!, null!, new VoiceMetricsStore(), NullLogger<VoiceRoomController>.Instance)
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = principal } } };
        controller.Request.Headers.Origin = "https://ui.example";
        return (controller, tickets);
    }

    private sealed class NoHttp : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => throw new InvalidOperationException("No network expected");
    }
}
