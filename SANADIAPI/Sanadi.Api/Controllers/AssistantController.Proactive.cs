using System.Data.Common;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Sanadi.Api.AI;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

public sealed partial class AssistantController
{
    private async Task<JsonObject> FinishProactiveTurn(DbConnection conn, Guid userId, Guid conversationId,
        string text, string lang, Classification classification, Guid traceId, Stopwatch sw,
        ProactiveServiceFlow.Reply reply, CancellationToken ct)
    {
        var ar = lang == "ar";
        var routed = classification with
        {
            Intent = "query", Category = reply.Category, RequiredUnitCode = null, RequiredUnitName = null,
            ActionRequested = false, RequiresHumanEscalation = false, Confidence = .95m
        };
        var assistantId = Guid.NewGuid();
        var response = new JsonObject
        {
            ["agent"] = "query", ["classification"] = JsonSerializer.SerializeToNode(routed, Json),
            ["answer"] = reply.Answer, ["verified"] = true, ["citations"] = new JsonArray(),
            ["proposedActions"] = new JsonArray(), ["messageId"] = assistantId.ToString(),
            ["conversationId"] = conversationId.ToString(), ["responseType"] = "answer",
            ["intents"] = new JsonArray(new JsonObject { ["intent"] = "query", ["category"] = reply.Category, ["confidence"] = .95m, ["handled"] = true }),
            ["clarifyingQuestion"] = null, ["nextSteps"] = new JsonArray(),
            ["toolsUsed"] = new JsonArray(),
            ["activity"] = new JsonArray(ar ? "راجعت معلومات الجامعة الرسمية" : "Checked official university information"),
            ["confidence"] = .95m, ["fallbackUsed"] = false, ["humanHandoff"] = false,
            ["receipt"] = null, ["issuedDocument"] = null, ["careerInsight"] = null, ["libraryResults"] = null,
            ["caseResult"] = null, ["followUp"] = null, ["traceId"] = TraceRef(traceId)
        };
        var metadata = response.DeepClone().AsObject(); metadata.Remove("answer");
        await conn.ExecuteAsync(DbProc.Call("usp_Assistant_InsertRunAndMessage", new
        {
            assistantId, conversationId, userId, content = reply.Answer, lang, metadata = metadata.ToJsonString(Json),
            traceId, agent = "query", input = JsonSerializer.Serialize(new { message = text, service = reply.ServiceCode }, Json),
            output = response.ToJsonString(Json), latency = (int)sw.ElapsedMilliseconds, model = (string?)null,
            provider = "deterministic", responseType = "answer", confidence = .95m, tools = 0, fallback = false, handoff = false
        }, ct));
        return response;
    }
}
