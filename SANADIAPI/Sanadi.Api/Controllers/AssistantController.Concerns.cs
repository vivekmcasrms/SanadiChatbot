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
    private async Task<ChatConcernPlanner.Context?> LoadConcernContext(DbConnection db,Guid conversation,CancellationToken ct)
    {
        var raw=await db.ExecuteScalarAsync<string>(DbProc.Call("usp_Assistant_GetLastAssistantMetadata",new {conversationId=conversation},ct));
        return string.IsNullOrWhiteSpace(raw)?null:JsonNode.Parse(raw)?["concernContext"]?.Deserialize<ChatConcernPlanner.Context>(Json);
    }
    private static string ConcernDetails(string text,ChatConcernPlanner.Context? previous,ChatConcernPlanner.Decision plan)
    {
        var details=plan.UsePrevious&&previous is not null?previous.Description+"\n"+text:text;
        return details;
    }
    private static string ConcernTool(string type)=>type switch {"complaint"=>"create_complaint","suggestion"=>"create_suggestion",_=>"create_enquiry"};
    private static string ConcernLabel(string type,string lang)=>lang=="ar"?type switch {"complaint"=>"شكوى","alert"=>"تنبيه","suggestion"=>"اقتراح",_=>"استفسار"}:
        type switch {"complaint"=>"Complaint","alert"=>"Alert","suggestion"=>"Suggestion",_=>"Enquiry"};

    private static string MissingAnswerOffer(string lang)=>lang=="ar"
        ? "ما لقيت في المصادر المتوفرة معلومات موثوقة تجاوب على طلبك. أقدر أساعدك في تقديم استفسار أو شكوى أو تنبيه أو اقتراح.\n\n"
        : "I could not verify an answer from the available sources. I can help raise an Enquiry, Complaint, Alert or Suggestion.\n\n";

    private async Task<JsonObject> FinishConcern(DbConnection db,Guid user,Guid conversation,string details,string lang,
        Classification classification,Guid trace,Stopwatch sw,ChatConcernPlanner.Decision plan,bool noAnswer,CancellationToken ct)
    {
        // Alerts keep their existing incident evidence, location and approval safeguards.
        // Never turn an incident into an enquiry merely because its answer is absent from the KB.
        if(plan.Type=="alert" && !plan.NeedsClarification && plan.Confidence>=ChatConcernPlanner.MinimumConfidence)
        {
            var incident=await MatchCampusIncident(db,details,ct)
                ?? await MatchCampusIncident(db,AssistantRouting.Normalize(details).Normalized,ct);
            if(incident is not null)
                return await FinishCampusIncidentTurn(db,user,conversation,details,lang,classification,trace,sw,incident,ct);
            return await FinishAlertTurn(db,user,conversation,details,lang,
                classification with {Intent="alert",RequiresHumanEscalation=true},trace,sw,null,ct);
        }
        if(plan.NeedsClarification || !plan.CanRoute)
        {
            var question=plan.Question;
            if(string.IsNullOrWhiteSpace(question)) question=lang=="ar"?"شنو الخدمة أو المكان المعني، وشنو صار أو شنو تبي تعرفه؟ أحتاج هالتفاصيل عشان أحدد الجهة المناسبة.":
                "Which service or location is involved, and what happened or what do you need to know? I need those details to identify the right team.";
            return await FinishConcernMessage(db,user,conversation,details,lang,
                classification with {RequiredUnitCode=null,RequiredUnitName=null,ActionRequested=false,Confidence=(decimal)plan.Confidence},trace,sw,
                (noAnswer?MissingAnswerOffer(lang):"")+question,new(details,question,"clarify"),new JsonArray(),question,ct,missingAnswer:noAnswer);
        }
        var unit=lang=="ar"?plan.Unit!.NameAr:plan.Unit!.NameEn;
        var type=ConcernLabel(plan.Type,lang);var tool=ConcernTool(plan.Type);
        var policy=await db.QueryFirstOrDefaultAsync<ToolPolicy>(DbProc.Call("usp_Assistant_GetToolPolicy",new {name=tool},ct));
        var roles=(await db.QueryAsync<string>(DbProc.Call("usp_Assistant_GetUserRoles",new {userId=user},ct))).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if(roles.Count==0)roles.Add("student");
        var actions=new JsonArray();
        if(policy is null || (policy.Enabled&&Allowed(policy.Roles,roles)))
        {
            var suggestion=plan.Type=="suggestion";
            var approvedArgs=new JsonObject { ["smartConcern"]=true,["type"]=plan.Type,["title"]=plan.Title,["description"]=details,
                ["unitId"]=plan.Unit!.UnitId!.Value.ToString(),["lang"]=lang };
            if(plan.Type=="complaint") approvedArgs["routingConfidence"]=plan.Unit.Confidence;
            actions.Add(new JsonObject {
                ["key"]=tool,["toolName"]=tool,["labelEn"]="Submit this "+ConcernLabel(plan.Type,"en").ToLowerInvariant(),
                ["labelAr"]="تقديم "+ConcernLabel(plan.Type,"ar"),["risk"]=policy?.Risk??(suggestion?"level_1":"level_2"),
                ["affectedService"]=unit,["responsibleUnit"]=unit,["dataShared"]=lang=="ar"?"اسمك ورقمك الجامعي ووصف طلبك":"Your name, student number and concern description",
                ["expectedOutcome"]=lang=="ar"?"طلب قابل للتتبع برقم مرجعي":"A tracked "+(suggestion?"suggestion":"case")+" with a reference number",
                ["consequence"]=suggestion?(lang=="ar"?"تتم مشاركة اقتراحك مع الجهة المعنية للمراجعة. ولا يتغير سجلك الأكاديمي.":"Your suggestion is shared with the relevant unit for review. Nothing on your academic record changes."):
                    (lang=="ar"?"يفتح طلب رسمي باسمك لدى الجهة المسؤولة. يمكنك سحبه لاحقاً.":"An official case is opened in your name for the responsible unit. You can withdraw it later."),
                ["fee"]=lang=="ar"?"بدون رسوم":"No fee",["reversible"]=suggestion?"no":"conditional",["route"]="/requests",
                ["humanApprovalRequired"]=policy?.HumanApproval==true||policy?.Risk=="level_3",
                ["args"]=approvedArgs
            });
        }
        // Suggestions open with the same framing as the live Sanadi assistant (what was understood,
        // the student's own words), then the shared submission details and approval step.
        var excerpt=details.Length>160?details[..160].TrimEnd()+"…":details;
        var lead=plan.Type=="suggestion"
            ?(lang=="ar"?$"شكراً لك. فهمت هالكلام كاقتراح لتحسين خدمة جامعية، مو طلب إرشاد شخصي.\n\n**الاقتراح:** {excerpt}\n\n"
                :$"Thank you. I have read this as a suggestion to improve a university service, not a personal request.\n\n**Suggestion:** {excerpt}\n\n")
            :"";
        var answer=lang=="ar"?(noAnswer?MissingAnswerOffer(lang):"")+lead+
            $"سندي بيتعامل مع هالطلب كـ **{type}** ويوجّهه إلى **{unit}**.\n\n### تفاصيل التقديم\n- العنوان: {plan.Title}\n- النوع: {type}\n- الجهة: {unit}\n\n":
            (noAnswer?MissingAnswerOffer(lang):"")+lead+
            $"Sanadi will handle this as {(plan.Type=="query"?"an":"a")} **{type}** and route it to **{unit}**.\n\n### Submission details\n- Title: {plan.Title}\n- Type: {type}\n- Unit: {unit}\n\n";
        answer+=actions.Count>0?(lang=="ar"?"تبي تقدّمه؟ راجع التفاصيل بزر التقديم بعدين وافق في النافذة. ما راح يتقدّم شي قبل موافقتك.":
            "Would you like to submit it? Review the details using the submission button, then approve in the popup. Nothing is submitted until you approve."):
            (lang=="ar"?"التقديم عبر المحادثة مو متاح لحسابك الحين.":"Chat submission is currently unavailable for your account.");
        var routed=classification with {Intent=plan.Type,Category=plan.Type,RequiredUnitCode=plan.Unit!.Code,RequiredUnitName=unit,
            ActionRequested=true,RequiresHumanEscalation=false,Confidence=(decimal)plan.Confidence};
        return await FinishConcernMessage(db,user,conversation,details,lang,routed,trace,sw,answer,
            new(details,"",actions.Count>0?"proposal":"closed"),actions,null,ct,missingAnswer:noAnswer);
    }

    private async Task<JsonObject> FinishConcernMessage(DbConnection db,Guid user,Guid conversation,string input,string lang,
        Classification classification,Guid trace,Stopwatch sw,string answer,ChatConcernPlanner.Context? context,
        JsonArray actions,string? question,CancellationToken ct,bool missingAnswer=false)
    {
        var id=Guid.NewGuid();var responseType=question is not null?"clarification":actions.Count>0?"action_proposal":"answer";
        var response=new JsonObject {
            ["agent"]=actions.Count>0?classification.Intent:"query",["classification"]=JsonSerializer.SerializeToNode(classification,Json),
            ["answer"]=answer,["verified"]=!missingAnswer&&(question is not null||actions.Count==0),["citations"]=new JsonArray(),["proposedActions"]=actions,
            ["messageId"]=id.ToString(),["conversationId"]=conversation.ToString(),["responseType"]=responseType,
            ["intents"]=new JsonArray(),["clarifyingQuestion"]=question,["nextSteps"]=new JsonArray(),["toolsUsed"]=new JsonArray(),
            ["activity"]=new JsonArray(lang=="ar"?"لا يتم إنشاء طلب قبل الموافقة على تفاصيله.":"No concern is submitted before its details are approved."),
            ["confidence"]=classification.Confidence,["fallbackUsed"]=missingAnswer,["humanHandoff"]=false,
            ["receipt"]=null,["issuedDocument"]=null,["careerInsight"]=null,["libraryResults"]=null,["caseResult"]=null,["followUp"]=null,["traceId"]=TraceRef(trace),
            ["concernContext"]=context is null?null:JsonSerializer.SerializeToNode(context,Json)
        };
        var metadata=response.DeepClone().AsObject();metadata.Remove("answer");
        await db.ExecuteAsync(DbProc.Call("usp_Assistant_InsertRunAndMessage",new {assistantId=id,conversationId=conversation,userId=user,
            content=answer,lang,metadata=metadata.ToJsonString(Json),traceId=trace,agent=(string)response["agent"]!,
            input=JsonSerializer.Serialize(new {message=input},Json),output=response.ToJsonString(Json),latency=(int)sw.ElapsedMilliseconds,
            model=(string?)null,provider="configured_intake",responseType,confidence=classification.Confidence,tools=0,fallback=missingAnswer,handoff=false},ct));
        return response;
    }

    private static async Task<JsonObject> LoadEnquiryProposal(DbConnection db,Guid userId,ActionRequest request,CancellationToken ct)
    {
        var raw=await db.ExecuteScalarAsync<string>(DbProc.Call("usp_Assistant_GetConcernProposal",new {userId,conversationId=request.ConversationId,messageId=request.MessageId},ct));
        var action=(JsonNode.Parse(raw??"{}")?["proposedActions"] as JsonArray)?.FirstOrDefault(a=>(string?)a?["toolName"]=="create_enquiry"&&(string?)a?["key"]==request.ActionKey);
        if(action?["args"] is not JsonObject args)throw new ForbiddenException("This enquiry proposal was not found. Please prepare it again in your chat.");
        return args.DeepClone().AsObject();
    }

    internal static InteractionUnitRouting.Decision ConfirmedConcernRoute(JsonObject args,InteractionUnitRouting.Unit? activeUnit)
    {
        // The action loader has already recovered this proposal from the user's saved assistant message.
        // A new model call here can disagree with that approved proposal even when nothing changed.
        if(!Guid.TryParse((string?)args["unitId"],out var proposedId)||activeUnit?.Id!=proposedId)
            throw new SanadiException("The responsible unit is no longer available. Please describe the concern again to review a new proposal.");
        // Older saved proposals did not include routing confidence; use the minimum that was
        // required to display a submission action, rather than inventing a higher score.
        var confidence=ChatConcernPlanner.MinimumConfidence;
        if(args["routingConfidence"] is JsonNode score)
        {
            if(!double.TryParse(score.ToString(),System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture,out confidence)||
                !double.IsFinite(confidence)||confidence<ChatConcernPlanner.MinimumConfidence||confidence>1)
                throw new SanadiException("The confirmed concern proposal is invalid. Please review a new proposal.");
        }
        return new(proposedId,activeUnit.Code,activeUnit.NameEn,activeUnit.NameAr,confidence);
    }

    private async Task<(object Data,string? Reference,string? Unit,string? Tracking,string NextEn,string NextAr,object? Document)>
        ExecuteSmartConcern(DbConnection db,Guid user,string tool,JsonObject args,Guid? conversation,string lang,CancellationToken ct)
    {
        lang=(string?)args["lang"]??lang;
        var type=(string)args["type"]!;var description=(string)args["description"]!;var title=(string)args["title"]!;
        if(ConcernTool(type)!=tool)throw new ForbiddenException("The confirmed concern type does not match this action.");
        if(args["courseInquiry"]?.GetValue<bool>()==true && Guid.TryParse((string?)args["unitId"], out var inquiryUnit))
        {
            var unit=await FindActiveUnit(db, inquiryUnit, ct);
            if(unit is null) throw new SanadiException("The responsible unit could not be confirmed. Please describe the course again.");
            var decision=new InteractionUnitRouting.Decision(unit.Id, unit.Code, unit.NameEn, unit.NameAr, 0.95);
            var prepared=new InteractionsController.Input(title, description, type, null, null, null, null, null, null, null, false, null, conversation, lang);
            var preparedClass=InteractionsController.ClassifyConcern(prepared, decision, type);
            var preparedResult=JsonSerializer.SerializeToNode(await InteractionsController.SubmitClassified(db, user, prepared, preparedClass, channel:"chat"), Json)!;
            return(preparedResult,(string?)preparedResult["reference"], lang=="ar"?unit.NameAr:unit.NameEn, (string?)preparedResult["trackingUrl"],
                "The responsible team will review your request. Keep the reference number to follow up.","سيراجع الفريق المختص طلبك. احتفظ بالرقم المرجعي للمتابعة.", null);
        }
        InteractionUnitRouting.Decision route;
        if(type=="complaint")
        {
            if(!Guid.TryParse((string?)args["unitId"],out var approvedUnitId))
                throw new SanadiException("The confirmed concern proposal is invalid. Please review a new proposal.");
            var activeUnit=await FindActiveUnit(db,approvedUnitId,ct);
            route=ConfirmedConcernRoute(args,activeUnit);
        }
        else
        {
            var current=await new ChatConcernPlanner(clients,logger).Assess(db,user,description,lang,null,ct);
            if(!current.CanRoute||current.Type!=type||current.Unit!.UnitId?.ToString()!=(string?)args["unitId"])
                throw new SanadiException("The concern details or responsible unit could not be reconfirmed. Please describe it again to review an updated proposal.");
            route=current.Unit;
        }
        var input=new InteractionsController.Input(title,description,type,null,null,null,null,null,null,null,false,null,conversation,lang);
        var classification=InteractionsController.ClassifyConcern(input,route,type);
        if((string)classification.interactionType!=type)throw new SanadiException("This concern needs the existing emergency workflow. Please report the emergency separately.");
        var result=JsonSerializer.SerializeToNode(await InteractionsController.SubmitClassified(db,user,input,classification,channel:"chat"),Json)!;
        return(result,(string?)result["reference"],lang=="ar"?route.NameAr:route.NameEn,(string?)result["trackingUrl"],
            "The responsible team will review your concern. Keep the reference number to follow up.","سيراجع الفريق المختص طلبك. احتفظ بالرقم المرجعي للمتابعة.",null);
    }
}
