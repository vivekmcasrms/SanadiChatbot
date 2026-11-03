using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Sanadi.Api.AI;
using Sanadi.Api.Controllers;

namespace Sanadi.Api.Tests;

// Opt-in read-only probe: synthetic messages go only through classification.
// No conversation, student record, letter or other workflow is created.
public sealed class DirectConversationIntentLiveTests
{
    public sealed class LiveTheoryAttribute : TheoryAttribute
    {
        public LiveTheoryAttribute()
        {
            if (Environment.GetEnvironmentVariable("SANADI_LIVE_INTENT_CHECKS") != "1")
                Skip = "Set SANADI_LIVE_INTENT_CHECKS=1 to probe the configured gateway with synthetic messages.";
        }
    }

    [LiveTheory]
    [InlineData("I need an enrolment letter.", "en", "document")]
    [InlineData("ساعدني في العثور على كتاب في الذكاء الاصطناعي.", "ar", "library")]
    [InlineData("Help me find a book on artificial intelligence.", "en", "library")]
    [InlineData("Find a book about enrolment letters.", "en", "library")]
    [InlineData("أحتاج إلى خطاب التسجيل.", "ar", "document")]
    [InlineData("أريد شهادة القيد.", "ar", "document")]
    [InlineData("ممكن افادة تثبت اني طالب مسجل؟", "ar", "document")]
    [InlineData("Hello, how are you?", "en", "greeting")]
    [InlineData("يا هلا وغلا، شحالج؟", "ar", "greeting")]
    [InlineData("صباح النور يا ميرا", "ar", "greeting")]
    [InlineData("مرحبا، أريد خطاب التسجيل.", "ar", "document")]
    [InlineData("لا أريد إصدار أي مستند، فقط اشرح لي سياسة الجامعة.", "ar", null)]
    [InlineData("أريد خطاب تسجيل لطالب آخر.", "ar", null)]
    [InlineData("Give me another student's academic record.", "en", null)]
    [InlineData("mar7aba, keef 7alak?", "en", "greeting")]
    public async Task Configured_model_routes_equivalent_messages_without_running_workflows(string text, string language, string? expected)
    {
        var turn = AssistantController.NormalizeTurn(new(text,null,language,null));
        var decision = await Classify(turn.Message);
        var route = AssistantRouting.Resolve(decision,
            AssistantController.RoutingCandidates(AssistantRouting.Normalize(text), decision));
        if (expected is null) Assert.DoesNotContain(route.Handler, new[] { "document", "library", "greeting" });
        else Assert.True(expected == route.Handler, $"Expected {expected}, selected {route.Handler}; synthetic decision={System.Text.Json.JsonSerializer.Serialize(decision)}");
    }

    [LiveTheory]
    [MemberData(nameof(AssistantRoutingTests.Requests), MemberType = typeof(AssistantRoutingTests))]
    public async Task Configured_model_has_bilingual_and_mixed_language_intent_parity(string expected, string english, string arabic, string mixed)
    {
        foreach (var text in new[] { english, arabic, mixed })
        {
            var decision = await Classify(text);
            var route = AssistantRouting.Resolve(decision,
                AssistantController.RoutingCandidates(AssistantRouting.Normalize(text), decision));
            Assert.True(expected == route.Intent, $"Expected {expected}, selected {route.Intent}; synthetic text={text}; decision={System.Text.Json.JsonSerializer.Serialize(decision)}");
        }
    }

    [LiveTheory]
    [InlineData("Career Services", "appointment", "appointment")]
    [InlineData("الخدمات المهنية", "appointment", "appointment")]
    [InlineData("What is my GPA?", "appointment", "academic_status")]
    [InlineData("كم معدلي؟", "appointment", "academic_status")]
    [InlineData("HIST120", "textbook", "textbook")]
    public async Task Owned_workflow_continuations_do_not_capture_a_new_topic(string text,string pending,string expected)
    {
        object state = pending == "appointment"
            ? new { appointmentContext = new { awaitingService = true, serviceOptions = new[] { new { unitCode = "CAREER", label = "Career Services / الخدمات المهنية" } } } }
            : new { textbookContext = new { awaitingCourse = true, courseCodes = new[] { "HIST120" } } };
        var decision = await Classify(text,new { intent = pending,state },pending);
        var route = AssistantRouting.Resolve(decision,AssistantController.RoutingCandidates(AssistantRouting.Normalize(text),decision,pending),pending);
        Assert.True(route.Intent == expected,$"Expected {expected}; synthetic decision={System.Text.Json.JsonSerializer.Serialize(decision)}; route={route}");
    }

    [LiveTheory]
    [InlineData("What skills am I missing for those jobs?")]
    [InlineData("ما المهارات التي تنقصني لتلك الوظائف؟")]
    [InlineData("ما skills التي تنقصني لتلك jobs؟")]
    public async Task Repeated_career_questions_stay_career_across_appointment_states(string text)
    {
        object?[] states = [null,
            new { awaitingService = true, serviceOptions = new[] { new { unitCode = "CAREER", label = "Career Services / الخدمات المهنية" } } },
            new { unitCode = "CAREER", awaitingAssist = true, assistOffered = true },
            new { unitCode = "CAREER", offeredSlots = new[] { new { slotId = "test-slot", staffName = "Test Advisor", typeName = "Career counselling" } } }
        ];
        foreach (var state in states)
        for (var repeat = 0; repeat < 2; repeat++)
        {
            var pending = state is null ? null : "appointment";
            var decision = await Classify(text,state is null ? null : new { intent = pending, state = new { appointmentContext = state } },pending);
            var route = AssistantRouting.Resolve(decision,AssistantController.RoutingCandidates(AssistantRouting.Normalize(text),decision,pending),pending);
            Assert.True(route.Intent == "career_skill_gap",$"Expected career_skill_gap, selected {route.Intent}; synthetic state={System.Text.Json.JsonSerializer.Serialize(state)}; decision={System.Text.Json.JsonSerializer.Serialize(decision)}");
            Assert.False(AssistantRouting.ContinuesWorkflow(route,decision.Routing,pending));
        }
    }

    private static async Task<StudentProfileScopePolicy.Decision> Classify(string text,object? pendingWorkflow=null,string? pendingIntent=null)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Sanadi.Api", "appsettings.json")))
            directory = directory.Parent;
        Assert.NotNull(directory);
        var config = new ConfigurationBuilder()
            .AddJsonFile(Path.Combine(directory.FullName, "Sanadi.Api", "appsettings.json")).Build();
        await using var db = new SqlConnection(config["SqlServer:ConnectionString"]);
        using var handler = new ProbeHandler();
        using var http = new HttpClient(handler);
        var logger = new ProbeLogger();
        var policy = new StudentProfileScopePolicy(new Factory(http), config, logger);
        var evidence = AssistantController.RoutingCandidates(AssistantRouting.Normalize(text), new(StudentProfileScopePolicy.Scope.Unavailable),pendingIntent);
        var decision = await policy.Evaluate(db, Guid.NewGuid(), text, default, pendingWorkflow,evidence);
        Assert.True(decision.Scope != StudentProfileScopePolicy.Scope.Unavailable,
            $"{logger.Failure ?? "Classifier unavailable without an exception."}; synthetic classifier output={handler.Output}");
        return decision;
    }

    private sealed class Factory(HttpClient client) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => client;
    }

    private sealed class ProbeHandler() : DelegatingHandler(new HttpClientHandler())
    {
        public string? Output { get; private set; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var response = await base.SendAsync(request, ct);
            if (response.IsSuccessStatusCode)
            {
                using var json = System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
                if (json.RootElement.TryGetProperty("choices", out var choices) && choices.GetArrayLength() > 0 &&
                    choices[0].TryGetProperty("message", out var message) && message.TryGetProperty("content", out var content))
                    Output = content.GetString();
            }
            return response;
        }
    }

    private sealed class ProbeLogger : ILogger
    {
        public string? Failure { get; private set; }
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel level) => true;
        public void Log<TState>(LogLevel level, EventId id, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            // Diagnostics identify the failure without printing credentials, prompts or upstream bodies.
            if (exception is not null)
                Failure = $"{exception.GetType().Name}; inner={exception.InnerException?.GetType().Name}; sql={(exception as SqlException)?.Number}";
        }
    }
}
