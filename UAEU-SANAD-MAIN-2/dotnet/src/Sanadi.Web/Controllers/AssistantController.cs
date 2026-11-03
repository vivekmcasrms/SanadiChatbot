using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Application;
using Sanadi.Application.Agent;

namespace Sanadi.Web.Controllers;

[Authorize]
public class AssistantController(AgentOrchestrator orchestrator) : Controller
{
    [HttpGet("/assistant")]
    public IActionResult Index() => View();

    [HttpPost("/api/assistant/ask")]
    [IgnoreAntiforgeryToken]
    public async Task<ActionResult<AgentResponse>> Ask([FromBody] AskDto body, CancellationToken ct)
    {
        var response = await orchestrator.RunAsync(new AskRequest(
            body.Message, body.ConversationId, HttpContext.Language(), User.Id(), User.Roles()), ct);
        return Ok(response);
    }

    [HttpPost("/api/assistant/execute")]
    [IgnoreAntiforgeryToken]
    public async Task<ActionResult<AgentResponse>> Execute([FromBody] ExecuteDto body, CancellationToken ct)
    {
        var response = await orchestrator.ExecuteConfirmedAsync(new ExecuteActionRequest(
            body.ToolName, body.Args ?? new Dictionary<string, object?>(), body.ConversationId,
            HttpContext.Language(), User.Id(), User.Roles()), ct);
        return Ok(response);
    }

    public sealed record AskDto(string Message, Guid? ConversationId);
    public sealed record ExecuteDto(string ToolName, Dictionary<string, object?>? Args, Guid? ConversationId);
}
