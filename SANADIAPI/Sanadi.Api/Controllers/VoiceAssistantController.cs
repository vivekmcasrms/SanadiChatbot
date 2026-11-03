using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.AI;
using Sanadi.Api.Security;
using Sanadi.Domain.Exceptions;

using Sanadi.Api.Middleware;

namespace Sanadi.Api.Controllers;

/// <summary>
/// Voice chat assistant endpoint. Separate from the text chat endpoints in
/// <see cref="AssistantController"/> (api/chat): its own route, request shape,
/// response envelope and error mapping. The transcript itself is passed unchanged
/// to the text assistant pipeline through <see cref="AssistantController.RunTurn"/>.
/// </summary>
[ApiController]
[Route("api/voice/chat")]
public sealed class VoiceAssistantController(
    AssistantController assistant,
    ILogger<VoiceAssistantController> logger) : ControllerBase
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Spoken request. Attachments are not part of a voice turn.</summary>
    public sealed record VoiceAskRequest(string Message, Guid? ConversationId, string? Lang, string? SupportAgent = null, bool SpokenOnly = false);

    private Guid RequireUserId()
    {
        var user = HttpContext.GetSanadiUser();
        if (!user.IsAuthenticated || user.UserId is not Guid id) throw new UnauthorizedException();
        return id;
    }

    /// <summary>
    /// One complete spoken turn. Voice waits for the full answer, so this returns
    /// JSON rather than a token stream.
    /// </summary>
    [HttpPost("ask")]
    public async Task<IActionResult> Ask([FromBody] VoiceAskRequest? request, CancellationToken ct)
    {
        var userId = RequireUserId();
        var message = request?.Message?.Trim() ?? "";
        if (message.Length == 0) return BadRequest(new { error = "message_required" });
        var lang = AssistantController.ReplyLanguage(message, request?.Lang);
        var trace = Guid.NewGuid().ToString();

        // The engine reads the current request (user, host, cancellation) from its controller context.
        assistant.ControllerContext = new ControllerContext { HttpContext = HttpContext };
        try
        {
            var result = await assistant.RunTurn(
                new AssistantController.AskRequest(message, request?.ConversationId, lang, null, request?.SupportAgent),
                userId, ct, trace);
            // The answer keeps the text chatbot's Sanadi Online layout for the chat window;
            // `speech` is a brief overview selected from that same final answer.
            var speech = VoiceReplyNarration.Overview(result, message, lang);
            return new JsonResult(new VoiceTurnResult(trace, result, speech), Json);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (UnauthorizedException) { throw; }
        catch (ForbiddenException) { throw; }
        catch (SanadiException exception)
        {
            ApiErrorPolicy.LogOnce(logger, exception, HttpContext, nameof(Ask), trace);
            return BadRequest(new { error = exception.Message, traceId = trace });
        }
        catch (Exception exception)
        {
            ApiErrorPolicy.LogOnce(logger, exception, HttpContext, nameof(Ask), trace);
            return StatusCode(StatusCodes.Status502BadGateway, new { error = "voice_assistant_unavailable", traceId = trace });
        }
    }

    /// <summary>
    /// Voice response envelope: the unchanged assistant response (text layout, used when a
    /// proposal must be shown in the chat window) and the spoken rendering of its answer.
    /// </summary>
    public sealed record VoiceTurnResult(string TraceId, JsonObject Response, string Speech);
}
