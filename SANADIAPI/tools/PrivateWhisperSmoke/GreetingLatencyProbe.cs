using System.Diagnostics;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Sanadi.Api.AI;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

internal static class GreetingLatencyProbe
{
    // Read-only configuration access and synthetic public phrases. No chat records,
    // credentials, recordings or transcripts are written by this probe.
    internal static async Task Run(ISqlConnectionFactory sql, IHttpClientFactory clients, IConfiguration config)
    {
        var speech = new VoiceSpeechSynthesis(new ConfiguredSpeech(sql, clients));
        var recognition = new OllamaVoiceTranscription(sql, clients);
        var translator = new VoiceTranscriptTranslator(sql, clients, config, NullLogger<VoiceTranscriptTranslator>.Instance);
        foreach (var sample in new[] { (Language: "en", Agent: "mira", Text: "Hello Mira"),
                     (Language: "ar", Agent: "suhail", Text: "مرحبا يا سهيل") })
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(90));
            try
            {
                var user = Guid.NewGuid();
                var timer = Stopwatch.StartNew();
                var (wav, _) = await speech.Speak(sample.Text, sample.Language, sample.Agent, user, timeout.Token);
                Console.WriteLine(JsonSerializer.Serialize(new { stage = "synthetic_audio", language = sample.Language,
                    elapsedMs = timer.ElapsedMilliseconds, bytes = wav.Length }));
                for (var attempt = 1; attempt <= 2; attempt++)
                {
                    timer.Restart();
                    var text = await recognition.Transcribe(wav, user, timeout.Token, "auto");
                    var recognitionMs = timer.ElapsedMilliseconds;
                    timer.Restart();
                    var translated = await translator.Translate(text, sample.Language, user, timeout.Token);
                    Console.WriteLine(JsonSerializer.Serialize(new { stage = "recognition", language = sample.Language, attempt,
                        recognitionMs, translationMs = timer.ElapsedMilliseconds,
                        recognized = !string.IsNullOrWhiteSpace(text), unchanged = text == translated }));
                }
            }
            catch (Exception error)
            {
                Console.WriteLine(JsonSerializer.Serialize(new { stage = "failed", language = sample.Language,
                    errorType = error.GetType().Name, code = (error as SanadiException)?.Code }));
                Environment.ExitCode = 1;
            }
        }
    }
}
