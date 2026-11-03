using System.Runtime.Versioning;
using System.Speech.Synthesis;

namespace Sanadi.Api.AI;

/// <summary>One server synthesis path. Never replaces the selected gender or spoken language.</summary>
public sealed class AdvisorSpeech(PrivateVoiceService privateSpeech, IConfiguration config)
{
    private static readonly SemaphoreSlim Capacity = new(2);
    public bool Enabled => privateSpeech.Enabled;
    public bool Available => Enabled && (privateSpeech.Configured || OperatingSystem.IsWindows());

    public async Task<byte[]> Speak(string text, string language, string agent, CancellationToken ct)
    {
        if (!privateSpeech.Enabled) throw new InvalidOperationException("voice_disabled");
        if (agent is not ("mira" or "suhail") || language is not ("ar" or "en") || text.Length is < 1 or > 6000)
            throw new InvalidOperationException("invalid_speech");
        if (privateSpeech.Configured) return await privateSpeech.Speak(text, language, agent, ct);
        if (!OperatingSystem.IsWindows()) throw new InvalidOperationException("server_tts_not_configured");
        await Capacity.WaitAsync(ct);
        try { return await WindowsSpeech(text, language, agent, ct); }
        finally { Capacity.Release(); }
    }

    [SupportedOSPlatform("windows")]
    private async Task<byte[]> WindowsSpeech(string text, string language, string agent, CancellationToken ct)
    {
        using var synthesizer = new SpeechSynthesizer();
        var gender = agent == "mira" ? VoiceGender.Female : VoiceGender.Male;
        var configured = config[agent == "mira" ? "Voice:WindowsFemaleVoice" : "Voice:WindowsMaleVoice"];
        var voices = synthesizer.GetInstalledVoices().Where(v => v.Enabled).Select(v => v.VoiceInfo)
            .Where(v => v.Gender == gender && v.Culture.TwoLetterISOLanguageName == language);
        var voice = string.IsNullOrWhiteSpace(configured)
            ? voices.OrderByDescending(v => v.Culture.Name.Equals($"{language}-AE", StringComparison.OrdinalIgnoreCase)).FirstOrDefault()
            : voices.FirstOrDefault(v => v.Name.Equals(configured, StringComparison.OrdinalIgnoreCase));
        if (voice is null) throw new InvalidOperationException($"voice_missing_{language}");
        synthesizer.SelectVoice(voice.Name);
        synthesizer.Rate = 0;
        using var output = new MemoryStream();
        synthesizer.SetOutputToWaveStream(output);
        var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        synthesizer.SpeakCompleted += (_, e) =>
        {
            if (e.Cancelled) done.TrySetCanceled(ct);
            else if (e.Error is not null) done.TrySetException(e.Error);
            else done.TrySetResult();
        };
        ct.ThrowIfCancellationRequested();
        synthesizer.SpeakAsync(text);
        using var abort = ct.Register(synthesizer.SpeakAsyncCancelAll);
        await done.Task;
        ct.ThrowIfCancellationRequested();
        synthesizer.SetOutputToNull(); // Finalize RIFF lengths before sending.
        return output.ToArray();
    }
}
