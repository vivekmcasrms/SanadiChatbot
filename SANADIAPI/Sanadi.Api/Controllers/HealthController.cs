using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

using Sanadi.Api.Middleware;

namespace Sanadi.Api.Controllers;

[ApiController]
[AllowAnonymous]
[Route("health")]
[Route("api/health")]
public sealed class HealthController(IHttpClientFactory httpClientFactory, IConfiguration config, ILogger<HealthController> logger) : ControllerBase
{
    /// <summary>Simple hosting check: API process is up.</summary>
    [HttpGet("ping")]
    [HttpHead("ping")]
    public IActionResult Ping() => Content("API ok", "text/plain");

    [HttpGet]
    [HttpHead]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        var upstream = config["AppServer:UpstreamUrl"]?.TrimEnd('/');
        var appServer = "not_configured";
        if (!string.IsNullOrWhiteSpace(upstream))
        {
            try
            {
                var client = httpClientFactory.CreateClient("AppServerProxy");
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                cts.CancelAfter(TimeSpan.FromSeconds(2));
                using var res = await client.GetAsync(upstream + "/", cts.Token);
                // Any HTTP response means the process is listening (even 404).
                appServer = "up";
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (Exception ex)
            {
                ApiErrorPolicy.LogOnce(logger, ex, HttpContext, nameof(Get));
                appServer = "down";
            }
        }

        if (appServer == "down")
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                $"API ok; App Server DOWN at {upstream}. Start UI\\Server\\start-server.bat on this host.");
        }

        return Content($"All ok with API; App Server {appServer}", "text/plain");
    }
}
