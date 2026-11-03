using Microsoft.Extensions.Configuration;
using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class ConservativeVoiceActivityTests
{
    private static SpeechActivityGate Gate(float? background = null)
    {
        var gate = new SpeechActivityGate(conservativeSpeechActivation: true);
        if (background is float level)
            for (var frame = 0; frame < 32; frame++) gate.Update(0.05f, level);
        return gate;
    }

    [Fact]
    public void Repeated_brief_high_confidence_bursts_do_not_interrupt()
    {
        var gate = Gate();
        for (var attempt = 0; attempt < 20; attempt++)
        {
            for (var frame = 0; frame < 3; frame++) Assert.Equal("continue", gate.Update(0.95f, 0.02f));
            gate.Update(0.05f, 0.001f);
            gate.Update(0.05f, 0.001f);
        }
        Assert.False(gate.HasSpeech);
        var previous = new SpeechActivityGate();
        previous.Update(0.95f, 0.02f);
        previous.Update(0.95f, 0.02f);
        Assert.Equal("speech", previous.Update(0.95f, 0.02f));
    }

    [Theory]
    [InlineData(0.0001f)]
    [InlineData(0.02f)]
    public void Clear_sustained_speech_needs_six_frames_without_startup_calibration(float level)
    {
        var gate = Gate();
        for (var frame = 0; frame < 5; frame++) Assert.Equal("continue", gate.Update(0.9f, level));
        Assert.Equal("speech", gate.Update(0.9f, level));
        Assert.Equal("continue", gate.Update(0.9f, level));
    }

    [Theory]
    [InlineData(1f, 0.6f)]
    [InlineData(1f, 0.95f)]
    [InlineData(0.001f, 0.95f)]
    public void Speech_close_to_background_needs_twelve_frames_even_when_confident(float scale, float probability)
    {
        var gate = Gate(0.01f * scale);
        for (var frame = 0; frame < 11; frame++)
            Assert.Equal("continue", gate.Update(probability, 0.012f * scale));
        // Sustained quiet speech is delayed, not permanently locked out.
        Assert.Equal("speech", gate.Update(probability, 0.012f * scale));
    }

    [Fact]
    public void A_single_clear_frame_cannot_bypass_background_confirmation()
    {
        var gate = Gate(0.01f);
        for (var frame = 0; frame < 5; frame++) gate.Update(0.9f, 0.012f);
        Assert.Equal("continue", gate.Update(0.95f, 0.03f));
        for (var frame = 0; frame < 4; frame++) Assert.Equal("continue", gate.Update(0.95f, 0.03f));
        Assert.Equal("speech", gate.Update(0.95f, 0.03f));
    }

    [Fact]
    public void Reset_gap_clears_both_confirmation_counters()
    {
        var gate = Gate();
        for (var frame = 0; frame < 5; frame++) gate.Update(0.9f, 0.03f);
        gate.Update(0.05f, 0.001f);
        gate.Update(0.05f, 0.001f);
        for (var frame = 0; frame < 5; frame++) Assert.Equal("continue", gate.Update(0.9f, 0.03f));
        Assert.Equal("speech", gate.Update(0.9f, 0.03f));
    }

    [Fact]
    public void Brief_syllable_gap_and_existing_end_of_speech_timing_are_preserved()
    {
        var gate = Gate();
        for (var frame = 0; frame < 3; frame++) gate.Update(0.9f, 0.03f);
        gate.Update(0.1f, 0.001f);
        for (var frame = 0; frame < 2; frame++) Assert.Equal("continue", gate.Update(0.9f, 0.03f));
        Assert.Equal("speech", gate.Update(0.9f, 0.03f));
        for (var frame = 0; frame < 29; frame++) Assert.Equal("continue", gate.Update(0.1f, 0.001f));
        Assert.Equal("continue", gate.Update(0.25f, 0.0001f));
        for (var frame = 0; frame < 29; frame++) Assert.Equal("continue", gate.Update(0.1f, 0.001f));
        Assert.Equal("pause", gate.Update(0.1f, 0.001f));
        Assert.Equal("continue", gate.Update(0.1f, 0.001f));
    }

    [Fact]
    public void Default_api_configuration_uses_conservative_confirmation()
    {
        using var detector = new VoiceActivityDetector();
        var gate = detector.CreateActivityGate();
        for (var frame = 0; frame < 5; frame++) Assert.Equal("continue", gate.Update(0.95f, 0.01f));
        Assert.Equal("speech", gate.Update(0.95f, 0.01f));
    }

    [Fact]
    public void Feature_disabled_reproduces_the_previous_background_guard_events()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Voice:ConservativeSpeechActivation"] = "false",
            ["Voice:EndpointSilenceMs"] = "960",
            ["Voice:AdaptiveEndpoint"] = "false"
        }).Build();
        using var detector = new VoiceActivityDetector(configuration);
        foreach (var probability in new[] { 0.6f, 0.95f })
        {
            var restored = detector.CreateActivityGate();
            var previous = new SpeechActivityGate();
            var input = Enumerable.Repeat((0.05f, 0.01f), 32)
                .Concat(Enumerable.Repeat((probability, 0.012f), 6))
                .Concat(Enumerable.Repeat((0.1f, 0.01f), 50));
            foreach (var (speechProbability, rms) in input)
                Assert.Equal(previous.Update(speechProbability, rms), restored.Update(speechProbability, rms));
            Assert.True(restored.HasSpeech);
        }
    }

    [Fact]
    public void Existing_global_guard_switch_still_restores_probability_only_behavior()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Voice:ReduceBackgroundActivations"] = "false"
        }).Build();
        using var detector = new VoiceActivityDetector(configuration);
        var gate = detector.CreateActivityGate();
        for (var frame = 0; frame < 32; frame++) gate.Update(0.05f, 0.02f);
        gate.Update(0.9f, 0.0001f);
        gate.Update(0.9f, 0.0001f);
        Assert.Equal("speech", gate.Update(0.9f, 0.0001f));
    }
}
