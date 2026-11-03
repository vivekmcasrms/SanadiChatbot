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
    private async Task<JsonObject> FinishCareerTurn(DbConnection conn, Guid userId, Guid conversationId, string text,
        string lang, string topic, Classification classification, Guid traceId, Stopwatch sw, CancellationToken ct)
    {
        // Use the same authenticated user and existing analysis/scoring rules as the Career page.
        var analysis = JsonSerializer.SerializeToNode(await CareerController.AnalyseStudent(sql,userId,null,true,ct),Json)!.AsObject();
        var counselling = JsonSerializer.SerializeToNode(await CareerController.FindOpenCounselling(sql,userId,ct),Json);
        var reply = CareerChatFlow.Build(analysis,counselling,topic,lang);
        // Career answers are rendered like Sanadi Online: the unit appears only in the citation,
        // not as a "Routed to" line, and the deterministic analysis adds no activity trail.
        var owningUnit=lang=="ar"?"خدمات المهن والتدريب":"Career and Internship Services";
        var routed = classification with { Intent="query", Category="career", RequiredUnitCode=null, RequiredUnitName=null,
            RequiresStudentData=true, ActionRequested=false, RequiresHumanEscalation=false };
        var assistantId=Guid.NewGuid();
        var response=new JsonObject
        {
            ["agent"]="career", ["classification"]=JsonSerializer.SerializeToNode(routed,Json), ["answer"]=reply.Answer,
            ["verified"]=true, ["citations"]=new JsonArray(new JsonObject {
                ["documentId"]=null, ["sourceTitle"]=lang=="ar"?"تحليل الإرشاد المهني في سندي (سجلك الجامعي وسيرتك الذاتية)":"Sanadi career analysis (your university record and CV)",
                ["owningUnit"]=owningUnit, ["documentVersion"]=$"v{analysis["versionNo"]}",
                ["effectiveDate"]=DateTime.UtcNow.ToString("yyyy-MM-dd"), ["citationUrl"]=null, ["confidence"]="high" }),
            ["proposedActions"]=new JsonArray(), ["messageId"]=assistantId.ToString(), ["conversationId"]=conversationId.ToString(),
            ["responseType"]="answer", ["intents"]=new JsonArray(new JsonObject { ["intent"]="query", ["category"]="career", ["confidence"]=routed.Confidence, ["handled"]=true }),
            ["clarifyingQuestion"]=null, ["nextSteps"]=reply.NextSteps, ["toolsUsed"]=new JsonArray(),
            ["activity"]=new JsonArray(),
            ["confidence"]=routed.Confidence, ["fallbackUsed"]=false, ["humanHandoff"]=false,
            ["receipt"]=null, ["issuedDocument"]=null, ["careerInsight"]=reply.Card, ["libraryResults"]=null,
            ["caseResult"]=null, ["followUp"]=null, ["traceId"]=traceId.ToString()
        };
        var metadata=response.DeepClone().AsObject(); metadata.Remove("answer");
        await conn.ExecuteAsync(DbProc.Call("usp_Assistant_InsertRunAndMessage",new {
            assistantId,conversationId,userId,content=reply.Answer,lang,metadata=metadata.ToJsonString(Json),traceId,agent="career",
            input=JsonSerializer.Serialize(new {message=text},Json),output=response.ToJsonString(Json),latency=(int)sw.ElapsedMilliseconds,
            model=(string?)null,provider="deterministic",responseType="answer",confidence=routed.Confidence,tools=1,fallback=false,handoff=false
        },ct));
        return response;
    }
}
