using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Application.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.AppFunctions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

[ApiController,Route("api/proactive")]
public sealed class ProactiveController(ISqlConnectionFactory sql,AcademicFunctions academic,IPermissionService permissions):ControllerBase
{
    [HttpPost("refresh")]
    public async Task<object> Refresh(CancellationToken ct)
    {
        var id=RequireUser();await using var conn=sql.Create();
        var before=(await conn.QueryAsync<string>(DbProc.Call("usp_Proactive_ListActiveAlertTypes", new{id}, ct))).ToHashSet();
        await academic.Briefing("en",HttpContext.GetSanadiUser(),ct);
        var closed=await conn.ExecuteAsync(DbProc.Call("usp_Proactive_CloseStaleCaseAlerts", new{id}, ct));
        var after=(await conn.QueryAsync<string>(DbProc.Call("usp_Proactive_ListActiveAlertTypes", new{id}, ct))).ToHashSet();
        var types=after.Except(before).ToArray();return new{created=types.Length,types,closed};
    }

    [HttpGet("suggestion-themes")]
    public async Task<object> Themes(CancellationToken ct)
    {
        var id=RequireUser();if(!await permissions.IsStaffAsync(id,ct))throw new ForbiddenException();await using var conn=sql.Create();
        var rows=(await conn.QueryAsync<Suggestion>(DbProc.Call("usp_Proactive_ListSuggestionThemes", null, ct))).ToList();
        var clusters=new List<List<Suggestion>>();foreach(var row in rows){var terms=Terms(row.Title+" "+row.Description);var hit=clusters.FirstOrDefault(c=>c[0].UnitId==row.UnitId&&Similarity(Terms(c[0].Title+" "+c[0].Description),terms)>=.34);if(hit is null)clusters.Add([row]);else hit.Add(row);}
        return clusters.Select(c=>new{key=c[0].Id,labelEn=c[0].Title,labelAr=c[0].Title,count=c.Count,votes=c.Sum(x=>x.Votes),unitId=c[0].UnitId,unitNameEn=c[0].UnitNameEn,unitNameAr=c[0].UnitNameAr,oldestAt=c[0].CreatedAt,items=c.Select(x=>new{x.Id,x.ReferenceNumber,x.Title,x.Status,votes=x.Votes,createdAt=x.CreatedAt})}).OrderByDescending(x=>x.count).ThenByDescending(x=>x.votes);
    }
    private Guid RequireUser(){var u=HttpContext.GetSanadiUser();if(!u.IsAuthenticated||u.UserId is not Guid id)throw new UnauthorizedException();return id;}
    private static HashSet<string> Terms(string value)=>value.ToLowerInvariant().Split([' ','\t','\r','\n',',','.',';',':','!','?','-','—'],StringSplitOptions.RemoveEmptyEntries).Where(x=>x.Length>2&&!Stop.Contains(x)).ToHashSet();
    private static double Similarity(HashSet<string>a,HashSet<string>b)=>a.Count==0||b.Count==0?0:a.Count(x=>b.Contains(x))/(double)Math.Min(a.Count,b.Count);
    private static readonly HashSet<string> Stop=["the","and","for","with","more","please","students","student","should","need","needs","university","uaeu","this","that","have","has","can","would","make","better","في","من","على","إلى","عن","مع","هذا","هذه","يجب","الطلاب","الطالب","الجامعة"];
    private sealed class Suggestion{public Guid Id{get;init;}public string ReferenceNumber{get;init;}="";public string Title{get;init;}="";public string? Description{get;init;}public string Status{get;init;}="";public int Votes{get;init;}public DateTimeOffset CreatedAt{get;init;}public Guid? UnitId{get;init;}public string? UnitNameEn{get;init;}public string? UnitNameAr{get;init;}}
}
