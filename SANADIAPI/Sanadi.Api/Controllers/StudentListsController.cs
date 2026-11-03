using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

[ApiController,Route("api/student-lists")]
public sealed class StudentListsController(ISqlConnectionFactory sql):ControllerBase
{
    [HttpGet("cases")]
    public async Task<object> Cases([FromQuery]int page=1,[FromQuery]int pageSize=20,[FromQuery]string? search=null,[FromQuery]string tab="active",[FromQuery]string? type=null,[FromQuery]string? status=null,[FromQuery]string sort="recent",[FromQuery]string? range=null,CancellationToken ct=default)
    {
        var uid=RequireUser();(page,pageSize)=Clamp(page,pageSize);
        var statuses=!string.IsNullOrWhiteSpace(status)&&status!="all"?Statuses(status):null;
        var typeFilter=!string.IsNullOrWhiteSpace(type)&&type!="all"?type:null;
        var since=Since(range);
        var searchLike=SearchLike(search);
        // Pass NULL (not "") when there is no status filter — an empty string makes
        // @statuses IS NOT NULL true and STRING_SPLIT yields no matches, so the list
        // appears empty while metrics (separate query) still show open counts.
        var p=new{uid,skip=(page-1)*pageSize,take=pageSize,tab,type=typeFilter,statuses=statuses is null?(string?)null:DbProc.Csv(statuses),sort,since,search=searchLike};
        await using var conn=sql.Create();
        var total=await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_StudentLists_CountCases",p,ct));
        var rows=await conn.QueryAsync(DbProc.Call("usp_StudentLists_ListCases",p,ct));
        return Page(rows,total,page,pageSize);
    }

    [HttpGet("suggestions")]
    public async Task<object> Suggestions([FromQuery]int page=1,[FromQuery]int pageSize=20,[FromQuery]string? search=null,[FromQuery]string? status=null,[FromQuery]string sort="recent",CancellationToken ct=default)
    {
        var uid=RequireUser();(page,pageSize)=Clamp(page,pageSize);
        var statusFilter=!string.IsNullOrWhiteSpace(status)&&status!="all"?status:null;
        var p=new{uid,skip=(page-1)*pageSize,take=pageSize,status=statusFilter,sort,search=SearchLike(search)};
        await using var conn=sql.Create();
        var total=await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_StudentLists_CountSuggestions",p,ct));
        var rows=await conn.QueryAsync(DbProc.Call("usp_StudentLists_ListSuggestions",p,ct));
        return Page(rows,total,page,pageSize);
    }

    [HttpGet("alerts")]
    public async Task<object> Alerts([FromQuery]int page=1,[FromQuery]int pageSize=20,[FromQuery]string? search=null,[FromQuery]string filter="all",[FromQuery]string? range=null,CancellationToken ct=default)
    {
        var uid=RequireUser();(page,pageSize)=Clamp(page,pageSize);
        var p=new{uid,skip=(page-1)*pageSize,take=pageSize,filter,since=Since(range),search=SearchLike(search)};
        await using var conn=sql.Create();
        var total=await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_StudentLists_CountAlerts",p,ct));
        var rows=await conn.QueryAsync(DbProc.Call("usp_StudentLists_ListAlerts",p,ct));
        return Page(rows,total,page,pageSize);
    }
    private Guid RequireUser(){var u=HttpContext.GetSanadiUser();if(!u.IsAuthenticated||u.UserId is not Guid id)throw new UnauthorizedException();return id;}
    private static (int,int) Clamp(int p,int s)=>(Math.Clamp(p,1,10000),Math.Clamp(s,5,100));
    private static object Page(IEnumerable<dynamic> items,int total,int page,int size)=>new{items,total,page,pageSize=size,pageCount=Math.Max(1,(int)Math.Ceiling(total/(double)size))};
    private static string? SearchLike(string? search){var x=(search??"").Trim();if(x.Length<2)return null;x=x[..Math.Min(80,x.Length)].Replace("%","[%]").Replace("_","[_]");return $"%{x}%";}
    private static DateTimeOffset? Since(string? range)=>range switch{"today"=>DateTimeOffset.Now.Date,"7d"=>DateTimeOffset.UtcNow.AddDays(-7),"30d"=>DateTimeOffset.UtcNow.AddDays(-30),"90d"=>DateTimeOffset.UtcNow.AddDays(-90),_=>null};
    private static string[] Statuses(string key)=>key switch{"waiting_student"=>["awaiting_student","student_confirmation"],"submitted" or "new"=>["draft","submitted","acknowledged","classified","routed","assigned"],"in_progress"=>["in_progress","in_review","ai_processing","resolution_proposed","escalated","on_hold","waiting_external","reopened","transferred"],"resolved" or "completed"=>["resolved","closed"],"open" or "all_open" or ""=>["draft","submitted","acknowledged","classified","routed","assigned","in_progress","in_review","ai_processing","resolution_proposed","escalated","on_hold","waiting_external","reopened","transferred","awaiting_student","student_confirmation"],_=>[key]};
}
