using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Sanadi.Api.Notifications;
using Sanadi.Api.Survey;
using Sanadi.Infrastructure;

// This executable never reads appsettings or creates a network-capable HTTP handler.
var connectionString=Environment.GetEnvironmentVariable("SANADI_EMAIL_SQL_TEST") ?? throw new InvalidOperationException("Use Test-SurveyLookup.ps1 -RunCSharp.");
var builder=new SqlConnectionStringBuilder(connectionString);
if(!builder.DataSource.StartsWith("(localdb)\\",StringComparison.OrdinalIgnoreCase) ||
   !System.Text.RegularExpressions.Regex.IsMatch(builder.InitialCatalog,"^SanadiSurveyTest_[0-9a-f]{32}$"))
    throw new InvalidOperationException("Only the disposable synthetic LocalDB fixture is allowed.");
await using var db=new SqlConnection(connectionString);await db.OpenAsync();
await db.ExecuteAsync("UPDATE dbo.CustomerPulseSetting SET IsEnabled=1, ScriptUrl='https://www.uaeu.ac.ae/en/vc/doit/cp2/js/pulse-portal.js'; UPDATE dbo.notification_deliveries SET status='queued',next_attempt_at=SYSDATETIMEOFFSET() WHERE event_type LIKE 'TICKET[_]EMAIL[_]%';");
var config=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>
{
    ["SqlServer:ConnectionString"]=connectionString,["SsoRouting:IsProductionEntry"]="false",
    ["Jwt:SigningKey"]=Convert.ToHexString(RandomNumberGenerator.GetBytes(48))
}).Build();
using var http=new RecordingHttp();
var services=new ServiceCollection().AddLogging();
services.AddSingleton<IConfiguration>(config).AddSanadiInfrastructure(config);
services.AddSingleton<IHttpClientFactory>(http);
services.AddSingleton<SurveyLinkCodec>();
services.AddScoped<ITicketEmailRepository,TicketEmailRepository>();
services.AddScoped<IUniversityEmailAuthorizationRepository,UniversityEmailAuthorizationRepository>();
services.AddScoped<IUniversityEmailAuthorization,UniversityEmailAuthorization>();
services.AddScoped<ITicketSurveyLinks,TicketSurveyLinks>();
services.AddScoped<TicketEmailDispatcher>();
await using var container=services.BuildServiceProvider();
await using var scope=container.CreateAsyncScope();
var actorIds=await db.QueryAsync<Guid>("SELECT DISTINCT CONVERT(uniqueidentifier,JSON_VALUE(template_vars,'$.actorId')) FROM dbo.notification_deliveries WHERE event_type LIKE 'TICKET[_]EMAIL[_]%';");
foreach(var actor in actorIds)
{
    var sid=Guid.NewGuid();
    await db.ExecuteAsync("INSERT auth.login_sessions VALUES(@sid,@actor,NULL); INSERT auth.refresh_tokens VALUES(@sid,NULL,DATEADD(day,1,SYSDATETIMEOFFSET()));",new{sid,actor});
    await db.ExecuteAsync("INSERT auth.users(id,email) SELECT id,email FROM dbo.profiles WHERE id=@actor;",new{actor});
}
var dispatcher=scope.ServiceProvider.GetRequiredService<TicketEmailDispatcher>();
var total=0;
for(var i=0;i<10;i++){var count=await dispatcher.RunAsync(default);total+=count;if(count==0)break;}
var remaining=await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.notification_deliveries WHERE event_type LIKE 'TICKET[_]EMAIL[_]%' AND status<>'sent';");
if(remaining!=0 || total<15 || http.TokenCalls<1)
{
    foreach(var problem in await db.QueryAsync("SELECT event_type,status,failure_code,COUNT(*) AS Total FROM dbo.notification_deliveries WHERE event_type LIKE 'TICKET[_]EMAIL[_]%' AND status<>'sent' GROUP BY event_type,status,failure_code"))
        Console.WriteLine(JsonSerializer.Serialize((object)problem));
    throw new InvalidOperationException($"SQL/C# dispatch failed: sent={total}, unresolved={remaining}, authorizationCalls={http.TokenCalls}.");
}
var codec=scope.ServiceProvider.GetRequiredService<SurveyLinkCodec>();
var surveys=0;
foreach(var json in http.EmailBodies)
{
    using var body=JsonDocument.Parse(json);
    var recipient=body.RootElement.GetProperty("recipient").GetString();
    if(recipient is not ("student@example.test" or "owner@example.test")) throw new InvalidOperationException("Recipient was not resolved from synthetic profiles.");
    var html=body.RootElement.GetProperty("bodyEn").GetString()!;
    var link=System.Text.RegularExpressions.Regex.Match(html,"https://app\\.test/survey\\?data=([^\"<>]+)");
    if(link.Success)
    {
        if(!codec.TryRead(WebUtility.HtmlDecode(link.Groups[1].Value),out var reference,out var category) ||
           !reference.StartsWith("TEST-",StringComparison.Ordinal) || category is not ("Inquiry" or "Complaint" or "Alert" or "Suggestion"))
            throw new InvalidOperationException("Survey link failed encrypted round trip.");
        surveys++;
    }
}
if(surveys!=4)throw new InvalidOperationException($"Expected four category survey invitations; got {surveys}.");
if(await dispatcher.RunAsync(default)!=0 || http.EmailBodies.Count!=total)throw new InvalidOperationException("A repeated dispatcher pass duplicated mail.");
if(http.TokenCalls!=total)throw new InvalidOperationException("Each send must request gateway authorization.");
Console.WriteLine($"PASS: real SQL -> C# gateway authorization/dispatcher -> simulated Email API: {total} notifications accepted, {surveys} encrypted category surveys, no duplicates. No external email was sent.");

sealed class RecordingHttp:HttpMessageHandler,IHttpClientFactory
{
    public int TokenCalls;public List<string> EmailBodies {get;}=[];
    public HttpClient CreateClient(string name)=>new(this,false);
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
    {
        if(request.RequestUri!.ToString()=="https://gateway.test/token")
        {
            using var body=JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct));
            if(request.Headers.Authorization is not null || body.RootElement.GetProperty("clientId").GetString()!="test-client" ||
                body.RootElement.GetProperty("clientSecret").GetString()!="synthetic-gateway-secret" ||
                body.RootElement.GetProperty("userAccount").GetString() is not ("student" or "owner"))
                throw new InvalidOperationException("Wrong gateway authorization contract.");
            TokenCalls++;
            return new(HttpStatusCode.OK){Content=new StringContent("{\"token\":\"synthetic-gateway-access\",\"tokenType\":\"Bearer\"}")};
        }
        if(request.RequestUri.ToString()!="https://mail.test/general/Common/send-email" ||
            request.Headers.Authorization?.ToString()!="Bearer synthetic-gateway-access")
            throw new InvalidOperationException("Unexpected external request or wrong gateway token.");
        EmailBodies.Add(await request.Content!.ReadAsStringAsync(ct));
        return new(HttpStatusCode.OK){Content=new StringContent("{\"code\":200,\"message\":\"Email queued successfully\"}")};
    }
}
