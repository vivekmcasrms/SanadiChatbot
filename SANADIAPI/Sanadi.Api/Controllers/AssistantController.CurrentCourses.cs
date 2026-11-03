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
    private async Task<List<CurrentCoursesFlow.Course>> LoadCurrentCourses(DbConnection conn, Guid userId, CancellationToken ct) =>
        (await conn.QueryAsync<CurrentCoursesFlow.Course>(DbProc.Call("usp_Assistant_GetTextbookCourses", new { userId }, ct))).ToList();

    private async Task<InteractionUnitRouting.Unit?> FindActiveUnit(DbConnection conn, Guid id, CancellationToken ct)
    {
        using var rows = await conn.QueryMultipleAsync(DbProc.Call("usp_Interactions_GetRoutingCatalog", null, ct));
        var units = (await rows.ReadAsync<InteractionUnitRouting.Unit>()).ToArray();
        await rows.ReadAsync();
        await rows.ReadAsync();
        return units.FirstOrDefault(u => u.Id == id);
    }

    private async Task<InteractionUnitRouting.Unit?> FindActiveUnit(DbConnection conn, string code, CancellationToken ct)
    {
        using var rows = await conn.QueryMultipleAsync(DbProc.Call("usp_Interactions_GetRoutingCatalog", null, ct));
        var units = (await rows.ReadAsync<InteractionUnitRouting.Unit>()).ToArray();
        await rows.ReadAsync();
        await rows.ReadAsync();
        return units.FirstOrDefault(u => string.Equals(u.Code, code, StringComparison.OrdinalIgnoreCase));
    }

    private async Task<JsonObject> FinishCurrentCoursesTurn(DbConnection conn, Guid userId, Guid conversationId,
        string text, string lang, Classification classification, Guid traceId, Stopwatch sw, CancellationToken ct)
    {
        var courses = await LoadCurrentCourses(conn, userId, ct);
        var unit = await FindActiveUnit(conn, "REG", ct);
        var ar = lang == "ar";
        var answer = CurrentCoursesFlow.Answer(courses, lang);
        var routed = classification with
        {
            Intent = "query", Category = "academic_courses_current",
            RequiredUnitCode = unit?.Code, RequiredUnitName = unit is null ? null : ar ? unit.NameAr : unit.NameEn,
            RequiresStudentData = true, ActionRequested = false, RequiresHumanEscalation = false, Confidence = .95m
        };
        return await FinishCourseRecord(conn, userId, conversationId, text, answer, lang, routed, traceId, sw,
            tools: new JsonArray(),
            activity: new JsonArray(ar ? "راجعت موادك" : "Checked your courses"),
            actions: new JsonArray(), ct);
    }

    private async Task<JsonObject?> TryCourseInquiryTurn(DbConnection conn, Guid userId, Guid conversationId,
        string text, string code, string lang, Classification classification, Guid traceId, Stopwatch sw, CancellationToken ct)
    {
        var course = CurrentCoursesFlow.Match(code, await LoadCurrentCourses(conn, userId, ct));
        if (course is null) return null;
        var unit = await FindActiveUnit(conn, "COMP", ct);
        if (unit is null) return null;
        var ar = lang == "ar";
        var unitName = ar ? unit.NameAr : unit.NameEn;
        var answer = CurrentCoursesFlow.Inquiry(course, unitName, unit.Code, lang);
        var title = ar ? $"استفسار عن تفاصيل مقرر {course.Code}" : $"Inquiry about {course.Code} Course Details";
        var description = ar
            ? $"أرغب في تفاصيل توصيف المقرر والمدرّس والجدول للمقرر {course.Code} — {course.TitleAr ?? course.TitleEn}."
            : $"I would like the syllabus, instructor and schedule for {course.Code} — {course.TitleEn}.";
        var actions = new JsonArray(new JsonObject
        {
            ["key"] = "create_enquiry", ["toolName"] = "create_enquiry",
            ["labelEn"] = "Submit this request", ["labelAr"] = "إرسال هذا الطلب",
            ["risk"] = "level_2", ["affectedService"] = unitName, ["responsibleUnit"] = unitName,
            ["dataShared"] = ar ? "اسمك ورقمك الجامعي وتفاصيل الطلب" : "Your name, student number and the request details",
            ["expectedOutcome"] = ar ? "طلب مسجل برقم مرجعي" : "A tracked request with a reference number",
            ["consequence"] = ar ? "يفتح طلب رسمي باسمك لدى الجهة المسؤولة. يمكنك سحبه لاحقاً." : "An official request is opened in your name for the responsible unit. You can withdraw it later.",
            ["fee"] = ar ? "بدون رسوم" : "No fee", ["reversible"] = "conditional", ["route"] = "/requests",
            ["humanApprovalRequired"] = false,
            ["args"] = new JsonObject
            {
                ["smartConcern"] = true, ["courseInquiry"] = true, ["type"] = "query", ["title"] = title,
                ["description"] = description, ["unitId"] = unit.Id.ToString(), ["lang"] = lang
            }
        });
        var routed = classification with
        {
            Intent = "query", Category = "course_detail_inquiry",
            RequiredUnitCode = unit.Code, RequiredUnitName = unitName,
            RequiresStudentData = true, ActionRequested = true, RequiresHumanEscalation = false, Confidence = .9m
        };
        return await FinishCourseRecord(conn, userId, conversationId, text, answer, lang, routed, traceId, sw,
            tools: new JsonArray("get_my_courses"),
            activity: new JsonArray(),
            actions: actions, ct);
    }

    private async Task<JsonObject> FinishCourseRecord(DbConnection conn, Guid userId, Guid conversationId,
        string text, string answer, string lang, Classification classification, Guid traceId, Stopwatch sw,
        JsonArray tools, JsonArray activity, JsonArray actions, CancellationToken ct)
    {
        var assistantId = Guid.NewGuid();
        var response = new JsonObject
        {
            ["agent"] = "academic", ["classification"] = JsonSerializer.SerializeToNode(classification, Json),
            ["answer"] = answer, ["verified"] = true, ["citations"] = new JsonArray(),
            ["proposedActions"] = actions, ["messageId"] = assistantId.ToString(),
            ["conversationId"] = conversationId.ToString(), ["responseType"] = actions.Count > 0 ? "action_proposal" : "answer",
            ["intents"] = new JsonArray(new JsonObject { ["intent"] = "query", ["category"] = classification.Category, ["confidence"] = .95m, ["handled"] = true }),
            ["clarifyingQuestion"] = null, ["nextSteps"] = new JsonArray(),
            ["toolsUsed"] = tools, ["activity"] = activity,
            ["confidence"] = .95m, ["fallbackUsed"] = false, ["humanHandoff"] = false,
            ["receipt"] = null, ["issuedDocument"] = null, ["careerInsight"] = null, ["libraryResults"] = null,
            ["caseResult"] = null, ["followUp"] = null, ["traceId"] = TraceRef(traceId)
        };
        var metadata = response.DeepClone().AsObject(); metadata.Remove("answer");
        await conn.ExecuteAsync(DbProc.Call("usp_Assistant_InsertRunAndMessage", new
        {
            assistantId, conversationId, userId, content = answer, lang, metadata = metadata.ToJsonString(Json),
            traceId, agent = "academic", input = JsonSerializer.Serialize(new { message = text }, Json),
            output = response.ToJsonString(Json), latency = (int)sw.ElapsedMilliseconds, model = (string?)null,
            provider = "deterministic", responseType = (string)response["responseType"]!, confidence = .95m,
            tools = tools.Count, fallback = false, handoff = false
        }, ct));
        return response;
    }
}
