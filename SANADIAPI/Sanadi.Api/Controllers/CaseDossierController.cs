using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Application.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

[ApiController]
[Route("api/case-dossiers")]
public sealed class CaseDossierController(ISqlConnectionFactory sql, IPermissionService permissions) : ControllerBase
{
    private static readonly HashSet<string> CaseStatuses = ["submitted","ai_processing","in_progress","awaiting_student","waiting_external","placement_allocated","resolved","closed","reopened","escalated"];
    private static readonly HashSet<string> ConversationStatuses = ["active","waiting_student","waiting_staff","resolved","closed"];
    private Guid UserId(){var u=HttpContext.GetSanadiUser();if(!u.IsAuthenticated||u.UserId is not Guid id)throw new UnauthorizedException();return id;}
    private async Task<Guid> Guard(Guid caseId,CancellationToken ct){var id=UserId();if(!await permissions.IsStaffAsync(id,ct)||!await permissions.CanAccessCaseAsync(caseId,id,ct))throw new ForbiddenException();return id;}
    public sealed record TextRequest(string Body);
    public sealed record StatusRequest(string Status,string? Note);
    public sealed record ReopenRequest(string Reason);
    public sealed record PlacementRequest(Guid AssignmentId,Guid NewOpportunityId,string Reason);

    [HttpGet("{caseId:guid}")]
    public async Task<IActionResult> Get(Guid caseId,CancellationToken ct)
    {
        await Guard(caseId,ct);await using var db=sql.Create();
        var kase=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Dossier_GetCase",new{caseId},ct))??throw new NotFoundException("Case not found");
        var studentId=(Guid)kase.student_id;Guid? assigned=kase.assigned_to as Guid?;Guid? conversationId=kase.related_conversation_id as Guid?;Guid? assignmentId=kase.related_internship_assignment_id as Guid?;
        var student=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Dossier_GetStudent",new{studentId},ct));
        var assignedName=assigned is null?null:await db.ExecuteScalarAsync<string?>(DbProc.Call("usp_Dossier_GetProfileName",new{assigned},ct));
        if(assignmentId is null)assignmentId=await db.ExecuteScalarAsync<Guid?>(DbProc.Call("usp_Dossier_FindAssignmentId",new{caseId},ct));
        object? assignment=null;
        if(assignmentId is not null)assignment=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Dossier_GetAssignment",new{assignmentId},ct));
        var conversation=conversationId is null?null:await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Dossier_GetConversation",new{conversationId},ct));
        var alternatives=await db.QueryAsync(DbProc.Call("usp_Dossier_ListAlternatives",null,ct));
        var timeline=new List<object>();
        var history=await db.QueryAsync(DbProc.Call("usp_Dossier_ListStatusHistory",new{caseId},ct));
        var comments=await db.QueryAsync(DbProc.Call("usp_Dossier_ListComments",new{caseId},ct));
        var actorIds=history.Select(x=>(Guid?)x.changed_by).Concat(comments.Select(x=>(Guid?)x.author_id)).Where(x=>x is not null).Select(x=>x!.Value).Distinct().ToArray();
        var people=actorIds.Length==0?new Dictionary<Guid,string>(): (await db.QueryAsync<(Guid Id,string Name)>(DbProc.Call("usp_Dossier_ListProfileNames",new{actorIds=DbProc.Csv(actorIds)},ct))).ToDictionary(x=>x.Id,x=>x.Name);
        var staff=actorIds.Length==0?new HashSet<Guid>(): (await db.QueryAsync<Guid>(DbProc.Call("usp_Dossier_ListStaffActors",new{actorIds=DbProc.Csv(actorIds)},ct))).ToHashSet();
        string Actor(Guid? id)=>id is null?"system":id==studentId?"student":staff.Contains(id.Value)?"owner":"system";
        foreach(var h in history){Guid? by=h.changed_by as Guid?;var actor=by is null&&((string)h.to_status)!="submitted"?"ai":Actor(by);timeline.Add(new{id=$"st-{h.id}",at=h.created_at,actor,actorName=by is not null&&people.TryGetValue(by.Value,out var n)?n:null,kind="status",title=(string)h.to_status,detail=h.note,@internal=false});}
        foreach(var c in comments){Guid? by=c.author_id as Guid?;bool inside=(bool)c.is_internal;timeline.Add(new{id=$"cm-{c.id}",at=c.created_at,actor=Actor(by),actorName=by is not null&&people.TryGetValue(by.Value,out var n)?n:null,kind=inside?"internal_note":"message",title=inside?"Internal note":((bool)c.is_info_request?"Information request":"Case message"),detail=c.body,@internal=inside});}
        if(conversationId is not null){var messages=await db.QueryAsync(DbProc.Call("usp_Dossier_ListMessages",new{conversationId},ct));foreach(var m in messages){bool user=(string)m.role=="user";timeline.Add(new{id=$"ms-{m.id}",at=m.created_at,actor=user?"student":"ai",actorName=user?(student?.name as string):"Sanadi AI",kind="chat",title=user?"Student message (chat)":"Sanadi reply (chat)",detail=((string)m.content)[..Math.Min(1200,((string)m.content).Length)],@internal=false});}}
        var notices=await db.QueryAsync(DbProc.Call("usp_Dossier_ListNotices",new{caseId},ct));foreach(var n in notices)timeline.Add(new{id=$"nt-{n.id}",at=n.created_at,actor="system",actorName=(string?)null,kind="notification",title=$"Student notified - {n.title??n.event_type}",detail=n.body,@internal=false});
        return Ok(new{@case=kase,student,assignedToName=assignedName,assignment=ShapeAssignment(assignment),conversation,timeline=timeline.OrderBy(x=>((dynamic)x).at),alternatives});
    }

    private static object? ShapeAssignment(object? value){if(value is null)return null;dynamic a=value;return new{id=a.id,assignment_number=a.assignment_number,assignment_status=a.assignment_status,match_score=a.match_score,assigned_at=a.assigned_at,assigned_by_type=a.assigned_by_type,course_registration_status=a.course_registration_status,employer_acceptance_status=a.employer_acceptance_status,owner_review_status=a.owner_review_status,requires_human_review=a.requires_human_review,human_review_reason=a.human_review_reason,owner_notes=a.owner_notes,internship_start_date=a.internship_start_date,internship_end_date=a.internship_end_date,opportunity_id=a.opportunity_id,internship_opportunities=new{opportunity_code=a.opportunity_code,title_en=a.title_en,title_ar=a.title_ar,location_emirate=a.location_emirate,location_city=a.location_city,work_mode=a.work_mode},internship_organizations=new{name_en=a.organization_name_en,name_ar=a.organization_name_ar,sector=a.sector},internship_match_explanations=a.explanation_en is null&&a.explanation_ar is null?null:new{explanation_en=a.explanation_en,explanation_ar=a.explanation_ar,total_match_score=a.total_match_score}};}

    [HttpPost("{caseId:guid}/notes")]
    public async Task<IActionResult> Note(Guid caseId,[FromBody]TextRequest r,CancellationToken ct){var actor=await Guard(caseId,ct);if(r.Body.Trim().Length is <2 or >4000)return BadRequest();await using var db=sql.Create();var id=Guid.NewGuid();await db.ExecuteAsync(DbProc.Call("usp_Dossier_InsertNote",new{id,caseId,actor,body=r.Body.Trim()},ct));await Audit(db,actor,"case_internal_note_added",caseId,new{note_id=id},ct);return Ok(new{ok=true,id});}

    [HttpPost("{caseId:guid}/messages")]
    public async Task<IActionResult> Message(Guid caseId,[FromBody]TextRequest r,CancellationToken ct){var actor=await Guard(caseId,ct);if(r.Body.Trim().Length is <2 or >4000)return BadRequest();await using var db=sql.Create();var c=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Dossier_GetCaseBrief",new{caseId},ct))??throw new NotFoundException();var body=r.Body.Trim();await db.ExecuteAsync(DbProc.Call("usp_Dossier_InsertStudentMessage",new{caseId,actor,body},ct));if(c.related_conversation_id is not null){await db.ExecuteAsync(DbProc.Call("usp_Dossier_InsertChatMessage",new{conversation=(Guid)c.related_conversation_id,student=(Guid)c.student_id,body,language=(string)c.language,meta=JsonSerializer.Serialize(new{sender="service_owner",case_id=caseId})},ct));}await Notify(db,"case_message",caseId,(Guid)c.student_id,(Guid?)c.service_unit_id,actor,$"A service owner sent a message about {c.case_number}.",ct);await Audit(db,actor,"case_student_message_sent",caseId,new{},ct);return Ok(new{ok=true});}

    [HttpPost("{caseId:guid}/status")]
    public async Task<IActionResult> Status(Guid caseId,[FromBody]StatusRequest r,CancellationToken ct){var actor=await Guard(caseId,ct);if(!CaseStatuses.Contains(r.Status))return BadRequest();await using var db=sql.Create();var c=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Dossier_GetCaseBrief",new{caseId},ct))??throw new NotFoundException();await db.ExecuteAsync(DbProc.Call("usp_Dossier_UpdateStatus",new{caseId,status=r.Status,@from=(string)c.status,actor,note=r.Note},ct));await Notify(db,"case_status_changed",caseId,(Guid)c.student_id,(Guid?)c.service_unit_id,actor,$"Case {c.case_number} is now {r.Status.Replace('_',' ')}.",ct);await Audit(db,actor,"case_status_changed",caseId,new{@from=(string)c.status,to=r.Status,note=r.Note},ct);return Ok(new{ok=true});}

    [HttpPost("{caseId:guid}/reopen")]
    public async Task<IActionResult> Reopen(Guid caseId,[FromBody]ReopenRequest r,CancellationToken ct){var actor=await Guard(caseId,ct);if(r.Reason.Trim().Length is <5 or >2000)return BadRequest();await using var db=sql.Create();var c=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Dossier_GetCaseBrief",new{caseId},ct))??throw new NotFoundException();await db.ExecuteAsync(DbProc.Call("usp_Dossier_Reopen",new{caseId,@from=(string)c.status,actor,reason=r.Reason.Trim()},ct));await Notify(db,"case_reopened",caseId,(Guid)c.student_id,(Guid?)c.service_unit_id,actor,$"Case {c.case_number} was reopened.",ct);await Audit(db,actor,"case_reopened_by_owner",caseId,new{reason=r.Reason},ct);return Ok(new{ok=true});}

    [HttpPost("{caseId:guid}/conversation-status")]
    public async Task<IActionResult> ConversationStatus(Guid caseId,[FromBody]StatusRequest r,CancellationToken ct){var actor=await Guard(caseId,ct);if(!ConversationStatuses.Contains(r.Status))return BadRequest();await using var db=sql.Create();var conversation=await db.ExecuteScalarAsync<Guid?>(DbProc.Call("usp_Dossier_GetLinkedConversation",new{caseId},ct))??throw new InvalidOperationException("This case has no linked conversation");await db.ExecuteAsync(DbProc.Call("usp_Dossier_UpdateConversationStatus",new{status=r.Status,conversation},ct));await Audit(db,actor,"conversation_status_changed",conversation,new{status=r.Status,case_id=caseId},ct);return Ok(new{ok=true});}

    [HttpPost("{caseId:guid}/placement")]
    public async Task<IActionResult> Placement(Guid caseId,[FromBody]PlacementRequest r,CancellationToken ct){var actor=await Guard(caseId,ct);if(r.Reason.Trim().Length is <5 or >500)return BadRequest();await using var db=sql.Create();await db.OpenAsync(ct);await using var tx=await db.BeginTransactionAsync(ct);var old=await db.QuerySingleOrDefaultAsync<(Guid OpportunityId,string Status)>(DbProc.Call("usp_Dossier_LockAssignment",r,ct,tx));if(old.OpportunityId==Guid.Empty)throw new NotFoundException();var seats=await db.ExecuteScalarAsync<int>(DbProc.Call("usp_Dossier_LockSeats",r,ct,tx));if(seats<1)throw new InvalidOperationException("The selected opportunity has no available seats");await db.ExecuteAsync(DbProc.Call("usp_Dossier_ChangePlacement",new{old=old.OpportunityId,r.NewOpportunityId,r.AssignmentId},ct,tx));await db.ExecuteAsync(DbProc.Call("usp_Dossier_FinishPlacement",new{r.AssignmentId,actor,details=JsonSerializer.Serialize(new{old_opportunity_id=old.OpportunityId,new_opportunity_id=r.NewOpportunityId,reason=r.Reason}),caseId},ct,tx));await tx.CommitAsync(ct);return Ok(new{ok=true});}

    private static Task Audit(System.Data.Common.DbConnection db,Guid actor,string action,Guid entity,object metadata,CancellationToken ct=default)=>db.ExecuteAsync(DbProc.Call("usp_Dossier_Audit",new{actor,action,entity,json=JsonSerializer.Serialize(metadata)},ct));
    private static Task Notify(System.Data.Common.DbConnection db,string type,Guid caseId,Guid recipient,Guid? unit,Guid actor,string body,CancellationToken ct=default)=>db.ExecuteAsync(DbProc.Call("usp_Dossier_Notify",new{type,caseId,recipient,body,url=$"/requests/{caseId}",unit,actor,dedupe=$"dossier:{type}:{caseId}:{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}"},ct));
}
