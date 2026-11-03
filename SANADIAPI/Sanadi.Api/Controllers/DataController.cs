using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Http;
using Sanadi.Api.Security;
using Sanadi.Application.Data;

namespace Sanadi.Api.Controllers;

[ApiController]
[Route("rest/v1")]
[Route("api/v1/data")]
public sealed class DataController(IDataQueryService data) : ControllerBase
{
    [HttpGet("{table}")]
    [HttpHead("{table}")]
    [HttpPost("{table}")]
    [HttpPatch("{table}")]
    [HttpDelete("{table}")]
    public async Task<IActionResult> Execute(string table, CancellationToken cancellationToken)
    {
        var user = HttpContext.GetSanadiUser();
        if (!user.IsAuthenticated)
        {
            return Unauthorized(new
            {
                code = "session_expired",
                message = "Your session has expired. Please sign in again.",
                details = (string?)null,
                hint = "Sign in again, then retry this request."
            });
        }

        object? payload = null;
        if (HttpMethods.IsPost(Request.Method) || HttpMethods.IsPatch(Request.Method))
        {
            if (Request.ContentLength is > 0)
            {
                using var doc = await JsonDocument.ParseAsync(Request.Body, cancellationToken: cancellationToken);
                payload = doc.RootElement.Clone();
            }
        }

        var request = PostgrestQueryParser.Parse(table, Request.Method, Request.Query, Request.Headers, payload);
        var result = await data.ExecuteAsync(request, user, cancellationToken);
        if (result.Count is not null)
            Response.Headers["Content-Range"] = $"0-{Math.Max((result.Count ?? 1) - 1, 0)}/{result.Count}";
        return Ok(result.Data);
    }
}
