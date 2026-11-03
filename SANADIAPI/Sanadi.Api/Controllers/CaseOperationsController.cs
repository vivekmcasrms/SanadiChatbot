using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Notifications;
using Sanadi.Api.Security;
using Sanadi.Application.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

[ApiController]
[Route("api/case-operations")]
public sealed class CaseOperationsController(ISqlConnectionFactory sql,IPermissionService permissions):ControllerBase
{
    private Guid UserId(){var u=HttpContext.GetSanadiUser();if(!u.IsAuthenticated||u.UserId is not Guid id)throw new UnauthorizedException();return id;}
    private async Task<Guid> Staff(Guid caseId,CancellationToken ct){var id=UserId();if(!await permissions.IsStaffAsync(id,ct)||!await permissions.CanAccessCaseAsync(caseId,id,ct))throw new ForbiddenException();return id;}
    private async Task<Guid> Manager(CancellationToken ct){var id=UserId();if(!await permissions.IsManagerAsync(id,ct))throw new ForbiddenException();return id;}
    private static Task History(System.Data.Common.DbConnection db,Guid id,string? from,string to,Guid actor,string? note)=>db.ExecuteAsync(DbProc.Call("usp_CaseOps_InsertHistory",new{id,@from=from,to,actor,note}));
    private static Task Audit(System.Data.Common.DbConnection db,Guid actor,string action,string entity,Guid id,object meta)=>db.ExecuteAsync(DbProc.Call("usp_CaseOps_InsertAudit",new{actor,action,entity,id,json=JsonSerializer.Serialize(meta)}));
    private static Task Notify(System.Data.Common.DbConnection db,string type,Guid entity,Guid recipient,Guid? caseId,Guid? unit,string body,Guid? actor=null)=>db.ExecuteAsync(DbProc.Call("usp_CaseOps_InsertNotify",new{type,entity,recipient,body,url=caseId is null?"/requests":$"/requests/{caseId}",caseId,unit,actor,key=$"ops:{type}:{entity}:{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}"}));
    private static async Task<dynamic> Case(System.Data.Common.DbConnection db,Guid id)=>await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_CaseOps_GetCase",new{id}))??throw new NotFoundException("Case not found");
    public sealed record CaseRequest(Guid CaseId,string? Note=null,Guid? AssigneeId=null,string? ReasonCode=null,string? Status=null,string? Outcome=null);

    [HttpPost("acknowledge")]
    public async Task<object>Acknowledge([FromBody]CaseRequest r,CancellationToken ct){var actor=await Staff(r.CaseId,ct);await using var db=sql.Create();var c=await Case(db,r.CaseId);await db.ExecuteAsync(DbProc.Call("usp_CaseOps_Acknowledge",new{r.CaseId},ct));await History(db,r.CaseId,(string)c.status,"acknowledged",actor,r.Note);await Notify(db,"case_acknowledged",r.CaseId,(Guid)c.student_id,r.CaseId,(Guid?)c.service_unit_id,$"Request {c.case_number} acknowledged",actor);return new{ok=true};}

    [HttpPost("assign")]
    public async Task<object>Assign([FromBody]CaseRequest r,CancellationToken ct){var actor=await Staff(r.CaseId,ct);await using var db=sql.Create();var c=await Case(db,r.CaseId);Guid? target=r.AssigneeId;if(target is null&&c.service_unit_id is Guid unit)target=await db.ExecuteScalarAsync<Guid?>(DbProc.Call("usp_CaseOps_PickAssignee",new{unit},ct));if(target is null)throw new SanadiException("No eligible assignee found for this unit");await db.ExecuteAsync(DbProc.Call("usp_CaseOps_Assign",new{id=r.CaseId,target,unit=(Guid?)c.service_unit_id,actor},ct));await History(db,r.CaseId,(string)c.status,"assigned",actor,r.Note);await Notify(db,"new_assignment",r.CaseId,target.Value,r.CaseId,(Guid?)c.service_unit_id,$"New case assigned to you: {c.case_number}",actor);await InAppNotify.PushCaseAssignedToStudentAsync(db,r.CaseId,(string)c.case_number,(Guid)c.student_id,target.Value,(Guid?)c.service_unit_id,actor,ct:ct);if(c.assigned_to is Guid old&&old!=target)await db.ExecuteAsync(DbProc.Call("usp_CaseOps_InsertReassignSignal",new{id=r.CaseId,old,target,note=r.Note,reason=r.ReasonCode},ct));return new{ok=true,assigneeId=target};}

    [HttpPost("status")]
    public async Task<object>Status([FromBody]CaseRequest r,CancellationToken ct){var actor=await Staff(r.CaseId,ct);var allowed=new[]{"acknowledged","assigned","in_review","awaiting_student","resolution_proposed","escalated","resolved","closed"};if(r.Status is null||!allowed.Contains(r.Status))throw new SanadiException("Invalid status");await using var db=sql.Create();var c=await Case(db,r.CaseId);var outcome=(r.Outcome??r.Note??(string?)c.outcome_en)?.Trim();if(r.Status is "resolved" or "closed"&&string.IsNullOrWhiteSpace(outcome))throw new SanadiException("Record the outcome for the student before resolving or closing this request.");await db.ExecuteAsync(DbProc.Call("usp_CaseOps_UpdateStatus",new{r.Status,r.CaseId,done=r.Status is "resolved" or "closed",outcome},ct));await History(db,r.CaseId,(string)c.status,r.Status,actor,r.Note??outcome);await Notify(db,"case_status_changed",r.CaseId,(Guid)c.student_id,r.CaseId,(Guid?)c.service_unit_id,$"Case {c.case_number} is now {r.Status.Replace('_',' ')}.",actor);return new{ok=true};}

    public sealed record InfoRequest(Guid CaseId,string InformationRequired,string? Reason,int? DueInDays,bool? PausesSla);
    [HttpPost("request-information")]
    public async Task<object>RequestInfo([FromBody]InfoRequest r,CancellationToken ct){var actor=await Staff(r.CaseId,ct);if(r.InformationRequired.Trim().Length<5)throw new SanadiException("Information required");await using var db=sql.Create();var c=await Case(db,r.CaseId);var due=DateTimeOffset.UtcNow.AddDays(r.DueInDays??7);var pause=r.PausesSla!=false;await db.ExecuteAsync(DbProc.Call("usp_CaseOps_RequestInfo",new{r.CaseId,actor,r.InformationRequired,r.Reason,due,pause},ct));await History(db,r.CaseId,(string)c.status,"awaiting_student",actor,"Information requested");await Notify(db,"information_requested",r.CaseId,(Guid)c.student_id,r.CaseId,(Guid?)c.service_unit_id,r.InformationRequired,actor);return new{ok=true,dueAt=due};}

    public sealed record InfoResponse(Guid CaseId,string ResponseNote,Guid? RequestId);
    [HttpPost("provide-information")]
    public async Task<object>ProvideInfo([FromBody]InfoResponse r,CancellationToken ct){var student=UserId();await using var db=sql.Create();var c=await Case(db,r.CaseId);if((Guid)c.student_id!=student)throw new ForbiddenException();await db.ExecuteAsync(DbProc.Call("usp_CaseOps_ProvideInfo",new{r.CaseId,r.ResponseNote,r.RequestId,student},ct));await History(db,r.CaseId,(string)c.status,"in_review",student,"Student provided information");if(c.assigned_to is Guid owner)await Notify(db,"information_provided",r.CaseId,owner,r.CaseId,(Guid?)c.service_unit_id,$"Student replied on {c.case_number}.",student);return new{ok=true};}

    public sealed record ResolutionRequest(Guid CaseId,string SummaryEn,string? SummaryAr,string? ResolutionType,string? ActionTaken,string? PolicyBasis,string? Remedy,bool? ManagerApprovalRequired);
    [HttpPost("propose-resolution")]
    public async Task<object>Resolution([FromBody]ResolutionRequest r,CancellationToken ct){var actor=await Staff(r.CaseId,ct);if(r.SummaryEn.Trim().Length<10)throw new SanadiException("Resolution summary required");await using var db=sql.Create();var c=await Case(db,r.CaseId);var id=Guid.NewGuid();var approval=r.ManagerApprovalRequired==true;await db.ExecuteAsync(DbProc.Call("usp_CaseOps_InsertResolution",new{id,r.CaseId,r.ResolutionType,r.SummaryEn,r.SummaryAr,r.ActionTaken,r.PolicyBasis,r.Remedy,actor,approval},ct));var status=approval?"in_review":"resolution_proposed";if(approval)await db.ExecuteAsync(DbProc.Call("usp_CaseOps_InsertApprovalRequest",new{r.CaseId,actor,summary=r.SummaryEn[..Math.Min(500,r.SummaryEn.Length)]},ct));await db.ExecuteAsync(DbProc.Call("usp_CaseOps_SetCaseStatus",new{status,r.CaseId},ct));await History(db,r.CaseId,(string)c.status,status,actor,approval?"Resolution awaiting manager approval":"Resolution proposed");if(!approval)await Notify(db,"resolution_proposed",r.CaseId,(Guid)c.student_id,r.CaseId,(Guid?)c.service_unit_id,r.SummaryEn,actor);return new{ok=true,resolutionId=id,awaitingApproval=approval};}

    public sealed record DecisionRequest(Guid ApprovalId,bool Approve,string? Reason);
    [HttpPost("decide-approval")]
    public async Task<object>Approval([FromBody]DecisionRequest r,CancellationToken ct){var actor=await Manager(ct);await using var db=sql.Create();var a=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_CaseOps_GetApproval",r,ct))??throw new NotFoundException();if((string)a.approval_status!="pending")return new{ok=true,alreadyDecided=true};await db.ExecuteAsync(DbProc.Call("usp_CaseOps_DecideApproval",new{state=r.Approve?"approved":"rejected",r.Reason,actor,r.ApprovalId},ct));if(a.case_id is Guid caseId){var c=await Case(db,caseId);var state=r.Approve?"resolution_proposed":"in_review";if(r.Approve)await db.ExecuteAsync(DbProc.Call("usp_CaseOps_ApproveResolution",new{actor,caseId},ct));await db.ExecuteAsync(DbProc.Call("usp_CaseOps_SetCaseStatusById",new{state,caseId},ct));await History(db,caseId,(string)c.status,state,actor,r.Approve?"Resolution approved by manager":$"Resolution rejected: {r.Reason}");if(r.Approve)await Notify(db,"resolution_proposed",caseId,(Guid)c.student_id,caseId,(Guid?)c.service_unit_id,"A resolution is ready for your review.",actor);}return new{ok=true,alreadyDecided=false};}

    public sealed record ResolutionResponse(Guid CaseId,bool Accept,string? Comment);
    [HttpPost("respond-resolution")]
    public async Task<object>Respond([FromBody]ResolutionResponse r,CancellationToken ct){var student=UserId();await using var db=sql.Create();var c=await Case(db,r.CaseId);if((Guid)c.student_id!=student)throw new ForbiddenException();await db.ExecuteAsync(DbProc.Call("usp_CaseOps_RespondResolution",new{r.CaseId,r.Comment,r.Accept,response=r.Accept?"accepted":"rejected",status=r.Accept?"resolved":"in_review"},ct));await History(db,r.CaseId,(string)c.status,r.Accept?"resolved":"in_review",student,r.Accept?"Student accepted the resolution":$"Student rejected the resolution: {r.Comment}");if(!r.Accept)await EscalateCore(db,r.CaseId,student,"Student rejected the proposed resolution");return new{ok=true};}

    public sealed record FeedbackRequest(Guid CaseId,int Overall,int? Speed,int? Quality,int? Communication,int? Fairness,int? Effort,bool? FullyResolved,string? Comments);
    [HttpPost("feedback")]
    public async Task<object>Feedback([FromBody]FeedbackRequest r,CancellationToken ct){var student=UserId();if(r.Overall is <1 or >5)throw new SanadiException("Invalid rating");await using var db=sql.Create();var c=await Case(db,r.CaseId);if((Guid)c.student_id!=student)throw new ForbiddenException();await db.ExecuteAsync(DbProc.Call("usp_CaseOps_SubmitFeedback",new{r.CaseId,student,r.Overall,r.Speed,r.Quality,r.Communication,r.Fairness,r.Effort,r.FullyResolved,r.Comments},ct));await History(db,r.CaseId,(string)c.status,"closed",student,"Closed after satisfaction feedback");if(r.Overall<=2||r.FullyResolved==false)await db.ExecuteAsync(DbProc.Call("usp_CaseOps_InsertFeedbackSignal",new{type=r.FullyResolved==false?"FALSE_RESOLUTION":"RESPONSE_QUALITY",r.CaseId,student,r.Comments,outcome=$"satisfaction:{r.Overall}"},ct));return new{ok=true};}

    public sealed record ReopenRequest(Guid CaseId,string Reason,string? NewEvidence,string? RequestedOutcome);
    [HttpPost("request-reopen")]
    public async Task<object>RequestReopen([FromBody]ReopenRequest r,CancellationToken ct){var student=UserId();if(r.Reason.Trim().Length<10)throw new SanadiException("Reason required");await using var db=sql.Create();var c=await Case(db,r.CaseId);if((Guid)c.student_id!=student)throw new ForbiddenException();await db.ExecuteAsync(DbProc.Call("usp_CaseOps_RequestReopen",new{r.CaseId,student,r.Reason,r.NewEvidence,r.RequestedOutcome},ct));if(c.assigned_to is Guid owner)await Notify(db,"case_reopened",r.CaseId,owner,r.CaseId,(Guid?)c.service_unit_id,r.Reason,student);return new{ok=true};}

    public sealed record ReopenDecision(Guid ReopenId,bool Approve,string? Reason);
    [HttpPost("decide-reopen")]
    public async Task<object>DecideReopen([FromBody]ReopenDecision r,CancellationToken ct){var actor=await Manager(ct);await using var db=sql.Create();var q=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_CaseOps_GetReopen",r,ct))??throw new NotFoundException();if(q.review_decision is not null)return new{ok=true,alreadyDecided=true};await db.ExecuteAsync(DbProc.Call("usp_CaseOps_DecideReopen",new{decision=r.Approve?"approved":"rejected",r.Reason,actor,r.ReopenId},ct));var caseId=(Guid)q.case_id;var c=await Case(db,caseId);if(r.Approve){await db.ExecuteAsync(DbProc.Call("usp_CaseOps_ReopenCase",new{caseId},ct));await History(db,caseId,(string)c.status,"in_review",actor,"Case reopened");}await Notify(db,r.Approve?"case_reopened":"case_status_changed",caseId,(Guid)q.student_id,caseId,(Guid?)c.service_unit_id,r.Approve?"Your case was reopened.":"Your reopen request was declined.",actor);return new{ok=true,alreadyDecided=false};}

    public sealed record ReasonRequest(Guid CaseId,string Reason);
    [HttpPost("escalate")]
    public async Task<object>Escalate([FromBody]ReasonRequest r,CancellationToken ct){var actor=await Staff(r.CaseId,ct);await using var db=sql.Create();return new{ok=await EscalateCore(db,r.CaseId,actor,r.Reason)};}
    private static async Task<bool>EscalateCore(System.Data.Common.DbConnection db,Guid id,Guid actor,string reason){var c=await Case(db,id);var level=await db.ExecuteScalarAsync<int>(DbProc.Call("usp_CaseOps_NextEscalationLevel",new{id}));await db.ExecuteAsync(DbProc.Call("usp_CaseOps_Escalate",new{id,level,unit=(Guid?)c.service_unit_id,owner=(Guid?)c.assigned_to,reason,actor}));await History(db,id,(string)c.status,"escalated",actor,reason);return true;}

    [HttpPost("route")]
    public async Task<object>Route([FromBody]CaseRequest r,CancellationToken ct){var actor=await Staff(r.CaseId,ct);await using var db=sql.Create();var c=await Case(db,r.CaseId);Guid? unit=(Guid?)c.service_unit_id;Guid? assignee=unit is null?null:await db.ExecuteScalarAsync<Guid?>(DbProc.Call("usp_CaseOps_PickUnitAssignee",new{unit},ct));await db.ExecuteAsync(DbProc.Call("usp_CaseOps_Route",new{id=r.CaseId,assignee},ct));return new{unitId=unit,assigneeId=assignee,requiresHumanReview=assignee is null};}

    public sealed record JobRequest(string Job);
    [HttpPost("jobs")]
    public async Task<object>Job([FromBody]JobRequest r,CancellationToken ct){await Manager(ct);await using var db=sql.Create();var processed=0;if(r.Job is "sla_sweep" or "auto_escalation" or "all")processed=await db.ExecuteAsync(DbProc.Call("usp_CaseOps_SlaSweep",null,ct));return new{job=r.Job,processed,details=new{sla=processed}};}

    public sealed record MeetingRequest(Guid CaseId,string MeetingAt,string Mode,string? Location,string? Note);
    [HttpPost("meeting")]
    public async Task<object>Meeting([FromBody]MeetingRequest r,CancellationToken ct){var actor=await Staff(r.CaseId,ct);if(!DateTimeOffset.TryParse(r.MeetingAt,out var at)||!new[]{"in_person","online","phone"}.Contains(r.Mode))throw new SanadiException("Invalid meeting details");await using var db=sql.Create();var c=await Case(db,r.CaseId);await db.ExecuteAsync(DbProc.Call("usp_CaseOps_SetMeeting",new{r.CaseId,at,r.Mode,r.Location,r.Note,actor,body=$"A meeting has been set for {at:u}. Mode: {r.Mode}. {r.Location}"},ct));await Notify(db,"case_meeting_set",r.CaseId,(Guid)c.student_id,r.CaseId,(Guid?)c.service_unit_id,$"Meeting scheduled for {at:u}.",actor);await Audit(db,actor,"case.meeting_set","case",r.CaseId,new{meeting_at=at,mode=r.Mode});return new{ok=true,meetingAt=at};}

    [HttpPost("meeting/clear")]
    public async Task<object>ClearMeeting([FromBody]CaseRequest r,CancellationToken ct){var actor=await Staff(r.CaseId,ct);await using var db=sql.Create();var c=await Case(db,r.CaseId);await db.ExecuteAsync(DbProc.Call("usp_CaseOps_ClearMeeting",new{r.CaseId,actor},ct));await Notify(db,"case_meeting_cancelled",r.CaseId,(Guid)c.student_id,r.CaseId,(Guid?)c.service_unit_id,"The meeting for this request was cancelled.",actor);return new{ok=true};}
}
