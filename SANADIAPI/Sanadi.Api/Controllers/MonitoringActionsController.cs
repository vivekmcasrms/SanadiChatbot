using System.Data;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Notifications;
using Sanadi.Api.Security;
using Sanadi.Application.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

[ApiController,Route("api/monitoring/actions")]
public sealed class MonitoringActionsController(ISqlConnectionFactory sql,IPermissionService permissions):ControllerBase
{
    public sealed class ActionBody{public Guid CaseId{get;set;}public string Action{get;set;}="";public string? Reason{get;set;}public Guid? NewUnitId{get;set;}public Guid? NewOwnerId{get;set;}}
    [HttpPost]
    public async Task<object> Act([FromBody]ActionBody b,CancellationToken ct)
    {
        var actor=RequireUser();if(!await permissions.CanMonitorCasesAsync(actor,ct))throw new ForbiddenException();if(!new[]{"remind_owner","escalate","reassign","note"}.Contains(b.Action)||b.Reason?.Length>1000)throw new SanadiException("Invalid oversight action.");
        await using var conn=sql.Create();await conn.OpenAsync(ct);using var tx=conn.BeginTransaction(IsolationLevel.Serializable);
        var c=await conn.QuerySingleOrDefaultAsync<CaseRow>(DbProc.Call("usp_Monitor_GetCaseForUpdate", new{b.CaseId}, ct, tx));if(c is null)throw new SanadiException("Case not found.");
        if(b.Action=="remind_owner")
        {
            var recent=await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_Monitor_CountRecentReminders", new{b.CaseId}, ct, tx));if(recent>0){tx.Rollback();return new{ok=false,message="A reminder was already sent for this case in the last 4 hours."};}
            if(c.OwnerId is Guid owner)await Notify(conn,tx,"sla_overdue",b.CaseId,owner,c.UnitId,actor,$"Case {c.CaseNumber} requires attention.",ct);
        }
        if(b.Action=="escalate")
        {
            var level=(c.EscalationLevel??0)+1;await conn.ExecuteAsync(DbProc.Call("usp_Monitor_EscalateCase", new{level,b.CaseId}, ct, tx));await conn.ExecuteAsync(DbProc.Call("usp_Monitor_InsertEscalation", new{b.CaseId,level,unit=c.UnitId,owner=c.OwnerId,reason=b.Reason??"Admin oversight escalation",actor}, ct, tx));
            if(c.OwnerId is Guid owner)await Notify(conn,tx,"case_escalated",b.CaseId,owner,c.UnitId,actor,$"Case {c.CaseNumber} was escalated to level {level}.",ct);
            if(c.StudentId is Guid student)await NotifyStudent(conn,tx,"case_escalated",b.CaseId,student,c.UnitId,actor,$"Request {c.CaseNumber} escalated to level {level}",ct);
            if(c.OwnerId is null)await InAppNotify.PushAdminsAsync(conn,"case_escalated",b.CaseId,c.CaseNumber??"",$"Request {c.CaseNumber} escalated and needs an owner.",c.UnitId,actor,$"escalate-admin:{level}",tx,ct);
        }
        if(b.Action=="reassign")
        {
            if(b.NewUnitId is null&&b.NewOwnerId is null)throw new SanadiException("Choose a new unit or owner");if(string.IsNullOrWhiteSpace(b.Reason))throw new SanadiException("A reason is required for reassignment");await conn.ExecuteAsync(DbProc.Call("usp_Monitor_ReassignCase", new{b.NewUnitId,b.NewOwnerId,b.CaseId}, ct, tx));
            if(b.NewOwnerId is Guid owner){await Notify(conn,tx,"new_assignment",b.CaseId,owner,b.NewUnitId??c.UnitId,actor,$"New case assigned to you: {c.CaseNumber}",ct);if(c.StudentId is Guid student)await InAppNotify.PushCaseAssignedToStudentAsync(conn,b.CaseId,c.CaseNumber??"",student,owner,b.NewUnitId??c.UnitId,actor,ct:ct,tx:tx);}
        }
        await conn.ExecuteAsync(DbProc.Call("usp_Monitor_InsertOversight", new{b.CaseId,b.Action,actor,b.Reason,unit=c.UnitId,owner=c.OwnerId,b.NewUnitId,b.NewOwnerId,sla=b.Action=="reassign"?"sla_continues":null}, ct, tx));
        var metadata=JsonSerializer.Serialize(new{b.Reason,b.NewUnitId,b.NewOwnerId});
        await conn.ExecuteAsync(DbProc.Call("usp_Monitor_InsertAudit", new{actor,action=$"oversight_{b.Action}",b.CaseId,metadata}, ct, tx));
        tx.Commit();
        var message=b.Action switch{"remind_owner"=>"Reminder sent to the responsible unit.","escalate"=>"Case escalated and the unit notified.","reassign"=>"Case reassigned. SLA clock continues.",_=>"Oversight note recorded."};return new{ok=true,message};
    }
    [HttpPost("closure/{caseId:guid}")]public async Task<object> Closure(Guid caseId,CancellationToken ct){var actor=RequireUser();if(!await permissions.CanMonitorCasesAsync(actor,ct))throw new ForbiddenException();await using var conn=sql.Create();await conn.OpenAsync(ct);using var tx=conn.BeginTransaction();await conn.ExecuteAsync(DbProc.Call("usp_Monitor_ConfirmClosure", new{caseId}, ct, tx));await conn.ExecuteAsync(DbProc.Call("usp_Monitor_InsertClosureAction", new{caseId,actor}, ct, tx));await conn.ExecuteAsync(DbProc.Call("usp_Monitor_InsertClosureAudit", new{actor,caseId}, ct, tx));tx.Commit();return new{ok=true};}
    private static Task Notify(System.Data.Common.DbConnection c,IDbTransaction tx,string type,Guid caseId,Guid recipient,Guid? unit,Guid actor,string body,CancellationToken ct)=>c.ExecuteAsync(DbProc.Call("usp_Monitor_Notify", new{type,caseId,recipient,body,url=$"/staff?case={caseId}",unit,actor,dedupe=$"oversight:{type}:{caseId}:{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}"}, ct, tx));
    private static Task NotifyStudent(System.Data.Common.DbConnection c,IDbTransaction tx,string type,Guid caseId,Guid recipient,Guid? unit,Guid actor,string body,CancellationToken ct)=>c.ExecuteAsync(DbProc.Call("usp_Monitor_Notify", new{type,caseId,recipient,body,url=$"/requests/{caseId}",unit,actor,dedupe=$"oversight-student:{type}:{caseId}:{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}"}, ct, tx));
    private Guid RequireUser(){var u=HttpContext.GetSanadiUser();if(!u.IsAuthenticated||u.UserId is not Guid id)throw new UnauthorizedException();return id;}
    private sealed class CaseRow{public Guid Id{get;init;}public string? CaseNumber{get;init;}public Guid? UnitId{get;init;}public Guid? OwnerId{get;init;}public int? EscalationLevel{get;init;}public Guid? StudentId{get;init;}}
}
