using System.Data.Common;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Sanadi.Api.AI;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

public sealed partial class AssistantController
{
    private static InteractionsController.Input ComplaintInput(string title, string description, Guid? conversation, string lang)
        => new(title,description,"complaint",null,null,null,null,null,null,null,false,null,conversation,lang);

    private async Task<JsonObject> FinishComplaintTurn(DbConnection conn, Guid userId, Guid conversationId,
        string text, string lang, Classification classification, Guid traceId, Stopwatch sw, CancellationToken ct)
    {
        var input = ComplaintInput(text[..Math.Min(120,text.Length)],text,conversationId,lang);
        var decision = await InteractionsController.ClassifyWithUnit(conn,userId,input,clients,logger,ct,confirmedComplaintIntent:true);
        string unit = lang == "ar" ? decision.serviceLabel.ar : decision.serviceLabel.en;
        var policy = await conn.QueryFirstOrDefaultAsync<ToolPolicy>(DbProc.Call("usp_Assistant_GetToolPolicy",new {name="create_complaint"},ct));
        var roles = (await conn.QueryAsync<string>(DbProc.Call("usp_Assistant_GetUserRoles",new {userId},ct))).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (roles.Count == 0) roles.Add("student");
        var actions = new JsonArray();
        if (policy is null || (policy.Enabled && Allowed(policy.Roles,roles)))
            actions.Add(new JsonObject {
                ["key"]="create_complaint",["toolName"]="create_complaint",
                ["labelEn"]="Submit this complaint",["labelAr"]="تقديم هذه الشكوى",
                ["risk"]=policy?.Risk ?? "level_2",["affectedService"]=unit,["responsibleUnit"]=unit,
                ["dataShared"]=lang=="ar"?"اسمك ورقمك الجامعي ووصف المشكلة":"Your name, student number and the issue description",
                ["expectedOutcome"]=lang=="ar"?"طلب قابل للتتبع برقم مرجعي وموعد استجابة":"A tracked case with a reference number and a service deadline",
                ["consequence"]=lang=="ar"?"تُفتح شكوى رسمية باسمك لدى الجهة المسؤولة. يمكنك سحبها لاحقاً.":"An official case is opened in your name for the responsible unit. You can withdraw it later.",
                ["fee"]=lang=="ar"?"بدون رسوم":"No fee",["reversible"]="conditional",["route"]="/requests",
                ["humanApprovalRequired"]=policy?.HumanApproval == true || policy?.Risk == "level_3",
                ["args"]=new JsonObject { ["title"]=input.Title,["description"]=text,
                    ["unitId"]=((Guid?)decision.unitId)?.ToString(),["lang"]=lang }
            });
        var routed = classification with { Intent="complaint",Category="complaint",RequiredUnitCode=(string)decision.serviceCode,
            RequiredUnitName=unit,ActionRequested=true,Confidence=(decimal)(double)decision.confidence };
        var answer = ComplaintChatFlow.Answer(unit,lang,actions.Count > 0);
        var assistantId = Guid.NewGuid();
        var responseType = actions.Count > 0 ? "action_proposal" : "answer";
        var response = new JsonObject {
            ["agent"]="complaint",["classification"]=JsonSerializer.SerializeToNode(routed,Json),["answer"]=answer,
            ["verified"]=true,["citations"]=new JsonArray(),["proposedActions"]=actions,
            ["messageId"]=assistantId.ToString(),["conversationId"]=conversationId.ToString(),["responseType"]=responseType,
            ["intents"]=new JsonArray(new JsonObject { ["intent"]="complaint",["category"]="complaint",["confidence"]=routed.Confidence,["handled"]=true }),
            ["clarifyingQuestion"]=null,["nextSteps"]=actions.Count>0?new JsonArray(lang=="ar"?"راجع الشكوى ثم وافق على تقديمها.":"Review and approve the complaint using the confirmation button."):new JsonArray(),
            ["toolsUsed"]=new JsonArray("classify_interaction"),["activity"]=new JsonArray(lang=="ar"?$"أعددت الشكوى للجهة المختصة: {unit}. لم يتم تقديمها بعد.":$"Prepared the complaint for {unit}. It has not been submitted."),
            ["confidence"]=routed.Confidence,["fallbackUsed"]=false,["humanHandoff"]=false,["receipt"]=null,["issuedDocument"]=null,
            ["careerInsight"]=null,["libraryResults"]=null,["caseResult"]=null,["followUp"]=null,["traceId"]=TraceRef(traceId)
        };
        var metadata = response.DeepClone().AsObject(); metadata.Remove("answer");
        await conn.ExecuteAsync(DbProc.Call("usp_Assistant_InsertRunAndMessage",new {
            assistantId,conversationId,userId,content=answer,lang,metadata=metadata.ToJsonString(Json),traceId,agent="complaint",
            input=JsonSerializer.Serialize(new {message=text},Json),output=response.ToJsonString(Json),latency=(int)sw.ElapsedMilliseconds,
            model=(string?)null,provider="configured_routing",responseType,confidence=routed.Confidence,tools=1,fallback=false,handoff=false
        },ct));
        return response;
    }

    private static async Task<JsonObject> LoadComplaintProposal(DbConnection conn, Guid userId, ActionRequest request, CancellationToken ct)
    {
        var metadata = await conn.ExecuteScalarAsync<string>(DbProc.Call("usp_Assistant_GetComplaintProposal",new {
            userId,conversationId=request.ConversationId,messageId=request.MessageId
        },ct));
        var action = (JsonNode.Parse(metadata ?? "{}")?["proposedActions"] as JsonArray)?
            .FirstOrDefault(a => (string?)a?["toolName"] == "create_complaint" && (string?)a?["key"] == request.ActionKey);
        if (action?["args"] is not JsonObject args) throw new ForbiddenException("This complaint proposal was not found. Please prepare it again in your chat.");
        // Use only the owned, persisted proposal. Browser edits cannot change its text or recipient.
        return args.DeepClone().AsObject();
    }

    private async Task<(object Data,string? Reference,string? Unit,string? Tracking,string NextEn,string NextAr,object? Document)>
        ExecuteComplaint(DbConnection conn, Guid userId, JsonObject args, Guid? conversation, string lang, CancellationToken ct)
    {
        lang = (string?)args["lang"] ?? lang;
        var input = ComplaintInput((string)args["title"]!, (string)args["description"]!,conversation,lang);
        var decision = await InteractionsController.ClassifyWithUnit(conn,userId,input,clients,logger,ct,confirmedComplaintIntent:true);
        // A changed catalogue/model decision must be shown and approved again, never silently rerouted.
        if (args.ContainsKey("unitId") && ((Guid?)decision.unitId)?.ToString() != (string?)args["unitId"])
            throw new SanadiException("The responsible unit has changed. Please send your complaint again to review the updated destination.");
        var result = JsonSerializer.SerializeToNode(await InteractionsController.SubmitClassified(conn,userId,input,decision,channel:"chat"),Json)!;
        var reference = (string?)result["reference"];
        string unit = lang=="ar" ? decision.serviceLabel.ar : decision.serviceLabel.en;
        return (result,reference,unit,(string?)result["trackingUrl"],
            "The responsible team will review your complaint. Track its deadline and updates in My Requests.",
            "سيراجع الفريق المختص شكواك. تابع موعد الاستجابة والتحديثات في طلباتي.",null);
    }
}
