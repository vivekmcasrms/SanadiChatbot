using System.Diagnostics;
using System.Text.Json;
using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using Sanadi.Api.AI;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.AppFunctions;
using Sanadi.Infrastructure.Options;
using Sanadi.Infrastructure.Persistence;

// Read-only database access. Only synthetic test phrases go to the university
// gateway, in memory. Never stores audio, transcripts, keys or settings to disk.
if (args.Length != 1 && !(args.Length == 3 && args[1] == "--probe-formats") &&
    !(args.Length == 2 && args[1] == "--probe-greeting-latency"))
    throw new ArgumentException("Pass the API appsettings.json path, optionally --probe-formats and a synthetic WAV path.");
var config = new ConfigurationBuilder().AddJsonFile(Path.GetFullPath(args[0]), false).Build();
var sql = new SqlConnectionFactory(Options.Create(new SqlOptions
{ ConnectionString = config["SqlServer:ConnectionString"] ?? throw new InvalidOperationException("SQL settings missing.") }));
await using (var db = sql.Create())
{
    var gateway = await db.QueryFirstOrDefaultAsync(DbProc.Call("usp_Assistant_GetAiSettings", null));
    if (gateway is null || gateway.ai_enabled is not true ||
        !Uri.TryCreate((string?)gateway.api_url, UriKind.Absolute, out var endpoint) ||
        endpoint.Scheme != "https" || !endpoint.Host.Equals("inferencellm.uaeu.ac.ae", StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("Test is restricted to the configured university AI gateway.");
}
using var clients = new PrivateClients();
if (args.Length == 2)
{
    await GreetingLatencyProbe.Run(sql, clients, config);
    return;
}
if (args.Length == 3)
{
    await TranscriptionFormatProbe.Run(sql, clients.CreateClient("VoiceTranscription"), args[2]);
    return;
}
var synthesis = new VoiceSpeechSynthesis(new ConfiguredSpeech(sql, clients));
var recognition = new VoiceTranscriptionService(new OllamaVoiceTranscription(sql, clients));
var user = Guid.NewGuid(); // Synthetic test identity, never a student's account.
foreach (var test in new[]
{
    (Language: "en", Agent: "suhail", Phrase: "What are the library opening hours?", Keyword: "library"),
    (Language: "ar", Agent: "mira", Phrase: "مرحبا، أريد معرفة مواعيد عمل المكتبة.", Keyword: "مكتب")
})
{
    using var stop = new CancellationTokenSource(TimeSpan.FromMinutes(2));
    var timer = Stopwatch.StartNew();
    try
    {
        var (audio, _) = await synthesis.Speak(test.Phrase, test.Language, test.Agent, user, stop.Token);
        var generatedMs = timer.ElapsedMilliseconds;
        var input = JsonSerializer.SerializeToElement(new { audioBase64 = Convert.ToBase64String(audio), language = test.Language });
        var result = JsonSerializer.SerializeToElement(await recognition.Transcribe(new FunctionInput(input), user, stop.Token));
        var text = result.GetProperty("text").GetString() ?? "";
        if (string.IsNullOrWhiteSpace(text) || !text.Contains(test.Keyword, StringComparison.OrdinalIgnoreCase))
        {
            Console.WriteLine(JsonSerializer.Serialize(new { language = test.Language, success = false, code = "test_transcript_mismatch", transcript = text }));
            Environment.ExitCode = 1;
            continue;
        }
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            language = test.Language, success = true, model = "whisper-large-v3", transcript = text,
            audioBytes = audio.Length, ttsMs = generatedMs, sttMs = timer.ElapsedMilliseconds - generatedMs
        }));
    }
    catch (SanadiException error)
    {
        Console.WriteLine(JsonSerializer.Serialize(new { language = test.Language, success = false, code = error.Code, status = error.StatusCode }));
        Environment.ExitCode = 1;
    }
    catch (Exception error)
    {
        Console.WriteLine(JsonSerializer.Serialize(new { language = test.Language, success = false, errorType = error.GetType().Name }));
        Environment.ExitCode = 1;
    }
}

sealed class PrivateClients : IHttpClientFactory, IDisposable
{
    private readonly HttpClient client = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(60) };
    public HttpClient CreateClient(string name) => client;
    public void Dispose() => client.Dispose();
}
