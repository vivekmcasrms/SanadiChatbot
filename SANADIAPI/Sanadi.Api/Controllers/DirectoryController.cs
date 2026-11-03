using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

[ApiController, Route("api/directory")]
public sealed class DirectoryController(ISqlConnectionFactory sql) : ControllerBase
{
    [HttpGet]
    public async Task<object> Get(CancellationToken ct)
    {
        var user = HttpContext.GetSanadiUser(); if (!user.IsAuthenticated) throw new UnauthorizedException();
        await using var db = sql.Create();
        var units = (await db.QueryAsync<Unit>(DbProc.Call("usp_Directory_ListUnits", null, ct))).ToArray();
        var services = (await db.QueryAsync<Service>(DbProc.Call("usp_Directory_ListServices", null, ct))).ToArray();
        var slots = (await db.QueryAsync<Slot>(DbProc.Call("usp_Directory_ListOpenSlots", null, ct))).ToArray();
        var result = units.Select(u =>
        {
            var own = services.Where(s => s.UnitId == u.Id).Select(s => new
            {
                code = s.Code,
                nameEn = s.NameEn,
                nameAr = s.NameAr,
                descriptionEn = s.DescriptionEn,
                descriptionAr = s.DescriptionAr,
                category = s.Category,
            }).ToArray();
            var available = slots.Where(s => s.UnitId == u.Id).OrderBy(s => s.StartTime).ToArray();
            return new
            {
                id = u.Id,
                code = u.Code,
                nameEn = u.NameEn,
                nameAr = u.NameAr,
                descriptionEn = u.DescriptionEn,
                descriptionAr = u.DescriptionAr,
                email = u.Email,
                phoneExtension = u.PhoneExtension,
                officeEn = u.OfficeEn,
                officeAr = u.OfficeAr,
                hoursEn = u.HoursEn,
                hoursAr = u.HoursAr,
                services = own,
                openSlots = available.Length,
                nextSlot = available.FirstOrDefault()?.StartTime,
            };
        }).OrderBy(u => u.openSlots > 0 ? 0 : u.services.Length > 0 ? 1 : u.email is not null ? 2 : 3).ThenBy(u => u.nameEn).ToArray();
        return new { units = result, generatedAt = DateTimeOffset.UtcNow };
    }
    private sealed record Unit(Guid Id,string? Code,string NameEn,string? NameAr,string? DescriptionEn,string? DescriptionAr,string? Email,string? PhoneExtension,string? OfficeEn,string? OfficeAr,string? HoursEn,string? HoursAr);
    private sealed record Service(Guid? UnitId,string Code,string NameEn,string NameAr,string? DescriptionEn,string? DescriptionAr,string? Category);
    private sealed record Slot(Guid? UnitId,DateTimeOffset StartTime);
}
