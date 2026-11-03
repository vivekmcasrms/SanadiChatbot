using System.Data;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Application.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

[ApiController, Route("api/case-transparency")]
public sealed class CaseTransparencyController(ISqlConnectionFactory sql, IPermissionService permissions) : ControllerBase
{
    public sealed class ConcernBody { public string Kind { get; set; }=""; public string Reason { get; set; }=""; public string Lang { get; set; }="en"; }

    [HttpGet("{caseId:guid}/activity")]
    public async Task<IActionResult> Activity(Guid caseId, CancellationToken ct)
    {
        var userId=RequireUser();
        if(!await permissions.CanAccessCaseAsync(caseId,userId,ct)) throw new ForbiddenException();
        await using var conn=sql.Create();
        var c=await conn.QuerySingleOrDefaultAsync<ActivityCase>(DbProc.Call("usp_Transp_GetActivityCase",new{caseId},ct));
        if(c is null) return new JsonResult(Array.Empty<object>());
        var events=new List<ActivityEvent>{new(c.CreatedAt,"Request received","تم استلام الطلب","sanadi","Sanadi","سند","Completed","تم")};
        if(!string.IsNullOrWhiteSpace(c.AiSummary)) events.Add(new(c.CreatedAt,"Information retrieved from verified university records","تم جلب المعلومات من السجلات الجامعية الموثقة","sanadi","Sanadi","سند","Completed","تم"));
        var history=await conn.QueryAsync<HistoryRow>(DbProc.Call("usp_Transp_ListStatusHistory",new{caseId},ct));
        foreach(var h in history)
        {
            if(h.ToStatus=="submitted") continue;
            var (en,ar,result)=StatusText(h.ToStatus); if(en is null) continue;
            if(h.ToStatus=="classified"&&!string.IsNullOrWhiteSpace(c.CategoryEn)){en=$"Intent identified: {c.CategoryEn}";ar=$"تم تحديد نوع الطلب: {c.CategoryAr??c.CategoryEn}";}
            if((h.ToStatus=="routed"||h.ToStatus=="transferred")&&!string.IsNullOrWhiteSpace(c.UnitEn)){en=$"Routed to {c.UnitEn}";ar=$"تم توجيه الطلب إلى {c.UnitAr??c.UnitEn}";}
            if(h.ToStatus=="assigned"&&!string.IsNullOrWhiteSpace(c.StaffName)){en=$"Assigned to {c.StaffName}";ar=$"تم إسناده إلى {c.StaffName}";}
            var automatic=h.ToStatus is "classified" or "routed" or "ai_processing" or "submitted" or "draft";
            events.Add(new(h.CreatedAt,en,ar??en,automatic?"sanadi":"staff",automatic?"Sanadi":h.ToStatus=="assigned"?c.StaffName:c.UnitEn,automatic?"سند":h.ToStatus=="assigned"?c.StaffName:c.UnitAr,result.en,result.ar));
        }
        var comments=await conn.QueryAsync<CommentRow>(DbProc.Call("usp_Transp_ListComments",new{caseId},ct));
        foreach(var x in comments){var mine=x.AuthorId==c.StudentId;events.Add(new(x.CreatedAt,x.IsInfoRequest?"Staff requested more information":mine?"You sent a message":"The service team replied to you",x.IsInfoRequest?"طلب فريق الخدمة معلومات إضافية منك":mine?"أرسلت رسالة":"رد فريق الخدمة عليك",mine?"you":"staff",mine?"You":c.UnitEn??"Service team",mine?"أنت":c.UnitAr??"فريق الخدمة",x.IsInfoRequest?"Waiting":"Completed",x.IsInfoRequest?"بالانتظار":"تم"));}
        var receipts=await conn.QueryAsync<ReceiptRow>(DbProc.Call("usp_Transp_ListReceipts",new{caseId},ct));
        foreach(var x in receipts)events.Add(new(x.CreatedAt,"Action completed on your behalf","تم تنفيذ إجراء نيابة عنك","sanadi",x.Actor??c.UnitEn??"Sanadi",x.Actor??c.UnitAr??"سند","Completed","تم"));
        var notices=await conn.QueryAsync<NoticeRow>(DbProc.Call("usp_Transp_ListNotices",new{caseId,studentId=c.StudentId},ct));
        foreach(var x in notices)events.Add(new(x.CreatedAt,"You were notified about an update","تم إشعارك بوجود تحديث","sanadi","Sanadi","سند","Completed","تم"));
        if(!string.IsNullOrWhiteSpace(c.OutcomeEn))events.Add(new(events.Max(x=>x.At),$"Outcome: {c.OutcomeEn}",$"النتيجة: {c.OutcomeAr??c.OutcomeEn}","staff",c.UnitEn,c.UnitAr,"Completed","تم"));
        return new JsonResult(events.OrderBy(x=>x.At),Camel);
    }

    [HttpGet("{caseId:guid}/outcome")]
    public async Task<IActionResult> Outcome(Guid caseId, CancellationToken ct=default)
    {
        var userId=RequireUser(); await using var conn=sql.Create();
        var c=await conn.QuerySingleOrDefaultAsync<OutcomeRow>(DbProc.Call("usp_Transp_GetOutcome",new{caseId},ct));
        if(c is null||c.StudentId!=userId) return new JsonResult(null);
        var concerns=await conn.QueryAsync(DbProc.Call("usp_Transp_ListConcerns",new{caseId},ct));
        return new JsonResult(new{c.Status,c.OutcomeEn,c.OutcomeAr,c.ExplanationEn,c.ExplanationAr,c.UnitEn,unitAr=c.UnitAr??c.UnitEn,c.StaffName,c.ResolvedAt,c.NextStepEn,c.NextStepAr,concerns},Camel);
    }

    [HttpPost("{caseId:guid}/concerns")]
    public async Task<object> Concern(Guid caseId,[FromBody] ConcernBody body,CancellationToken ct)
    {
        var userId=RequireUser(); body.Kind=body.Kind.Trim().ToLowerInvariant(); body.Reason=body.Reason.Trim();
        if(!new[]{"question","correction","objection","reopen"}.Contains(body.Kind)||body.Reason.Length is <5 or >4000||!new[]{"en","ar"}.Contains(body.Lang)) throw new SanadiException("Invalid outcome concern.");
        await using var conn=sql.Create(); await conn.OpenAsync(ct); using var tx=conn.BeginTransaction(IsolationLevel.Serializable);
        var c=await conn.QuerySingleOrDefaultAsync<CaseRow>(DbProc.Call("usp_Transp_LockCase",new{caseId},ct,tx));
        if(c is null) throw new SanadiException("Case not found"); if(c.StudentId!=userId) throw new ForbiddenException();
        await conn.ExecuteAsync(DbProc.Call("usp_Transp_InsertComment",new{caseId,userId,reason=body.Reason},ct,tx));
        if(body.Kind=="question")
        {
            await AuditAndNotify(conn,tx,c,userId,caseId,"case.outcome_question","question",body.Reason,ct);
            tx.Commit(); return new{ok=true,status=c.Status};
        }
        await conn.ExecuteAsync(DbProc.Call("usp_Transp_InsertReopenRequest",new{caseId,userId,kind=body.Kind,reason=body.Reason,status=c.Status,outcomeEn=c.OutcomeEn,outcomeAr=c.OutcomeAr,decidedAt=c.DecidedAt},ct,tx));
        var nextEn=body.Kind switch{"correction"=>"Your correction request is with the responsible unit for review.","objection"=>"Your objection is under review by the authorised reviewer.",_=>"Your request to reopen is with the responsible unit."};
        var nextAr=body.Kind switch{"correction"=>"طلب التصحيح لديك قيد المراجعة من الوحدة المسؤولة.","objection"=>"اعتراضك قيد المراجعة من الجهة المخوّلة.",_=>"طلب إعادة الفتح لديك لدى الوحدة المسؤولة."};
        await conn.ExecuteAsync(DbProc.Call("usp_Transp_SetInReview",new{caseId,nextEn,nextAr},ct,tx));
        await conn.ExecuteAsync(DbProc.Call("usp_Transp_InsertStatusHistory",new{caseId,status=c.Status,userId,note=$"Student raised outcome {body.Kind}"},ct,tx));
        if(body.Kind=="objection")
        {
            var level=Math.Min(3,c.EscalationLevel+1);
            await conn.ExecuteAsync(DbProc.Call("usp_Transp_InsertEscalation",new{caseId,level,unitId=c.UnitId,assignedTo=c.AssignedTo,reason=$"Student objection: {body.Reason}",userId},ct,tx));
        }
        await AuditAndNotify(conn,tx,c,userId,caseId,$"case.outcome_{body.Kind}",body.Kind,body.Reason,ct);
        tx.Commit(); return new{ok=true,status="in_review"};
    }

    private static async Task AuditAndNotify(System.Data.Common.DbConnection conn,IDbTransaction tx,CaseRow c,Guid actor,Guid caseId,string action,string kind,string reason,CancellationToken ct)
    {
        var metadata=JsonSerializer.Serialize(new{kind,original_status=c.Status,original_outcome=c.OutcomeEn});
        await conn.ExecuteAsync(DbProc.Call("usp_Transp_Audit",new{actor,action,caseId,metadata},ct,tx));
        foreach(var recipient in new Guid?[]{c.AssignedTo,c.StudentId}.Where(x=>x is not null).Distinct())
            await conn.ExecuteAsync(DbProc.Call("usp_Transp_Notify",new{caseId,recipient,reason,url=$"/requests/{caseId}",unitId=c.UnitId,actor,dedupe=$"{action}:{caseId}:{recipient}:{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}"},ct,tx));
    }
    private Guid RequireUser(){var u=HttpContext.GetSanadiUser();if(!u.IsAuthenticated||u.UserId is not Guid id)throw new UnauthorizedException();return id;}
    private static (string? en,string? ar,(string en,string ar) result) StatusText(string status)=>status switch
    {
        "draft"=>("Request drafted","تم إنشاء مسودة الطلب",("In progress","قيد التنفيذ")),"classified"=>("Intent identified","تم تحديد نوع الطلب",("Completed","تم")),
        "routed"=>("Routed to the responsible unit","تم توجيه الطلب إلى الوحدة المسؤولة",("Completed","تم")),"acknowledged"=>("Acknowledged by the service team","أقرّ فريق الخدمة باستلام الطلب",("Completed","تم")),
        "assigned"=>("Assigned to a responsible staff member","تم إسناده إلى موظف مسؤول",("Completed","تم")),"in_review"=>("Under review","قيد المراجعة",("In progress","قيد التنفيذ")),
        "in_progress"=>("Being worked on","قيد المعالجة",("In progress","قيد التنفيذ")),"ai_processing"=>("Handled automatically by Sanadi","تتم معالجته آلياً بواسطة سند",("In progress","قيد التنفيذ")),
        "awaiting_student"=>("Staff requested more information","طلب فريق الخدمة معلومات إضافية",("Waiting","بالانتظار")),"student_confirmation"=>("Waiting for your confirmation","بانتظار تأكيدك",("Waiting","بالانتظار")),
        "resolution_proposed"=>("A resolution was proposed","تم اقتراح حل",("Waiting","بالانتظار")),"escalated"=>("Escalated for a faster decision","تم تصعيد الطلب لاتخاذ قرار أسرع",("In progress","قيد التنفيذ")),
        "on_hold"=>("Paused","تم تعليق الطلب مؤقتاً",("Waiting","بالانتظار")),"waiting_external"=>("Waiting on another department","بانتظار جهة أخرى",("Waiting","بالانتظار")),
        "transferred"=>("Transferred to another unit","تم تحويله إلى وحدة أخرى",("Completed","تم")),"reopened"=>("Reopened","تمت إعادة فتح الطلب",("In progress","قيد التنفيذ")),
        "resolved"=>("Resolved","تم حل الطلب",("Completed","تم")),"closed"=>("Closed","تم إغلاق الطلب",("Completed","تم")),"rejected"=>("Request not approved","لم تتم الموافقة على الطلب",("Completed","تم")),
        "withdrawn"=>("Request withdrawn","تم سحب الطلب",("Completed","تم")),"duplicate"=>("Merged with an identical request","تم دمجه مع طلب مطابق",("Completed","تم")),_=>(null,null,("",""))
    };
    private static readonly JsonSerializerOptions Camel=new(){PropertyNamingPolicy=JsonNamingPolicy.CamelCase};
    private sealed class OutcomeRow{public Guid StudentId{get;init;}public string Status{get;init;}="";public string? OutcomeEn{get;init;}public string? OutcomeAr{get;init;}public string? ExplanationEn{get;init;}public string? ExplanationAr{get;init;}public string? UnitEn{get;init;}public string? UnitAr{get;init;}public string? StaffName{get;init;}public DateTimeOffset? ResolvedAt{get;init;}public string? NextStepEn{get;init;}public string? NextStepAr{get;init;}}
    private sealed class CaseRow{public Guid StudentId{get;init;}public string? CaseNumber{get;init;}public string Status{get;init;}="";public Guid? UnitId{get;init;}public Guid? AssignedTo{get;init;}public string? OutcomeEn{get;init;}public string? OutcomeAr{get;init;}public DateTimeOffset? DecidedAt{get;init;}public int EscalationLevel{get;init;}}
    private sealed class ActivityCase{public Guid StudentId{get;init;}public DateTimeOffset CreatedAt{get;init;}public string? AiSummary{get;init;}public string? OutcomeEn{get;init;}public string? OutcomeAr{get;init;}public string? UnitEn{get;init;}public string? UnitAr{get;init;}public string? StaffName{get;init;}public string? CategoryEn{get;init;}public string? CategoryAr{get;init;}}
    private sealed class HistoryRow{public string ToStatus{get;init;}="";public DateTimeOffset CreatedAt{get;init;}}
    private sealed class CommentRow{public Guid AuthorId{get;init;}public bool IsInfoRequest{get;init;}public DateTimeOffset CreatedAt{get;init;}}
    private sealed class ReceiptRow{public DateTimeOffset CreatedAt{get;init;}public string? Actor{get;init;}}
    private sealed class NoticeRow{public DateTimeOffset CreatedAt{get;init;}public string Status{get;init;}="";}
    private sealed record ActivityEvent(DateTimeOffset At,string En,string Ar,string By,string? ActorEn,string? ActorAr,string? ResultEn,string? ResultAr);
}
