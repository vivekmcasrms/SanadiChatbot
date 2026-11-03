using Sanadi.Api.AI;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.Tests;

public sealed class VoiceInputSpeechGuardTests
{
    [Theory]
    [InlineData("silence")]
    [InlineData("tone")]
    [InlineData("noise")]
    public async Task Non_speech_returns_empty_without_database_or_recognition_calls(string kind)
    {
        var random = new Random(42);
        var samples = Enumerable.Range(0, 16000 * 3).Select(i => (short)(kind switch
        {
            "tone" => 4000 * Math.Sin(2 * Math.PI * 440 * i / 16000),
            "noise" => 1000 * (random.NextDouble() * 2 - 1),
            _ => 0d
        })).ToArray();
        var wav = Wave(samples);
        var original = wav.ToArray();
        using var detector = new VoiceActivityDetector();
        // Null dependencies deliberately fail if non-speech reaches SQL or HTTP.
        var transcriber = new OllamaVoiceTranscription(null!, null!, detector);
        foreach (var language in new[] { "en", "ar", "auto" })
            Assert.Equal("", await transcriber.Transcribe(wav, Guid.NewGuid(), default, language));
        Assert.Equal(original, wav);
    }

    [Fact]
    public void Other_recording_formats_keep_provider_validation()
    {
        Assert.Null(VoiceInputSpeechGuard.HasSpeech([1, 2, 3], null, default));
        Assert.Null(VoiceInputSpeechGuard.HasSpeech(Wave(new short[4096], 24000), null, default));
        var truncated = Wave(new short[4096])[..^1];
        Assert.Null(VoiceInputSpeechGuard.HasSpeech(truncated, null, default));
    }

    [Fact]
    public async Task Authentication_and_cancellation_are_checked_before_silence_is_accepted()
    {
        var transcriber = new OllamaVoiceTranscription(null!, null!);
        await Assert.ThrowsAsync<UnauthorizedException>(() => transcriber.Transcribe(Wave(new short[4096]), Guid.Empty, default));
        using var stop = new CancellationTokenSource();
        stop.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            transcriber.Transcribe(Wave(new short[4096]), Guid.NewGuid(), stop.Token));
    }

    private static byte[] Wave(short[] samples, int rate = 16000)
    {
        using var output = new MemoryStream();
        using var writer = new BinaryWriter(output);
        writer.Write("RIFF"u8); writer.Write(samples.Length * 2 + 36); writer.Write("WAVEfmt "u8);
        writer.Write(16); writer.Write((short)1); writer.Write((short)1);
        writer.Write(rate); writer.Write(rate * 2); writer.Write((short)2); writer.Write((short)16);
        writer.Write("data"u8); writer.Write(samples.Length * 2);
        foreach (var sample in samples) writer.Write(sample);
        return output.ToArray();
    }
}
