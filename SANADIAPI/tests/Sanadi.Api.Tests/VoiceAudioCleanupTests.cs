using System.Buffers.Binary;
using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class VoiceAudioCleanupTests
{
    [Theory]
    [InlineData(16000, 1, false)]
    [InlineData(24000, 1, false)]
    [InlineData(48000, 2, false)]
    [InlineData(24000, 1, true)]
    [InlineData(48000, 2, true)]
    public void Quiet_noise_in_pauses_is_muted_without_editing_speech_or_timing(int rate, int channels, bool floating)
    {
        var samples = Enumerable.Range(0, rate * 2 * channels).Select(i =>
        {
            var time = (i / channels) / (double)rate;
            return (short)(time is >= .6 and < 1.2 ? (i % 2 == 0 ? 6000 : -6000) : 60);
        }).ToArray();
        var wav = Wav(samples, rate, channels, floating);
        var original = wav.ToArray();
        var cleaned = VoiceAudioCleanup.Apply(wav);
        Assert.True(ConfiguredSpeech.ValidWave(cleaned));
        Assert.Equal(wav.Length, cleaned.Length);
        Assert.Equal(original, wav);
        Assert.Equal(0, Sample(cleaned, rate / 4 * channels));
        Assert.Equal(0, Sample(cleaned, rate * 3 / 2 * channels));
        for (var i = (int)(rate * .6) * channels; i < (int)(rate * 1.2) * channels; i++)
            Assert.Equal(samples[i], Sample(cleaned, i));
    }

    [Fact]
    public void Soft_syllables_next_to_speech_are_preserved_by_the_hold_window()
    {
        var samples = Enumerable.Range(0, 24000).Select(i => (short)(i is >= 12000 and < 16000 ? 5000 : 20)).ToArray();
        var cleaned = VoiceAudioCleanup.Apply(Wav(samples, 24000, 1));
        Assert.Equal(20, Sample(cleaned, 11500));
        Assert.Equal(20, Sample(cleaned, 16500));
    }

    [Fact]
    public void An_entirely_quiet_utterance_is_not_erased()
    {
        var wav = Wav(Enumerable.Repeat((short)150, 24000).ToArray(), 24000, 1);
        Assert.Same(wav, VoiceAudioCleanup.Apply(wav));
    }

    [Fact]
    public void Tiny_or_invalid_audio_is_not_reinterpreted()
    {
        var tiny = Wav([10, -10], 24000, 1);
        Assert.Same(tiny, VoiceAudioCleanup.Apply(tiny));
        byte[] invalid = [1, 2, 3];
        Assert.Same(invalid, VoiceAudioCleanup.Apply(invalid));
    }

    private static short Sample(byte[] wav, int index) => BinaryPrimitives.ReadUInt16LittleEndian(wav.AsSpan(20)) == 3
        ? (short)Math.Round(BinaryPrimitives.ReadSingleLittleEndian(wav.AsSpan(44 + index * 4)) * 32768)
        : BinaryPrimitives.ReadInt16LittleEndian(wav.AsSpan(44 + index * 2));
    private static byte[] Wav(short[] samples, int rate, int channels, bool floating = false)
    {
        using var output = new MemoryStream(); using var writer = new BinaryWriter(output);
        var bytes = floating ? 4 : 2;
        writer.Write("RIFF"u8); writer.Write(36 + samples.Length * bytes); writer.Write("WAVEfmt "u8);
        writer.Write(16); writer.Write((short)(floating ? 3 : 1)); writer.Write((short)channels); writer.Write(rate);
        writer.Write(rate * channels * bytes); writer.Write((short)(channels * bytes)); writer.Write((short)(bytes * 8));
        writer.Write("data"u8); writer.Write(samples.Length * bytes);
        foreach (var sample in samples) { if (floating) writer.Write(sample / 32768f); else writer.Write(sample); }
        return output.ToArray();
    }
}
