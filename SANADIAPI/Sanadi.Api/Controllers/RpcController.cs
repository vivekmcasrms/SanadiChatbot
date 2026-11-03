using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Application.Rpc;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.Controllers;

[ApiController]
[Route("rest/v1/rpc")]
[Route("api/v1/rpc")]
public sealed class RpcController(IRpcExecutor rpc) : ControllerBase
{
    [HttpPost("{name}")]
    [HttpGet("{name}")]
    public async Task<IActionResult> Execute(string name, CancellationToken cancellationToken)
    {
        var user = HttpContext.GetSanadiUser();
        if (!user.IsAuthenticated) throw new UnauthorizedException();

        JsonElement args = default;
        if (HttpMethods.IsPost(Request.Method) && Request.ContentLength is > 0)
        {
            using var doc = await JsonDocument.ParseAsync(Request.Body, cancellationToken: cancellationToken);
            args = doc.RootElement.Clone();
        }
        else
        {
            var dict = Request.Query.ToDictionary(k => k.Key, k => (object?)k.Value.ToString());
            args = JsonSerializer.SerializeToElement(dict);
        }

        var result = await rpc.ExecuteAsync(
            name,
            args.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null
                ? JsonSerializer.SerializeToElement(new Dictionary<string, string>())
                : args,
            user,
            cancellationToken);
        // Ok(string) is text/plain; letter issuance JSON-parses the body.
        if (result is string) return new JsonResult(result);
        return Ok(result);
    }
}
