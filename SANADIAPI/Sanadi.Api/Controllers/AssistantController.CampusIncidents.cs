using System.Data.Common;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Sanadi.Api.AI;
using Sanadi.Api.Notifications;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

public sealed partial class AssistantController
{
    private static async Task<CampusIncidentRouting.Contact?> MatchCampusIncident(DbConnection conn, string text, CancellationToken ct)
    {
        if (!CampusIncidentRouting.IsCandidate(text)) return null;
        var contacts = await conn.QueryAsync<CampusIncidentRouting.Contact>(DbProc.Call("usp_Assistant_GetIncidentContacts", null, ct));
        return CampusIncidentRouting.Match(text, contacts);
    }

    private async Task<JsonObject> FinishCampusIncidentTurn(DbConnection conn, Guid userId, Guid conversationId,
        string text, string lang, Classification classification, Guid traceId, Stopwatch sw,
        CampusIncidentRouting.Contact contact, CancellationToken ct)
    {
        var ar = lang == "ar";
        var unit = CampusIncidentRouting.UnitName(contact, lang);
        var policy = await conn.QueryFirstOrDefaultAsync<ToolPolicy>(DbProc.Call("usp_Assistant_GetToolPolicy", new { name = "report_alert" }, ct));
        var roles = (await conn.QueryAsync<string>(DbProc.Call("usp_Assistant_GetUserRoles", new { userId }, ct))).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (roles.Count == 0) roles.Add("student");
        var actions = new JsonArray();
        if (policy is null || (policy.Enabled && Allowed(policy.Roles, roles)))
            actions.Add(IncidentProposal(text, lang, contact, policy?.Risk ?? "level_2", policy?.HumanApproval == true || policy?.Risk == "level_3"));
        var routed = classification with
        {
            Intent = "alert", Category = contact.Code, RequiredUnitCode = contact.Code, RequiredUnitName = unit,
            ActionRequested = true, Urgency = classification.RequiresHumanEscalation ? "critical" : "high",
            Sentiment = "negative", RequiresHumanEscalation = false, Confidence = .95m
        };
        var answer = CampusIncidentRouting.Answer(contact, lang);
        var assistantId = Guid.NewGuid();
        var responseType = actions.Count > 0 ? "action_proposal" : "answer";
        var response = new JsonObject
        {
            ["agent"] = "alert", ["classification"] = JsonSerializer.SerializeToNode(routed, Json),
            ["answer"] = answer, ["verified"] = true,
            ["citations"] = new JsonArray(new JsonObject
            {
                ["documentId"] = null,
                ["sourceTitle"] = ar ? "سجل جهات الطوارئ المعتمد في الجامعة" : "Official university emergency contact register",
                ["owningUnit"] = unit, ["confidence"] = "high", ["citationUrl"] = null
            }),
            ["proposedActions"] = actions, ["messageId"] = assistantId.ToString(), ["conversationId"] = conversationId.ToString(),
            ["responseType"] = responseType,
            ["intents"] = new JsonArray(new JsonObject { ["intent"] = "alert", ["category"] = contact.Code, ["confidence"] = .95m, ["handled"] = true }),
            ["clarifyingQuestion"] = null, ["nextSteps"] = new JsonArray(),
            ["toolsUsed"] = new JsonArray("get_emergency_contact"),
            ["activity"] = new JsonArray(ar ? "حددت الجهة المختصة من سجل جهات الطوارئ المعتمد" : "Matched the incident to the responsible unit in the official contact register"),
            ["confidence"] = .95m, ["fallbackUsed"] = false, ["humanHandoff"] = false,
            ["receipt"] = null, ["issuedDocument"] = null, ["careerInsight"] = null, ["libraryResults"] = null,
            ["caseResult"] = null, ["followUp"] = null, ["traceId"] = TraceRef(traceId)
        };
        // Correct the initial generic working-agent stage once database routing is known.
        if (Response.ContentType == "text/event-stream")
            await Send(new { type = "stage", stage = "emergency", agent = new
            {
                key = "emergency", displayName = ar ? "وكيل الطوارئ والسلامة" : "Emergency & Safety Agent",
                statusText = ar ? $"جلبت بيانات الاتصال المعتمدة لـ {unit}" : $"Retrieved official contact details for {unit}", domain = "emergency"
            } }, ct);
        var metadata = response.DeepClone().AsObject(); metadata.Remove("answer");
        await conn.ExecuteAsync(DbProc.Call("usp_Assistant_InsertRunAndMessage", new
        {
            assistantId, conversationId, userId, content = answer, lang, metadata = metadata.ToJsonString(Json), traceId,
            agent = "alert", input = JsonSerializer.Serialize(new { message = text }, Json), output = response.ToJsonString(Json),
            latency = (int)sw.ElapsedMilliseconds, model = (string?)null, provider = "deterministic", responseType,
            confidence = .95m, tools = 1, fallback = false, handoff = false
        }, ct));
        return response;
    }

    internal static JsonObject IncidentProposal(string text, string lang, CampusIncidentRouting.Contact contact, string risk, bool humanApproval)
    {
        var unit = CampusIncidentRouting.UnitName(contact, lang);
        return new JsonObject
        {
            ["key"] = "report_alert", ["toolName"] = "report_alert",
            ["labelEn"] = $"Notify {CampusIncidentRouting.UnitName(contact, "en")} now",
            ["labelAr"] = $"إبلاغ {CampusIncidentRouting.UnitName(contact, "ar")} الآن",
            ["risk"] = risk, ["affectedService"] = (lang == "ar" ? contact.CategoryAr : contact.CategoryEn) ?? contact.Code,
            ["responsibleUnit"] = unit, ["dataShared"] = "Your name, student number and your report",
            ["expectedOutcome"] = "An urgent alert is tracked as a case for the responsible team",
            ["consequence"] = "Your report creates an official case and you receive a reference number to follow up",
            ["fee"] = "No fee", ["route"] = "/requests", ["reversible"] = "no", ["humanApprovalRequired"] = humanApproval,
            ["args"] = new JsonObject { ["title"] = text[..Math.Min(80, text.Length)], ["description"] = text, ["unitCode"] = contact.UnitEn }
        };
    }

    private sealed record IncidentCaseRoute(Guid? UnitId, Guid? OwnerId, string? UnitEn, string? UnitAr);

    private static async Task<(object Data, string? Reference, string? Unit, string? Tracking, string NextEn, string NextAr, object? Document)>
        ExecuteCampusIncident(DbConnection conn, Guid userId, string title, string description, Guid? conversationId,
        string lang, CampusIncidentRouting.Contact contact, CancellationToken ct)
    {
        var id = Guid.NewGuid();
        var reference = $"CASE-{DateTime.UtcNow:yyyyMMdd}-{Random.Shared.Next(10000, 99999)}";
        var urgency = Classify(description, lang).RequiresHumanEscalation ? "critical" : "high";
        // SQL resolves the current active unit again; client-supplied routing is never used.
        var route = await conn.QuerySingleAsync<IncidentCaseRoute>(DbProc.Call("usp_Assistant_InsertIncidentCase",
            new { id, reference, userId, title, description, lang, conversationId, contactId = contact.Id, urgency }, ct));
        var unit = (lang == "ar" ? route.UnitAr : route.UnitEn) ?? CampusIncidentRouting.UnitName(contact, lang);
        await InAppNotify.PushCaseOpenedAsync(conn, id, reference, userId, route.UnitId, route.OwnerId, urgency, userId, unit, ct);
        if (route.OwnerId is null)
            await InAppNotify.PushAdminsAsync(conn, "case_escalated", id, reference, $"Alert {reference} needs a unit owner.", route.UnitId, userId, "alert", ct: ct);
        return (new { id, reference }, reference, unit, $"/requests/{id}",
            "The responsible team will review your alert. Track it in My Requests.", "سيراجع الفريق المختص بلاغك. تابعه من صفحة طلباتي.", null);
    }
}
