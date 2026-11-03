using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Infrastructure.AppFunctions;

namespace Sanadi.Api.Controllers;

[ApiController]
[Route("api/appointments/availability")]
public sealed class AppointmentAvailabilityController(AppointmentAvailabilityFunctions functions) : ControllerBase
{
    [HttpGet("workspace")]
    public Task<object> Workspace(CancellationToken ct) => functions.Workspace(HttpContext.GetSanadiUser(), ct);

    [HttpPost("staff")]
    public Task<object> Staff([FromBody] JsonElement input, CancellationToken ct) => functions.Staff(new(input), HttpContext.GetSanadiUser(), ct);

    [HttpPost("enabled")]
    public Task<object> Enabled([FromBody] JsonElement input, CancellationToken ct) => functions.SetEnabled(new(input), HttpContext.GetSanadiUser(), ct);

    [HttpPost("rules")]
    public Task<object> Create([FromBody] JsonElement input, CancellationToken ct) => functions.Create(new(input), HttpContext.GetSanadiUser(), ct);

    [HttpPost("regenerate")]
    public Task<object> Regenerate([FromBody] JsonElement input, CancellationToken ct) => functions.Regenerate(new(input), HttpContext.GetSanadiUser(), ct);

    [HttpPost("deactivate")]
    public Task<object> Deactivate([FromBody] JsonElement input, CancellationToken ct) => functions.Deactivate(new(input), HttpContext.GetSanadiUser(), ct);
}
