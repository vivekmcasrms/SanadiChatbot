using Sanadi.Api.AI;
using Microsoft.Extensions.Configuration;

namespace Sanadi.Api.Tests;

public sealed class VoiceActivityDetectorTests
{
    [Fact]
    public void Brief_weak_speech_near_background_does_not_activate_after_calibration()
    {
        var gate = CalibratedGate(0.01f);
        for (var attempt = 0; attempt < 10; attempt++)
        {
            for (var frame = 0; frame < 3; frame++) Assert.Equal("continue", gate.Update(0.6f, 0.012f));
            Assert.Equal("continue", gate.Update(0.1f, 0.01f));
            Assert.Equal("continue", gate.Update(0.1f, 0.01f));
        }
        Assert.False(gate.HasSpeech);
    }

    [Fact]
    public void Sustained_weak_speech_is_delayed_but_not_locked_out_by_the_guard()
    {
        var gate = CalibratedGate(0.01f);
        for (var frame = 0; frame < 5; frame++) Assert.Equal("continue", gate.Update(0.6f, 0.012f));
        Assert.Equal("speech", gate.Update(0.6f, 0.012f));
    }

    [Theory]
    [InlineData(1f)]
    [InlineData(0.1f)]
    [InlineData(0.001f)]
    public void Clearer_speech_keeps_original_timing_at_different_microphone_levels(float scale)
    {
        var gate = CalibratedGate(0.01f * scale);
        Assert.Equal("continue", gate.Update(0.6f, 0.02f * scale));
        Assert.Equal("continue", gate.Update(0.6f, 0.02f * scale));
        Assert.Equal("speech", gate.Update(0.6f, 0.02f * scale));

        var weak = CalibratedGate(0.01f * scale);
        for (var frame = 0; frame < 3; frame++) Assert.Equal("continue", weak.Update(0.6f, 0.012f * scale));
        Assert.False(weak.HasSpeech);
    }

    [Fact]
    public void High_confidence_quiet_speech_keeps_original_timing_even_with_a_high_background_estimate()
    {
        var gate = CalibratedGate(0.02f);
        Assert.Equal("continue", gate.Update(0.8f, 0.0001f));
        Assert.Equal("continue", gate.Update(0.8f, 0.0001f));
        Assert.Equal("speech", gate.Update(0.8f, 0.0001f));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(7)]
    public void Speech_before_background_calibration_keeps_original_timing(int backgroundFrames)
    {
        var gate = new SpeechActivityGate();
        for (var i = 0; i < backgroundFrames; i++) gate.Update(0.05f, 0.02f);
        Assert.Equal("continue", gate.Update(0.6f, 0.001f));
        Assert.Equal("continue", gate.Update(0.6f, 0.001f));
        Assert.Equal("speech", gate.Update(0.6f, 0.001f));
    }

    [Fact]
    public void Ambiguous_audio_is_not_used_to_calibrate_background()
    {
        var gate = new SpeechActivityGate();
        for (var i = 0; i < 64; i++) gate.Update(0.4f, 0.2f);
        gate.Update(0.6f, 0.001f);
        gate.Update(0.6f, 0.001f);
        Assert.Equal("speech", gate.Update(0.6f, 0.001f));
    }

    [Fact]
    public void A_clear_frame_can_complete_an_existing_weak_candidate()
    {
        var gate = CalibratedGate(0.01f);
        gate.Update(0.6f, 0.012f);
        gate.Update(0.6f, 0.012f);
        Assert.Equal("speech", gate.Update(0.85f, 0.012f));
    }

    [Fact]
    public void Short_candidate_gap_and_pause_timing_are_preserved_with_the_guard()
    {
        var gate = CalibratedGate(0.01f);
        for (var i = 0; i < 3; i++) gate.Update(0.6f, 0.012f);
        gate.Update(0.1f, 0.01f);
        for (var i = 0; i < 2; i++) Assert.Equal("continue", gate.Update(0.6f, 0.012f));
        Assert.Equal("speech", gate.Update(0.6f, 0.012f));
        for (var i = 0; i < 24; i++) Assert.Equal("continue", gate.Update(0.1f, 0.01f));
        Assert.Equal("continue", gate.Update(0.25f, 0.0001f));
        for (var i = 0; i < 29; i++) Assert.Equal("continue", gate.Update(0.1f, 0.01f));
        Assert.Equal("pause", gate.Update(0.1f, 0.01f));
    }

    [Fact]
    public void Calibration_does_not_leak_between_gates()
    {
        var calibrated = CalibratedGate(0.01f);
        var fresh = new SpeechActivityGate();
        for (var i = 0; i < 2; i++)
        {
            calibrated.Update(0.6f, 0.012f);
            fresh.Update(0.6f, 0.012f);
        }
        Assert.Equal("continue", calibrated.Update(0.6f, 0.012f));
        Assert.Equal("speech", fresh.Update(0.6f, 0.012f));
    }

    [Fact]
    public void Disabled_guard_preserves_original_events_with_background_measurements()
    {
        var withLevels = new SpeechActivityGate(reduceBackgroundActivations: false);
        var withoutLevels = new SpeechActivityGate();
        var probabilities = Enumerable.Repeat(0.05f, 32)
            .Concat(new[] { 0.6f, 0.1f, 0.6f, 0.6f })
            .Concat(Enumerable.Repeat(0.1f, 30)).Append(0.25f)
            .Concat(Enumerable.Repeat(0.1f, 80));
        foreach (var probability in probabilities)
            Assert.Equal(withoutLevels.Update(probability), withLevels.Update(probability, 0.01f));
        Assert.True(withLevels.HasSpeech);
    }

    [Theory]
    [InlineData(float.NaN)]
    [InlineData(float.PositiveInfinity)]
    [InlineData(-0.01f)]
    [InlineData(1.01f)]
    public void Invalid_audio_levels_are_rejected(float rms)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new SpeechActivityGate().Update(0.6f, rms));
    }

    [Fact]
    public void Configuration_rollback_keeps_the_model_probabilities_identical()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Voice:ReduceBackgroundActivations"] = "false"
        }).Build();
        using var trial = new VoiceActivityDetector();
        using var previous = new VoiceActivityDetector(configuration);
        using var trialStream = trial.OpenStream();
        using var previousStream = previous.OpenStream();
        var quiet = Enumerable.Range(0, 512).Select(i => (float)(Math.Sin(i * 0.1) * 0.0001)).ToArray();
        var original = quiet.ToArray();
        for (var i = 0; i < 40; i++)
            Assert.Equal(previousStream.ProcessFrame(quiet).Probability, trialStream.ProcessFrame(quiet).Probability);
        Assert.Equal(original, quiet);
    }

    private static SpeechActivityGate CalibratedGate(float background)
    {
        var gate = new SpeechActivityGate();
        for (var frame = 0; frame < 32; frame++) gate.Update(0.05f, background);
        return gate;
    }

    [Fact]
    public void Speech_is_confirmed_in_three_frames_without_a_loudness_requirement()
    {
        var gate = new SpeechActivityGate();
        Assert.Equal("continue", gate.Update(0.5f));
        Assert.Equal("continue", gate.Update(0.5f));
        Assert.Equal("speech", gate.Update(0.5f));
        Assert.True(gate.HasSpeech);
        Assert.Equal("continue", gate.Update(0.9f));
    }

    [Fact]
    public void Isolated_probability_spikes_do_not_accumulate_into_speech()
    {
        var gate = new SpeechActivityGate();
        for (var i = 0; i < 20; i++)
        {
            Assert.Equal("continue", gate.Update(0.95f));
            Assert.Equal("continue", gate.Update(0.1f));
            Assert.Equal("continue", gate.Update(0.1f));
        }
        Assert.False(gate.HasSpeech);
    }

    [Fact]
    public void A_single_short_probability_gap_keeps_the_speech_candidate()
    {
        var gate = new SpeechActivityGate();
        gate.Update(0.8f);
        gate.Update(0.1f);
        Assert.Equal("continue", gate.Update(0.8f));
        Assert.Equal("speech", gate.Update(0.8f));
    }

    [Fact]
    public void Non_speech_never_activates_or_produces_a_pause()
    {
        var gate = new SpeechActivityGate();
        for (var i = 0; i < 200; i++) Assert.Equal("continue", gate.Update(0.49f));
        Assert.False(gate.HasSpeech);
    }

    [Fact]
    public void Quiet_syllables_reset_the_pause_and_recording_waits_960_ms_after_speech()
    {
        var gate = new SpeechActivityGate();
        for (var i = 0; i < 3; i++) gate.Update(0.9f);
        for (var i = 0; i < 24; i++) Assert.Equal("continue", gate.Update(0.1f));
        Assert.Equal("continue", gate.Update(0.25f));
        for (var i = 0; i < 29; i++) Assert.Equal("continue", gate.Update(0.1f));
        Assert.Equal("pause", gate.Update(0.1f));
        for (var i = 0; i < 40; i++) Assert.Equal("continue", gate.Update(0.1f));
        Assert.True(gate.HasSpeech);
    }

    [Theory]
    [InlineData(float.NaN)]
    [InlineData(float.PositiveInfinity)]
    [InlineData(float.NegativeInfinity)]
    [InlineData(-0.1f)]
    [InlineData(1.1f)]
    public void Invalid_probability_is_rejected(float probability)
    {
        var gate = new SpeechActivityGate();
        Assert.Throws<ArgumentOutOfRangeException>(() => gate.Update(probability));
        Assert.False(gate.HasSpeech);
    }

    [Fact]
    public void Packaged_model_processes_pcm_and_float_silence_without_external_assets()
    {
        using var detector = new VoiceActivityDetector();
        using var pcm = detector.OpenStream();
        using var samples = detector.OpenStream();
        for (var i = 0; i < 40; i++)
        {
            var pcmResult = pcm.ProcessPcm16(new byte[VoiceActivityDetector.FrameBytes]);
            var floatResult = samples.ProcessFrame(new float[VoiceActivityDetector.FrameSamples]);
            Assert.InRange(pcmResult.Probability, 0f, 1f);
            Assert.Equal(floatResult.Probability, pcmResult.Probability);
            Assert.Equal("continue", pcmResult.Event);
            Assert.Equal("continue", floatResult.Event);
        }
        Assert.Equal("1", Environment.GetEnvironmentVariable("ORT_DISABLE_TELEMETRY"));
    }

    [Fact]
    public void Separate_streams_start_with_independent_recurrent_state()
    {
        using var detector = new VoiceActivityDetector();
        using var first = detector.OpenStream();
        var signal = Enumerable.Range(0, VoiceActivityDetector.FrameSamples)
            .Select(i => (float)(Math.Sin(i * 0.1) * 0.05)).ToArray();
        for (var i = 0; i < 10; i++) first.ProcessFrame(signal);
        using var second = detector.OpenStream();
        using var fresh = detector.OpenStream();
        var silence = new float[VoiceActivityDetector.FrameSamples];
        Assert.Equal(fresh.ProcessFrame(silence), second.ProcessFrame(silence));
    }

    [Fact]
    public void Invalid_frames_and_use_after_disposal_are_rejected()
    {
        using var detector = new VoiceActivityDetector();
        var stream = detector.OpenStream();
        Assert.Throws<ArgumentException>(() => stream.ProcessPcm16(new byte[1023]));
        Assert.Throws<ArgumentException>(() => stream.ProcessFrame(new float[511]));
        var invalid = new float[512];
        invalid[1] = float.NaN;
        Assert.Throws<ArgumentException>(() => stream.ProcessFrame(invalid));
        invalid[1] = 1.1f;
        Assert.Throws<ArgumentException>(() => stream.ProcessFrame(invalid));
        stream.Dispose();
        stream.Dispose();
        Assert.Throws<ObjectDisposedException>(() => stream.ProcessFrame(new float[512]));
        detector.Dispose();
        Assert.Throws<ObjectDisposedException>(() => detector.OpenStream());
    }
}
