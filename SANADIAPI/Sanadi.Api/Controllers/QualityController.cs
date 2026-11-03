using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Infrastructure.AppFunctions;

namespace Sanadi.Api.Controllers;

[ApiController, Route("api/quality")]
public sealed class QualityController(QualityFunctions functions) : ControllerBase
{
    [HttpGet("dashboard")]
    public Task<object> Dashboard(CancellationToken ct) => functions.Dashboard(HttpContext.GetSanadiUser(), ct);
    [HttpPost("performance")]
    public Task<object> Performance([FromBody] JsonElement input, CancellationToken ct) => functions.Performance(new(input), HttpContext.GetSanadiUser(), ct);
    [HttpPost("reviews")]
    public Task<object> Review([FromBody] JsonElement input, CancellationToken ct) => functions.Review(new(input), HttpContext.GetSanadiUser(), ct);
    [HttpPost("readiness")]
    public Task<object> Gate([FromBody] JsonElement input, CancellationToken ct) => functions.Gate(new(input), HttpContext.GetSanadiUser(), ct);
    [HttpPost("state")]
    public Task<object> State([FromBody] JsonElement input, CancellationToken ct) => functions.State(new(input), HttpContext.GetSanadiUser(), ct);
    [HttpPost("consistency")]
    public Task<object> Consistency(CancellationToken ct) => functions.Consistency(HttpContext.GetSanadiUser(), ct);
}
