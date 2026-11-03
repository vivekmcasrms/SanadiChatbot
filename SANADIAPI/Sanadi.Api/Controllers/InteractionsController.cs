using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Notifications;
using Sanadi.Api.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;
using Sanadi.Api.AI;
using Sanadi.Api.Routing;

namespace Sanadi.Api.Controllers;

[ApiController, Route("api/interactions")]
public sealed class InteractionsController(ISqlConnectionFactory sql, IHttpClientFactory clients, ILogger<InteractionsController> logger):ControllerBase
{
    private Guid UserId(){var u=HttpContext.GetSanadiUser();if(!u.IsAuthenticated||u.UserId is not Guid id)throw new UnauthorizedException();return id;}
    public sealed record Input(string Title,string Description,string? ShortcutHint,string? UrgencyHint,Guid? CategoryId,Guid? UnitId,string? DesiredResolution,string? ExpectedBenefit,string? IncidentDate,string? Confidentiality,bool? IsAnonymous,string? Location,Guid? ConversationId,string? Lang);
    public sealed record ConvertRequest(Guid CaseId,string Reason);

    [HttpPost("preview")]
    public async Task<object> Preview([FromBody]Input r, CancellationToken ct)
    {
        var user = UserId();
        await using var db = sql.Create();
        return await ClassifyWithUnit(db, user, r, clients, logger, ct);
    }

    [HttpGet("emergency-pathways")]
    public async Task<object>Emergency([FromQuery]string lang="en"){UserId();await using var db=sql.Create();var rows=await db.QueryAsync(DbProc.Call("usp_Interactions_ListEmergencyContacts",new{ar=lang=="ar"},CancellationToken.None));return rows;}

    [HttpPost]
    public async Task<object>Submit([FromBody]Input r)
    {
        var user=UserId();if((r.Title??"").Trim().Length<3||(r.Description??"").Trim().Length<10)throw new SanadiException("Title and description are required.");
        await using var db=sql.Create();var c=await ClassifyWithUnit(db,user,r,clients,logger,HttpContext.RequestAborted);
        return await SubmitClassified(db,user,r,c);
    }

    // Chat uses the same assignment, SLA, audit and notification path after confirmation.
    internal static async Task<object> SubmitClassified(System.Data.Common.DbConnection db, Guid user, Input r, dynamic c, string channel = "shortcut")
    {
        Guid? unit=c.unitId;
        var unitRow=await TicketAssignment.ResolveAsync(db,unit,user,(bool)c.isSensitive);
        unit=unitRow.UnitId;
        var unitEn=unitRow.En??"Student Services";var unitAr=unitRow.Ar??"خدمات الطلبة";var lang=r.Lang=="ar"?"ar":"en";
        if(c.interactionType=="suggestion")
        {
            var id=Guid.NewGuid();var reference=$"SUG-{DateTime.UtcNow:yyyyMMdd}-{Random.Shared.Next(1000,9999)}";
            await db.ExecuteAsync(DbProc.Call("usp_Interactions_InsertSuggestion",new{id,user,reference,title=r.Title.Trim()[..Math.Min(r.Title.Trim().Length,160)],description=r.Description.Trim()[..Math.Min(r.Description.Trim().Length,8000)],benefit=r.ExpectedBenefit,unit,anon=r.IsAnonymous==true,lang,conversation=r.ConversationId,service=c.serviceCode,c.reasonEn,c.reasonAr,c.confidence,channel},CancellationToken.None));
            var suggestionAckEn=$"Your suggestion {reference} has been received and sent to {unitEn} for review.";var suggestionAckAr=$"تم استلام اقتراحك {reference} وإرساله إلى {unitAr} للمراجعة.";
            return new{kind="suggestion",id,reference,interactionType="suggestion",classification=c,trackingUrl="/requests",acknowledgementEn=suggestionAckEn,acknowledgementAr=suggestionAckAr,emergencyContacts=Array.Empty<object>(),linkedSuggestionId=id};
        }
        var caseId=Guid.NewGuid();var referenceNo=$"REQ-{DateTime.UtcNow:yyyyMMdd}-{Random.Shared.Next(1000,9999)}";var status=unitRow.Status;
        await db.ExecuteAsync(DbProc.Call("usp_Interactions_InsertCase",new{caseId,referenceNo,user,type=c.interactionType,category=r.CategoryId,unit,title=r.Title.Trim()[..Math.Min(r.Title.Trim().Length,160)],description=r.Description.Trim()[..Math.Min(r.Description.Trim().Length,8000)],status,c.priority,c.severity,lang,hint=r.ShortcutHint,automation=c.automationLevel,alert=c.alertType,location=r.Location,sensitive=c.isSensitive,sensitivity=c.isSensitive?"restricted":"normal",human=c.humanAttentionRequired,attention=c.attentionReason,confidentiality=r.Confidentiality??"standard",incident=r.IncidentDate,desired=r.DesiredResolution,conversation=r.ConversationId,service=c.serviceCode,c.topic,root=c.rootCauseCode,c.reasonEn,c.reasonAr,c.confidence,owner=unitRow.Owner,method=unitRow.Method,action=$"interaction.{c.interactionType}.created",meta=JsonSerializer.Serialize(new{reference=referenceNo,channel,classification=c}),channel},CancellationToken.None));
        if(c.interactionType=="alert"&&c.severity is "high" or "critical")await db.ExecuteAsync(DbProc.Call("usp_Interactions_EscalateCase",new{caseId},CancellationToken.None));
        await InAppNotify.PushCaseOpenedAsync(db, caseId, referenceNo, user, unit, unitRow.Owner, (string)c.priority, user, unitEn, CancellationToken.None);
        var verb=c.interactionType=="complaint"?"complaint":c.interactionType=="alert"?"alert":"request";var ackEn=$"Your {verb} {referenceNo} has been received and routed to {unitEn}.";var ackAr=$"تم استلام طلبك {referenceNo} وتوجيهه إلى {unitAr}.";
        var contacts=c.isEmergency?(await db.QueryAsync(DbProc.Call("usp_Interactions_ListEmergencyContacts",new{ar=lang=="ar"},CancellationToken.None))).ToArray():[];
        return new{kind="case",id=caseId,reference=referenceNo,interactionType=c.interactionType,classification=c,trackingUrl=$"/requests/{caseId}",acknowledgementEn=ackEn,acknowledgementAr=ackAr,emergencyContacts=contacts,linkedSuggestionId=(Guid?)null,clarifyingQuestionEn=(string?)null,clarifyingQuestionAr=(string?)null};
    }

    [HttpPost("convert-to-complaint")]
    public async Task<object>Convert([FromBody]ConvertRequest r){var user=UserId();await using var db=sql.Create();var row=await db.QuerySingleOrDefaultAsync<(string Number,string Type)>(DbProc.Call("usp_Interactions_GetCaseForConvert",new{r.CaseId,user},CancellationToken.None));if(row.Number is null)return new{ok=false};if(row.Type=="complaint")return new{ok=true,reference=row.Number};await db.ExecuteAsync(DbProc.Call("usp_Interactions_ConvertToComplaint",new{r.CaseId,user,note=$"Converted from query to complaint: {r.Reason}"[..Math.Min(500,$"Converted from query to complaint: {r.Reason}".Length)]},CancellationToken.None));return new{ok=true,reference=row.Number};}

    internal static async Task<dynamic> ClassifyWithUnit(System.Data.Common.DbConnection db, Guid user, Input r, IHttpClientFactory clients, ILogger logger, CancellationToken ct, bool confirmedComplaintIntent = false, bool confirmedSuggestionIntent = false)
    {
        var c = Classify(r, confirmedComplaintIntent, confirmedSuggestionIntent);
        var route = await new InteractionUnitRouting(clients, logger).Resolve(db, user,
            (r.Title ?? "").Trim(), (r.Description ?? "").Trim(), (string)c.interactionType, r.CategoryId, r.UnitId, ct);
        return RoutedClassification(c,route);
    }

    internal static dynamic ClassifyConcern(Input r, InteractionUnitRouting.Decision route, string type)
        => RoutedClassification(Classify(r,type=="complaint",type=="suggestion",type=="query"),route);

    private static dynamic RoutedClassification(dynamic c, InteractionUnitRouting.Decision route)
    {
        // Preserve existing type/severity/sensitivity/approval rules. Only unit routing changes.
        return new
        {
            c.interactionType, serviceCode = route.Code, serviceLabel = new { en = route.NameEn, ar = route.NameAr },
            unitId = route.UnitId, c.topic, c.rootCauseCode, c.priority, c.severity, c.automationLevel,
            confidence = Math.Min((double)c.confidence, route.Confidence),
            humanAttentionRequired = (bool)c.humanAttentionRequired || route.UnitId is null || route.Confidence < .6,
            attentionReason = route.UnitId is null || route.Confidence < .6 ? "low_confidence" : (string?)c.attentionReason,
            c.isEmergency, c.alertType, c.isSensitive, c.secondarySuggestion, c.overriddenHint,
            reasonEn = $"Classified as {c.interactionType} and routed to {route.NameEn}.",
            reasonAr = $"تم التصنيف والتوجيه إلى {route.NameAr}."
        };
    }

    private static dynamic Classify(Input r, bool confirmedComplaintIntent = false, bool confirmedSuggestionIntent = false, bool confirmedEnquiryIntent = false)
    {
        var text=$"{r.Title}\n{r.Description}";var emergency=Regex.IsMatch(text,@"\b(fire|smoke|explosion|gas leak|bleeding|unconscious|assault|weapon|flood|ambulance|medical emergency|danger)\b|حريق|دخان|نزيف|اعتداء|خطر",RegexOptions.IgnoreCase);var complaint=confirmedComplaintIntent||Regex.IsMatch(text,@"\b(complain|complaint|unacceptable|unfair|wrong|still pending|no one|too slow|late)\b|شكوى|غير مقبول|تأخر",RegexOptions.IgnoreCase);var suggestion=confirmedSuggestionIntent||Regex.IsMatch(text,@"\b(suggest|propose|recommend|please add|should add|would be better)\b|أقترح|اقتراح",RegexOptions.IgnoreCase);var query=Regex.IsMatch(text,@"\b(what|when|where|how|which|who|can i|eligible|deadline|status)\b|\?|كيف|أين|متى|هل",RegexOptions.IgnoreCase);
        var type=emergency?"alert":confirmedEnquiryIntent?"query":confirmedSuggestionIntent?"suggestion":suggestion&&!complaint?"suggestion":complaint?"complaint":query?"query":r.ShortcutHint??"query";var severity=emergency?"critical":type=="complaint"&&(r.UrgencyHint is "high" or "critical")?"high":type=="complaint"?"normal":"low";if(r.UrgencyHint=="critical")severity="critical";var priority=severity=="normal"?"medium":severity;var sensitive=Regex.IsMatch(text,@"harass|discriminat|assault|abuse|threat|تحرش|تمييز|اعتداء|تهديد",RegexOptions.IgnoreCase);var service=emergency?"SECURITY":Regex.IsMatch(text,"career|internship|job|cv",RegexOptions.IgnoreCase)?"CAREER":Regex.IsMatch(text,"library|book",RegexOptions.IgnoreCase)?"LIBRARY":"STUDENT_SERVICES";var label=service=="CAREER"?new{en="Career and Internship Services",ar="خدمات التوظيف والتدريب"}:service=="LIBRARY"?new{en="Library Services",ar="خدمات المكتبة"}:service=="SECURITY"?new{en="Campus Security",ar="أمن الحرم الجامعي"}:new{en="Student Services",ar="خدمات الطلبة"};var confidence=emergency?.92:type=="query"&&!query?.5:.82;var human=sensitive||emergency||confidence<.6;
        return new{interactionType=type,serviceCode=service,serviceLabel=label,topic=service.ToLowerInvariant(),rootCauseCode=(string?)null,priority,severity,automationLevel=human?"human_review":type=="query"?"auto_resolve":"auto_manage",confidence,humanAttentionRequired=human,attentionReason=sensitive?"sensitive":emergency?"sla_critical":confidence<.6?"low_confidence":null,isEmergency=emergency,alertType=emergency?"life_safety":null,isSensitive=sensitive,secondarySuggestion=type!="suggestion"&&suggestion,overriddenHint=r.ShortcutHint is not null&&r.ShortcutHint!=type?r.ShortcutHint:null,reasonEn=$"Classified as {type} and routed to {label.en}.",reasonAr=$"تم التصنيف والتوجيه إلى {label.ar}."};
    }
}
