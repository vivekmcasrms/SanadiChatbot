using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Infrastructure.AppFunctions;

namespace Sanadi.Api.Controllers;

[ApiController, Route("api/evaluation")]
public sealed class EvaluationController(EvaluationFunctions functions) : ControllerBase
{
    [HttpPost("snapshot")]
    public Task<object> Snapshot([FromBody] JsonElement input, CancellationToken ct) => functions.Snapshot(new(input), HttpContext.GetSanadiUser(), ct);
    [HttpPost("baselines")]
    public Task<object> Baseline([FromBody] JsonElement input, CancellationToken ct) => functions.SaveBaseline(new(input), HttpContext.GetSanadiUser(), ct);
    [HttpPost("baselines/delete")]
    public Task<object> DeleteBaseline([FromBody] JsonElement input, CancellationToken ct) => functions.Delete(new(input), false, HttpContext.GetSanadiUser(), ct);
    [HttpPost("pilots")]
    public Task<object> Pilot([FromBody] JsonElement input, CancellationToken ct) => functions.SavePilot(new(input), HttpContext.GetSanadiUser(), ct);
    [HttpPost("pilots/delete")]
    public Task<object> DeletePilot([FromBody] JsonElement input, CancellationToken ct) => functions.Delete(new(input), true, HttpContext.GetSanadiUser(), ct);
}
