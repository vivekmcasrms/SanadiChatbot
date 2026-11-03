using System.Data.Common;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Application.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

[ApiController]
[Route("api/suggestions")]
public sealed class SuggestionsController(ISqlConnectionFactory sql, IPermissionService permissions) : ControllerBase
{
    private Guid UserId()
    {
        var user = HttpContext.GetSanadiUser();
        if (!user.IsAuthenticated || user.UserId is not Guid id) throw new UnauthorizedException();
        return id;
    }

    private async Task RequireStaff(Guid id, CancellationToken ct)
    { if (!await permissions.IsStaffAsync(id, ct)) throw new ForbiddenException(); }

    private sealed record Suggestion(Guid Id, string ReferenceNumber, Guid StudentId, string Status,
        string Language, Guid? ServiceUnitId, Guid? AssignedStaffId, DateTimeOffset? ReviewDueAt);

    private static Task<Suggestion?> Load(DbConnection db, Guid id) =>
        db.QuerySingleOrDefaultAsync<Suggestion>(DbProc.Call("usp_Suggestions_Load", new { id }));

    private static Task Update(DbConnection db, Guid id, Guid? actor, string type, string en, string? ar = null, bool visible = true) =>
        db.ExecuteAsync(DbProc.Call("usp_Suggestions_InsertUpdate", new { id, actor, type, en, ar, visible }));

    private static Task Audit(DbConnection db, Guid? actor, Guid id, string action, object metadata) =>
        db.ExecuteAsync(DbProc.Call("usp_Suggestions_InsertAudit", new { actor, action, id, json = JsonSerializer.Serialize(metadata) }));

    private static Task Notify(DbConnection db, Suggestion s, Guid? actor, string status, string? note = null) =>
        db.ExecuteAsync(DbProc.Call("usp_Suggestions_Notify", new { s.Id, s.StudentId, s.ServiceUnitId, actor, body = note ?? $"Suggestion {s.ReferenceNumber} is now {status.Replace('_', ' ')}.", dedupe = $"sugg-status:{s.Id}:{status}:{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}" }));

    public sealed record IdRequest(Guid SuggestionId, string? Note = null, Guid? AssigneeId = null);
    public sealed record AssessmentRequest(Guid SuggestionId, int Impact, int Feasibility, int Alignment,
        string? CostBand, string? Complexity, string Recommendation, string? Rationale);
    public sealed record DecisionRequest(Guid SuggestionId, string Decision, string OutcomeEn, string? OutcomeAr, string? TargetDate);
    public sealed record ProgressRequest(Guid SuggestionId, string TextEn, string? TextAr, bool VisibleToStudent = true);

    [HttpPost("intake")]
    public async Task<IActionResult> Intake([FromBody] IdRequest request, CancellationToken ct)
    {
        var actor = UserId(); await using var db = sql.Create(); var s = await Load(db, request.SuggestionId) ?? throw new NotFoundException("Suggestion not found");
        if (s.StudentId != actor) await RequireStaff(actor, ct);
        if (s.AssignedStaffId is not null) return Ok(new { unitId = s.ServiceUnitId, assigneeId = s.AssignedStaffId });
        Guid? assignee = null;
        if (s.ServiceUnitId is not null) assignee = await db.ExecuteScalarAsync<Guid?>(DbProc.Call("usp_Suggestions_PickAssignee", new { s.ServiceUnitId }, ct));
        var due = s.ReviewDueAt ?? DateTimeOffset.UtcNow.AddDays(14);
        await db.ExecuteAsync(DbProc.Call("usp_Suggestions_AssignOnIntake", new { assignee, due, id=s.Id }, ct));
        await Update(db,s.Id,null,"routed",assignee is null ? "Your suggestion was received and is queued for review by the responsible unit." : "Your suggestion was routed to the responsible unit and a reviewing officer was assigned.");
        await Audit(db,null,s.Id,"suggestion.routed",new { unit=s.ServiceUnitId,assignee });
        return Ok(new { unitId=s.ServiceUnitId,assigneeId=assignee });
    }

    [HttpPost("acknowledge")]
    public async Task<IActionResult> Acknowledge([FromBody] IdRequest r,CancellationToken ct){var actor=UserId();await RequireStaff(actor,ct);await using var db=sql.Create();var s=await Load(db,r.SuggestionId)??throw new NotFoundException("Suggestion not found");await db.ExecuteAsync(DbProc.Call("usp_Suggestions_Acknowledge",new{actor,id=s.Id},ct));await Update(db,s.Id,actor,"acknowledged",string.IsNullOrWhiteSpace(r.Note)?"Your suggestion is now under review by the responsible unit.":r.Note);await Notify(db,s,actor,"under_review");await Audit(db,actor,s.Id,"suggestion.acknowledged",new{});return Ok(new{ok=true});}

    [HttpPost("assign")]
    public async Task<IActionResult> Assign([FromBody] IdRequest r,CancellationToken ct){var actor=UserId();await RequireStaff(actor,ct);await using var db=sql.Create();var s=await Load(db,r.SuggestionId)??throw new NotFoundException("Suggestion not found");var target=r.AssigneeId??actor;await db.ExecuteAsync(DbProc.Call("usp_Suggestions_Assign",new{target,id=s.Id},ct));await Audit(db,actor,s.Id,"suggestion.assigned",new{assignee=target});return Ok(new{ok=true,assigneeId=target});}

    [HttpPost("assess")]
    public async Task<IActionResult> Assess([FromBody] AssessmentRequest r,CancellationToken ct){var actor=UserId();await RequireStaff(actor,ct);if(r.Impact is <1 or >5||r.Feasibility is <1 or >5||r.Alignment is <1 or >5||!new[]{"approve","pilot","defer","decline"}.Contains(r.Recommendation))return BadRequest();await using var db=sql.Create();var s=await Load(db,r.SuggestionId)??throw new NotFoundException("Suggestion not found");await db.ExecuteAsync(DbProc.Call("usp_Suggestions_InsertAssessment",new{r.SuggestionId,actor,r.Impact,r.Feasibility,r.Alignment,r.CostBand,r.Complexity,r.Recommendation,r.Rationale},ct));await db.ExecuteAsync(DbProc.Call("usp_Suggestions_MarkUnderReview",new{r.SuggestionId},ct));await Update(db,s.Id,actor,"assessed","The unit completed its assessment of your suggestion.");await Audit(db,actor,s.Id,"suggestion.assessed",new{r.Recommendation});return Ok(new{ok=true});}

    [HttpPost("decide")]
    public async Task<IActionResult> Decide([FromBody] DecisionRequest r,CancellationToken ct){var actor=UserId();await RequireStaff(actor,ct);if(!new[]{"planned","implemented","not_proceeding","closed"}.Contains(r.Decision)||r.OutcomeEn.Trim().Length<10)return BadRequest();await using var db=sql.Create();var s=await Load(db,r.SuggestionId)??throw new NotFoundException("Suggestion not found");DateTimeOffset? target=DateTimeOffset.TryParse(r.TargetDate,out var d)?d:null;await db.ExecuteAsync(DbProc.Call("usp_Suggestions_Decide",new{r.Decision,r.OutcomeEn,target,r.SuggestionId},ct));await db.ExecuteAsync(DbProc.Call("usp_Suggestions_InsertReview",new{r.SuggestionId,actor,r.Decision,r.OutcomeEn},ct));await Update(db,s.Id,actor,r.Decision,r.OutcomeEn,r.OutcomeAr);await Notify(db,s,actor,r.Decision,r.OutcomeEn);await Audit(db,actor,s.Id,"suggestion.decided",new{r.Decision});return Ok(new{ok=true});}

    [HttpPost("updates")]
    public async Task<IActionResult> Progress([FromBody] ProgressRequest r,CancellationToken ct){var actor=UserId();await RequireStaff(actor,ct);if(r.TextEn.Trim().Length<3)return BadRequest();await using var db=sql.Create();var s=await Load(db,r.SuggestionId)??throw new NotFoundException("Suggestion not found");await Update(db,s.Id,actor,"progress",r.TextEn,r.TextAr,r.VisibleToStudent);if(r.VisibleToStudent)await Notify(db,s,actor,s.Status,r.TextEn);await Audit(db,actor,s.Id,"suggestion.update",new{visible=r.VisibleToStudent});return Ok(new{ok=true});}
}
