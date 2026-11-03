using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Sanadi.Api.AI;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Tests;

// In-memory TTS/STT check with test digit sequences only. No student-profile access or saved audio.
public sealed class VoiceNumberPronunciationLiveTests(Xunit.Abstractions.ITestOutputHelper output)
{
    public sealed class LiveTheoryAttribute : TheoryAttribute
    {
        public LiveTheoryAttribute()
        {
            if (Environment.GetEnvironmentVariable("SANADI_LIVE_NUMBER_SPEECH_CHECKS") != "1")
                Skip = "Set SANADI_LIVE_NUMBER_SPEECH_CHECKS=1 to check digit pronunciation on the configured speech gateway.";
        }
    }

    [LiveTheory]
    [InlineData("en", "mira", "202000336")]
    [InlineData("en", "suhail", "202000336")]
    [InlineData("ar", "mira", "202000336")]
    [InlineData("ar", "suhail", "202000336")]
    [InlineData("en", "mira", "000010020")]
    [InlineData("en", "suhail", "000010020")]
    [InlineData("ar", "mira", "000010020")]
    [InlineData("ar", "suhail", "000010020")]
    [InlineData("en", "mira", "9876543210")]
    [InlineData("en", "suhail", "9876543210")]
    [InlineData("ar", "mira", "9876543210")]
    [InlineData("ar", "suhail", "9876543210")]
    [InlineData("en", "mira", "1111111")]
    [InlineData("en", "suhail", "1111111")]
    [InlineData("ar", "mira", "1111111")]
    [InlineData("ar", "suhail", "1111111")]
    public async Task Generated_audio_preserves_the_test_digits_in_a_transcription_check(string language, string agent, string expected)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Sanadi.Api", "appsettings.json")))
            directory = directory.Parent;
        Assert.NotNull(directory);
        var config = new ConfigurationBuilder().AddJsonFile(Path.Combine(directory.FullName, "Sanadi.Api", "appsettings.json")).Build();
        await using var db = new SqlConnection(config["SqlServer:ConnectionString"]);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        var cfg = await db.QuerySingleAsync(DbProc.Call("usp_Assistant_GetAiSettings", null, timeout.Token));
        Assert.True((bool)cfg.ai_enabled);
        var settings = new ConfiguredSpeech.Settings((string)cfg.api_url, (string)cfg.api_key);
        var transcription = OllamaVoiceTranscription.FromAiSettings(settings.Url, settings.Key);
        var userId = Guid.NewGuid();
        using var client = new HttpClient(new SpeechTrace(output));
        var text = language == "ar" ? $"الرقم هو {expected}." : $"The number is {expected}.";
        var wav = await ConfiguredSpeech.SpeakForCall(client, settings, text, language, agent, userId, timeout.Token);
        var recognized = await OllamaVoiceTranscription.Transcribe(client, transcription, wav, userId, timeout.Token, language);
        Assert.True(expected == Digits(recognized), $"Digit check failed: expected={expected}; recognized={recognized}");
    }

    // Test diagnostics contain synthetic speech only, never gateway addresses, credentials or headers.
    private sealed class SpeechTrace(Xunit.Abstractions.ITestOutputHelper output) : DelegatingHandler(new HttpClientHandler())
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            if (request.RequestUri!.AbsolutePath.EndsWith("/audio/speech"))
            {
                using var body = System.Text.Json.JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct));
                output.WriteLine("Synthesis: " + body.RootElement.GetProperty("input").GetString());
            }
            var response = await base.SendAsync(request, ct);
            if (response.IsSuccessStatusCode && request.RequestUri.AbsolutePath.EndsWith("/audio/transcriptions"))
            {
                using var body = System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
                output.WriteLine("Recognized: " + body.RootElement.GetProperty("text").GetString());
            }
            return response;
        }
    }

    private static string Digits(string text)
    {
        var words = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["zero"]="0", ["oh"]="0", ["one"]="1", ["two"]="2", ["three"]="3", ["four"]="4",
            ["five"]="5", ["six"]="6", ["seven"]="7", ["eight"]="8", ["nine"]="9",
            ["صفر"]="0", ["واحد"]="1", ["اثنان"]="2", ["اثنين"]="2", ["ثلاثة"]="3", ["اربعة"]="4",
            ["خمسة"]="5", ["ستة"]="6", ["سبعة"]="7", ["ثمانية"]="8", ["تسعة"]="9"
        };
        text = Regex.Replace(text, @"[\u064B-\u065F]", "").Replace('أ', 'ا').Replace('إ', 'ا');
        return string.Concat(Regex.Matches(text, @"[\p{L}\p{Nd}]+").Select(token =>
            token.Value.All(char.IsDigit) ? string.Concat(token.Value.Select(digit => (int)char.GetNumericValue(digit)))
            : words.GetValueOrDefault(token.Value, "")));
    }
}
