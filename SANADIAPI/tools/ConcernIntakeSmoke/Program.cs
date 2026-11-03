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
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Sanadi.Api.Controllers;
using Sanadi.Api.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Options;
using Sanadi.Infrastructure.Persistence;

// Disposable LocalDB only. Synthetic model replies; never creates production cases.
var root=Path.GetFullPath(args[0]);
if(args.Contains("--live-read-only"))
{
    var config=new ConfigurationBuilder().AddJsonFile(Path.Combine(root,"Sanadi.Api/appsettings.json")).Build();
    await using var live=new SqlConnection(config["SqlServer:ConnectionString"]);
    var type=typeof(AssistantController).Assembly.GetType("Sanadi.Api.AI.ChatConcernPlanner")!;
    var diagnostics=new PlannerDiagnostics();
    var planner=Activator.CreateInstance(type,new RealHttp(),diagnostics)!;
    var assess=type.GetMethod("Assess",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)!;
    foreach(var sample in new[]{
        (Lang:"en",Text:"I have a problem",Type:"query",Vague:true),
        (Lang:"ar",Text:"أحتاج مساعدة",Type:"query",Vague:true),
        (Lang:"en",Text:"What is the deadline for overseas exchange applications?",Type:"query",Vague:false),
        (Lang:"ar",Text:"ما هو آخر موعد للتقديم على برامج التبادل الطلابي الخارجي؟",Type:"query",Vague:false),
        (Lang:"en",Text:"The buses are always late, and today I had to walk all the way back to my hostel",Type:"complaint",Vague:false),
        (Lang:"ar",Text:"الحافلات تتأخر دائما واضطررت اليوم إلى المشي إلى السكن بسبب تأخرها",Type:"complaint",Vague:false),
        (Lang:"en",Text:"I suggest more technology industry partnerships to provide student internships",Type:"suggestion",Vague:false),
        (Lang:"ar",Text:"أقترح زيادة الشراكات مع شركات التقنية لتوفير فرص تدريب للطلاب",Type:"suggestion",Vague:false),
        (Lang:"en",Text:"A ceiling panel is falling above students in Building B2 and someone could be injured",Type:"alert",Vague:false),
        (Lang:"ar",Text:"لوح من السقف يسقط فوق الطلاب في المبنى B2 وقد يصاب أحدهم",Type:"alert",Vague:false),
        (Lang:"en",Text:"What is the procedure for reporting a campus safety concern?",Type:"query",Vague:false),
        (Lang:"ar",Text:"ما هي إجراءات الإبلاغ عن مشكلة تتعلق بالسلامة في الحرم؟",Type:"query",Vague:false)})
    {
        var filter=args.FirstOrDefault(a=>a.StartsWith("--live-filter="))?["--live-filter=".Length..];
        if(filter is not null && filter!=sample.Lang+"/"+sample.Type)continue;
        diagnostics.Failure=null;
        var task=(Task)assess.Invoke(planner,[live,Guid.NewGuid(),sample.Text,sample.Lang,null,CancellationToken.None,null])!;await task;
        var decision=JsonSerializer.SerializeToNode(task.GetType().GetProperty("Result")!.GetValue(task))!;
        Console.WriteLine(JsonSerializer.Serialize(new {sample.Lang,sample.Type,detected=(string?)decision["Type"],needsClarification=(bool)decision["NeedsClarification"]!,canRoute=(bool)decision["CanRoute"]!,question=(string?)decision["Question"],error=diagnostics.Failure}));
        if(sample.Vague)Check((bool)decision["NeedsClarification"]!&&!(bool)decision["CanRoute"]!,"Vague live request must clarify");
        else Check((string?)decision["Type"]==sample.Type&&!(bool)decision["NeedsClarification"]!,"Clear live concern must preserve its actual type in either language");
    }
    Console.WriteLine("PASS selected read-only live-model EN/AR concern classifications; no business records created");
    return;
}
var name="SanadiConcernIntakeTest_"+Guid.NewGuid().ToString("N");
await using var admin=new SqlConnection(@"Server=(localdb)\MSSQLLocalDB;Database=master;Integrated Security=true;TrustServerCertificate=true");
await admin.OpenAsync();await admin.ExecuteAsync($"CREATE DATABASE [{name}]");
try
{
    var factory=new SqlConnectionFactory(Options.Create(new SqlOptions{ConnectionString=$@"Server=(localdb)\MSSQLLocalDB;Database={name};Integrated Security=true;TrustServerCertificate=true"}));
    await using var db=factory.Create();await db.OpenAsync();
    var schema=File.ReadAllText(Path.Combine(root,"sql/sanadi_schema.sql"));
    foreach(var table in new[]{"conversations","messages","agent_runs","emergency_contacts","service_units","case_categories","routing_rules","cases","suggestions","case_status_history","audit_logs","notification_events","user_roles","agent_tools","action_requests","agent_tool_executions","action_receipts","exception_events"})
    {
        var match=Regex.Match(schema,@"CREATE TABLE \[dbo\]\.\["+table+@"\][\s\S]*?^GO\s*$",RegexOptions.Multiline);
        await db.ExecuteAsync(Regex.Replace(match.Value,@"^GO\s*$","",RegexOptions.Multiline));
    }
    // Bring the disposable schema fixture up to the existing exception logging procedure's contract.
    await db.ExecuteAsync("ALTER TABLE dbo.exception_events ADD trace_id nvarchar(100) NULL,resolved_at datetimeoffset NULL,student_message nvarchar(max) NULL,is_test bit NOT NULL DEFAULT 0");
    var procs=File.ReadAllText(Path.Combine(root,"sql/2026-09-21-usp-api-direct-queries.sql"));
    foreach(Match match in Regex.Matches(procs,@"CREATE OR ALTER PROCEDURE dbo\.usp_(?:Assistant_\w+|Interactions_GetUnitRow|Interactions_InsertCase|Interactions_InsertSuggestion|Exceptions_Insert)\b[\s\S]*?^GO\s*$",RegexOptions.Multiline))
        await db.ExecuteAsync(Regex.Replace(match.Value,@"^GO\s*$","",RegexOptions.Multiline));
    foreach(var file in new[]{"VS_2026-09-29-chat-incident-routing.sql","VS_2026-09-29-live-complaint-routing.sql","VS_2026-09-29-chat-complaint-proposals.sql","VS_2026-09-29-chat-suggestion-proposals.sql","VS_2026-09-29-chat-concern-intake.sql","_notify_push_inapp.sql"})
        foreach(var batch in Regex.Split(File.ReadAllText(Path.Combine(root,"sql",file)),@"^GO\s*$",RegexOptions.Multiline))
            if(!string.IsNullOrWhiteSpace(batch))await db.ExecuteAsync(batch);
    await db.ExecuteAsync("""
        CREATE OR ALTER PROCEDURE dbo.usp_Assistant_GetAiSettings AS
        SELECT CAST(1 AS bit) ai_enabled,N'ollama' provider,N'test-model' model_name,
          N'test-key' api_key,N'https://model.example.test' api_url,CAST(0 AS bit) enable_thinking, CAST(0 AS decimal(9,4)) temperature, 1000 max_output_tokens;
        """);
    await db.ExecuteAsync("""
        CREATE PROCEDURE dbo.usp_Tickets_GetAssignment @unit uniqueidentifier,@requester uniqueidentifier,
          @sensitive bit=0,@preferredOwner uniqueidentifier=NULL AS
        SELECT id UnitId,name_en En,name_ar Ar,primary_service_owner_id Owner,N'fixture' Method
          FROM dbo.service_units WHERE id=@unit AND is_active=1;
        """);
    await db.ExecuteAsync("CREATE TABLE dbo.search_calls(id int IDENTITY(1,1),terms nvarchar(max))");
    await db.ExecuteAsync("""
        CREATE OR ALTER PROCEDURE dbo.usp_Assistant_RetrieveEvidence @terms nvarchar(max), @lang nvarchar(10), @overview bit=0 AS
        BEGIN
          INSERT dbo.search_calls(terms) VALUES(@terms);
          SELECT NEWID() DocumentId,N'Published exchange dates' Title,N'Mobility team' Unit,
            CAST(NULL AS nvarchar(20)) Version,CAST(NULL AS datetime) EffectiveDate,
            CAST(NULL AS nvarchar(100)) Url,N'Published exchange applications open in October.' Content,
            CAST(1 AS decimal(9,4)) Score,N'service' SourceType
          WHERE @terms LIKE N'%published%' OR @terms LIKE N'%conflicting%';
        END
        """);
    var student=Guid.NewGuid();var facilities=Guid.NewGuid();var mobility=Guid.NewGuid();var careers=Guid.NewGuid();
    await db.ExecuteAsync("""
        INSERT dbo.service_units(id,code,name_en,name_ar,description_en) VALUES
        (@facilities,N'FAC',N'Configured Facilities Team',N'المرافق',N'Campus building maintenance'),
        (@mobility,N'MOB',N'Configured Mobility Team',N'التبادل',N'Overseas exchange programmes'),
        (@careers,N'CAR',N'Configured Career Team',N'التوظيف',N'Career partnerships and internships');
        """,new{facilities,mobility,careers});
    var model=new Model(facilities,mobility,careers);var context=new DefaultHttpContext();
    context.Items[CurrentUserMiddleware.ItemKey]=new CurrentUser{UserId=student,IsAuthenticated=true,Roles=["student"]};
    var assistant=new AssistantController(factory,model,new ConfigurationBuilder().Build(),null!,new Sanadi.Infrastructure.Appointments.AppointmentChatService(),new FixtureLogger())
    {ControllerContext=new ControllerContext{HttpContext=context}};
    async Task<JsonNode> Turn(string text,Guid? conversation=null,string lang="en")
    {
        context.Response.Body=new MemoryStream();await assistant.Stream(new(text,conversation,lang,null),default);context.Response.Body.Position=0;
        var events=(await new StreamReader(context.Response.Body,leaveOpen:true).ReadToEndAsync()).Split('\n').Where(l=>l.StartsWith("data:")).Select(l=>JsonNode.Parse(l[5..])!).ToArray();
        Check(!events.Any(e=>(string?)e["type"]=="error"),"Chat error: "+string.Join(" ",events.Where(e=>(string?)e["type"]=="error")));
        return events.Single(e=>(string?)e["type"]=="final")["response"]!;
    }
    async Task<VoiceAssistantController.VoiceTurnResult> VoiceTurn(string text,string lang)
    {
        context.Response.Body=new MemoryStream();context.Response.ContentType=null;
        var voice=new VoiceAssistantController(assistant,NullLogger<VoiceAssistantController>.Instance)
            {ControllerContext=new ControllerContext{HttpContext=context}};
        var result=await voice.Ask(new(text,null,lang),default);
        return (VoiceAssistantController.VoiceTurnResult)((JsonResult)result).Value!;
    }
    async Task<JsonObject> CallSignOff(string text,string lang,Guid? conversation=null)
    {
        var run=typeof(AssistantController).GetMethod("RunTurn",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)!;
        return await (Task<JsonObject>)run.Invoke(assistant,[new AssistantController.AskRequest(text,conversation,lang,null),student,CancellationToken.None,null,null,true])!;
    }
    Guid Conversation(JsonNode r)=>Guid.Parse((string)r["conversationId"]!);
    AssistantController.ActionRequest Request(JsonNode turn)
    {
        var a=turn["proposedActions"]![0]!;
        return new((string)a["toolName"]!,a["args"]!.DeepClone().AsObject(),Conversation(turn),"en",Guid.Parse((string)turn["messageId"]!),(string)a["key"]!);
    }
    var vague=await Turn("I have a problem");var conversation=Conversation(vague);
    Check((string?)vague["responseType"]=="clarification"&&vague["proposedActions"]!.AsArray().Count==0,"Vague query asks a question without a guessed route");
    Check(vague["classification"]?["requiredUnitName"] is null,"No department guessed");
    var bare=await Turn("yes",conversation);Check((string?)bare["responseType"]=="clarification","Bare yes does not supply missing facts");
    var detail=await Turn("The building",conversation);Check(((string)detail["clarifyingQuestion"]!).Contains("happened"),"Targeted follow-up continues until clear");
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.search_calls")==0,"No source search before intent is understood");
    var complaint=await Turn("The computer lab ventilation stopped yesterday",conversation);
    Check((string?)complaint["classification"]?["intent"]=="complaint","AI chooses complaint from clarified failure");
    var proposal=complaint["proposedActions"]![0]!;
    Check((string?)proposal["args"]?["title"]=="Computer lab ventilation failure","Clear AI title is proposed");
    Check((string?)proposal["responsibleUnit"]=="Configured Facilities Team","Recipient comes from active catalogue");
    Check(((string)proposal["args"]!["description"]!).Contains("The building"),"Details are retained across clarification turns");
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.cases")==0,"No write before popup approval");
    var typedYes=await Turn("yes",conversation);Check(typedYes["proposedActions"]!.AsArray().Count==0&&((string)typedYes["answer"]!).Contains("popup"),"Typed yes refers to existing popup, never executes");
    var arabicYes=await Turn("نعم",conversation,"ar");
    Check(((string)arabicYes["answer"]!).Contains("راجع نافذة الموافقة") && arabicYes["proposedActions"]!.AsArray().Count==0,
        "Arabic confirmation preserves the original approval message without executing");
    var approved=JsonSerializer.SerializeToNode(((JsonResult)await assistant.Execute(Request(complaint),default)).Value)!;
    Check(approved["receipt"] is not null,"Approved complaint has a receipt");
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.cases WHERE case_type=N'complaint' AND service_unit_id=@facilities AND title=N'Computer lab ventilation failure'",new{facilities})==1,"Confirmed title, type and recipient persisted by existing case workflow");
    await assistant.Execute(Request(complaint),default);
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.cases")==1,"Duplicate approval suppressed");
    Console.WriteLine("PASS multiple clarifications, no premature search/route, grounded AI title/type/unit, existing confirmation and complaint persistence");

    var question=await Turn("What is the application deadline for overseas exchange?");
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.search_calls")==1,"Clear query searches first");
    Check((string?)question["proposedActions"]?[0]?["toolName"]=="create_enquiry","No answer offers Enquiry, not an invented answer or complaint");
    Check(((string)question["answer"]!).Contains("Enquiry, Complaint, Alert or Suggestion"),"Missing-source response offers all four concern types");
    Check((bool?)question["verified"]==false&&(bool?)question["fallbackUsed"]==true,"Missing facts are explicitly unverified fallback");
    var request=Request(question);request.Args!["title"]="tampered";request.Args["unitId"]=facilities.ToString();
    await assistant.Execute(request,default);
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.cases WHERE case_type=N'query' AND service_unit_id=@mobility AND title=N'Exchange application dates'",new{mobility})==1,"Enquiry uses stored approved fields and existing form persistence");
    var conflicting=await Turn("What are the conflicting exchange application dates?");
    Check((string?)conflicting["proposedActions"]?[0]?["toolName"]=="create_enquiry","Unrelated/conflicting retrieved evidence does not become an answer");
    var known=await Turn("What are the published exchange application dates?");
    Check(known["proposedActions"]!.AsArray().Count==0&&((string)known["answer"]!).Contains("October"),"Supported source still answers normally without a ticket");
    Console.WriteLine("PASS search before fallback, source coverage, supported answers, Enquiry approval and tamper resistance");

    var pending=await Turn("When can I apply?");
    var changed=await Turn("Instead, I suggest more industry partnerships",Conversation(pending));
    Check((string?)changed["proposedActions"]?[0]?["toolName"]=="create_suggestion","AI can identify a new suggestion topic");
    Check(!((string)changed["proposedActions"]![0]!["args"]!["description"]!).Contains("When can I apply"),"Unrelated previous topic is not attached to the concern");
    await assistant.Execute(Request(changed),default);
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.suggestions WHERE service_unit_id=@careers",new{careers})==1,"Suggestion uses existing suggestion workflow");
    var uncertain=await Turn("I have an uncertain complaint about a service");
    Check(uncertain["proposedActions"]!.AsArray().Count==0&&uncertain["classification"]?["requiredUnitName"] is null,"Low recipient confidence forces clarification");
    var cancel=await Turn("cancel",Conversation(uncertain));Check(cancel["concernContext"] is null,"Cancel clears pending context");
    var malformed=await Turn("I have a malformed complaint");Check((string?)malformed["responseType"]=="clarification"&&malformed["proposedActions"]!.AsArray().Count==0,"Malformed model output cannot create an action");
    var arabicCancel=await Turn("إلغاء",Conversation(malformed),"ar");
    Check((string?)arabicCancel["answer"]=="تم إلغاء المسودة. لم يتم تقديم أي طلب." && arabicCancel["concernContext"] is null,
        "Arabic cancellation preserves its original wording and clears context");
    context.Items[CurrentUserMiddleware.ItemKey]=new CurrentUser{UserId=Guid.NewGuid(),IsAuthenticated=true,Roles=["student"]};
    try{await assistant.Execute(Request(question),default);throw new Exception("Other user's proposal accepted");}catch(ForbiddenException){}
    try{await assistant.Ask(new("yes",Conversation(question),"en",null),default);throw new Exception("Other user's clarification accepted");}catch(ForbiddenException){}
    context.Items[CurrentUserMiddleware.ItemKey]=new CurrentUser{UserId=student,IsAuthenticated=true,Roles=["student"]};
    Console.WriteLine("PASS topic changes, suggestion persistence, uncertain routing, malformed AI, cancellation and ownership");

    var caseCount=await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.cases");
    var suggestionCount=await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.suggestions");
    foreach(var sample in new[] {
        (Lang:"en",Text:"What is the application deadline for overseas exchange?",Tool:"create_enquiry",Type:"query"),
        (Lang:"ar",Text:"ما هو آخر موعد للتقديم على التبادل الخارجي؟",Tool:"create_enquiry",Type:"query"),
        (Lang:"en",Text:"The computer lab ventilation stopped yesterday",Tool:"create_complaint",Type:"complaint"),
        (Lang:"ar",Text:"توقفت التهوية في مختبر الحاسوب أمس",Tool:"create_complaint",Type:"complaint"),
        (Lang:"en",Text:"I suggest more industry partnerships",Tool:"create_suggestion",Type:"suggestion"),
        (Lang:"ar",Text:"أقترح زيادة الشراكات الصناعية",Tool:"create_suggestion",Type:"suggestion"),
        (Lang:"en",Text:"The ceiling panel is coming loose above students in Building B2",Tool:"report_alert",Type:"alert"),
        (Lang:"ar",Text:"لوح السقف فوق الطلاب يكاد يسقط في المبنى B2 ويحتاج إلى تدخل",Tool:"report_alert",Type:"alert")})
    {
        Console.WriteLine($"CHECK {sample.Lang}/{sample.Type} text/voice proposal parity");
        var typed=await Turn(sample.Text,null,sample.Lang);
        var spoken=await VoiceTurn(sample.Text,sample.Lang);
        foreach(var field in new[]{"answer","classification","proposedActions","responseType","verified","fallbackUsed"})
            Check(JsonNode.DeepEquals(typed[field],spoken.Response[field]),$"{sample.Lang}/{sample.Type}: text and voice have identical {field}");
        Check((string?)typed["proposedActions"]?[0]?["toolName"]==sample.Tool,$"{sample.Lang}: {sample.Type} preselects the correct existing submission action");
        Check((string?)typed["classification"]?["intent"]==sample.Type,$"{sample.Lang}: detected concern type is retained");
        Check(!string.IsNullOrWhiteSpace(spoken.Speech),$"{sample.Lang}: the offer is available in speech");
        Check(typed["receipt"] is null,"A proposal never claims a submission receipt");
    }
    foreach(var sample in new[]{(Lang:"en",Text:"What is the exchange recipient policy?"),(Lang:"ar",Text:"ما هي سياسة جهة التبادل؟")})
    {
        var typed=await Turn(sample.Text,null,sample.Lang);var spoken=await VoiceTurn(sample.Text,sample.Lang);
        Check(typed["proposedActions"]!.AsArray().Count==0&&typed["classification"]?["requiredUnitName"] is null,"No invented recipient when the catalogue cannot identify a team");
        Check((bool?)typed["fallbackUsed"]==true&&(bool?)typed["verified"]==false,"Unroutable missing answer is not represented as verified");
        Check(((string)typed["answer"]!).Contains(sample.Lang=="ar"?"استفسار أو شكوى أو تنبيه أو اقتراح":"Enquiry, Complaint, Alert or Suggestion"),"Missing answer still offers concern submission while asking for routing details");
        Check((string?)typed["answer"]==(string?)spoken.Response["answer"],"Unknown recipient fallback is identical in voice");
    }
    var knownVoice=await VoiceTurn("What are the published exchange application dates?","en");
    Check((string?)known["answer"]==(string?)knownVoice.Response["answer"]&&knownVoice.Response["proposedActions"]!.AsArray().Count==0,"Verified answers stay unchanged in text and voice");
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.cases")==caseCount&&await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.suggestions")==suggestionCount,"No EN/AR text or voice offer creates records before approval");
    Console.WriteLine("PASS all four types in EN/AR text and voice, unknown recipients, honest fallback and verified-answer regression");

    var alertProposal=await Turn("The ceiling panel is coming loose above students in Building B2");
    var alertSubmission=JsonSerializer.SerializeToNode(((JsonResult)await assistant.Execute(Request(alertProposal),default)).Value)!;
    Check(alertSubmission["receipt"] is null&&await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.action_requests WHERE student_id=@student AND action_type=N'report_alert' AND human_approval_required=1 AND execution_status=N'awaiting_approval'",new{student})==1,"Confirmed alert retains the existing staff approval requirement");
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.cases")==caseCount,"Alert proposal cannot bypass staff approval to execute");
    Console.WriteLine("PASS alert submission enters the existing approval workflow");

    foreach(var sample in new[]{(Text:"Thank you",Lang:"en"),(Text:"شكراً",Lang:"ar"),(Text:"Shukran",Lang:"ar")})
    {
        var before=model.Calls;
        var bye=await CallSignOff(sample.Text,sample.Lang,Conversation(question));
        Check((string?)bye["answer"]==(sample.Lang=="ar"?"العفو، حياك الله! يسعدني أساعدك. مع السلامة.":"You're welcome! Happy to help. Goodbye!"),"Voice sign-off uses selected-language farewell even with pending concern");
        Check(bye["proposedActions"]!.AsArray().Count==0&&bye["receipt"] is null&&model.Calls==before,"Farewell cannot approve a pending action or invoke the model");
        var saved=await db.ExecuteScalarAsync<string>("SELECT content FROM dbo.messages WHERE id=@id",new{id=Guid.Parse((string)bye["messageId"]!)});
        Check(saved==(string?)bye["answer"],"Farewell is persisted in the owned conversation");
    }
    var mixed=await CallSignOff("Thanks, what are the published exchange application dates?","en");
    Check(((string)mixed["answer"]!).Contains("October"),"Thanks plus a real question follows the normal answer pipeline");
    var otherUser=Guid.NewGuid();
    context.Items[CurrentUserMiddleware.ItemKey]=new CurrentUser{UserId=otherUser,IsAuthenticated=true,Roles=["student"]};
    var foreign=await db.ExecuteScalarAsync<Guid>("SELECT TOP 1 id FROM dbo.conversations WHERE user_id=@student",new{student});
    // Use the caller's actual user ID to exercise the same ownership check as the voice controller.
    var run=typeof(AssistantController).GetMethod("RunTurn",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)!;
    try {
        await (Task<JsonObject>)run.Invoke(assistant,[new AssistantController.AskRequest("Thank you",foreign,"en",null),otherUser,CancellationToken.None,null,null,true])!;
        throw new Exception("Farewell accepted another user's conversation");
    } catch(ForbiddenException) { }
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.cases")==caseCount,"Farewells never submit a pending concern");
    Console.WriteLine("PASS deterministic call farewells, selected language, persistence, mixed-request continuation and ownership");
}
finally{SqlConnection.ClearAllPools();await admin.ExecuteAsync($"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}]");}
static void Check(bool value,string reason){if(!value)throw new Exception(reason);}
sealed class RealHttp:IHttpClientFactory { public HttpClient CreateClient(string name)=>new(); }
sealed class PlannerDiagnostics:ILogger
{
    public string? Failure;
    public IDisposable? BeginScope<TState>(TState state) where TState:notnull=>null;
    public bool IsEnabled(LogLevel level)=>level>=LogLevel.Error;
    public void Log<TState>(LogLevel level,EventId id,TState state,Exception? error,Func<TState,Exception?,string> formatter)
    {if(error is not null)Failure=error is JsonException?error.Message:error.GetType().Name;}
}
sealed class FixtureLogger:ILogger<AssistantController>
{
    public IDisposable? BeginScope<TState>(TState state) where TState:notnull=>null;
    public bool IsEnabled(LogLevel level)=>level>=LogLevel.Error;
    public void Log<TState>(LogLevel level,EventId id,TState state,Exception? error,Func<TState,Exception?,string> formatter)
    {if(error is not null)Console.Error.WriteLine(error);}
}
sealed class Model(Guid facilities,Guid mobility,Guid careers):HttpMessageHandler,IHttpClientFactory
{
    public int Calls { get; private set; }
    public HttpClient CreateClient(string name)=>new(this,false);
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
    {
        Calls++;
        if(request.Headers.Authorization?.Parameter!="test-key")throw new Exception("Missing configured model authentication");
        using var body=JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct));
        var prompt=body.RootElement.GetProperty("messages")[0].GetProperty("content").GetString()!;
        string answer;
        if(prompt.StartsWith("Classify the data subject"))
            answer=JsonSerializer.Serialize(new {scope="not_private_data",directTool=(string?)null,greetingOnly=false,intentConfidence=.99});
        else if(prompt.StartsWith("You classify the requested OUTCOME")||prompt.StartsWith("Resolve a disagreement"))
        {
            // This fixture exercises the shared knowledge/intake fallback, not unrelated specialist handlers.
            var text=JsonSerializer.Deserialize<string>(prompt.Split("\nMESSAGE: ")[1].Split('\n')[0])!;
            answer=JsonSerializer.Serialize(new {routingIntents=new[]{"knowledge"},intentConfidence=.99,continueWorkflow=!text.StartsWith("Instead")});
        }
        else if(prompt.Contains("Sanadi's intake planner"))
        {
            var text=JsonSerializer.Deserialize<string>(prompt.Split("\nSTUDENT: ")[1])!;
            var prev=JsonNode.Parse(prompt.Split("\nPREVIOUS: ")[1].Split("\nSTUDENT: ")[0]);
            var prior=(string?)prev?["Description"]??"";var continuing=prev is not null&&!text.StartsWith("Instead");
            var details=continuing?prior+"\n"+text:text;
            var suggestion=details.Contains("industry partnerships")||details.Contains("الشراكات الصناعية");var complaint=details.Contains("ventilation")||details.Contains("التهوية");
            var alert=details.Contains("ceiling panel")||details.Contains("لوح السقف");
            var unknownUnit=details.Contains("recipient policy")||details.Contains("سياسة جهة");
            var query=details.Contains("exchange")||details.Contains("التبادل");var ready=suggestion||complaint||query||alert;
            var uncertain=details.Contains("uncertain");
            var type=alert?"alert":suggestion?"suggestion":complaint||uncertain?"complaint":"query";
            var question=details.Contains("The building")?"What happened in the building?":"Which service or programme do you mean?";
            answer=details.Contains("malformed")?"invalid JSON":JsonSerializer.Serialize(new {
                needsClarification=!ready,question=ready?"":question,type,
                title=alert?"Loose ceiling panel":suggestion?"Industry partnership proposal":complaint?"Computer lab ventilation failure":"Exchange application dates",
                searchQuery=complaint?"The computer lab ventilation stopped yesterday":suggestion?"The university should build industry partnerships":text,
                unitId=unknownUnit?"not-a-catalogue-id":ready?(suggestion?careers:complaint||alert?facilities:mobility).ToString():null,
                confidence=ready?.95:.4,routingConfidence=ready?.95:.2,usePrevious=continuing});
        }
        else if(prompt.Contains("Check whether these retrieved"))
            answer=JsonSerializer.Serialize(new {supported=!prompt.Contains("conflicting")});
        else answer="Published exchange applications open in October.";
        return new(HttpStatusCode.OK){Content=new StringContent(JsonSerializer.Serialize(new {choices=new[]{new {message=new {content=answer}}}}),Encoding.UTF8,"application/json")};
    }
}
