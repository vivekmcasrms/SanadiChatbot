using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Sanadi.Api.Controllers;
using Sanadi.Api.Security;
using Sanadi.Infrastructure;
using Sanadi.Infrastructure.Library;
using Sanadi.Infrastructure.Options;
using Sanadi.Infrastructure.Persistence;

var root=Path.GetFullPath(args[0]);
if(args.Contains("--routing-settings-read-only"))
{
    var config=new ConfigurationBuilder().AddJsonFile(Path.Combine(root,"Sanadi.Api/appsettings.json")).Build();
    await using var settingsDb=new SqlConnection(config["SqlServer:ConnectionString"]);
    var settings=await settingsDb.QueryFirstAsync(DbProc.Call("usp_Assistant_GetAiSettings",null));
    Console.WriteLine(JsonSerializer.Serialize(new { provider=(string)settings.provider, model=(string)settings.model_name, enabled=(bool)settings.ai_enabled }));
    return;
}
if(args.Contains("--live-read-only"))
{
    var config=new ConfigurationBuilder().AddJsonFile(Path.Combine(root,"Sanadi.Api/appsettings.json")).Build();
    using var services=new ServiceCollection().AddLogging().AddSanadiInfrastructure(config).BuildServiceProvider();
    using var scope=services.CreateScope();
    var queryIndex=Array.IndexOf(args,"--query");
    var query=queryIndex>=0&&queryIndex+1<args.Length?args[queryIndex+1]:"control systems";
    var live=await scope.ServiceProvider.GetRequiredService<OclcLibrarySearchService>().SearchAsync(new(query,10,"en"),default);
    Console.WriteLine($"Live catalogue check: status={live.status}; results={live.results.Count}; total={live.total}; durationMs={live.latencyMs}");
    foreach(var record in live.results.Take(3)) Console.WriteLine("Title: "+record.title);
    return;
}
// Writes only to this newly-created disposable LocalDB database. HTTP responses are synthetic.
var name="SanadiLibraryChatTest_"+Guid.NewGuid().ToString("N");
await using var admin=new SqlConnection(@"Server=(localdb)\MSSQLLocalDB;Database=master;Integrated Security=true;TrustServerCertificate=true");
await admin.OpenAsync();await admin.ExecuteAsync($"CREATE DATABASE [{name}]");
try
{
    var factory=new SqlConnectionFactory(Options.Create(new SqlOptions{ConnectionString=$@"Server=(localdb)\MSSQLLocalDB;Database={name};Integrated Security=true;TrustServerCertificate=true"}));
    await using var db=factory.Create();await db.OpenAsync();
    var schema=File.ReadAllText(Path.Combine(root,"sql/sanadi_schema.sql"));
    foreach(var table in new[]{"conversations","messages","agent_runs","emergency_contacts"})
    {
        var match=Regex.Match(schema,@"CREATE TABLE \[dbo\]\.\["+table+@"\][\s\S]*?^GO\s*$",RegexOptions.Multiline);
        await db.ExecuteAsync(Regex.Replace(match.Value,@"^GO\s*$","",RegexOptions.Multiline));
    }
    var procs=File.ReadAllText(Path.Combine(root,"sql/2026-09-21-usp-api-direct-queries.sql"));
    foreach(Match match in Regex.Matches(procs,@"CREATE OR ALTER PROCEDURE dbo\.usp_Assistant_\w+[\s\S]*?^GO\s*$",RegexOptions.Multiline))
        await db.ExecuteAsync(Regex.Replace(match.Value,@"^GO\s*$","",RegexOptions.Multiline));
    var incident=File.ReadAllText(Path.Combine(root,"sql/VS_2026-09-29-chat-incident-routing.sql"));
    var contact=Regex.Match(incident,@"CREATE OR ALTER PROCEDURE dbo\.usp_Assistant_GetIncidentContacts\b[\s\S]*?^GO\s*$",RegexOptions.Multiline);
    await db.ExecuteAsync(Regex.Replace(contact.Value,@"^GO\s*$","",RegexOptions.Multiline));
    await db.ExecuteAsync("""
        CREATE PROCEDURE dbo.usp_Library_GetOclcSettings AS
        SELECT N'Test catalogue' ProviderName, CAST(1 AS bit) Enabled,
          N'https://catalogue.example.test/search' BaseUrl,N'https://catalogue.example.test/record/{id}' CatalogueUrlTemplate,
          N'test-id' ClientId,N'test-secret' ClientSecret;
        """);
    var transport=new CatalogueHttp();using var cache=new MemoryCache(new MemoryCacheOptions());
    var library=new OclcLibrarySearchService(factory,transport,cache,NullLogger<OclcLibrarySearchService>.Instance);
    var student=Guid.NewGuid();var context=new DefaultHttpContext();
    context.Items[CurrentUserMiddleware.ItemKey]=new CurrentUser{UserId=student,IsAuthenticated=true,Roles=["student"]};
    var controller=new AssistantController(factory,transport,new ConfigurationBuilder().Build(),null!,new Sanadi.Infrastructure.Appointments.AppointmentChatService(),NullLogger<AssistantController>.Instance,library)
    {ControllerContext=new ControllerContext{HttpContext=context}};
    async Task<JsonNode> Turn(string text,Guid? conversation=null)
    {
        var completedBefore=await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.messages WHERE role=N'assistant'");
        context.Response.Body=new MemoryStream();await controller.Stream(new(text,conversation,"en",null),default);
        context.Response.Body.Position=0;
        var events=(await new StreamReader(context.Response.Body,leaveOpen:true).ReadToEndAsync()).Split('\n').Where(l=>l.StartsWith("data:")).Select(l=>JsonNode.Parse(l[5..])!).ToArray();
        Check(!events.Any(e=>(string?)e["type"]=="error"),"Chat error: "+string.Join(" ",events.Where(e=>(string?)e["type"]=="error")));
        Check(events.Any(e=>(string?)e["type"]=="token"),"Answer tokens sent");
        Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.messages WHERE role=N'assistant'")==completedBefore+1,"Exactly one handler persists a final assistant response");
        if(text.StartsWith("Find resources similar to")||text.StartsWith("ابحث عن مصادر مشابهة"))
            Check(events.Any(e=>(string?)e["type"]=="stage"&&(string?)e["stage"]=="library"),"Find similar displays the Library Agent");
        return events.Single(e=>(string?)e["type"]=="final")["response"]!;
    }
    var result=await Turn("Can you find me a good book on control systems?");
    Check(transport.LastQuery=="kw:control systems","Full subject sent to existing catalogue connector");
    Check((string?)result["agent"]=="library"&&(bool)result["verified"]!&&!(bool)result["fallbackUsed"]!,"Live catalogue route replaces document fallback");
    var card=result["libraryResults"]!;
    Check((string?)card["results"]![0]!["title"]=="Modern Control Systems","Real mapped record reaches chat card");
    Check((string?)card["results"]![0]!["catalogueUrl"]=="https://catalogue.example.test/record/123","Link uses configured catalogue template");
    Check((string?)card["results"]![0]!["availabilityLabel"]=="Unknown","Unknown availability stays unknown");
    Check(result["proposedActions"]!.AsArray().Count==0,"No case created or proposed by search");
    var conversation=Guid.Parse((string)result["conversationId"]!);
    var saved=JsonNode.Parse((await db.ExecuteScalarAsync<string>("SELECT metadata FROM dbo.messages WHERE id=@id",new{id=Guid.Parse((string)result["messageId"]!)}))!)!;
    Check(JsonNode.DeepEquals(card,saved["libraryResults"]),"Card persists in chat history");
    await Turn("Find resources similar to \"Modern Control Systems\"",conversation);
    Check(transport.LastQuery=="kw:Modern Control Systems","Find similar callback performs a fresh catalogue search");
    foreach(var title in new[]{"Schaum's outline of theory and problems of feedback and control systems",
        "Algebraic methods for nonlinear control systems", "Fire safety: problems and ideas", "Career counselling appointments", "Enrollment letter guidance", "Textbooks for HIST120"})
    {
        var before=transport.SearchRequests;
        var similar=await Turn($"Find resources similar to \"{title}\"",conversation);
        Check(transport.SearchRequests==before+1&&transport.LastQuery=="kw:"+title,"Every Find similar click searches the selected title");
        Check((string?)similar["agent"]=="library"&&(string?)similar["classification"]?["intent"]=="query","Quoted title cannot change the agent or intent");
        Check(similar["proposedActions"]!.AsArray().Count==0&&similar["libraryResults"]?["results"]?.AsArray().Count>0,"Fresh result cards replace complaint/action proposals");
        Check((string?)similar["libraryResults"]?["results"]?[0]?["id"]==(122+transport.SearchRequests).ToString(),"New provider response reaches the screen card");
        var metadata=JsonNode.Parse((await db.ExecuteScalarAsync<string>("SELECT metadata FROM dbo.messages WHERE id=@id",new{id=Guid.Parse((string)similar["messageId"]!)}))!)!;
        Check(JsonNode.DeepEquals(similar["libraryResults"],metadata["libraryResults"]),"Similar results survive reloading chat history");
    }
    var arabic=await Turn("ابحث عن مصادر مشابهة لـ \"مشكلات التحكم\"",conversation);
    Check(transport.LastQuery=="kw:مشكلات التحكم"&&(string?)arabic["agent"]=="library","Arabic Find similar uses the same catalogue route");
    transport.Mode="broad";
    var broad=await Turn("Can you find me a good book on control systems?",conversation);
    Check(((string)broad["answer"]!).Contains("could not confirm an exact topic match"),"Broad result does not invent relevance");
    transport.Mode="empty";
    var empty=await Turn("Can you find me a good book on control systems?",conversation);
    Check(empty["libraryResults"] is null&&((string)empty["answer"]!).Contains("returned no results"),"Successful empty catalogue message");
    transport.Mode="timeout";
    var timeout=await Turn("Can you find me a good book on control systems?",conversation);
    Check(timeout["libraryResults"] is null&&((string)timeout["answer"]!).Contains("cannot reach the live library catalogue"),"Provider failure handled without a made-up book or zero-results claim");
    await db.ExecuteAsync("""
        CREATE OR ALTER PROCEDURE dbo.usp_Assistant_GetAiSettings AS
        SELECT N'openai' provider,N'test-model' model_name,N'test-key' api_key,
          N'https://model.example.test/v1/chat/completions' api_url,CAST(1 AS bit) ai_enabled,CAST(0 AS bit) enable_thinking;
        """);
    await db.ExecuteAsync("""
        CREATE PROCEDURE dbo.usp_AiAdmin_ListTools AS
        SELECT N'issue_enrollment_letter' tool_name,N'document' agent_type,
          N'Issue an official certificate confirming current university enrolment.' description,CAST(1 AS bit) enabled;
        """);
    transport.Mode="ai";
    var voice=new VoiceAssistantController(controller,NullLogger<VoiceAssistantController>.Instance)
        {ControllerContext=new ControllerContext{HttpContext=context}};
    foreach(var (question,language) in new[]{("Help me find a book on artificial intelligence.","en"),
        ("ساعدني في العثور على كتاب في الذكاء الاصطناعي.","ar")})
    {
        var textResult=await Turn(question,conversation);
        var action=await voice.Ask(new(question,conversation,language,"mira"),default);
        var voiceResult=(VoiceAssistantController.VoiceTurnResult)((JsonResult)action).Value!;
        foreach(var response in new[]{textResult,voiceResult.Response})
        {
            Check((string?)response["agent"]=="library","Incorrect document classifier output cannot override a book search: "+language+" "+response.ToJsonString());
            Check(response["issuedDocument"] is null&&response["receipt"] is null,"No unrelated document or receipt is created");
            Check((string?)response["libraryResults"]?["results"]?[0]?["title"]=="Artificial Intelligence: A Modern Approach","Answer uses the catalogue record");
        }
        Check((string?)textResult["answer"]==(string?)voiceResult.Response["answer"],"Text/voice answer parity for "+language);
        Check(!string.IsNullOrWhiteSpace(voiceResult.Speech)&&!voiceResult.Speech.Contains("catalogue.example.test"),"Speech uses an overview, not the full result cards");
        Check(transport.LastQuery=="kw:artificial intelligence","Correct subject reaches the catalogue in both languages");
    }
    transport.Intents=["library"];
    await Turn("أين أجد كتاباً عن الشبكات؟",conversation);
    transport.Intents=["library","document"];
    var beforeConflict=transport.SearchRequests;
    var conflict=await Turn("Find a resource and issue a certificate.",conversation);
    Check((string?)conflict["responseType"]=="clarification"&&transport.SearchRequests==beforeConflict&&conflict["issuedDocument"] is null,"Conflicting outcomes ask once without executing a specialist");
    transport.Scope="another_person";
    var refused=await Turn("Show another student's record.",conversation);
    Check(refused["toolsUsed"]!.AsArray().Any(t=>(string?)t=="authenticated_profile_scope")&&transport.SearchRequests==beforeConflict,"Privacy refusal precedes every business handler");
    Console.WriteLine("PASS EN/AR text and voice routing under a deliberately wrong document classification, catalogue-backed answers, no letter issuance, spoken overview, persisted cards, and existing similar/broad/empty/timeout flows.");
}
finally{SqlConnection.ClearAllPools();await admin.ExecuteAsync($"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}]");}
static void Check(bool value,string message){if(!value)throw new Exception(message);}
sealed class CatalogueHttp:HttpMessageHandler,IHttpClientFactory
{
    public string Mode="ok";public string? LastQuery;public int SearchRequests;
    public string[]? Intents;public string Scope="signed_in_student";
    public HttpClient CreateClient(string name){if(name!="OclcLibrary"&&!(Mode=="ai"&&name=="AssistantModel"))throw new Exception("Unexpected model call");return new(this,false);}
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage req,CancellationToken ct)
    {
        object data;
        if(req.RequestUri!.Host=="model.example.test")
        {
            var prompt=await req.Content!.ReadAsStringAsync(ct);
            var content=prompt.Contains("Translate this library catalogue subject")?"artificial intelligence":
                prompt.Contains("ROUTE CATALOGUE")||prompt.Contains("Resolve a disagreement")
                    ? Intents is null ? """{"scope":"signed_in_student"}""" : JsonSerializer.Serialize(new{routingIntents=Intents,intentConfidence=.99,continueWorkflow=false})
                    : prompt.Contains("Compare the desired outcome") ? """{"authorized":false,"confidence":0.99}"""
                    : JsonSerializer.Serialize(new{scope=Scope,directTool="issue_enrollment_letter",greetingOnly=false,intentConfidence=.99});
            data=new{choices=new[]{new{message=new{content}}}};
        }
        else if(req.Method==HttpMethod.Post)data=new{access_token="test-token",expires_in=3600};
        else
        {
            SearchRequests++;
            CheckHeader(req);
            LastQuery=Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(req.RequestUri!.Query)["q"];
            if(Mode=="timeout")throw new TaskCanceledException("Synthetic catalogue timeout");
            data=Mode=="empty"?new{numberOfRecords=0,briefRecords=Array.Empty<object>()}:(object)new{numberOfRecords=42,briefRecords=new[]{new{oclcNumber=(122+SearchRequests).ToString(),title=Mode=="ai"?"Artificial Intelligence: A Modern Approach":Mode=="broad"?"Chronic disease epidemiology, prevention, and control":"Modern Control Systems",creator=new[]{"Test Author"},date="2020",generalFormat="Book"}}};
        }
        return new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(JsonSerializer.Serialize(data),Encoding.UTF8,"application/json")};
    }
    private static void CheckHeader(HttpRequestMessage req){if(req.Headers.Authorization?.Scheme!="Bearer")throw new Exception("Missing catalogue bearer token");}
}
