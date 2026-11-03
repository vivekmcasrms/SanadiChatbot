using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace Sanadi.Api.AI;

/// <summary>In-memory reuse of fixed public welcomes, greetings and cues. Never stores student data.</summary>
public sealed class VoiceWelcomeAudio
{
    private sealed class Entry
    {
        internal readonly SemaphoreSlim Gate = new(1, 1);
        internal byte[]? Audio;
        internal string? SettingsKey;
        internal DateTimeOffset Expires;
    }
    private readonly ConcurrentDictionary<(string Agent, string Language, string Clip), Entry> entries = new();

    internal async Task<byte[]> Get(ConfiguredSpeech.Settings settings, string agent, string language,
        Func<string, CancellationToken, Task<byte[]>> synthesize, CancellationToken ct)
    {
        var text = VoiceCallGreeting.Text(agent, language); // Restricts the cache to the four public welcomes.
        return await GetClip(settings, agent, language, "welcome", text, synthesize, ct);
    }

    internal Task<byte[]> GetCue(ConfiguredSpeech.Settings settings, string agent, string language, string kind, int index,
        Func<string, CancellationToken, Task<byte[]>> synthesize, CancellationToken ct)
    {
        if (agent is not ("mira" or "suhail")) throw new ArgumentException("Invalid voice selection.");
        var text = VoiceProcessingCues.Text(kind, index, language);
        return GetClip(settings, agent, language, kind + index, text, synthesize, ct);
    }

    internal Task<byte[]> GetGreetingReply(ConfiguredSpeech.Settings settings, string agent, string language,
        Func<string, CancellationToken, Task<byte[]>> synthesize, CancellationToken ct)
    {
        if (agent is not ("mira" or "suhail") || language is not ("en" or "ar"))
            throw new ArgumentException("Invalid voice selection.");
        return GetClip(settings, agent, language, "greeting/reply", ConversationalTurn.GreetingReply("Hello", language)!, synthesize, ct);
    }

    internal byte[]? ReadyGreetingReply(ConfiguredSpeech.Settings settings, string agent, string language)
    {
        if (!entries.TryGetValue((agent, language, "greeting/reply"), out var entry) || !entry.Gate.Wait(0)) return null;
        try
        {
            return entry.Audio is not null && entry.SettingsKey == SettingsKey(settings) && entry.Expires > DateTimeOffset.UtcNow
                ? entry.Audio : null;
        }
        finally { entry.Gate.Release(); }
    }

    private static string SettingsKey(ConfiguredSpeech.Settings settings) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(settings.Url + "\n" + settings.Key)));

    internal static bool IsFixedGreeting(JsonObject result, string question, string agent, string language) =>
        result["verified"]?.GetValue<bool>() == true &&
        result["toolsUsed"] is JsonArray tools && tools.Any(tool => (string?)tool == "greeting") &&
        ConversationalTurn.ImmediateGreetingReply(question, language, agent) is { } expected &&
        (string?)result["answer"] == expected;

    // Use the same splitter as live replies; otherwise prepared audio would miss the actual chunks.
    internal static async Task<string[]> StandardGreetingSegments(string agent, string language)
    {
        if (agent is not ("mira" or "suhail") || language is not ("en" or "ar"))
            throw new ArgumentException("Invalid voice selection.");
        var result = new JsonObject { ["answer"] = ConversationalTurn.GreetingReply("Hello", language),
            ["toolsUsed"] = new JsonArray("greeting") };
        var segments = new List<string>();
        var sentences = new VoiceSentences(language, sentence => { segments.Add(sentence); return Task.CompletedTask; },
            firstChunkChars: 160, naturalPhrasing: true, separateFirstSentence: true);
        await sentences.Push(VoiceReplyNarration.Overview(result, "Hello", language), final: true);
        return segments.ToArray();
    }

    internal Task<byte[]> GetGreeting(ConfiguredSpeech.Settings settings, string agent, string language,
        string question, string sentence, bool introduce,
        Func<string, CancellationToken, Task<byte[]>> synthesize, CancellationToken ct)
    {
        if (agent is not ("mira" or "suhail") || language is not ("en" or "ar"))
            throw new ArgumentException("Invalid voice selection.");
        var reply = ConversationalTurn.ImmediateGreetingReply(question, language, agent);
        var prefix = VoiceCallDelivery.Introduction(agent, language);
        var content = introduce && sentence.StartsWith(prefix, StringComparison.Ordinal) ? sentence[prefix.Length..] : sentence;
        // Only server-owned public template text is eligible. Model output and student replies use normal TTS.
        if (reply is null || string.IsNullOrWhiteSpace(content) ||
            !VoiceSpeechFormatter.ToSpeech(reply, language).Contains(content, StringComparison.Ordinal))
            return synthesize(sentence, ct);
        var clip = "greeting/" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sentence)));
        return GetClip(settings, agent, language, clip, sentence, synthesize, ct);
    }

    private async Task<byte[]> GetClip(ConfiguredSpeech.Settings settings, string agent, string language, string clip, string text,
        Func<string, CancellationToken, Task<byte[]>> synthesize, CancellationToken ct)
    {
        var key = SettingsKey(settings);
        var entry = entries.GetOrAdd((agent, language, clip), _ => new());
        await entry.Gate.WaitAsync(ct);
        try
        {
            ct.ThrowIfCancellationRequested();
            if (entry.Audio is not null && entry.SettingsKey == key && entry.Expires > DateTimeOffset.UtcNow)
                return entry.Audio;
            var audio = await synthesize(text, ct);
            ct.ThrowIfCancellationRequested();
            var limit = clip == "welcome" || clip.StartsWith("greeting/", StringComparison.Ordinal)
                ? ConfiguredSpeech.MaximumWavBytes : 1_000_000;
            if (!ConfiguredSpeech.ValidWave(audio) || audio.Length > limit)
                throw new InvalidOperationException("Invalid welcome audio.");
            entry.Audio = audio;
            entry.SettingsKey = key;
            entry.Expires = DateTimeOffset.UtcNow.AddMinutes(20);
            return audio;
        }
        finally { entry.Gate.Release(); }
    }
}
