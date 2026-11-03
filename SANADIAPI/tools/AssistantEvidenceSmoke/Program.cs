using System.Net;
using System.Reflection;
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
using Sanadi.Infrastructure.Options;
using Sanadi.Infrastructure.Persistence;

var root = Path.GetFullPath(args[0]);
var migration = File.ReadAllText(Path.Combine(root, "sql/VS_2026-09-29-assistant-service-evidence.sql"));
var queryType = typeof(AssistantController).Assembly.GetType("Sanadi.Api.AI.AssistantEvidenceQuery")!;
string[] Terms(string text) => (string[])queryType.GetMethod("Terms", BindingFlags.Static | BindingFlags.NonPublic)!.Invoke(null, [text])!;
const string campus = "Do I need to apply for a campus entry permit?";

if (args.Contains("--live-read-only"))
{
    // Execute only the new SELECT body, without deploying the procedure or creating chat records.
    var config = new ConfigurationBuilder().AddJsonFile(Path.Combine(root,"Sanadi.Api/appsettings.json")).Build();
    await using var db = new SqlConnection(config["SqlServer:ConnectionString"]);
    var body = Regex.Match(migration, @"(?s)\bAS\s*BEGIN(.*)END;\s*GO").Groups[1].Value;
    var samples = new[] { campus, "How can I get help with fees and payment plans?", "هل أحتاج إلى تقديم طلب تصريح دخول الحرم؟" };
    foreach (var question in samples)
    {
        var lang = question == samples[2] ? "ar" : "en";
        var evidence = (await db.QueryAsync(body, new { terms = JsonSerializer.Serialize(Terms(question)), lang })).ToList();
        Check(evidence.Count > 0, "No configured evidence retrieved");
        var top = (IDictionary<string, object>)evidence[0];
        Console.WriteLine($"PASS live read-only retrieval: {question} => {top["Title"]} ({top["SourceType"]})");
        var sources = JsonSerializer.Serialize(evidence.Select((dynamic e, int i) => new { source=$"S{i+1}", type=(string)e.SourceType, title=(string)e.Title, content=(string)e.Content }));
        var prompt = (string)queryType.GetMethod("Prompt", BindingFlags.Static | BindingFlags.NonPublic)!.Invoke(null,[question,lang,sources])!;
        var ai = await db.QuerySingleAsync(DbProc.Call("usp_Assistant_GetAiSettings",null));
        var controller = new AssistantController(null!,new RealHttp(),config,null!,null!,NullLogger<AssistantController>.Instance);
        var providerClass=typeof(AssistantController).Assembly.GetType("Sanadi.Api.AI.AiProviderChat")!;
        var kind=providerClass.GetMethod("Resolve",BindingFlags.Static|BindingFlags.NonPublic)!.Invoke(null,[(string)ai.provider]);
        var method=typeof(AssistantController).GetMethod("CallConfiguredModel",BindingFlags.Instance|BindingFlags.NonPublic)!;
        var answer=await (Task<string?>)method.Invoke(controller,[kind,(string)ai.model_name,(string)ai.api_key,(string)ai.api_url,Guid.NewGuid(),prompt,(decimal)ai.temperature,(int)ai.max_output_tokens,(bool?)ai.enable_thinking,CancellationToken.None])!;
        Check(!string.IsNullOrWhiteSpace(answer),"Active model returned an empty response");
        Console.WriteLine("MODEL: " + answer);
    }
    return;
}

// All writes below are confined to a new disposable LocalDB database.
var name="SanadiEvidenceTest_"+Guid.NewGuid().ToString("N");
await using var admin=new SqlConnection(@"Server=(localdb)\MSSQLLocalDB;Database=master;Integrated Security=true;TrustServerCertificate=true");
await admin.OpenAsync(); await admin.ExecuteAsync($"CREATE DATABASE [{name}]");
try
{
    var factory=new SqlConnectionFactory(Options.Create(new SqlOptions { ConnectionString=$@"Server=(localdb)\MSSQLLocalDB;Database={name};Integrated Security=true;TrustServerCertificate=true" }));
    await using var db=factory.Create(); await db.OpenAsync();
    var schema=File.ReadAllText(Path.Combine(root,"sql/sanadi_schema.sql"));
    foreach(var table in new[]{"service_units","case_categories","routing_rules","university_services","knowledge_documents","document_chunks","faq_items","conversations","messages","agent_runs","emergency_contacts","exception_events"})
    {
        var match=Regex.Match(schema,@"CREATE TABLE \[dbo\]\.\["+table+@"\][\s\S]*?^GO\s*$",RegexOptions.Multiline);
        Check(match.Success,"Missing fixture table "+table);
        await db.ExecuteAsync(Regex.Replace(match.Value,@"^GO\s*$","",RegexOptions.Multiline));
    }
    var oldProcs=File.ReadAllText(Path.Combine(root,"sql/2026-09-21-usp-api-direct-queries.sql"));
    foreach(Match match in Regex.Matches(oldProcs,@"CREATE OR ALTER PROCEDURE dbo\.usp_Assistant_\w+[\s\S]*?^GO\s*$",RegexOptions.Multiline))
        await db.ExecuteAsync(Regex.Replace(match.Value,@"^GO\s*$","",RegexOptions.Multiline));
    var incident=File.ReadAllText(Path.Combine(root,"sql/VS_2026-09-29-chat-incident-routing.sql"));
    var contactProc=Regex.Match(incident,@"CREATE OR ALTER PROCEDURE dbo\.usp_Assistant_GetIncidentContacts\b[\s\S]*?^GO\s*$",RegexOptions.Multiline);
    await db.ExecuteAsync(Regex.Replace(contactProc.Value,@"^GO\s*$","",RegexOptions.Multiline));
    var routing=File.ReadAllText(Path.Combine(root,"sql/VS_2026-09-29-live-complaint-routing.sql"));
    await db.ExecuteAsync(Regex.Split(routing,@"^GO\s*$",RegexOptions.Multiline)[0]);
    foreach(var batch in Regex.Split(migration,@"^GO\s*$",RegexOptions.Multiline))
        if(!string.IsNullOrWhiteSpace(batch))await db.ExecuteAsync(batch);
    // Re-running the migration must be safe.
    foreach(var batch in Regex.Split(migration,@"^GO\s*$",RegexOptions.Multiline))
        if(!string.IsNullOrWhiteSpace(batch))await db.ExecuteAsync(batch);
    await db.ExecuteAsync("""
        CREATE OR ALTER PROCEDURE dbo.usp_Assistant_GetAiSettings AS
        SELECT CAST(1 AS bit) ai_enabled,N'custom' provider,N'test-model' model_name,
          N'test-key' api_key,N'https://model.example.test' api_url,CAST(0 AS bit) enable_thinking,
          CAST(0.2 AS decimal(18,6)) temperature,512 max_output_tokens;
        """);
    await db.ExecuteAsync("""
        INSERT dbo.university_services(code,name_en,name_ar,category,description_en,instructions_en,description_ar)
        VALUES(N'dynamic-entry',N'Campus entry permit',N'تصريح دخول الحرم',N'proactive',
          N'No separate application is required.',N'Use your university ID at the designated parking gate.',N'لا تحتاج إلى طلب منفصل. استخدم بطاقتك الجامعية للدخول.'),
          (N'dynamic-fees',N'Fees and payment support',N'الرسوم',N'finance',N'Contact the fees desk for payment plans.',NULL,N'دعم الرسوم');
        INSERT dbo.faq_items(question_en,question_ar,answer_en,answer_ar)
        VALUES(N'How can I renew borrowed books?',N'تجديد استعارة الكتب',N'Renew books through your library account.',N'جدد من حساب المكتبة');
        INSERT dbo.knowledge_documents(title,is_active,is_current,approval_status,effective_date)
        SELECT TOP (100) N'Unrelated campus news',1,1,N'approved',CONVERT(date,GETDATE()) FROM sys.all_objects;
        INSERT dbo.document_chunks(document_id,chunk_index,content)
        SELECT id,0,N'Campus news only.' FROM dbo.knowledge_documents;
        DECLARE @policy uniqueidentifier=NEWID();
        INSERT dbo.knowledge_documents(id,title,is_active,is_current,approval_status,effective_date)
        VALUES(@policy,N'Semester withdrawal policy',1,1,N'approved',DATEADD(day,-30,GETDATE()));
        INSERT dbo.document_chunks(document_id,chunk_index,content) VALUES(@policy,0,N'Semester withdrawal requires adviser review.');
        """);
    async Task<List<dynamic>> Search(string q,string lang="en") => (await db.QueryAsync(DbProc.Call("usp_Assistant_RetrieveEvidence",new { terms=JsonSerializer.Serialize(Terms(q)),lang }))).ToList();
    Check((string)(await Search(campus))[0].SourceType=="service","Campus guidance comes from catalogue");
    Check((string)(await Search("How can I get help with fees and payment plans?"))[0].Title=="Fees and payment support","Other service uses same flow");
    Check((string)(await Search("How can I renew borrowed books?"))[0].SourceType=="faq","Approved FAQ retrieved");
    Check((string)(await Search("What is the semester withdrawal policy?"))[0].Title=="Semester withdrawal policy","Relevant older policy beyond first 80 chunks retrieved");
    Check((string)(await Search("هل أحتاج إلى تقديم طلب تصريح دخول الحرم؟","ar"))[0].Title=="تصريح دخول الحرم","Arabic service retrieved");
    Check((await Search("Tell me about extraterrestrial teleportation")).Count==0,"Unrelated evidence not invented");
    // Existing visibility boundaries apply to documents and FAQs that inherit them.
    await db.ExecuteAsync("""
        UPDATE dbo.knowledge_documents SET confidentiality=N'restricted' WHERE title=N'Semester withdrawal policy';
        INSERT dbo.faq_items(question_en,question_ar,answer_en,answer_ar,document_id)
        SELECT N'Withdrawal details',N'تفاصيل',N'Private withdrawal details',N'خاص',id FROM dbo.knowledge_documents WHERE title=N'Semester withdrawal policy';
        UPDATE dbo.faq_items SET approval_status=N'draft' WHERE question_en=N'How can I renew borrowed books?';
        UPDATE dbo.university_services SET is_active=0 WHERE code=N'dynamic-fees';
        """);
    Check((await Search("semester withdrawal")).Count==0,"Restricted policy and linked FAQ excluded");
    Check((await Search("renew borrowed books")).Count==0,"Unapproved FAQ excluded");
    Check((await Search("fees payment")).Count==0,"Inactive service excluded");
    Console.WriteLine("PASS retrieval: service/FAQ/policy, >80 passages, Arabic, unrelated, restricted and inactive records, repeatable SQL migration");

    var student=Guid.NewGuid(); var context=new DefaultHttpContext();
    context.Items[CurrentUserMiddleware.ItemKey]=new CurrentUser { UserId=student,IsAuthenticated=true,Roles=["student"] };
    context.Response.Body=new MemoryStream();
    var model=new FakeModel();
    var assistant=new AssistantController(factory,model,new ConfigurationBuilder().Build(),null!,new Sanadi.Infrastructure.Appointments.AppointmentChatService(),NullLogger<AssistantController>.Instance)
    { ControllerContext=new ControllerContext { HttpContext=context } };
    await assistant.Stream(new(campus,null,"en",null),default);
    context.Response.Body.Position=0;
    var events=(await new StreamReader(context.Response.Body,leaveOpen:true).ReadToEndAsync()).Split('\n').Where(l=>l.StartsWith("data:")).Select(l=>JsonNode.Parse(l[5..])!).ToList();
    Check(!events.Any(e=>(string?)e["type"]=="error"),"SSE error: "+string.Join(" ",events.Where(e=>(string?)e["type"]=="error")));
    var final=events.Single(e=>(string?)e["type"]=="final")["response"]!;
    Check((bool)final["verified"]! && !(bool)final["fallbackUsed"]!,"Grounded model response must replace no-source fallback");
    Check((string?)final["answer"]==FakeModel.Answer,"Model answer delivered to chat");
    Check(final["proposedActions"]!.AsArray().Count==0,"Proactive service must not create an action proposal");
    Check((string?)final["citations"]![0]!["sourceType"]=="service","Service evidence attached to response");
    Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.messages WHERE role=N'assistant' AND content=@answer",new { answer=FakeModel.Answer })==1,"Answer persisted for history");
    Check(model.Prompt?.Contains("No separate application is required.")==true,"Stored guidance sent to active model");
    Console.WriteLine("PASS chat SSE final answer, source metadata, model prompt, no unnecessary proposal and persisted chat history");
}
finally { SqlConnection.ClearAllPools(); await admin.ExecuteAsync($"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}]"); }
static void Check(bool value,string message) { if(!value)throw new Exception(message); }
sealed class RealHttp : IHttpClientFactory { public HttpClient CreateClient(string name)=>new() {Timeout=TimeSpan.FromSeconds(60)}; }
sealed class FakeModel : HttpMessageHandler,IHttpClientFactory
{
    public const string Answer="**Your campus access is already taken care of.**\n\nNo separate application is required. Use your university ID at the designated parking gate.";
    public string? Prompt { get;private set; }
    public HttpClient CreateClient(string name)=>new(this,false);
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
    {
        Prompt=await request.Content!.ReadAsStringAsync(ct);
        var answer=Prompt.Contains("intake planner")?JsonSerializer.Serialize(new {
            needsClarification=false,question="",type="query",title="Campus entry permit enquiry",
            searchQuery="Do I need to apply for a campus entry permit?",unitId=(string?)null,confidence=.99,routingConfidence=0,usePrevious=false
        }):Prompt.Contains("retrieved university sources actually answer")?"{\"supported\":true}":Answer;
        return new(HttpStatusCode.OK) { Content=new StringContent(JsonSerializer.Serialize(new { choices=new[]{new { message=new {content=answer} } } }),Encoding.UTF8,"application/json") };
    }
}
