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
    private async Task<JsonObject?> TryTextbookTurn(DbConnection conn, Guid userId, Guid conversationId,
        string text, string lang, Classification classification, Guid traceId, Stopwatch sw, CancellationToken ct,
        bool confirmedIntent = false)
    {
        try
        {
        var explicitQuestion = confirmedIntent || CourseTextbookFlow.IsQuestion(text);
        if (!explicitQuestion)
        {
            if (text.Length > 100) return null;
            // Run has already verified ownership. Use server-persisted context, not client claims.
            var meta = await conn.ExecuteScalarAsync<string?>(DbProc.Call("usp_Assistant_GetLastAssistantMetadata", new { conversationId }, ct));
            if (string.IsNullOrWhiteSpace(meta)) return null;
            try
            {
                if (JsonNode.Parse(meta)?["textbookContext"] is not JsonObject) return null;
            }
            catch (JsonException ex) { LogFunctionError(ex, nameof(TryTextbookTurn)); return null; }
        }
        // Re-read on every turn so withdrawn courses and changed enrollment cannot be reused.
        var courses = (await conn.QueryAsync<CourseTextbookFlow.Course>(DbProc.Call("usp_Assistant_GetTextbookCourses", new { userId }, ct))).ToList();
        if (!explicitQuestion && !CourseTextbookFlow.IsSelection(text, courses)) return null;
        var reply = CourseTextbookFlow.Build(text, courses, lang);
        var ar = lang == "ar";
        var routed = classification with { Intent = "query", Category = "course_textbooks", RequiredUnitCode = "LIB",
            RequiredUnitName = ar ? "خدمات المكتبة" : "Library Services", RequiresStudentData = true,
            ActionRequested = false, RequiresHumanEscalation = false, Confidence = .95m };
        var assistantId = Guid.NewGuid();
        var responseType = reply.AwaitingCourse ? "clarification" : "answer";
        var response = new JsonObject
        {
            ["agent"] = "library", ["classification"] = JsonSerializer.SerializeToNode(routed, Json),
            ["answer"] = reply.Answer, ["verified"] = true, ["citations"] = new JsonArray(),
            ["proposedActions"] = new JsonArray(), ["messageId"] = assistantId.ToString(),
            ["conversationId"] = conversationId.ToString(), ["responseType"] = responseType,
            ["intents"] = new JsonArray(new JsonObject { ["intent"] = "query", ["category"] = "course_textbooks", ["confidence"] = .95m, ["handled"] = true }),
            ["clarifyingQuestion"] = reply.AwaitingCourse ? (ar ? "أي مقرر تقصد؟" : "Which course do you mean?") : null,
            ["nextSteps"] = new JsonArray(),
            ["toolsUsed"] = new JsonArray(reply.Course is null ? "list_registered_courses" : "get_course_textbook"),
            ["activity"] = new JsonArray(ar ? "راجعت مقرراتك المسجلة في سجلك الجامعي" : "Checked your registered courses in your university record",
                ar ? "طبّقت خدمة كتب المقررات الاستباقية عبر Blackboard" : "Applied the proactive Blackboard course-material service"),
            ["confidence"] = .95m, ["fallbackUsed"] = false, ["humanHandoff"] = false,
            ["receipt"] = null, ["issuedDocument"] = null, ["careerInsight"] = null, ["libraryResults"] = null,
            ["caseResult"] = null, ["followUp"] = null, ["traceId"] = traceId.ToString(),
            ["textbookContext"] = new JsonObject { ["awaitingCourse"] = reply.AwaitingCourse,
                ["courseCodes"] = new JsonArray(courses.Select(c => (JsonNode?)JsonValue.Create(c.Code)).ToArray()) }
        };
        var metadata = response.DeepClone().AsObject(); metadata.Remove("answer");
        await conn.ExecuteAsync(DbProc.Call("usp_Assistant_InsertRunAndMessage", new
        {
            assistantId, conversationId, userId, content = reply.Answer, lang, metadata = metadata.ToJsonString(Json),
            traceId, agent = "library", input = JsonSerializer.Serialize(new { message = text }, Json), output = response.ToJsonString(Json),
            latency = (int)sw.ElapsedMilliseconds, model = (string?)null, provider = "deterministic", responseType,
            confidence = .95m, tools = 1, fallback = false, handoff = false
        }, ct));
        return response;
        }
        catch (Exception ex)
        {
            LogFunctionError(ex, nameof(TryTextbookTurn));
            throw;
        }
    }
}
