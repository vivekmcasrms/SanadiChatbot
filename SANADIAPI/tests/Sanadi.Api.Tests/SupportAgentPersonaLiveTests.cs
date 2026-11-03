using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Sanadi.Api.AI;
using Sanadi.Api.Controllers;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Tests;

// Synthetic social messages only: no student records, conversations or service actions.
public sealed class SupportAgentPersonaLiveTests
{
    public sealed class LiveTheoryAttribute : TheoryAttribute
    {
        public LiveTheoryAttribute()
        {
            if (Environment.GetEnvironmentVariable("SANADI_LIVE_PERSONA_CHECKS") != "1")
                Skip = "Set SANADI_LIVE_PERSONA_CHECKS=1 to verify the selected advisor with the configured university model.";
        }
    }

    [LiveTheory]
    [InlineData("mira", "en", "How are you Mira?", false)]
    [InlineData("suhail", "en", "How are you Suhail?", false)]
    [InlineData("mira", "ar", "كيف حالك يا ميرا؟", false)]
    [InlineData("suhail", "ar", "كيف حالك يا سهيل؟", false)]
    [InlineData("mira", "en", "Who are you?", true)]
    [InlineData("suhail", "en", "Who are you?", true)]
    [InlineData("mira", "ar", "ما اسمك؟", true)]
    [InlineData("suhail", "ar", "ما اسمك؟", true)]
    public async Task Configured_model_keeps_the_selected_advisor(string agent, string language, string question, bool needsName)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Sanadi.Api", "appsettings.json")))
            directory = directory.Parent;
        Assert.NotNull(directory);
        var config = new ConfigurationBuilder().AddJsonFile(Path.Combine(directory.FullName, "Sanadi.Api", "appsettings.json")).Build();
        await using var db = new SqlConnection(config["SqlServer:ConnectionString"]);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(45));
        var cfg = await db.QuerySingleAsync(DbProc.Call("usp_Assistant_GetAiSettings", null, timeout.Token));
        Assert.True((bool)cfg.ai_enabled);
        var provider = AiProviderChat.Resolve((string)cfg.provider);
        Assert.NotNull(provider);
        using var client = new HttpClient();
        using var request = AiProviderChat.CreateRequest(provider.Value, (string)cfg.api_url, (string)cfg.api_key,
            Guid.NewGuid(), (string)cfg.model_name, SupportAgentPersona.GreetingPrompt(question, language, agent),
            (decimal)cfg.temperature, 512, cfg.enable_thinking is null ? null : Convert.ToBoolean(cfg.enable_thinking));
        using var response = await client.SendAsync(request, timeout.Token);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
        var answer = AiProviderChat.ReadText(provider.Value, json.RootElement);
        Assert.False(string.IsNullOrWhiteSpace(answer));
        Assert.Equal(language, AssistantController.ReplyLanguage(answer!, null));
        var wrongName = SupportAgentPersona.Name(agent == "mira" ? "suhail" : "mira", language);
        Assert.DoesNotContain(wrongName, answer!, StringComparison.OrdinalIgnoreCase);
        Assert.False(Regex.IsMatch(answer!, @"(?:my name is|I am|I'm)\s+(?:Sanadi|the Sanadi)|(?:اسمي|أنا|انا)\s+(?:سندي|سنادي)|mix[- ]?up|confusion", RegexOptions.IgnoreCase), answer);
        if (needsName)
            Assert.True(answer!.Contains(SupportAgentPersona.Name(agent, language), StringComparison.OrdinalIgnoreCase) ||
                agent == "mira" && language == "en" && answer.Contains("Mira", StringComparison.OrdinalIgnoreCase), answer);
    }
}
