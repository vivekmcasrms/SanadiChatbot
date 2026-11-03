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
    private static InteractionsController.Input SuggestionInput(string title, string description, Guid? conversation, string lang)
        => new(title,description,"suggestion",null,null,null,null,null,null,null,false,null,conversation,lang);

    private async Task<JsonObject> FinishSuggestionTurn(DbConnection conn, Guid userId, Guid conversationId,
        string text, string lang, Classification classification, Guid traceId, Stopwatch sw, CancellationToken ct)
    {
        var input = SuggestionInput(text[..Math.Min(120,text.Length)],text,conversationId,lang);
        var decision = await InteractionsController.ClassifyWithUnit(conn,userId,input,clients,logger,ct,confirmedSuggestionIntent:true);
        if ((string)decision.interactionType != "suggestion") throw new SanadiException("This report needs the alert workflow. Please report the emergency separately.");
        string unit = lang == "ar" ? decision.serviceLabel.ar : decision.serviceLabel.en;
        var policy = await conn.QueryFirstOrDefaultAsync<ToolPolicy>(DbProc.Call("usp_Assistant_GetToolPolicy",new {name="create_suggestion"},ct));
        var roles = (await conn.QueryAsync<string>(DbProc.Call("usp_Assistant_GetUserRoles",new {userId},ct))).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (roles.Count == 0) roles.Add("student");
        var actions = new JsonArray();
        if (policy is null || (policy.Enabled && Allowed(policy.Roles,roles)))
            actions.Add(new JsonObject {
                ["key"]="create_suggestion",["toolName"]="create_suggestion",
                ["labelEn"]="Submit this suggestion",["labelAr"]="تقديم هذا الاقتراح",
                ["risk"]=policy?.Risk ?? "level_1",["affectedService"]=unit,["responsibleUnit"]=unit,
                ["dataShared"]=lang=="ar"?"اسمك ورقمك الجامعي ونص الاقتراح":"Your name, student number and suggestion",
                ["expectedOutcome"]=lang=="ar"?"اقتراح قابل للتتبع برقم مرجعي":"A tracked suggestion with a reference number",
                ["consequence"]=lang=="ar"?"تتم مشاركة اقتراحك مع الوحدة المعنية للمراجعة. ولا يتغير أي شيء في سجلك.":"Your suggestion is shared with the relevant unit for review. Nothing on your record changes.",
                ["fee"]=lang=="ar"?"بدون رسوم":"No fee",["reversible"]="no",["route"]="/requests",
                ["humanApprovalRequired"]=policy?.HumanApproval == true || policy?.Risk == "level_3",
                ["args"]=new JsonObject { ["title"]=input.Title,["description"]=text,
                    ["unitId"]=((Guid?)decision.unitId)?.ToString(),["lang"]=lang }
            });
        var routed = classification with { Intent="suggestion",Category="suggestion",RequiredUnitCode=(string)decision.serviceCode,
            RequiredUnitName=unit,ActionRequested=true,Confidence=(decimal)(double)decision.confidence };
        var answer = SuggestionChatFlow.Answer(text,unit,lang,actions.Count > 0);
        var assistantId = Guid.NewGuid();
        var responseType = actions.Count > 0 ? "action_proposal" : "answer";
        var response = new JsonObject {
            ["agent"]="suggestion",["classification"]=JsonSerializer.SerializeToNode(routed,Json),["answer"]=answer,
            ["verified"]=false,["citations"]=new JsonArray(),["proposedActions"]=actions,
            ["messageId"]=assistantId.ToString(),["conversationId"]=conversationId.ToString(),["responseType"]=responseType,
            ["intents"]=new JsonArray(new JsonObject { ["intent"]="suggestion",["category"]="suggestion",["confidence"]=routed.Confidence,["handled"]=true }),
            ["clarifyingQuestion"]=null,["nextSteps"]=new JsonArray(),
            ["toolsUsed"]=new JsonArray(),["activity"]=new JsonArray(lang=="ar"?$"أعددت الاقتراح للجهة المختصة: {unit}. لم يتم تقديمه بعد.":$"Prepared the suggestion for {unit}. It has not been submitted."),
            ["confidence"]=routed.Confidence,["fallbackUsed"]=false,["humanHandoff"]=false,["receipt"]=null,["issuedDocument"]=null,
            ["careerInsight"]=null,["libraryResults"]=null,["caseResult"]=null,["followUp"]=null,["traceId"]=TraceRef(traceId)
        };
        var metadata = response.DeepClone().AsObject(); metadata.Remove("answer");
        await conn.ExecuteAsync(DbProc.Call("usp_Assistant_InsertRunAndMessage",new {
            assistantId,conversationId,userId,content=answer,lang,metadata=metadata.ToJsonString(Json),traceId,agent="suggestion",
            input=JsonSerializer.Serialize(new {message=text},Json),output=response.ToJsonString(Json),latency=(int)sw.ElapsedMilliseconds,
            model=(string?)null,provider="configured_routing",responseType,confidence=routed.Confidence,tools=1,fallback=false,handoff=false
        },ct));
        return response;
    }

    private static async Task<JsonObject> LoadSuggestionProposal(DbConnection conn, Guid userId, ActionRequest request, CancellationToken ct)
    {
        var metadata = await conn.ExecuteScalarAsync<string>(DbProc.Call("usp_Assistant_GetSuggestionProposal",new {
            userId,conversationId=request.ConversationId,messageId=request.MessageId
        },ct));
        var action = (JsonNode.Parse(metadata ?? "{}")?["proposedActions"] as JsonArray)?
            .FirstOrDefault(a => (string?)a?["toolName"] == "create_suggestion" && (string?)a?["key"] == request.ActionKey);
        if (action?["args"] is not JsonObject args) throw new ForbiddenException("This suggestion proposal was not found. Please prepare it again in your chat.");
        // Use only the owned, persisted proposal. Browser edits cannot change its text or recipient.
        return args.DeepClone().AsObject();
    }

    private async Task<(object Data,string? Reference,string? Unit,string? Tracking,string NextEn,string NextAr,object? Document)>
        ExecuteSuggestion(DbConnection conn, Guid userId, JsonObject args, Guid? conversation, string lang, CancellationToken ct)
    {
        lang = (string?)args["lang"] ?? lang;
        var input = SuggestionInput((string)args["title"]!, (string)args["description"]!,conversation,lang);
        var decision = await InteractionsController.ClassifyWithUnit(conn,userId,input,clients,logger,ct,confirmedSuggestionIntent:true);
        if ((string)decision.interactionType != "suggestion") throw new SanadiException("This report needs the alert workflow. Please report the emergency separately.");
        // A changed catalogue/model decision must be shown and approved again, never silently rerouted.
        if (args.ContainsKey("unitId") && ((Guid?)decision.unitId)?.ToString() != (string?)args["unitId"])
            throw new SanadiException("The responsible unit has changed. Please send your suggestion again to review the updated destination.");
        var result = JsonSerializer.SerializeToNode(await InteractionsController.SubmitClassified(conn,userId,input,decision,channel:"chat"),Json)!;
        var reference = (string?)result["reference"];
        string unit = lang=="ar" ? decision.serviceLabel.ar : decision.serviceLabel.en;
        return (result,reference,unit,(string?)result["trackingUrl"],
            "Your suggestion has been sent to the responsible unit for review. Keep your reference number to follow up.",
            "سيراجع الفريق المختص اقتراحك. احتفظ بالرقم المرجعي للمتابعة.",null);
    }
}
