using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Application.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

[ApiController]
[Route("api/automation")]
public sealed class AutomationController(ISqlConnectionFactory sql,IPermissionService permissions):ControllerBase
{
    private Guid UserId(){var u=HttpContext.GetSanadiUser();if(!u.IsAuthenticated||u.UserId is not Guid id)throw new UnauthorizedException();return id;}
    private async Task<Guid>Staff(Guid? caseId,CancellationToken ct){var id=UserId();if(!await permissions.IsStaffAsync(id,ct)||(caseId is Guid c&&!await permissions.CanAccessCaseAsync(c,id,ct)))throw new ForbiddenException();return id;}
    private static readonly string[] Closed=["closed","resolved","withdrawn","rejected","duplicate"];

    [HttpGet("console")]
    public async Task<object>Console(CancellationToken ct){var uid=await Staff(null,ct);await using var db=sql.Create();var closedJson=JsonSerializer.Serialize(Closed);
      var rows=(await db.QueryAsync(DbProc.Call("usp_Automation_ListConsoleCases",new{uid,closedJson},ct))).ToArray();object Map(dynamic c)=>new{id=c.id,case_number=c.case_number,case_type=c.case_type,title=c.title,status=c.status,urgency=c.urgency,language=c.language,is_sensitive=c.is_sensitive,ai_confidence=c.ai_confidence,service_unit_id=c.service_unit_id,assigned_to=c.assigned_to,resolution_due_at=c.resolution_due_at,first_response_due_at=c.first_response_due_at,created_at=c.created_at,last_activity_at=c.last_activity_at,automation=c.ai_status is null&&c.attention_category is null?null:new{ai_status=c.ai_status,attention_category=c.attention_category,attention_reason_en=c.attention_reason_en,attention_reason_ar=c.attention_reason_ar,next_action_key=c.next_action_key,next_action_en=c.next_action_en,next_action_ar=c.next_action_ar,next_action_at=c.next_action_at,automation_paused=c.automation_paused,pause_reason=c.pause_reason,reminders_sent=c.reminders_sent,last_automated_at=c.last_automated_at,ai_confidence=c.state_ai_confidence}};var mapped=rows.Select(Map).ToArray();dynamic D(object x)=>x;var attention=mapped.Where(x=>D(x).automation is not null&&(D(x).automation.attention_category is not null||D(x).automation.automation_paused==true)).ToArray();var managed=mapped.Where(x=>D(x).automation is not null&&D(x).automation.attention_category is null&&D(x).automation.automation_paused!=true).ToArray();var unmanaged=mapped.Where(x=>D(x).automation is null).ToArray();var since=DateTimeOffset.UtcNow.AddDays(-30);var events=(await db.QueryAsync(DbProc.Call("usp_Automation_ListRecentEvents",new{since},ct))).ToArray();var edits=(await db.QueryAsync<string>(DbProc.Call("usp_Automation_ListRecentEditCategories",new{since},ct))).ToArray();var prefs=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Automation_GetPreferences",new{uid},ct));var ai=events.Count(x=>(string)x.actor_type=="ai"&&(bool)x.executed);var human=events.Count(x=>(string)x.actor_type=="human");var avg=await db.ExecuteScalarAsync<decimal?>(DbProc.Call("usp_Automation_GetAvgHoursSaved",null,ct))??0;return new{attention,managed,unmanaged,preferences=prefs,impact=new{autonomousCompletions=ai,hoursSaved=(int)Math.Round(ai*avg),aiActions=ai},metrics=new{automationRate=events.Length>=5?(int?)Math.Round(ai*100d/events.Length):null,sampleSize=events.Length,aiActions=ai,humanActions=human,attentionCount=attention.Length,managedCount=managed.Length,editCounts=edits.GroupBy(x=>x).ToDictionary(g=>g.Key,g=>g.Count()),totalEdits=edits.Length}};}

    [HttpGet("cases/{caseId:guid}")]
    public async Task<object>Case(Guid caseId,CancellationToken ct){await Staff(caseId,ct);await using var db=sql.Create();var state=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Automation_GetCaseState",new{caseId},ct));var events=await db.QueryAsync(DbProc.Call("usp_Automation_ListCaseEvents",new{caseId},ct));return new{state,events};}
    public sealed record CaseRequest(Guid CaseId);
    [HttpPost("intake")]
    public async Task<object>Intake([FromBody]CaseRequest r,CancellationToken ct){var actor=await Staff(r.CaseId,ct);await using var db=sql.Create();var c=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Automation_GetCaseAssignInfo",r,ct))??throw new NotFoundException();Guid? assignee=(Guid?)c.assigned_to;if(assignee is null&&c.service_unit_id is Guid unit)assignee=await db.ExecuteScalarAsync<Guid?>(DbProc.Call("usp_Automation_PickAssignee",new{unit},ct));await db.ExecuteAsync(DbProc.Call("usp_Automation_CompleteIntake",new{r.CaseId,assignee,actor},ct));return new{ok=true,assigneeId=assignee};}

    public sealed record PauseRequest(Guid CaseId,bool Pause,string Reason);
    [HttpPost("pause")]
    public async Task<object>Pause([FromBody]PauseRequest r,CancellationToken ct){var actor=await Staff(r.CaseId,ct);await using var db=sql.Create();await db.ExecuteAsync(DbProc.Call("usp_Automation_Pause",new{r.CaseId,r.Pause,r.Reason,actor,summary=r.Pause?"Automation paused":"Automation resumed"},ct));return new{ok=true,paused=r.Pause};}

    public sealed record OverrideRequest(Guid CaseId,string Field,string Value,string Reason);
    [HttpPost("override")]
    public async Task<object>Override([FromBody]OverrideRequest r,CancellationToken ct){var actor=await Staff(r.CaseId,ct);if(r.Reason.Trim().Length<3)throw new SanadiException("A reason is required");if(r.Field is not ("unit" or "urgency" or "assignee" or "classification"))throw new SanadiException("Invalid override field");await using var db=sql.Create();await db.ExecuteAsync(DbProc.Call("usp_Automation_OverrideField",r,ct));await db.ExecuteAsync(DbProc.Call("usp_Automation_InsertOverrideAudit",new{r.CaseId,actor,r.Reason,result=JsonSerializer.Serialize(new{r.Field,r.Value,r.Reason})},ct));return new{ok=true};}

    [HttpPost("draft")]
    public async Task<object>Draft([FromBody]CaseRequest r,CancellationToken ct){var actor=await Staff(r.CaseId,ct);await using var db=sql.Create();var c=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Automation_GetCaseForDraft",r,ct))??throw new NotFoundException();var ar=(string)c.language=="ar";var unit=ar?(string?)c.name_ar:(string?)c.name_en;unit??=ar?"الوحدة المسؤولة":"the responsible unit";var draft=ar?$"عزيزي الطالب،\n\nبخصوص الحالة {c.case_number} (\"{c.title}\") — تتولى {unit} متابعة طلبك حالياً، والحالة الآن: {c.status}. سنوافيك بالمستجدات فور توفرها.\n\nمع التحية،\n{unit}":$"Dear student,\n\nRegarding case {c.case_number} (\"{c.title}\") — {unit} is handling your request. The current status is: {c.status}. We will update you as soon as there is progress.\n\nKind regards,\n{unit}";await db.ExecuteAsync(DbProc.Call("usp_Automation_InsertDraftEvent",new{r.CaseId,actor,result=JsonSerializer.Serialize(new{fallback=true})},ct));return new{caseId=r.CaseId,draft,language=ar?"ar":"en",autonomy="owner_approval",autoSendAllowed=false,reason="Service Owner review required",fallback=true};}

    public sealed record SendRequest(Guid CaseId,string OriginalDraft,string FinalText,string? Reason);
    [HttpPost("draft/send")]
    public async Task<object>Send([FromBody]SendRequest r,CancellationToken ct){var actor=await Staff(r.CaseId,ct);if(string.IsNullOrWhiteSpace(r.FinalText))throw new SanadiException("Response cannot be empty");await using var db=sql.Create();var edited=r.OriginalDraft.Trim()!=r.FinalText.Trim();await db.ExecuteAsync(DbProc.Call("usp_Automation_SendDraft",new{r.CaseId,actor,r.FinalText},ct));if(edited)await db.ExecuteAsync(DbProc.Call("usp_Automation_InsertHumanEdit",new{r.CaseId,r.OriginalDraft,r.FinalText,actor,r.Reason,category=EditCategory(r.OriginalDraft,r.FinalText)},ct));await db.ExecuteAsync(DbProc.Call("usp_Automation_InsertSendEvent",new{r.CaseId,actor,summary=edited?"Service Owner edited and sent the AI draft":"Service Owner approved and sent the AI draft",result=JsonSerializer.Serialize(new{edited})},ct));return new{ok=true,edited};}
    private static string EditCategory(string a,string b){if(a.Trim()==b.Trim())return"approved_unchanged";var ratio=b.Trim().Length/(double)Math.Max(1,a.Trim().Length);return ratio<.6?"shortened":ratio>1.4?"added_detail":"tone_or_wording";}

    public sealed record Preferences(bool AutoSendRoutineUpdates,bool AutoRequestMissingInformation,bool AutoFollowUp,bool AutoEscalateByPolicy,bool AutoPrepareResolution,bool AutoCloseEligibleCases,bool RequireReviewForAllStudentMessages,string PreferredResponseStyle);
    [HttpPost("preferences")]
    public async Task<object>PreferencesSave([FromBody]Preferences r,CancellationToken ct){var uid=await Staff(null,ct);await using var db=sql.Create();await db.ExecuteAsync(DbProc.Call("usp_Automation_MergePreferences",new{uid,r.AutoSendRoutineUpdates,r.AutoRequestMissingInformation,r.AutoFollowUp,r.AutoEscalateByPolicy,r.AutoPrepareResolution,r.AutoCloseEligibleCases,r.RequireReviewForAllStudentMessages,r.PreferredResponseStyle},ct));return new{ok=true};}

    [HttpGet("policies")]
    public async Task<object>Policies(CancellationToken ct){await Staff(null,ct);await using var db=sql.Create();return new{policies=await db.QueryAsync(DbProc.Call("usp_Automation_ListPolicies",null,ct)),followUps=await db.QueryAsync(DbProc.Call("usp_Automation_ListFollowUpPolicies",null,ct))};}
    public sealed record PolicyRequest(Guid Id,string AutonomyLevel);
    [HttpPost("policies/autonomy")]
    public async Task<object>Policy([FromBody]PolicyRequest r,CancellationToken ct){var uid=UserId();if(!await permissions.IsManagerAsync(uid,ct))throw new ForbiddenException();if(!new[]{"automatic","automatic_notify","owner_approval","human_only"}.Contains(r.AutonomyLevel))throw new SanadiException("Invalid autonomy level");await using var db=sql.Create();await db.ExecuteAsync(DbProc.Call("usp_Automation_UpdatePolicyAutonomy",r,ct));return new{ok=true};}
    public sealed record IssueRequest(string IssueType,string Description);
    [HttpPost("knowledge-issues")]
    public async Task<object>Issue([FromBody]IssueRequest r,CancellationToken ct){var uid=await Staff(null,ct);if(r.Description.Trim().Length is <10 or >2000)throw new SanadiException("Description required");await using var db=sql.Create();await db.ExecuteAsync(DbProc.Call("usp_Automation_InsertKnowledgeIssue",new{uid,r.IssueType,r.Description},ct));return new{ok=true};}
}
