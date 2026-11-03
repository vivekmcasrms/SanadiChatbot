using System.Net;
using System.Text;
using System.Text.Json;
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

// Disposable LocalDB only. Synthetic model replies; never creates production cases.
var root=Path.GetFullPath(args.Single());
var name="SanadiSuggestionChatTest_"+Guid.NewGuid().ToString("N");
await using var admin=new SqlConnection(@"Server=(localdb)\MSSQLLocalDB;Database=master;Integrated Security=true;TrustServerCertificate=true");
await admin.OpenAsync();await admin.ExecuteAsync($"CREATE DATABASE [{name}]");
try
{
    var factory=new SqlConnectionFactory(Options.Create(new SqlOptions{ConnectionString=$@"Server=(localdb)\MSSQLLocalDB;Database={name};Integrated Security=true;TrustServerCertificate=true"}));
    await using var db=factory.Create();await db.OpenAsync();
    var schema=File.ReadAllText(Path.Combine(root,"sql/sanadi_schema.sql"));
    foreach(var table in new[]{"conversations","messages","agent_runs","emergency_contacts","service_units","case_categories","routing_rules","cases","suggestions","case_status_history","audit_logs","notification_events","user_roles","agent_tools","action_requests","agent_tool_executions","action_receipts"})
    {
        var match=Regex.Match(schema,@"CREATE TABLE \[dbo\]\.\["+table+@"\][\s\S]*?^GO\s*$",RegexOptions.Multiline);
        await db.ExecuteAsync(Regex.Replace(match.Value,@"^GO\s*$","",RegexOptions.Multiline));
    }
    var procs=File.ReadAllText(Path.Combine(root,"sql/2026-09-21-usp-api-direct-queries.sql"));
    foreach(Match match in Regex.Matches(procs,@"CREATE OR ALTER PROCEDURE dbo\.usp_(?:Assistant_\w+|Interactions_GetUnitRow|Interactions_InsertCase|Interactions_InsertSuggestion)\b[\s\S]*?^GO\s*$",RegexOptions.Multiline))
        await db.ExecuteAsync(Regex.Replace(match.Value,@"^GO\s*$","",RegexOptions.Multiline));
    foreach(var file in new[]{"VS_2026-09-29-chat-incident-routing.sql","VS_2026-09-29-live-complaint-routing.sql","VS_2026-09-29-chat-complaint-proposals.sql","VS_2026-09-29-chat-suggestion-proposals.sql","_notify_push_inapp.sql"})
        foreach(var batch in Regex.Split(File.ReadAllText(Path.Combine(root,"sql",file)),@"^GO\s*$",RegexOptions.Multiline))
            if(!string.IsNullOrWhiteSpace(batch))await db.ExecuteAsync(batch);
    await db.ExecuteAsync("""
        CREATE OR ALTER PROCEDURE dbo.usp_Assistant_GetAiSettings AS
        SELECT CAST(1 AS bit) ai_enabled,N'ollama' provider,N'test-model' model_name,
          N'test-key' api_key,N'https://model.example.test' api_url,CAST(0 AS bit) enable_thinking;
        """);
    var student=Guid.NewGuid();var unit=Guid.NewGuid();var owner=Guid.NewGuid();
    // Synthetic assignment boundary required by the existing ticket workflow.
    await db.ExecuteAsync("""
        CREATE PROCEDURE dbo.usp_Tickets_GetAssignment @unit uniqueidentifier,@requester uniqueidentifier,
          @sensitive bit=0,@preferredOwner uniqueidentifier=NULL AS
        SELECT id UnitId,name_en En,name_ar Ar,primary_service_owner_id Owner,N'fixture' Method
          FROM dbo.service_units WHERE id=@unit AND is_active=1;
        """);
    await db.ExecuteAsync("INSERT dbo.service_units(id,code,name_en,name_ar,description_en,primary_service_owner_id) VALUES(@unit,N'configured-careers',N'Configured Career Services',N'خدمات النقل',N'Careers, internships and industry partnerships',@owner)",new{unit,owner});
    var model=new Model(unit);var context=new DefaultHttpContext();
    context.Items[CurrentUserMiddleware.ItemKey]=new CurrentUser{UserId=student,IsAuthenticated=true,Roles=["student"]};
    var assistant=new AssistantController(factory,model,new ConfigurationBuilder().Build(),null!,new Sanadi.Infrastructure.Appointments.AppointmentChatService(),NullLogger<AssistantController>.Instance)
    {ControllerContext=new ControllerContext{HttpContext=context}};
    const string report="I think the university should work with more technology companies to give students better internship opportunities and placements.";
    async Task<JsonNode> Turn()
    {
        context.Response.Body=new MemoryStream();await assistant.Stream(new(report,null,"en",null),default);context.Response.Body.Position=0;
        var events=(await new StreamReader(context.Response.Body,leaveOpen:true).ReadToEndAsync()).Split('\n').Where(l=>l.StartsWith("data:")).Select(l=>JsonNode.Parse(l[5..])!).ToArray();
        Check(!events.Any(e=>(string?)e["type"]=="error"),"Chat error: "+string.Join(" ",events.Where(e=>(string?)e["type"]=="error")));
        Check(events.Any(e=>(string?)e["type"]=="stage"&&(string?)e["stage"]=="suggestion"),"Suggestion agent displayed");
        return events.Single(e=>(string?)e["type"]=="final")["response"]!;
    }
    AssistantController.ActionRequest Request(JsonNode turn)=>new("create_suggestion",turn["proposedActions"]![0]!["args"]!.DeepClone().AsObject(),Guid.Parse((string)turn["conversationId"]!),"en",Guid.Parse((string)turn["messageId"]!),"create_suggestion");
    var reply=await Turn();var action=reply["proposedActions"]![0]!;var request=Request(reply);
    Check((string?)reply["agent"]=="suggestion"&&!(bool)reply["fallbackUsed"]!,"Suggestion bypasses knowledge fallback");
    Check(((string)reply["answer"]!).Contains("Suggestion"),"Submission summary present");
    Check((string?)action["labelEn"]=="Submit this suggestion"&&(string?)action["responsibleUnit"]=="Configured Career Services","Popup button and configured recipient");
    foreach(var field in new[]{"dataShared","expectedOutcome","consequence","fee","risk","reversible"})Check(!string.IsNullOrWhiteSpace((string?)action[field]),"Popup field "+field);
    Check((string?)action["risk"]=="level_1"&&(string?)action["reversible"]=="no","Student confirmation required");
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.suggestions")==0,"No case until Approve (Cancel does not call actions)");
    var saved=JsonNode.Parse((await db.ExecuteScalarAsync<string>("SELECT metadata FROM dbo.messages WHERE id=@id",new{id=request.MessageId}))!)!;
    Check(JsonNode.DeepEquals(action,saved["proposedActions"]![0]),"Popup survives history reload");
    request.Args!["description"]="tampered report";request.Args["unitId"]=Guid.NewGuid().ToString();
    var result=JsonSerializer.SerializeToNode(((JsonResult)await assistant.Execute(request,default)).Value)!;
    Check(result["receipt"] is not null,"Approve returns receipt");
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.suggestions WHERE student_id=@student AND service_unit_id=@unit AND description=@report AND entry_channel=N'chat' AND related_conversation_id=@conversation AND status=N'submitted'",new{student,unit,report,conversation=request.ConversationId})==1,"Approved suggestion uses stored text, configured unit and chat association");
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.cases")==0,"Suggestion must never create a case");
    await assistant.Execute(request,default);
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.suggestions")==1,"Repeat approval does not duplicate");
    context.Items[CurrentUserMiddleware.ItemKey]=new CurrentUser{UserId=Guid.NewGuid(),IsAuthenticated=true,Roles=["student"]};
    try{await assistant.Execute(request,default);throw new Exception("Other user's proposal accepted");}catch(ForbiddenException){}
    context.Items[CurrentUserMiddleware.ItemKey]=new CurrentUser{UserId=student,IsAuthenticated=true,Roles=["student"]};
    Console.WriteLine("PASS exact internship suggestion: stream, acknowledgement, popup contract, no pre-approval writes, history, routed suggestion, receipt, duplicate protection, tamper resistance and user isolation");
    await db.ExecuteAsync("INSERT dbo.agent_tools(tool_name,agent_type,description,risk_level,confirmation_required,human_approval_required,allowed_roles,enabled) VALUES(N'create_suggestion',N'suggestion',N'Test',N'level_2',1,0,N'[\"student\"]',0)");
    Check((await Turn())["proposedActions"]!.AsArray().Count==0,"Disabled tool not offered");
    await db.ExecuteAsync("UPDATE dbo.agent_tools SET enabled=1,human_approval_required=1");
    var gated=await Turn();Check((bool)gated["proposedActions"]![0]!["humanApprovalRequired"]!,"Staff approval displayed");
    await assistant.Execute(Request(gated),default);
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.suggestions")==1,"Staff approval does not immediately execute");
    await db.ExecuteAsync("UPDATE dbo.agent_tools SET human_approval_required=0");
    var changed=await Turn();await db.ExecuteAsync("UPDATE dbo.service_units SET is_active=0 WHERE id=@unit",new{unit});model.Unit=null;
    try{await assistant.Execute(Request(changed),default);throw new Exception("Changed destination accepted");}catch(SanadiException ex)when(ex.Message.Contains("could not be reconfirmed")){}
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.suggestions")==1,"Changed route requires fresh approval");
    Console.WriteLine("PASS disabled tool, staff approval and changed-destination safeguards");
    // The original form retains its shortcut channel and existing behavior.
    await db.ExecuteAsync("UPDATE dbo.service_units SET is_active=1 WHERE id=@unit",new{unit});model.Unit=unit;
    var form=new InteractionsController(factory,model,NullLogger<InteractionsController>.Instance){ControllerContext=new ControllerContext{HttpContext=context}};
    await form.Submit(new("Internship suggestion",report,"suggestion",null,null,null,null,null,null,null,false,null,null,"en"));
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.suggestions WHERE entry_channel=N'shortcut'")==1,"Existing form unchanged");
    Console.WriteLine("PASS existing suggestion form submission");

}
finally{SqlConnection.ClearAllPools();await admin.ExecuteAsync($"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}]");}
static void Check(bool condition,string message){if(!condition)throw new Exception(message);}
sealed class Model(Guid? unit):HttpMessageHandler,IHttpClientFactory
{
    public Guid? Unit=unit;
    public HttpClient CreateClient(string name)=>new(this,false);
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
    {
        CheckAuth(request);
        var content=JsonSerializer.Serialize(new{choices=new[]{new{message=new{content=JsonSerializer.Serialize(new{unitId=Unit,confidence=.95,routingConfidence=.95,needsClarification=false,question="",type="suggestion",title="Technology industry partnerships",searchQuery="The university should build more industry partnerships",usePrevious=false})}}}});
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(content,Encoding.UTF8,"application/json")});
    }
    static void CheckAuth(HttpRequestMessage request){if(request.Headers.Authorization?.Scheme!="Bearer"||request.Headers.Authorization.Parameter!="test-key")throw new Exception("Ollama Bearer authentication missing");}
}
