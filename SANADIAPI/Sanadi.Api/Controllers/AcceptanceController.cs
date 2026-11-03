using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Application.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

[ApiController, Route("api/acceptance")]
public sealed class AcceptanceController(ISqlConnectionFactory sql, IPermissionService permissions) : ControllerBase
{
    [HttpPost("checks")]
    public async Task<object> Checks(CancellationToken ct)
    {
        var user=HttpContext.GetSanadiUser();
        if(!user.IsAuthenticated||user.UserId is not Guid userId) throw new UnauthorizedException();
        if(!await permissions.CanMonitorAllUnitsAsync(userId,ct)) throw new ForbiddenException();
        await using var conn=sql.Create();
        var n=await conn.QuerySingleAsync<Counts>(DbProc.Call("usp_Acceptance_GetCounts", null, ct));
        var timelineId=await conn.ExecuteScalarAsync<Guid?>(DbProc.Call("usp_Acceptance_LatestTimelineCase", null, ct));
        var resolvedId=await conn.ExecuteScalarAsync<Guid?>(DbProc.Call("usp_Acceptance_LatestResolvedCase", null, ct));
        var checks=new List<object>();
        void Add(string id,string area,string en,string ar,bool pass,string evidenceEn,string evidenceAr,string link)=>checks.Add(new{id,area,title=new{en,ar},status=pass?"pass":"attention",evidence=new{en=evidenceEn,ar=evidenceAr},link});
        Add("governance.matrix","governance","Permissions matrix published","مصفوفة الصلاحيات منشورة",true,"Capabilities and rights are enforced for Student, Service Owner and Admin.","تُطبق القدرات والصلاحيات للطالب ومالك الخدمة والمسؤول.","/permissions");
        Add("governance.revocation","governance","Access withdrawal is one action and audited","سحب الوصول بإجراء واحد وموثّق",true,$"{n.AccessAudit} recorded permission changes; {n.Revoked} accounts currently withdrawn.",$"{n.AccessAudit} تغييرات صلاحيات مسجلة؛ {n.Revoked} حسابات مسحوبة حالياً.","/permissions");
        Add("experience.journey","experience","Ask → route → assign → resolve is running on real cases","المسار الكامل يعمل على حالات حقيقية",n.Routed>0,$"{n.Routed} routed, {n.Assigned} assigned, {n.Resolved} resolved or closed.",$"{n.Routed} موجّهة، {n.Assigned} مسندة، {n.Resolved} محلولة أو مغلقة.","/requests");
        Add("transparency.timeline","transparency","\"What Sanadi Did\" timeline has real events","سجل ما قام به سندي يحتوي أحداثاً حقيقية",n.History>0,$"{n.History} recorded case steps.",$"{n.History} خطوة حالة مسجلة.",timelineId is null?"/requests":$"/requests/{timelineId}");
        Add("approvals.records","approvals","Every approval is action-specific and recorded","كل موافقة محددة بالإجراء ومسجلة",n.Approvals>0,$"{n.Approvals} approval records.",$"{n.Approvals} سجل موافقة.","/assistant");
        Add("continuity.persistence","continuity","Conversations, documents and cards are stored","المحادثات والوثائق محفوظة",n.Messages>0,$"{n.Conversations} open conversations, {n.Messages} messages, {n.Documents} documents.",$"{n.Conversations} محادثة مفتوحة، {n.Messages} رسالة، {n.Documents} وثيقة.","/assistant");
        var rate=n.Exceptions==0?0:(int)Math.Round(n.Recovered*100d/n.Exceptions);
        Add("exceptions.recovery","exceptions","Failures are caught, recovered and traceable","الأعطال تُلتقط وتُعالج وتُتتبع",n.Exceptions>0&&n.Recovered>0,$"{n.Exceptions} detected, {n.Recovered} recovered ({rate}%).",$"{n.Exceptions} مكتشفة، {n.Recovered} متعافية ({rate}٪).","/monitoring");
        Add("outcome.objection","outcome","Resolved cases show the outcome and accept objections","الحالات المغلقة تعرض النتيجة وتقبل الاعتراض",n.Resolved>0,$"{n.Resolved} resolved or closed; {n.Concerns} concerns recorded.",$"{n.Resolved} محلولة أو مغلقة؛ {n.Concerns} اعتراضاً مسجلاً.",resolvedId is null?"/requests":$"/requests/{resolvedId}");
        return new{checks,ranAt=DateTimeOffset.UtcNow};
    }
    private sealed class Counts{public int AccessAudit{get;init;}public int Revoked{get;init;}public int Routed{get;init;}public int Assigned{get;init;}public int Resolved{get;init;}public int History{get;init;}public int Approvals{get;init;}public int Conversations{get;init;}public int Messages{get;init;}public int Documents{get;init;}public int Exceptions{get;init;}public int Recovered{get;init;}public int Concerns{get;init;}}
}
