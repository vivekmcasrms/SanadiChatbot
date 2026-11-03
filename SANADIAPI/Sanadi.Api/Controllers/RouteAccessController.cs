using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

/// <summary>Database-owned authorization decision for authenticated UI routes.</summary>
[ApiController]
[Route("api/route-access")]
public sealed class RouteAccessController(ISqlConnectionFactory sql) : ControllerBase
{
    [HttpGet]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<object> Check([FromQuery] string path, CancellationToken ct)
    {
        var user=HttpContext.GetSanadiUser();
        if(!user.IsAuthenticated || user.UserId is not Guid userId) throw new UnauthorizedException();
        await using var db=sql.Create();
        var row=await db.QuerySingleAsync(DbProc.Call("usp_AuthorizeAppRoute",new{userId,path},ct));
        return new { allowed=(bool)row.allowed, landing=(string)row.landing, audience=(string?)row.audience };
    }
}
