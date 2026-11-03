using System.Net;
using System.Text.Json;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Sanadi.Api.Notifications;
using Sanadi.Infrastructure;

// Opt-in, one-email operator probe. It never discovers/replays the live queue,
// creates a ticket, changes settings, or logs credentials/tokens. Email requests and
// responses are written to the API's local text diagnostics, with secrets redacted.
if (args.Length != 7 || args[0] != "--send-one-test-email" || args[1] != "--settings-file" ||
    args[3] != "--actor-email" || args[5] != "--recipient")
    throw new ArgumentException("Usage: --send-one-test-email --settings-file <path> --actor-email <signed-in university email> --recipient <approved test recipient>");
var config = new ConfigurationBuilder().AddJsonFile(Path.GetFullPath(args[2]),optional:false).Build();
using var services = new ServiceCollection().AddLogging().AddSingleton<IConfiguration>(config)
    .AddSanadiInfrastructure(config).BuildServiceProvider();
await using var db = new SqlConnection(config["SqlServer:ConnectionString"]);
var actor = await db.QuerySingleOrDefaultAsync<Guid?>("SELECT id FROM auth.users WHERE email=@email;",new { email=args[4] })
    ?? throw new InvalidOperationException("The specified actor is not a registered university account.");
var repository = new TicketEmailRepository(services.GetRequiredService<Sanadi.Infrastructure.Persistence.ISqlConnectionFactory>());
var settings = await repository.SettingsAsync(config.GetValue<bool>("SsoRouting:IsProductionEntry"),default)
    ?? throw new InvalidOperationException("Email settings are unavailable.");
var contextRepository = new UniversityEmailAuthorizationRepository(services.GetRequiredService<Sanadi.Infrastructure.Persistence.ISqlConnectionFactory>());
var emailLog = new EmailApiFileLog(Path.Combine(Path.GetDirectoryName(Path.GetFullPath(args[2]))!, "App_Data", "logs", "email"));
using var http = new OneEmailHttp(emailLog);
var authorization = new UniversityEmailAuthorization(contextRepository,http,config);
var item = new TicketEmailEvent(Guid.NewGuid(),"case","EMAIL-TEST-"+DateTimeOffset.UtcNow.ToString("yyyyMMdd-HHmmss"),
    "Complaint","Notification gateway test","test",null,actor,"created",DateTimeOffset.UtcNow);
var probe = new ProbeRepository(settings,new TicketEmailDelivery(Guid.NewGuid(),
    JsonSerializer.Serialize(item,new JsonSerializerOptions(JsonSerializerDefaults.Web)),Guid.NewGuid(),args[6],"Test recipient",
    "Sanadi notification gateway test — {ReferenceNumber}",null,
    "<p>This is the single authorized Sanadi email notification test.</p><p>No ticket was created or changed.</p><p>Reference: {ReferenceNumber}</p>",
    "<p>هذه رسالة اختبار لإشعارات سندي. لم يتم إنشاء أي طلب أو تغييره.</p>","operator-test"));
var sent = await new TicketEmailDispatcher(probe,authorization,new NoSurvey(),http,config).RunAsync(default);
Console.WriteLine(JsonSerializer.Serialize(new
{
    reference=item.ReferenceNumber,recipient=args[6],status=probe.Status ?? "not_attempted",code=probe.Code,
    emailRequests=http.EmailRequests,acceptedByEmailApi=sent==1,providerDiagnostic=http.Diagnostic,
    logDirectory=emailLog.DirectoryPath
}));
if (sent!=1) Environment.ExitCode=1;

sealed class ProbeRepository(TicketEmailSettings settings,TicketEmailDelivery delivery):ITicketEmailRepository
{
    private bool claimed;
    public string? Status,Code;
    public Task<TicketEmailSettings?> SettingsAsync(bool p,CancellationToken ct)=>Task.FromResult<TicketEmailSettings?>(settings);
    public Task DiscoverAsync(CancellationToken ct)=>Task.CompletedTask;
    public Task<TicketEmailDelivery?> ClaimAsync(CancellationToken ct)
    { if(claimed)return Task.FromResult<TicketEmailDelivery?>(null);claimed=true;return Task.FromResult<TicketEmailDelivery?>(delivery); }
    public Task CompleteAsync(Guid id,string status,string? code,CancellationToken ct)
    { Status=status;Code=code;return Task.CompletedTask; }
}
sealed class NoSurvey:ITicketSurveyLinks
{
    public Task<string> CreateAsync(TicketEmailEvent e,string url,CancellationToken ct)=>throw new InvalidOperationException("This probe cannot send surveys.");
}
sealed class OneEmailHttp:IHttpClientFactory,IDisposable
{
    private readonly HttpClient authorization=new(new HttpClientHandler { AllowAutoRedirect=false })
        { Timeout=TimeSpan.FromSeconds(30),MaxResponseContentBufferSize=64*1024 };
    private readonly CountingHandler handler=new();
    private readonly HttpClient email;
    public int EmailRequests=>handler.Calls;
    public string? Diagnostic=>handler.Diagnostic;
    public OneEmailHttp(EmailApiFileLog log)=>email=new(new EmailApiLoggingHandler(log) { InnerHandler=handler })
        { Timeout=TimeSpan.FromSeconds(30) };
    public HttpClient CreateClient(string name)=>name switch
    {
        "UniversityEmailAuthorization"=>authorization,"UniversityEmail"=>email,
        _=>throw new InvalidOperationException("Unexpected HTTP client.")
    };
    public void Dispose() { authorization.Dispose();email.Dispose(); }
    private sealed class CountingHandler:DelegatingHandler
    {
        public int Calls;
        public string? Diagnostic;
        public CountingHandler():base(new HttpClientHandler { AllowAutoRedirect=false }) { }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
        {
            if(Interlocked.Increment(ref Calls)!=1)throw new InvalidOperationException("Only one email request is permitted.");
            var response=await base.SendAsync(request,ct);
            if(!response.IsSuccessStatusCode)
            {
                try
                {
                    using var json=JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
                    if(json.RootElement.ValueKind==JsonValueKind.Object)
                    {
                        var fields=json.RootElement.EnumerateObject()
                            .Where(p=>p.Name is "message" or "title" or "errors")
                            .Select(p=>p.Name+": "+p.Value.ToString());
                        var diagnostic=string.Join("; ",fields);
                        if(request.Headers.Authorization?.Parameter is { Length: > 0 } token)
                            diagnostic=diagnostic.Replace(token,"[redacted]",StringComparison.Ordinal);
                        diagnostic=System.Text.RegularExpressions.Regex.Replace(diagnostic,
                            @"(?i)Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+","[redacted]");
                        Diagnostic=diagnostic.Length>1024?diagnostic[..1024]:diagnostic;
                    }
                }
                catch(JsonException) { Diagnostic="Non-JSON gateway error response."; }
            }
            return response;
        }
    }
}
