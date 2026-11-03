using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

[ApiController,Route("api/approvals")]
public sealed class ApprovalsController(ISqlConnectionFactory sql):ControllerBase
{
    // The approval row records consent, while completed/failed describe the later
    // action execution. The latter belong in payload, not the constrained status column.
    internal static string StoredStatus(string status)=>status switch
    {
        "declined"=>"rejected",
        "approved" or "completed" or "failed"=>"approved",
        _=>throw new SanadiException("Invalid approval decision.")
    };

    public sealed class Decision{public string ActionKey{get;set;}="";public string Status{get;set;}="";public string? AffectedService{get;set;}public string? DataShared{get;set;}public string? ExpectedOutcome{get;set;}public string? ResponsibleUnit{get;set;}public string? Fee{get;set;}public string? Reversible{get;set;}public string RiskLevel{get;set;}="level_2";public string[] DataScope{get;set;}=[];public string? ReceiptNumber{get;set;}public Guid? ApprovalId{get;set;}public string Language{get;set;}="en";}
    [HttpPost("decision")]
    public async Task<object> Record([FromBody]Decision b)
    {
        var user=HttpContext.GetSanadiUser();if(!user.IsAuthenticated||user.UserId is not Guid userId)throw new UnauthorizedException();
        if(string.IsNullOrWhiteSpace(b.ActionKey)||!new[]{"approved","declined","completed","failed"}.Contains(b.Status)||!new[]{"level_0","level_1","level_2","level_3"}.Contains(b.RiskLevel)||b.Reversible is not(null or "yes" or "no" or "conditional")||b.Language is not("en" or "ar"))throw new SanadiException("Invalid approval decision.");
        if(b.ApprovalId is null && (b.Status is "completed" or "failed"))throw new SanadiException("An existing approval is required to record the action outcome.");
        var status=StoredStatus(b.Status);
        var payload=JsonSerializer.Serialize(new{responsible_unit=b.ResponsibleUnit,fee=b.Fee,reversible=b.Reversible,data_scope=b.DataScope,language=b.Language,decided_at=DateTimeOffset.UtcNow,execution_status=b.Status is "completed" or "failed"?b.Status:null});await using var conn=sql.Create();
        if(b.ApprovalId is Guid id){var updated=await conn.ExecuteScalarAsync<Guid?>(DbProc.Call("usp_Approvals_UpdateDecision",new{Status=status,b.ReceiptNumber,payload,id,userId}));return new{id=updated??id};}
        var created=await conn.ExecuteScalarAsync<Guid?>(DbProc.Call("usp_Approvals_InsertDecision",new{userId,b.ActionKey,Status=status,b.RiskLevel,b.AffectedService,b.DataShared,b.ExpectedOutcome,b.ReceiptNumber,payload}));return new{id=created};
    }
}
