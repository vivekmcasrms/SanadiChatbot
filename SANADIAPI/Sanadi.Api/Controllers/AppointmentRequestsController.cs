using System.Data;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Application.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

[ApiController, Route("api/appointment-requests")]
public sealed class AppointmentRequestsController(ISqlConnectionFactory sql, IPermissionService permissions) : ControllerBase
{
    private static readonly JsonSerializerOptions CamelJson = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public sealed class ResponseBody
    {
        public string Action { get; set; } = "";
        public DateTimeOffset? AlternativeDatetime { get; set; }
        public string? Location { get; set; }
        public string? Message { get; set; }
    }

    [HttpGet("case/{caseId:guid}")]
    public async Task<IActionResult> ForCase(Guid caseId, CancellationToken ct)
    {
        var userId = RequireUser();
        if (!await permissions.CanAccessCaseAsync(caseId, userId, ct)) throw new ForbiddenException();
        await using var conn = sql.Create();
        var row = await conn.QuerySingleOrDefaultAsync<Row>(DbProc.Call("usp_ApptReq_GetByCase", new { caseId }, ct));
        return new JsonResult(row is null ? null : View(row, userId), CamelJson);
    }

    [HttpGet("mine")]
    public async Task<IActionResult> Mine(CancellationToken ct)
    {
        var userId = RequireUser();
        if (!await permissions.IsStaffAsync(userId, ct)) throw new ForbiddenException();
        await using var conn = sql.Create();
        var rows = await conn.QueryAsync<Row>(DbProc.Call("usp_ApptReq_ListMine", new { userId }, ct));
        return new JsonResult(rows.Select(x => View(x, userId)), CamelJson);
    }

    [HttpPost("{requestId:guid}/respond")]
    public async Task<object> Respond(Guid requestId, [FromBody] ResponseBody body, CancellationToken ct)
    {
        var userId = RequireUser();
        if (body.Message?.Length > 2000 || body.Location?.Length > 200) throw new SanadiException("Response is too long.");
        var valid = new[] { "confirm", "propose", "request_info", "decline", "student_accept", "student_cancel" };
        if (!valid.Contains(body.Action)) throw new SanadiException("Invalid appointment action.");

        await using var conn = sql.Create();
        await conn.OpenAsync(ct);
        using var tx = conn.BeginTransaction(IsolationLevel.Serializable);
        var current = await conn.QuerySingleOrDefaultAsync<Row>(DbProc.Call("usp_ApptReq_GetById", new { requestId }, ct, tx));
        if (current is null) throw new SanadiException("Appointment request not found.");
        var isStudent = current.StudentId == userId;
        if (body.Action.StartsWith("student_", StringComparison.Ordinal))
        {
            if (!isStudent) throw new ForbiddenException("Only the student can respond to the suggested time.");
        }
        else
        {
            if (isStudent || !await permissions.IsStaffAsync(userId, ct) || current.CaseId is not Guid caseId || !await permissions.CanAccessCaseAsync(caseId, userId, ct))
                throw new ForbiddenException();
        }

        var status = current.RequestStatus;
        var confirmation = current.ConfirmationStatus;
        DateTimeOffset? confirmed = current.ConfirmedDatetime, alternative = current.AlternativeDatetime;
        string? decline = current.DeclineReason;
        var officeResponse = current.OfficeResponseAt;
        var studentResponse = current.StudentResponseAt;
        var now = DateTimeOffset.UtcNow;
        switch (body.Action)
        {
            case "confirm": status = confirmation = "CONFIRMED"; confirmed = current.PreferredDatetime; officeResponse = now; break;
            case "propose":
                if (body.AlternativeDatetime is null) throw new SanadiException("Choose the alternative time first.");
                status = "ALTERNATIVE_PROPOSED"; confirmation = "AWAITING_STUDENT_CONFIRMATION"; alternative = body.AlternativeDatetime; officeResponse = now; break;
            case "request_info": status = "AWAITING_OFFICE_CONFIRMATION"; officeResponse = now; break;
            case "decline": status = confirmation = "DECLINED"; decline = body.Message; officeResponse = now; break;
            case "student_accept":
                if (current.AlternativeDatetime is null) throw new SanadiException("No alternative time was suggested.");
                status = confirmation = "CONFIRMED"; confirmed = current.AlternativeDatetime; studentResponse = now; break;
            case "student_cancel": status = confirmation = "CANCELLED"; studentResponse = now; break;
        }

        await conn.ExecuteAsync(DbProc.Call("usp_ApptReq_UpdateResponse", new { status, confirmation, confirmed, alternative, decline, officeResponse, studentResponse, location = body.Location, requestId }, ct, tx));
        if (current.CaseId is Guid commentCase && !string.IsNullOrWhiteSpace(body.Message))
            await conn.ExecuteAsync(DbProc.Call("usp_ApptReq_InsertComment", new { commentCase, userId, message = body.Message }, ct, tx));

        var eventType = status == "CONFIRMED" ? "appointment_request_confirmed" : status == "ALTERNATIVE_PROPOSED" ? "appointment_request_alternative" : "appointment_request_updated";
        foreach (var recipient in new Guid?[] { current.StudentId, current.AssignedStaffId }.Where(x => x is not null).Distinct())
        {
            var dedupe = $"{eventType}:{requestId}:{recipient}:{now:yyyyMMddHHmmss}";
            await conn.ExecuteAsync(DbProc.Call("usp_ApptReq_Notify", new { eventType, requestId, recipient, message = body.Message ?? status, dedupe, caseId = current.CaseId, unitId = current.UnitId, userId }, ct, tx));
        }
        tx.Commit();
        return new { ok = true, status };
    }

    private Guid RequireUser()
    {
        var user = HttpContext.GetSanadiUser();
        if (!user.IsAuthenticated || user.UserId is not Guid id) throw new UnauthorizedException();
        return id;
    }

    private static object View(Row r, Guid viewer) => new { r.Id, r.CaseId, r.Reference, r.StudentId, r.StudentName, r.StudentNumber,
        unitId=r.UnitId, r.UnitName, r.PreferredDatetime, r.AlternativeDatetime, r.ConfirmedDatetime, r.AssignedStaffId,
        r.AssignedStaffName, r.AssignedStaffEmail, r.AssignmentMethod, r.AssignedAt, r.WorkloadAtAssignment,
        r.RequestStatus, r.ConfirmationStatus, r.Purpose, r.DeclineReason, r.Location, r.OfficeResponseAt, r.StudentResponseAt,
        isMine = r.StudentId == viewer };

    private sealed class Row
    {
        public Guid Id { get; init; } public Guid? CaseId { get; init; } public string? Reference { get; init; }
        public Guid StudentId { get; init; } public string? StudentName { get; init; } public string? StudentNumber { get; init; }
        public Guid? UnitId { get; init; } public string? UnitName { get; init; } public DateTimeOffset PreferredDatetime { get; init; }
        public DateTimeOffset? AlternativeDatetime { get; init; } public DateTimeOffset? ConfirmedDatetime { get; init; }
        public Guid? AssignedStaffId { get; init; } public string? AssignedStaffName { get; init; } public string? AssignedStaffEmail { get; init; }
        public string? AssignmentMethod { get; init; } public DateTimeOffset? AssignedAt { get; init; } public decimal? WorkloadAtAssignment { get; init; }
        public string RequestStatus { get; init; } = "REQUESTED"; public string ConfirmationStatus { get; init; } = "AWAITING_OFFICE_CONFIRMATION";
        public string? Purpose { get; init; } public string? DeclineReason { get; init; } public string? Location { get; init; }
        public DateTimeOffset? OfficeResponseAt { get; init; } public DateTimeOffset? StudentResponseAt { get; init; }
    }
}
