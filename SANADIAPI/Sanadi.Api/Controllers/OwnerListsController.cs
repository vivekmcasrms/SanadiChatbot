using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Application.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

[ApiController,Route("api/owner-lists")]
public sealed class OwnerListsController(ISqlConnectionFactory sql,IPermissionService permissions):ControllerBase
{
    [HttpGet("cases")]
    public async Task<object> Cases([FromQuery]Guid? unitId,[FromQuery]int page=1,[FromQuery]int pageSize=25,[FromQuery]string? search=null,[FromQuery]string? type=null,[FromQuery]string? status=null,[FromQuery]string sla="all",[FromQuery]string automation="all",[FromQuery]string? priority=null,[FromQuery]string? range=null,[FromQuery]string sort="activity",CancellationToken ct=default)
    {
        var uid=RequireUser();var scope=await Scope(uid,unitId,ct);(page,pageSize)=Clamp(page,pageSize);
        var now=DateTimeOffset.UtcNow;var in4=now.AddHours(4);var in24=now.AddHours(24);
        var wanted=Statuses(status);
        var typeFilter=!string.IsNullOrWhiteSpace(type)&&type!="all"?type:null;
        var priorityFilter=!string.IsNullOrWhiteSpace(priority)&&priority!="all"?priority:null;
        var term=SearchLike(search);
        var since=Since(range);
        var baseArgs=new{uid,scope=DbProc.Csv(scope),hasScope=scope.Length>0,skip=(page-1)*pageSize,take=pageSize,now,in4,in24,type=typeFilter,priority=priorityFilter,since,term,sla,automation,sort,wanted=DbProc.Csv(wanted),extra=(string?)null};
        await using var conn=sql.Create();
        var total=await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_OwnerLists_CountCases",baseArgs,ct));
        var rows=(await conn.QueryAsync<CaseRow>(DbProc.Call("usp_OwnerLists_ListCases",baseArgs,ct))).ToArray();
        var items=rows.Select(x=>new{id=x.Id,service_unit_id=x.ServiceUnitId,case_number=x.CaseNumber,case_type=x.CaseType,title=x.Title,status=x.Status,urgency=x.Urgency,created_at=x.CreatedAt,last_activity_at=x.LastActivityAt,resolution_due_at=x.ResolutionDueAt,routing_reason_en=x.RoutingReasonEn,routing_reason_ar=x.RoutingReasonAr,routing_confidence=x.RoutingConfidence,attention_reason_en=x.AttentionReasonEn,attention_reason_ar=x.AttentionReasonAr,student_id=x.StudentId,student_name=x.StudentName,x.NeedsAttention,breached=x.ResolutionDueAt<now,lowConfidenceRouting=(x.RoutingConfidence??1)<.6});
        async Task<int> Count(string[]? statuses,string? extra=null)=>await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_OwnerLists_CountCases",new{uid,scope=DbProc.Csv(scope),hasScope=scope.Length>0,skip=0,take=1,now,in4,in24,type=typeFilter,priority=priorityFilter,since,term,sla,automation,sort,wanted=DbProc.Csv(statuses),extra},ct));
        var counts=new{open=await Count(Open),newCount=await Count(New),inProgress=await Count(Progress),waitingStudent=await Count(Waiting),completed=await Count(Completed),attention=await Count(Open,"attention"),breached=await Count(Open,"breached")};
        return new{items,total,page,pageSize,pageCount=Math.Max(1,(int)Math.Ceiling(total/(double)pageSize)),unitIds=scope,counts};
    }

    [HttpGet("chats")]
    public async Task<object> Chats([FromQuery]Guid? unitId,[FromQuery]int page=1,[FromQuery]int pageSize=20,[FromQuery]string? search=null,[FromQuery]string filter="all",CancellationToken ct=default)
    {
        var uid=RequireUser();var scope=await Scope(uid,unitId,ct);(page,pageSize)=Clamp(page,pageSize);if(scope.Length==0)return Empty(page,pageSize);
        var term=(search??"").Trim();var termLike=term.Length>=2?$"%{term[..Math.Min(80,term.Length)]}%":null;
        var p=new{scope=DbProc.Csv(scope),skip=(page-1)*pageSize,take=pageSize,filter,term=termLike};
        await using var conn=sql.Create();
        var total=await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_OwnerLists_CountChats",p,ct));
        var rows=await conn.QueryAsync(DbProc.Call("usp_OwnerLists_ListChats",p,ct));
        return new{items=rows,total,page,pageSize,pageCount=Math.Max(1,(int)Math.Ceiling(total/(double)pageSize))};
    }
    private async Task<Guid[]> Scope(Guid uid,Guid? requested,CancellationToken ct){if(!await permissions.IsStaffAsync(uid,ct))throw new ForbiddenException();await using var conn=sql.Create();var ids=(await conn.QueryAsync<Guid>(DbProc.Call("usp_Owner_ListStaffUnits",new{uid},ct))).Distinct().ToList();if(ids.Count==0&&(await permissions.HasRoleAsync(uid,"service_manager",ct)||await permissions.HasRoleAsync(uid,"system_admin",ct)))ids=(await conn.QueryAsync<Guid>(DbProc.Call("usp_Owner_ListActiveUnits",null,ct))).ToList();if(requested is Guid r&&ids.Contains(r))return[r];return ids.ToArray();}
    private Guid RequireUser(){var u=HttpContext.GetSanadiUser();if(!u.IsAuthenticated||u.UserId is not Guid id)throw new UnauthorizedException();return id;}
    private static (int,int)Clamp(int p,int s)=>(Math.Clamp(p,1,10000),Math.Clamp(s,5,100));private static new object Empty(int p,int s)=>new{items=Array.Empty<object>(),total=0,page=p,pageSize=s,pageCount=1};
    private static string? SearchLike(string? value){var x=(value??"").Trim();if(x.Length<2)return null;return $"%{x[..Math.Min(80,x.Length)]}%";}
    private static DateTimeOffset? Since(string? range)=>range switch{"today"=>DateTimeOffset.Now.Date,"7d"=>DateTimeOffset.UtcNow.AddDays(-7),"30d"=>DateTimeOffset.UtcNow.AddDays(-30),"90d"=>DateTimeOffset.UtcNow.AddDays(-90),_=>null};
    private static readonly string[] Waiting=["awaiting_student","student_confirmation"],New=["draft","submitted","acknowledged","classified","routed","assigned"],Progress=["in_progress","in_review","ai_processing","resolution_proposed","escalated","on_hold","waiting_external","reopened","transferred"],Completed=["resolved","closed"],Open=[..New,..Progress,..Waiting];private static string[]? Statuses(string? s)=>s switch{null or "" or "open" or "all_open"=>Open,"all"=>null,"waiting_student"=>Waiting,"submitted" or "new"=>New,"in_progress"=>Progress,"resolved" or "completed"=>Completed,_=>[s]};
    private sealed class CaseRow{public Guid Id{get;init;}public Guid? ServiceUnitId{get;init;}public string CaseNumber{get;init;}="";public string CaseType{get;init;}="";public string Title{get;init;}="";public string Status{get;init;}="";public string Urgency{get;init;}="";public DateTimeOffset CreatedAt{get;init;}public DateTimeOffset? LastActivityAt{get;init;}public DateTimeOffset? ResolutionDueAt{get;init;}public string? RoutingReasonEn{get;init;}public string? RoutingReasonAr{get;init;}public double? RoutingConfidence{get;init;}public string? AttentionReasonEn{get;init;}public string? AttentionReasonAr{get;init;}public Guid? StudentId{get;init;}public string? StudentName{get;init;}public bool NeedsAttention{get;init;}}
}
