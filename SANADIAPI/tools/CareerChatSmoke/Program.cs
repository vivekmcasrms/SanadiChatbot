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
using Sanadi.Infrastructure.Options;
using Sanadi.Infrastructure.Persistence;

var root=Path.GetFullPath(args[0]);
var json=new JsonSerializerOptions(JsonSerializerDefaults.Web);
if(args.Contains("--live-read-only"))
{
    // Career State and Counselling are read-only. Do not create chats or persist analyses in production.
    var config=new ConfigurationBuilder().AddJsonFile(Path.Combine(root,"Sanadi.Api/appsettings.json")).Build();
    var factory=new SqlConnectionFactory(Options.Create(new SqlOptions{ConnectionString=config["SqlServer:ConnectionString"]!}));
    await using var db=factory.Create();
    var student=await db.ExecuteScalarAsync<Guid>("SELECT student_id FROM dbo.cases WHERE case_number=N'REQ-20260929-5663'");
    var context=Context(student);
    var career=new CareerController(factory,null!) { ControllerContext=new ControllerContext{HttpContext=context} };
    var state=JsonSerializer.SerializeToNode(await career.State(default),json)!;
    var counselling=JsonSerializer.SerializeToNode(await career.Counselling(default),json);
    var adapter=typeof(AssistantController).Assembly.GetType("Sanadi.Api.AI.CareerChatFlow")!;
    var reply=adapter.GetMethod("Build",System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.NonPublic)!.Invoke(null,[state["analysis"]!.AsObject(),counselling,"matches","en"])!;
    var card=JsonSerializer.SerializeToNode(reply,json)!;
    Console.WriteLine("PASS read-only configured career engine and chat adapter: "+card["answer"]!.GetValue<string>());
    Console.WriteLine("Career snapshot: "+card["card"]!.ToJsonString());
    return;
}
var name="SanadiCareerChatTest_"+Guid.NewGuid().ToString("N");
await using var admin=new SqlConnection(@"Server=(localdb)\MSSQLLocalDB;Database=master;Integrated Security=true;TrustServerCertificate=true");
await admin.OpenAsync(); await admin.ExecuteAsync($"CREATE DATABASE [{name}]");
try
{
    var factory=new SqlConnectionFactory(Options.Create(new SqlOptions{ConnectionString=$@"Server=(localdb)\MSSQLLocalDB;Database={name};Integrated Security=true;TrustServerCertificate=true"}));
    await using var db=factory.Create(); await db.OpenAsync();
    var schema=File.ReadAllText(Path.Combine(root,"sql/sanadi_schema.sql"));
    foreach(var table in new[]{"conversations","messages","agent_runs","emergency_contacts","student_profiles","academic_programs","courses","student_course_history","student_cv_documents","student_career_profiles","career_roles","career_role_matches","career_analysis_versions","career_counselling_events","internship_assignments","internship_opportunities","cases"})
    {
        var match=Regex.Match(schema,@"CREATE TABLE \[dbo\]\.\["+table+@"\][\s\S]*?^GO\s*$",RegexOptions.Multiline);
        Check(match.Success,"Missing table "+table);
        await db.ExecuteAsync(Regex.Replace(match.Value,@"^GO\s*$","",RegexOptions.Multiline));
    }
    var procs=File.ReadAllText(Path.Combine(root,"sql/2026-09-21-usp-api-direct-queries.sql"));
    foreach(Match match in Regex.Matches(procs,@"CREATE OR ALTER PROCEDURE dbo\.usp_(Assistant|Career)_\w+[\s\S]*?^GO\s*$",RegexOptions.Multiline))
        await db.ExecuteAsync(Regex.Replace(match.Value,@"^GO\s*$","",RegexOptions.Multiline));
    var incident=File.ReadAllText(Path.Combine(root,"sql/VS_2026-09-29-chat-incident-routing.sql"));
    var contacts=Regex.Match(incident,@"CREATE OR ALTER PROCEDURE dbo\.usp_Assistant_GetIncidentContacts\b[\s\S]*?^GO\s*$",RegexOptions.Multiline);
    await db.ExecuteAsync(Regex.Replace(contacts.Value,@"^GO\s*$","",RegexOptions.Multiline));
    var student=Guid.NewGuid();var programme=Guid.NewGuid();var other=Guid.NewGuid();
    await db.ExecuteAsync("""
        INSERT dbo.academic_programs(id,code,name_en,name_ar) VALUES(@programme,N'DS',N'Data Science',N'علوم البيانات');
        INSERT dbo.student_profiles(user_id,student_number,program_id) VALUES(@student,N'TEST',@programme);
        INSERT dbo.career_roles(role_code,title_en,title_ar,career_family,suitable_programmes,required_hard_skills,preferred_tools)
        VALUES(N'role-a',N'Data Analyst',N'محلل بيانات',N'data',N'["Data Science"]',N'["SQL","Statistics"]',N'["Python"]'),
        (N'role-b',N'Data Scientist',N'عالم بيانات',N'data',N'["Data Science"]',N'["Python","Statistics"]',N'["Excel"]'),
        (N'role-c',N'Machine Learning Engineer',N'مهندس تعلم آلي',N'data',N'["Data Science"]',N'["Machine Learning"]',N'["Python"]');
        INSERT dbo.cases(case_number,student_id,case_type,title,description,status,urgency)
        VALUES(N'CAREER-OWN',@student,N'query',N'Career counselling request',N'Test',N'assigned',N'medium'),
        (N'CAREER-OTHER',@other,N'query',N'Career counselling request',N'Test',N'assigned',N'medium');
        """,new{student,programme,other});
    var context=Context(student);
    var career=new CareerController(factory,null!) {ControllerContext=new ControllerContext{HttpContext=context}};
    var assistant=new AssistantController(factory,new NoHttp(),new ConfigurationBuilder().Build(),null!,new Sanadi.Infrastructure.Appointments.AppointmentChatService(),NullLogger<AssistantController>.Instance)
    {ControllerContext=new ControllerContext{HttpContext=context}};
    async Task<JsonNode> Turn(string question,Guid? conversation=null)
    {
        context.Response.Body=new MemoryStream(); await assistant.Stream(new(question,conversation,"en",null),default);
        context.Response.Body.Position=0;
        var events=(await new StreamReader(context.Response.Body,leaveOpen:true).ReadToEndAsync()).Split('\n').Where(l=>l.StartsWith("data:")).Select(l=>JsonNode.Parse(l[5..])!).ToArray();
        Check(!events.Any(e=>(string?)e["type"]=="error"),"Chat error: "+string.Join(" ",events.Where(e=>(string?)e["type"]=="error")));
        return events.Single(e=>(string?)e["type"]=="final")["response"]!;
    }
    var page=JsonSerializer.SerializeToNode(await career.State(default),json)!["analysis"]!;
    var result=await Turn("What kind of jobs would suit my degree and skills?");
    var snapshot=result["careerInsight"]!;
    Check((string?)result["agent"]=="career" && (bool)result["verified"]! && !(bool)result["fallbackUsed"]!,"Career route replaces document fallback");
    Check(snapshot["matches"]!.AsArray().Count==3,"Three role matches shown");
    for(var i=0;i<3;i++) Check((int)snapshot["matches"]![i]!["fitScore"]! == (int)page["matches"]![i]!["fitScore"]!,"Card scores identical to Career page");
    Check(result["nextSteps"]!.ToJsonString().Contains("Upload CV"),"Upload CV next step");
    Check((string?)snapshot["counsellingRequest"]!["reference"]=="CAREER-OWN","Only own counselling request shown");
    Check(snapshot["skillGaps"]!["missing"]!.AsArray().Count>0,"Missing skills displayed");
    Check((await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.cases"))==2,"Question creates no counselling case");
    var conversation=Guid.Parse((string)result["conversationId"]!);
    var saved=await db.ExecuteScalarAsync<string>("SELECT metadata FROM dbo.messages WHERE id=@id",new{id=Guid.Parse((string)result["messageId"]!)});
    Check(JsonNode.Parse(saved!)!["careerInsight"]!["matches"]!.AsArray().Count==3,"Card persisted for chat history");
    var skills=await Turn("What skills am I missing for those jobs?",conversation);
    var skillsCard=skills["careerInsight"]!;
    Check((string?)skillsCard["topic"]=="skill_gap","Exact screenshot follow-up uses skill-gap topic");
    var skillsAnswer=(string)skills["answer"]!;
    Check(skillsAnswer.Contains("Compared with what **"+(string)snapshot["matches"]![0]!["title"]!+"** requires:"),"Follow-up uses the same leading career role");
    Check(skillsAnswer.Contains("**Missing**")&&skillsAnswer.Contains("**Next steps**"),"Missing skills and action plan visible in answer");
    foreach(var skill in skillsCard["skillGaps"]!["missing"]!.AsArray()) Check(skillsAnswer.Contains((string)skill!),"Answer and snapshot share actual missing skills");
    Check(JsonNode.DeepEquals(snapshot["matches"],skillsCard["matches"]),"Follow-up preserves role matches and scores");
    Check((string?)skillsCard["counsellingRequest"]!["reference"]=="CAREER-OWN"&&!(bool)skillsCard["cv"]!["hasCv"]!,"Snapshot includes own counselling reference and upload state");
    Check((bool)skills["verified"]!&&!(bool)skills["fallbackUsed"]!&&!skillsAnswer.Contains("could not find an approved"),"No incorrect missing-source fallback");
    var savedSkills=JsonNode.Parse((await db.ExecuteScalarAsync<string>("SELECT metadata FROM dbo.messages WHERE id=@id",new{id=Guid.Parse((string)skills["messageId"]!)}))!)!;
    Check(JsonNode.DeepEquals(skillsCard,savedSkills["careerInsight"]),"Complete skills card survives chat history reload");
    Console.WriteLine("PASS exact skills screenshot follow-up: same role, missing skills, next steps, complete Career snapshot, own counselling, upload state, no source fallback and persisted history.");
    // Simulate an already-uploaded readable CV; the existing upload endpoint remains untouched.
    await db.ExecuteAsync("""
        INSERT dbo.student_cv_documents(student_id,file_name,mime_type,size_bytes,original_file_path,parsed_text,parsing_status,is_current)
        VALUES(@student,N'test-cv.txt',N'text/plain',200,N'test-only',
        N'Education: BSc Data Science. Skills: SQL, Python, Statistics, Excel. Projects: Built a reporting dashboard, analysed data and improved report preparation time by 20%. Experience: Data analyst internship.',N'parsed',1);
        """,new{student});
    var ats=await Turn("What is my ATS score?",conversation);
    Check(ats["careerInsight"]!["ats"]?["overall"] is not null && (bool)ats["careerInsight"]!["cv"]!["analysed"]!,"CV upload follow-up returns current ATS card");
    var newPage=JsonSerializer.SerializeToNode(await career.State(default),json)!["analysis"]!;
    Check(ats["careerInsight"]!["ats"]!["overall"]!.ToJsonString()==newPage["ats"]!["overall"]!.ToJsonString(),"ATS equals Career page score");
    context.Items[CurrentUserMiddleware.ItemKey]=new CurrentUser{UserId=other,IsAuthenticated=true,Roles=["student"]};
    var empty=await Turn("What jobs suit my degree?");
    Check(empty["careerInsight"]!["matches"]!.AsArray().Count==0,"No academic/CV evidence does not fabricate personalised roles");
    Console.WriteLine("PASS screenshot career reply, next steps, three-role card, unchanged Career page scores, missing skills, own counselling case, persisted history, no extra cases, readable CV/ATS follow-up, and no-profile handling. No model calls.");

    // Contradictory model output must never let a pending booking replace a skills question.
    // All settings/state below belong to this disposable synthetic database.
    await db.ExecuteAsync("""
        CREATE OR ALTER PROCEDURE dbo.usp_Assistant_GetAiSettings AS
        SELECT CAST(1 AS bit) ai_enabled,N'openai' provider,N'test-model' model_name,
          N'test-key' api_key,N'https://model.example.test/v1/chat/completions' api_url,
          CAST(0 AS bit) enable_thinking;
        """);
    await db.ExecuteAsync("""
        CREATE OR ALTER PROCEDURE dbo.usp_AiAdmin_ListTools AS
        SELECT CAST(NULL AS nvarchar(100)) tool_name,CAST(NULL AS nvarchar(100)) agent_type,
          CAST(NULL AS nvarchar(100)) description,CAST(0 AS bit) enabled WHERE 1=0;
        """);
    context.Items[CurrentUserMiddleware.ItemKey]=new CurrentUser{UserId=student,IsAuthenticated=true,Roles=["student"]};
    var contradictoryModel=new ContradictoryContinuation();
    assistant=new AssistantController(factory,contradictoryModel,new ConfigurationBuilder().Build(),null!,
        new Sanadi.Infrastructure.Appointments.AppointmentChatService(),NullLogger<AssistantController>.Instance)
        {ControllerContext=new ControllerContext{HttpContext=context}};
    var voice=new VoiceAssistantController(assistant,NullLogger<VoiceAssistantController>.Instance)
        {ControllerContext=new ControllerContext{HttpContext=context}};
    foreach(var (question,lang) in new[]{("What skills am I missing for those jobs?","en"),("ما المهارات التي تنقصني لتلك الوظائف؟","ar")})
    {
        JsonObject? expected=null;
        foreach(var state in new object[]{
            new {awaitingService=true,serviceOptions=new[]{new{unitCode="CAREER",label="Career Services"}}},
            new {unitCode="CAREER",awaitingAssist=true,assistOffered=true},
            new {unitCode="CAREER",offeredSlots=new[]{new{slotId="synthetic-slot",staffName="Test Advisor",typeName="Career counselling"}}}})
        foreach(var useVoice in new[]{false,true})
        {
            var conversationId=Guid.NewGuid();
            await db.ExecuteAsync(DbProc.Call("usp_Assistant_InsertConversation",new{conversationId,userId=student,title="Synthetic career routing regression",lang}));
            var seedId=Guid.NewGuid();
            await db.ExecuteAsync("""
                INSERT dbo.messages(id,conversation_id,user_id,role,content,metadata)
                VALUES(@seedId,@conversationId,@student,N'assistant',N'Synthetic pending booking',@metadata)
                """,new{seedId,conversationId,student,metadata=JsonSerializer.Serialize(new{appointmentContext=state},json)});
            for(var repeat=0;repeat<2;repeat++)
            {
                var before=await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.messages WHERE conversation_id=@conversationId AND role=N'assistant'",new{conversationId});
                JsonObject response;
                if(useVoice)
                {
                    var envelope=(VoiceAssistantController.VoiceTurnResult)((JsonResult)await voice.Ask(new(question,conversationId,lang),default)).Value!;
                    response=envelope.Response;
                    Check(!string.IsNullOrWhiteSpace(envelope.Speech),"Voice supplies a summary of the career response");
                }
                else response=(JsonObject)((JsonResult)await assistant.Ask(new(question,conversationId,lang,null),default)).Value!;
                Check((string?)response["agent"]=="career" && (string?)response["careerInsight"]?["topic"]=="skill_gap",
                    $"Pending appointments never replace the recognized skill-gap answer (lang={lang}, voice={useVoice}, repeat={repeat}, agent={response["agent"]}, type={response["responseType"]})");
                Check(response["appointmentContext"] is null && response["proposedActions"]!.AsArray().Count==0,
                    "No appointment state or booking action leaks into a career answer");
                expected??=response;
                Check((string?)expected["answer"]==(string?)response["answer"] && JsonNode.DeepEquals(expected["careerInsight"]?["skillGaps"],response["careerInsight"]?["skillGaps"]),
                    "Repeated text and voice questions return the same source-backed answer across prior states");
                Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.messages WHERE conversation_id=@conversationId AND role=N'assistant'",new{conversationId})==before+1,
                    "Exactly one assistant response is persisted per request");
            }
        }
    }
    Check(contradictoryModel.RoutingCalls==24,"All regression turns exercise semantic routing, not unavailable-model fallback");
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.cases")==2,"Repeated questions create no booking or counselling cases");
    Console.WriteLine("PASS 24 repeated EN/AR text/voice career turns across service-choice, assistance and slot states, with a deliberately wrong continuation flag; same verified answer, one response, no booking.");
    contradictoryModel.Intent="appointment";
    foreach(var (question,lang) in new[]{("Choose appointment 1","en"),("اختر الموعد 1","ar")})
    {
        var conversationId=Guid.NewGuid();
        var slotId=Guid.NewGuid().ToString();
        var starts=DateTimeOffset.UtcNow.AddDays(3);
        var metadata=JsonSerializer.Serialize(new{appointmentContext=new{unitCode="CAREER",offeredSlots=new[]{new{
            slotId,start=starts.ToString("O"),end=starts.AddMinutes(45).ToString("O"),staffName="Test Advisor",
            unit="Career Services",unitCode="CAREER",typeName="Career counselling",durationMinutes=45,location="Test Room"}}}},json);
        await db.ExecuteAsync(DbProc.Call("usp_Assistant_InsertConversation",new{conversationId,userId=student,title="Synthetic slot selection",lang}));
        await db.ExecuteAsync("""
            INSERT dbo.messages(conversation_id,user_id,role,content,metadata)
            VALUES(@conversationId,@student,N'assistant',N'Synthetic offered slot',@metadata)
            """,new{conversationId,student,metadata});
        var response=(JsonObject)((JsonResult)await assistant.Ask(new(question,conversationId,lang,null),default)).Value!;
        Check((string?)response["agent"]=="appointment" && (string?)response["proposedActions"]?[0]?["toolName"]=="book_appointment",
            "Genuine EN/AR slot selection still enters the existing booking confirmation workflow");
        Check((string?)response["proposedActions"]?[0]?["args"]?["slotId"]==slotId,"The selected slot comes from the owned pending context");
        Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.cases")==2,"Slot selection still requires approval before booking");
    }
    Console.WriteLine("PASS genuine EN/AR appointment selections retain the selected slot and existing approval requirement.");
}
finally{SqlConnection.ClearAllPools();await admin.ExecuteAsync($"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}]");}
static DefaultHttpContext Context(Guid student){var c=new DefaultHttpContext();c.Items[CurrentUserMiddleware.ItemKey]=new CurrentUser{UserId=student,IsAuthenticated=true,Roles=["student"]};return c;}
static void Check(bool value,string message){if(!value)throw new Exception(message);}
sealed class NoHttp:IHttpClientFactory{public HttpClient CreateClient(string name)=>throw new Exception("Career scores must come from the existing engine, not a model");}
sealed class ContradictoryContinuation:HttpMessageHandler,IHttpClientFactory
{
    public int RoutingCalls {get;private set;}
    public string Intent {get;set;}="career_skill_gap";
    public HttpClient CreateClient(string name)=>new(this,false);
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
    {
        using var body=JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct));
        var prompt=body.RootElement.GetProperty("messages")[0].GetProperty("content").GetString()!;
        string answer;
        if(prompt.Contains("Classify the data subject")) answer="""{"scope":"signed_in_student","directTool":null,"greetingOnly":false,"intentConfidence":0.99}""";
        else if(prompt.Contains("ROUTE CATALOGUE"))
        {
            RoutingCalls++;
            answer=JsonSerializer.Serialize(new{routingIntents=new[]{Intent},continueWorkflow=true,intentConfidence=.99});
        }
        else if(prompt.Contains("Resolve a disagreement"))
            answer=JsonSerializer.Serialize(new{routingIntents=new[]{Intent},continueWorkflow=true,intentConfidence=.99});
        else throw new Exception("Career answers must use the existing deterministic engine, not model-generated content");
        return new(System.Net.HttpStatusCode.OK){Content=new StringContent(JsonSerializer.Serialize(new{choices=new[]{new{message=new{content=answer}}}}),System.Text.Encoding.UTF8,"application/json")};
    }
}
