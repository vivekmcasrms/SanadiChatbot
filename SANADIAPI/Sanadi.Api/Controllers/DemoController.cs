using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Application.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Domain.Security;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

[ApiController]
[Route("api/demo")]
public sealed class DemoController(ISqlConnectionFactory sql, IPermissionService permissions, IConfiguration config) : ControllerBase
{
    private Guid UserId()
    {
        var user = HttpContext.GetSanadiUser();
        if (!user.IsAuthenticated || user.UserId is not Guid id) throw new UnauthorizedException();
        return id;
    }

    [HttpGet("accounts")]
    public async Task<IActionResult> Accounts(CancellationToken ct)
    {
        var actor = UserId();
        if (!await permissions.HasRoleAsync(actor, AppRoles.SystemAdmin, ct)) throw new ForbiddenException();
        await using var db = sql.Create();
        var rows = await db.QueryAsync(DbProc.Call("usp_Demo_ListAccounts", null, ct));
        return Ok(new
        {
            accounts = rows,
            staffPassword = config["DEMO_STAFF_PASSWORD"] ?? "st123456",
            studentPassword = config["DEMO_STUDENT_PASSWORD"] ?? "s123456"
        });
    }

    [AllowAnonymous]
    [HttpGet("access")]
    public IActionResult Access() => Ok(new
    {
        enabled = string.Equals(config["ENABLE_DEMO_ACCESS"], "true", StringComparison.OrdinalIgnoreCase),
        requiresCode = !string.IsNullOrWhiteSpace(config["DEMO_ACCESS_CODE"])
    });

    public sealed record DemoAccessRequest(string? AccessCode);

    [AllowAnonymous]
    [HttpPost("sign-in-accounts")]
    public async Task<IActionResult> SignInAccounts([FromBody] DemoAccessRequest? request, CancellationToken ct)
    {
        if (!string.Equals(config["ENABLE_DEMO_ACCESS"], "true", StringComparison.OrdinalIgnoreCase))
            return NotFound(new { message = "Demo access unavailable" });
        var required = config["DEMO_ACCESS_CODE"]?.Trim();
        if (!string.IsNullOrEmpty(required) && !string.Equals(request?.AccessCode?.Trim(), required, StringComparison.Ordinal))
            throw new ForbiddenException("Invalid demo access code");

        await using var db = sql.Create();
        var students = await db.QueryAsync(DbProc.Call("usp_Demo_ListStudents", null, ct));
        var staff = await db.QueryAsync(DbProc.Call("usp_Demo_ListStaff", null, ct));
        return Ok(new { studentPassword=config["DEMO_STUDENT_PASSWORD"]??"s123456",staffPassword=config["DEMO_STAFF_PASSWORD"]??"st123456",students,staff });
    }

    [HttpPost("provision")]
    public async Task<IActionResult> Provision(CancellationToken ct)
    {
        var actor=UserId();
        if(!await permissions.HasRoleAsync(actor,AppRoles.SystemAdmin,ct))throw new ForbiddenException();
        await using var db=sql.Create();
        var students=await db.ExecuteScalarAsync<int>(DbProc.Call("usp_Demo_CountStudents", null, ct));
        var staff=await db.ExecuteScalarAsync<int>(DbProc.Call("usp_Demo_CountStaff", null, ct));
        await db.ExecuteAsync(DbProc.Call("usp_Demo_InsertAudit", new{actor,metadata=System.Text.Json.JsonSerializer.Serialize(new{students,staff,cases=0,alerts=0,suggestions=0})}, ct));
        return Ok(new{students,staff,cases=0,alerts=0,suggestions=0});
    }
}
