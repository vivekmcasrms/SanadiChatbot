using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Application.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

[ApiController]
[Route("api/cases")]
public sealed class CaseController(ISqlConnectionFactory sql, IPermissionService permissions) : ControllerBase
{
    private static readonly JsonSerializerOptions CamelJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.Never,
    };

    [HttpGet("{caseId:guid}/responsible")]
    public async Task<IActionResult> Responsible(Guid caseId, CancellationToken cancellationToken)
    {
        var user = HttpContext.GetSanadiUser();
        if (!user.IsAuthenticated || user.UserId is not Guid userId)
            throw new UnauthorizedException();
        if (!await permissions.CanAccessCaseAsync(caseId, userId, cancellationToken))
            throw new ForbiddenException();

        await using var conn = sql.Create();
        var result = await conn.QuerySingleOrDefaultAsync<ResponsibleRow>(
            DbProc.Call("usp_Case_GetResponsible", new { caseId }, cancellationToken));

        if (result is null) return new JsonResult(null, CamelJson);
        return new JsonResult(new
        {
            caseNumber = result.CaseNumber,
            status = result.Status,
            assigned = !string.IsNullOrWhiteSpace(result.StaffName),
            staffName = result.StaffName,
            staffEmail = result.StaffEmail,
            staffPhone = result.StaffPhone,
            staffRoleEn = result.StaffRoleEn,
            staffRoleAr = result.StaffRoleAr,
            unitNameEn = result.UnitNameEn,
            unitNameAr = result.UnitNameAr,
            unitEmail = result.UnitEmail,
            serviceDesk = string.Equals(result.AssignmentMethod, "SERVICE_DESK_FALLBACK", StringComparison.Ordinal),
            escalated = result.NeedsAssignmentAttention && string.IsNullOrWhiteSpace(result.StaffName),
        }, CamelJson);
    }

    [HttpGet("{caseId:guid}/handover")]
    public async Task<IActionResult> Handover(Guid caseId, CancellationToken cancellationToken)
    {
        var user = HttpContext.GetSanadiUser();
        if (!user.IsAuthenticated || user.UserId is not Guid userId) throw new UnauthorizedException();
        if (!await permissions.IsStaffAsync(userId, cancellationToken)) throw new ForbiddenException();
        if (!await permissions.CanAccessCaseAsync(caseId, userId, cancellationToken)) throw new ForbiddenException();

        await using var conn = sql.Create();
        var row = await conn.QuerySingleOrDefaultAsync<HandoverRow>(
            DbProc.Call("usp_Case_GetHandover", new { caseId }, cancellationToken));
        if (row is null) return new JsonResult(null, CamelJson);
        return new JsonResult(new
        {
            row.CaseNumber, row.StudentName, row.StudentNumber, row.StudentEmail,
            row.UnitEn, row.UnitAr, row.InteractionType, row.Summary,
            conversation = JsonValue(row.Conversation, Array.Empty<object>()),
            verifiedData = JsonValue(row.VerifiedData, new Dictionary<string, object?>()),
            actionsTaken = JsonValue(row.ActionsTaken, Array.Empty<object>()),
            row.UnresolvedIssue, row.RecommendedAction, row.Priority,
            attachments = JsonValue(row.Attachments, Array.Empty<object>()),
        }, CamelJson);
    }

    private static object JsonValue(string? value, object fallback)
    {
        if (string.IsNullOrWhiteSpace(value)) return fallback;
        try { return JsonSerializer.Deserialize<JsonElement>(value); }
        catch (JsonException) { return fallback; }
    }

    private sealed class ResponsibleRow
    {
        public string? CaseNumber { get; init; }
        public string? Status { get; init; }
        public string? AssignmentMethod { get; init; }
        public bool NeedsAssignmentAttention { get; init; }
        public string? StaffName { get; init; }
        public string? StaffEmail { get; init; }
        public string? StaffPhone { get; init; }
        public string? StaffRoleEn { get; init; }
        public string? StaffRoleAr { get; init; }
        public string? UnitNameEn { get; init; }
        public string? UnitNameAr { get; init; }
        public string? UnitEmail { get; init; }
    }

    private sealed class HandoverRow
    {
        public string? CaseNumber { get; init; }
        public string? StudentName { get; init; }
        public string? StudentNumber { get; init; }
        public string? StudentEmail { get; init; }
        public string? UnitEn { get; init; }
        public string? UnitAr { get; init; }
        public string? InteractionType { get; init; }
        public string? Summary { get; init; }
        public string? Conversation { get; init; }
        public string? VerifiedData { get; init; }
        public string? ActionsTaken { get; init; }
        public string? UnresolvedIssue { get; init; }
        public string? RecommendedAction { get; init; }
        public string? Priority { get; init; }
        public string? Attachments { get; init; }
    }
}
