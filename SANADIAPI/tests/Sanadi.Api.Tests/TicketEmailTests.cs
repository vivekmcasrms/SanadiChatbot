using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Sanadi.Api.Notifications;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.Tests;

public sealed class TicketEmailTests
{
    [Theory]
    [InlineData("Inquiry")][InlineData("Complaint")][InlineData("Alert")][InlineData("Suggestion")]
    public async Task Creation_sends_to_database_recipient_with_configured_API_and_gateway_token(string category)
    {
        using var f=new Fixture(category,"created");
        Assert.Equal(1,await f.Run());
        Assert.Equal("https://mail.test/general/Common/send-email",f.Http.Url);
        Assert.Equal("Bearer gateway-actor-token",f.Http.Authorization);
        using var body=JsonDocument.Parse(f.Http.Body!);
        Assert.Equal("student@example.test",body.RootElement.GetProperty("recipient").GetString());
        Assert.Equal("configured-app",body.RootElement.GetProperty("app").GetString());
        Assert.Equal("template",body.RootElement.GetProperty("template").GetString());
        Assert.Equal("",body.RootElement.GetProperty("bodyAr").GetString());
        Assert.Contains("&lt;script&gt;",body.RootElement.GetProperty("bodyEn").GetString());
        Assert.DoesNotContain("<script>",body.RootElement.GetProperty("bodyEn").GetString());
        Assert.Equal(f.Event.ActorId,f.Tokens.RequestedUser);
        Assert.Equal("sent",Assert.Single(f.Repo.Outcomes).status);
    }
    [Theory]
    [InlineData("Inquiry")][InlineData("Complaint")][InlineData("Alert")][InlineData("Suggestion")]
    public async Task Closure_survey_uses_category_link_and_acceptance_is_recorded(string category)
    {
        using var f=new Fixture(category,"survey");
        Assert.Equal(1,await f.Run());
        Assert.Equal(category,f.Surveys.Category);
        Assert.Contains("/survey?data=opaque",f.Http.Body);
        Assert.DoesNotContain("gateway-actor-token",f.Http.Body);
    }
    [Fact]
    public async Task Owner_notification_uses_owner_profile_not_requester_or_test_override()
    {
        using var f=new Fixture("Complaint","assigned");
        f.Repo.Delivery=f.Repo.Delivery! with{RecipientEmail="owner@example.test"};
        await f.Run(); Assert.Contains("owner@example.test",f.Http.Body);
    }
    [Fact]
    public async Task Superseded_assignment_never_notifies_the_old_owner()
    {
        using var f=new Fixture("Complaint","assigned");
        f.Repo.Delivery=f.Repo.Delivery! with{RecipientCurrent=false};
        Assert.Equal(0,await f.Run());Assert.Equal(0,f.Http.Calls);
        Assert.Equal("email_assignment_superseded",Assert.Single(f.Repo.Outcomes).code);
    }
    [Theory]
    [InlineData(false,false)][InlineData(true,true)]
    public async Task Disabled_or_demo_mode_does_not_discover_claim_or_send(bool enabled,bool demo)
    {
        using var f=new Fixture("Alert","created"); f.Repo.Settings=f.Repo.Settings with{Enabled=enabled,DemoMode=demo};
        Assert.Equal(0,await f.Run());Assert.Equal(0,f.Http.Calls);Assert.Equal(0,f.Repo.Discoveries);Assert.NotNull(f.Repo.Delivery);
    }
    [Fact]
    public async Task Gateway_authorization_failure_keeps_notification_retryable_without_calling_email_API()
    {
        using var f=new Fixture("Inquiry","created");f.Tokens.Fail=true;
        Assert.Equal(0,await f.Run());Assert.Equal(0,f.Http.Calls);
        Assert.Equal("retrying",Assert.Single(f.Repo.Outcomes).status);
    }
    [Fact]
    public async Task Missing_survey_configuration_never_sends_a_broken_link()
    {
        using var f=new Fixture("Suggestion","survey");f.Surveys.Fail=true;
        Assert.Equal(0,await f.Run());Assert.Equal(0,f.Http.Calls);
    }
    [Fact]
    public async Task Timeout_after_send_has_uncertain_outcome_and_is_not_replayed()
    {
        using var f=new Fixture("Complaint","created");f.Http.Timeout=true;
        Assert.Equal(0,await f.Run());Assert.Equal("uncertain",Assert.Single(f.Repo.Outcomes).status);
        Assert.Equal(0,await f.Run());Assert.Equal(1,f.Http.Calls);
    }
    [Theory]
    [InlineData(401,"retrying")][InlineData(400,"failed")][InlineData(503,"uncertain")]
    public async Task HTTP_failure_is_not_recorded_as_sent(int code,string expected)
    {
        using var f=new Fixture("Alert","created");f.Http.Status=(HttpStatusCode)code;
        Assert.Equal(0,await f.Run());Assert.Equal(expected,Assert.Single(f.Repo.Outcomes).status);
    }
    [Theory]
    [InlineData("{\"success\":false}")]
    [InlineData("{\"code\":400,\"message\":\"Rejected\"}")]
    [InlineData("{\"code\":\"invalid\"}")]
    public async Task Explicit_provider_failure_in_HTTP_200_is_not_success(string response)
    {
        using var f=new Fixture("Inquiry","created");f.Http.Response=response;
        Assert.Equal(0,await f.Run());Assert.Equal("failed",Assert.Single(f.Repo.Outcomes).status);
    }
    private sealed class Fixture:IDisposable
    {
        public Repo Repo=new();public Tokens Tokens=new();public Surveys Surveys=new();public Http Http=new();public TicketEmailEvent Event;
        public Fixture(string category,string action)
        {
            Event=new(Guid.NewGuid(),category=="Suggestion"?"suggestion":"case","REQ-TEST",category,"<script>alert('x')</script>",action=="survey"?"closed":"assigned","Public reply",Guid.NewGuid(),action,DateTimeOffset.UtcNow);
            Repo.Delivery=new(Guid.NewGuid(),JsonSerializer.Serialize(Event,new JsonSerializerOptions(JsonSerializerDefaults.Web)),Guid.NewGuid(),"student@example.test","Student","{Category} {ReferenceNumber}",null,"<p>{Subject}</p><a href=\"{TicketUrl}\">Request</a><a href=\"{SurveyUrl}\">Survey</a>",null,"test");
        }
        public Task<int> Run()=>new TicketEmailDispatcher(Repo,Tokens,Surveys,Http,new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{{"SsoRouting:IsProductionEntry","false"}}).Build()).RunAsync(default);
        public void Dispose()=>Http.Dispose();
    }
    private sealed class Repo:ITicketEmailRepository
    {
        public TicketEmailSettings Settings=new("https://mail.test/general","configured-app","https://app.test",null,null,"template","configured-email-client",true,false);
        public TicketEmailDelivery? Delivery;public int Discoveries;public List<(string status,string? code)> Outcomes=[];
        public Task<TicketEmailSettings?> SettingsAsync(bool p,CancellationToken ct)=>Task.FromResult<TicketEmailSettings?>(Settings);
        public Task DiscoverAsync(CancellationToken ct){Discoveries++;return Task.CompletedTask;}
        public Task<TicketEmailDelivery?> ClaimAsync(CancellationToken ct){var d=Delivery;Delivery=null;return Task.FromResult(d);}
        public Task CompleteAsync(Guid id,string s,string? c,CancellationToken ct){Outcomes.Add((s,c));return Task.CompletedTask;}
    }
    private sealed class Tokens:IUniversityEmailAuthorization
    {
        public bool Fail;public Guid RequestedUser;
        public Task<string> GetAsync(Guid actor,CancellationToken ct){RequestedUser=actor;if(Fail)throw new SanadiException("Unavailable",503,"email_authorization_http_401");return Task.FromResult("gateway-actor-token");}
    }
    private sealed class Surveys:ITicketSurveyLinks
    {
        public string? Category;public bool Fail;
        public Task<string> CreateAsync(TicketEmailEvent e,string u,CancellationToken ct){Category=e.Category;if(Fail)throw new SanadiException("Missing",503,"survey_not_configured");return Task.FromResult(u+"/survey?data=opaque");}
    }
    private sealed class Http:HttpMessageHandler,IHttpClientFactory
    {
        public string? Url,Body,Authorization;public int Calls;public bool Timeout;public HttpStatusCode Status=HttpStatusCode.OK;public string Response="{\"code\":200,\"message\":\"Email queued successfully\"}";
        public HttpClient CreateClient(string name)=>new(this,false);
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
        {Calls++;Url=request.RequestUri!.ToString();Body=await request.Content!.ReadAsStringAsync(ct);Authorization=request.Headers.Authorization?.ToString();if(Timeout)throw new TaskCanceledException();return new(Status){Content=new StringContent(Response)};}
    }
}
