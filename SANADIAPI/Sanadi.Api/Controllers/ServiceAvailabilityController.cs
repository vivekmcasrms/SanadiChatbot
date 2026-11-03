using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Application.Rpc;
using Sanadi.Application.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

[ApiController,Route("api/service-availability")]
public sealed class ServiceAvailabilityController(ISqlConnectionFactory sql,IRpcExecutor rpc,IPermissionService permissions):ControllerBase
{
    public sealed class ReminderBody{public string Code{get;set;}="";public string ReminderType{get;set;}="service_open";}
    public sealed class WindowBody{public Guid? Id{get;set;}public Guid ServiceId{get;set;}public string AvailabilityType{get;set;}="always_available";public DateTimeOffset? OpensAt{get;set;}public DateTimeOffset? ClosesAt{get;set;}public Guid? AcademicTermId{get;set;}public string? Label{get;set;}public string? ReasonEn{get;set;}public string? ReasonAr{get;set;}public string? StudentMessageEn{get;set;}public string? StudentMessageAr{get;set;}public bool? RemindersEnabled{get;set;}public bool? PreliminaryCheckAllowed{get;set;}public bool? StudentVisible{get;set;}public string? Status{get;set;}}

    [HttpGet("service/{code}")]
    public async Task<object> One(string code,CancellationToken ct)
    {
        RequireUser();await using var conn=sql.Create();var id=await conn.ExecuteScalarAsync<Guid?>(DbProc.Call("usp_SvcAvail_GetServiceIdByCode", new{code}, ct));
        return id is null?Unknown(code):await Availability(id.Value,ct);
    }

    [HttpGet("board")]
    public async Task<object> Board(CancellationToken ct)
    {
        RequireUser();await using var conn=sql.Create();var services=(await conn.QueryAsync<ServiceRow>(DbProc.Call("usp_SvcAvail_ListServices", null, ct))).ToArray();
        var windows=(await conn.QueryAsync<WindowRow>(DbProc.Call("usp_SvcAvail_ListWindows", null, ct))).ToArray();
        var result=new List<object>();foreach(var s in services)result.Add(new{service=new{id=s.Id,code=s.Code,name_en=s.NameEn,name_ar=s.NameAr,category=s.Category,is_active=s.IsActive,service_unit_id=s.ServiceUnitId},availability=await Availability(s.Id,ct),windows=windows.Where(x=>x.ServiceId==s.Id).Select(x=>new{id=x.Id,service_id=x.ServiceId,availability_type=x.AvailabilityType,opens_at=x.OpensAt,closes_at=x.ClosesAt,status=x.Status,label=x.Label,reason_en=x.ReasonEn,reason_ar=x.ReasonAr,student_message_en=x.StudentMessageEn,student_message_ar=x.StudentMessageAr,reminders_enabled=x.RemindersEnabled,preliminary_check_allowed=x.PreliminaryCheckAllowed,student_visible=x.StudentVisible,academic_term_id=x.AcademicTermId,updated_at=x.UpdatedAt})});return result;
    }

    [HttpGet("reminders")]
    public async Task<object> Reminders(CancellationToken ct){var id=RequireUser();await using var conn=sql.Create();return await conn.QueryAsync(DbProc.Call("usp_SvcAvail_ListReminders", new{id}, ct));}

    [HttpPost("reminders")]
    public async Task<object> AddReminder([FromBody]ReminderBody body,CancellationToken ct)
    {
        var userId=RequireUser();if(body.Code.Length<2||body.ReminderType is not("service_open" or "day_before_open"))throw new SanadiException("Invalid reminder.");await using var conn=sql.Create();var serviceId=await conn.ExecuteScalarAsync<Guid?>(DbProc.Call("usp_SvcAvail_GetServiceIdByCode", new{code=body.Code}, ct));if(serviceId is null)throw new SanadiException("Unknown service.");
        var a=JsonSerializer.SerializeToNode(await Availability(serviceId.Value,ct))!.AsObject();if(a["isAvailable"]?.GetValue<bool>()==true)throw new SanadiException("SERVICE_ALREADY_OPEN");var next=a["nextOpenAt"]?.ToString();if(next is null||a["remindersEnabled"]?.GetValue<bool>()!=true)throw new SanadiException("REMINDERS_UNAVAILABLE");var scheduled=DateTimeOffset.Parse(next).AddDays(body.ReminderType=="day_before_open"?-1:0);
        var existing=await conn.ExecuteScalarAsync<Guid?>(DbProc.Call("usp_SvcAvail_FindReminder", new{userId,serviceId,body.ReminderType}, ct));if(existing is not null)return new{id=existing,scheduledFor=scheduled,alreadyExisted=true,availability=a};
        var id=await conn.ExecuteScalarAsync<Guid>(DbProc.Call("usp_SvcAvail_InsertReminder", new{userId,serviceId,window=Guid.TryParse(a["nextWindowId"]?.ToString(),out var w)?w:(Guid?)null,body.ReminderType,scheduled}, ct));return new{id,scheduledFor=scheduled,alreadyExisted=false,availability=a};
    }
    [HttpDelete("reminders/{id:guid}")]public async Task<object> Cancel(Guid id,CancellationToken ct){var userId=RequireUser();await using var conn=sql.Create();await conn.ExecuteAsync(DbProc.Call("usp_SvcAvail_CancelReminder", new{id,userId}, ct));return new{ok=true};}

    [HttpPut("windows")]
    public async Task<object> Save([FromBody]WindowBody b,CancellationToken ct)
    {
        var userId=RequireUser();if(!await permissions.HasRoleAsync(userId,"system_admin",ct))throw new ForbiddenException("Only system administrators may change service availability.");var allowed=new[]{"always_available","date_range","term_based","multiple_windows","temporarily_closed","admin_disabled"};if(!allowed.Contains(b.AvailabilityType)||b.Status is not(null or "active" or "archived"))throw new SanadiException("Invalid availability window.");var dated=new[]{"date_range","term_based","multiple_windows"}.Contains(b.AvailabilityType);await using var conn=sql.Create();
        if(b.Id is Guid id){await conn.ExecuteAsync(DbProc.Call("usp_SvcAvail_UpdateWindow", new{b.ServiceId,b.AvailabilityType,opens=dated?b.OpensAt:null,closes=dated?b.ClosesAt:null,b.AcademicTermId,b.Label,b.ReasonEn,b.ReasonAr,b.StudentMessageEn,b.StudentMessageAr,b.RemindersEnabled,b.PreliminaryCheckAllowed,b.StudentVisible,b.Status,userId,id}, ct));return new{id};}
        var created=await conn.ExecuteScalarAsync<Guid>(DbProc.Call("usp_SvcAvail_InsertWindow", new{b.ServiceId,b.AvailabilityType,opens=dated?b.OpensAt:null,closes=dated?b.ClosesAt:null,b.AcademicTermId,b.Label,b.ReasonEn,b.ReasonAr,b.StudentMessageEn,b.StudentMessageAr,b.RemindersEnabled,b.PreliminaryCheckAllowed,b.StudentVisible,b.Status,userId}, ct));return new{id=created};
    }
    [HttpDelete("windows/{id:guid}")]public async Task<object> Delete(Guid id,CancellationToken ct){var userId=RequireUser();if(!await permissions.HasRoleAsync(userId,"system_admin",ct))throw new ForbiddenException();await using var conn=sql.Create();await conn.ExecuteAsync(DbProc.Call("usp_SvcAvail_DeleteWindow", new{id}, ct));return new{ok=true};}
    [HttpGet("audit")]public async Task<object> Audit([FromQuery]Guid? serviceId,CancellationToken ct){var id=RequireUser();if(!await permissions.IsStaffAsync(id,ct))throw new ForbiddenException();await using var conn=sql.Create();return await conn.QueryAsync(DbProc.Call("usp_SvcAvail_ListAudit", new{serviceId}, ct));}

    private async Task<object> Availability(Guid id,CancellationToken ct){var raw=await rpc.ExecuteAsync("get_service_availability",JsonSerializer.SerializeToElement(new{_service_id=id}),HttpContext.GetSanadiUser(),ct);var n=JsonSerializer.SerializeToNode(raw)?.AsObject()??[];string? S(string k)=>n[k]?.ToString();bool B(string k)=>n[k]?.GetValue<bool>()??false;return new{serviceId=S("service_id"),serviceCode=S("service_code"),serviceNameEn=S("service_name_en"),serviceNameAr=S("service_name_ar"),exists=B("exists"),isAvailable=B("is_available"),status=S("status")??"closed",availabilityType=S("availability_type")??"always_available",currentWindowId=S("current_window_id"),nextWindowId=S("next_window_id"),opensAt=S("opens_at"),closesAt=S("closes_at"),nextOpenAt=S("next_open_at"),nextCloseAt=S("next_close_at"),reasonEn=S("reason_en"),reasonAr=S("reason_ar"),studentMessageEn=S("student_message_en"),studentMessageAr=S("student_message_ar"),remindersEnabled=B("reminders_enabled"),preliminaryCheckAllowed=B("preliminary_check_allowed"),timezone=S("timezone")??"Asia/Dubai"};}
    private static object Unknown(string code)=>new{serviceId=(string?)null,serviceCode=code,serviceNameEn=(string?)null,serviceNameAr=(string?)null,exists=false,isAvailable=true,status="always_available",availabilityType="always_available",currentWindowId=(string?)null,nextWindowId=(string?)null,opensAt=(string?)null,closesAt=(string?)null,nextOpenAt=(string?)null,nextCloseAt=(string?)null,reasonEn=(string?)null,reasonAr=(string?)null,studentMessageEn=(string?)null,studentMessageAr=(string?)null,remindersEnabled=false,preliminaryCheckAllowed=false,timezone="Asia/Dubai"};
    private Guid RequireUser(){var u=HttpContext.GetSanadiUser();if(!u.IsAuthenticated||u.UserId is not Guid id)throw new UnauthorizedException();return id;}
    private sealed class ServiceRow{public Guid Id{get;init;}public string Code{get;init;}="";public string? NameEn{get;init;}public string? NameAr{get;init;}public string? Category{get;init;}public bool IsActive{get;init;}public Guid? ServiceUnitId{get;init;}}
    private sealed class WindowRow{public Guid Id{get;init;}public Guid ServiceId{get;init;}public string AvailabilityType{get;init;}="";public DateTimeOffset? OpensAt{get;init;}public DateTimeOffset? ClosesAt{get;init;}public string Status{get;init;}="";public string? Label{get;init;}public string? ReasonEn{get;init;}public string? ReasonAr{get;init;}public string? StudentMessageEn{get;init;}public string? StudentMessageAr{get;init;}public bool RemindersEnabled{get;init;}public bool PreliminaryCheckAllowed{get;init;}public bool StudentVisible{get;init;}public Guid? AcademicTermId{get;init;}public DateTimeOffset UpdatedAt{get;init;}}
}
