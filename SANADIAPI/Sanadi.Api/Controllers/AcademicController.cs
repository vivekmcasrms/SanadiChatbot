using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Infrastructure.AppFunctions;

namespace Sanadi.Api.Controllers;

[ApiController, Route("api/academic")]
public sealed class AcademicController(AcademicFunctions functions) : ControllerBase
{
    [HttpGet("me")]
    public Task<object> Mine(CancellationToken ct) => functions.Mine(HttpContext.GetSanadiUser(), ct);

    [HttpGet("briefing")]
    public Task<object> Briefing([FromQuery] string lang="en",CancellationToken ct=default) => functions.Briefing(lang=="ar"?"ar":"en",HttpContext.GetSanadiUser(),ct);
}
