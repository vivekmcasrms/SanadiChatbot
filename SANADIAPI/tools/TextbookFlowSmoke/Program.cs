using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Sanadi.Api.Controllers;
using Sanadi.Api.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Options;
using Sanadi.Infrastructure.Persistence;

// All writes confined to a fresh disposable LocalDB database; no deployment settings loaded.
var root=Path.GetFullPath(args.Single());
var name="SanadiTextbookTest_"+Guid.NewGuid().ToString("N");
await using var admin=new SqlConnection(@"Server=(localdb)\MSSQLLocalDB;Database=master;Integrated Security=true;TrustServerCertificate=true");
await admin.OpenAsync(); await admin.ExecuteAsync($"CREATE DATABASE [{name}]");
try
{
    var factory=new SqlConnectionFactory(Options.Create(new SqlOptions { ConnectionString=$@"Server=(localdb)\MSSQLLocalDB;Database={name};Integrated Security=true;TrustServerCertificate=true" }));
    await using var db=factory.Create(); await db.OpenAsync();
    var schema=File.ReadAllText(Path.Combine(root,"sql/sanadi_schema.sql"));
    foreach(var table in new[]{"conversations","messages","agent_runs","emergency_contacts","courses","course_sections","student_current_enrollments"})
    {
        var match=Regex.Match(schema,@"CREATE TABLE \[dbo\]\.\["+table+@"\][\s\S]*?^GO\s*$",RegexOptions.Multiline);
        Check(match.Success,"Missing fixture table "+table);
        await db.ExecuteAsync(Regex.Replace(match.Value,@"^GO\s*$","",RegexOptions.Multiline));
    }
    var procs=File.ReadAllText(Path.Combine(root,"sql/2026-09-21-usp-api-direct-queries.sql"));
    foreach(Match match in Regex.Matches(procs,@"CREATE OR ALTER PROCEDURE dbo\.usp_Assistant_\w+[\s\S]*?^GO\s*$",RegexOptions.Multiline))
        await db.ExecuteAsync(Regex.Replace(match.Value,@"^GO\s*$","",RegexOptions.Multiline));
    var incident=File.ReadAllText(Path.Combine(root,"sql/VS_2026-09-29-chat-incident-routing.sql"));
    var contacts=Regex.Match(incident,@"CREATE OR ALTER PROCEDURE dbo\.usp_Assistant_GetIncidentContacts\b[\s\S]*?^GO\s*$",RegexOptions.Multiline);
    await db.ExecuteAsync(Regex.Replace(contacts.Value,@"^GO\s*$","",RegexOptions.Multiline));
    var migration=File.ReadAllText(Path.Combine(root,"sql/VS_2026-09-29-assistant-course-textbooks.sql"));
    for(var repeat=0;repeat<2;repeat++)
        foreach(var batch in Regex.Split(migration,@"^GO\s*$",RegexOptions.Multiline))
            if(!string.IsNullOrWhiteSpace(batch))await db.ExecuteAsync(batch);

    var student=Guid.NewGuid(); var other=Guid.NewGuid();
    var history=Guid.NewGuid();var ethics=Guid.NewGuid();var dropped=Guid.NewGuid();var privateCourse=Guid.NewGuid();
    await db.ExecuteAsync("""
        INSERT dbo.courses(id,code,title_en,title_ar) VALUES
        (@history,N'HIST120',N'UAE Society and History',N'مجتمع الإمارات وتاريخه'),
        (@ethics,N'ETHC201',N'Professional Ethics',N'الأخلاقيات المهنية'),
        (@dropped,N'DROP100',N'Dropped subject',N'مقرر محذوف'),
        (@privateCourse,N'OTHER100',N'Other student subject',N'مقرر طالب آخر');
        INSERT dbo.course_sections(id,course_id,academic_term_id,section_number)
        SELECT id,id,NEWID(),N'1' FROM dbo.courses;
        INSERT dbo.student_current_enrollments(student_id,course_section_id,enrollment_status) VALUES
        (@student,@history,N'registered'),(@student,@ethics,N'registered'),
        (@student,@dropped,N'dropped'),(@other,@privateCourse,N'registered');
        """,new {student,other,history,ethics,dropped,privateCourse});
    var rows=(await db.QueryAsync(DbProc.Call("usp_Assistant_GetTextbookCourses",new {userId=student}))).ToList();
    Check(rows.Count==2,"Only own active enrollments");
    var context=new DefaultHttpContext();
    context.Items[CurrentUserMiddleware.ItemKey]=new CurrentUser {UserId=student,IsAuthenticated=true,Roles=["student"]};
    var controller=new AssistantController(factory,new NoHttp(),new ConfigurationBuilder().Build(),null!,new Sanadi.Infrastructure.Appointments.AppointmentChatService(),NullLogger<AssistantController>.Instance)
    {ControllerContext=new ControllerContext {HttpContext=context}};
    async Task<JsonNode> Turn(string question,Guid? conversation=null,string lang="en")
    {
        context.Response.Body=new MemoryStream();
        await controller.Stream(new(question,conversation,lang,null),default);
        context.Response.Body.Position=0;
        var events=(await new StreamReader(context.Response.Body,leaveOpen:true).ReadToEndAsync()).Split('\n').Where(l=>l.StartsWith("data:")).Select(l=>JsonNode.Parse(l[5..])!).ToList();
        Check(!events.Any(e=>(string?)e["type"]=="error"),"SSE error: "+string.Join(" ",events.Where(e=>(string?)e["type"]=="error")));
        Check(events.Any(e=>(string?)e["type"]=="token"),"Answer tokens sent");
        return events.Single(e=>(string?)e["type"]=="final")["response"]!;
    }
    var first=await Turn("Where can I find the textbook for CSBP301 — Artificial Intelligence course?");
    Check((string?)first["responseType"]=="clarification","Unknown code asks for a registered course");
    var answer=(string)first["answer"]!;
    Check(answer.Contains("HIST120")&&answer.Contains("ETHC201")&&!answer.Contains("DROP100")&&!answer.Contains("OTHER100"),"Clarification lists only student's active courses");
    var conversation=Guid.Parse((string)first["conversationId"]!);
    var selected=await Turn("HIST120",conversation);
    Check(((string)selected["answer"]!).Contains("HIST120 — UAE Society and History"),"Bare code resolves from persisted context");
    Check(((string)selected["answer"]!).Contains("No separate request is needed"),"Original proactive answer preserved");
    Check((bool)selected["verified"]!&&!(bool)selected["fallbackUsed"]!,"Textbook answer is verified without fallback");
    Check((string?)selected["agent"]=="library"&&selected["libraryResults"] is null&&selected["proposedActions"]!.AsArray().Count==0,"Library guidance without catalogue search or action proposal");
    var second=await Turn("ETHC201",conversation);
    Check(((string)second["answer"]!).Contains("ETHC201 — Professional Ethics"),"Next course code remains in textbook flow after first answer");
    var arabic=await Turn("أين أجد كتاب مقرر HIST120؟",null,"ar");
    Check(((string)arabic["answer"]!).Contains("مجتمع الإمارات وتاريخه"),"Arabic enrollment title used");
    await db.ExecuteAsync("UPDATE dbo.student_current_enrollments SET enrollment_status=N'withdrawn' WHERE student_id=@student AND course_section_id=@history",new {student,history});
    var withdrawn=await Turn("HIST120",conversation);
    Check((string?)withdrawn["responseType"]=="clarification"&&!((string)withdrawn["answer"]!).Contains("HIST120"),"Fresh enrollment prevents use of withdrawn course");
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.messages WHERE conversation_id=@conversation AND role=N'assistant' AND ISJSON(metadata)=1",new {conversation})==4,"Answers and textbook context saved in chat history");
    context.Items[CurrentUserMiddleware.ItemKey]=new CurrentUser {UserId=other,IsAuthenticated=true,Roles=["student"]};
    try { await controller.Ask(new("HIST120",conversation,"en",null),default); throw new Exception("Cross-user conversation accepted"); }
    catch(ForbiddenException) { }
    context.Items[CurrentUserMiddleware.ItemKey]=new CurrentUser {UserId=Guid.NewGuid(),IsAuthenticated=true,Roles=["student"]};
    var empty=await Turn("Where is the textbook for my course?");
    Check(((string)empty["answer"]!).Contains("don't see any courses registered"),"No enrollment does not invent course details");
    Console.WriteLine("PASS screenshot flow: unknown CSBP301 -> registered choices -> HIST120 -> ETHC201; SSE tokens/final response; proactive Blackboard guidance; Arabic; no catalogue/model calls; no new actions; saved context/history; refreshed enrollments; dropped/withdrawn exclusions; user isolation; empty enrollment; repeatable SQL.");
}
finally {SqlConnection.ClearAllPools(); await admin.ExecuteAsync($"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}]");}
static void Check(bool value,string message){if(!value)throw new Exception(message);}
sealed class NoHttp:IHttpClientFactory {public HttpClient CreateClient(string name)=>throw new Exception("Textbook guidance must not depend on AI or library catalogue calls");}
