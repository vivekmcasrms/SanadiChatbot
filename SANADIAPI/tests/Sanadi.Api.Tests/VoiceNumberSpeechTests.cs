using System.Buffers.Binary;
using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class VoiceNumberSpeechTests
{
    [Theory]
    [InlineData("en")]
    [InlineData("ar")]
    public async Task Only_audio_whose_digits_match_the_source_is_returned(string language)
    {
        var attempts = 0;
        var audio = await VoiceNumberSpeech.Synthesize("202000336", language,
            (_, _) => Task.FromResult(Wav((short)++attempts)),
            (wav, _) => Task.FromResult(Samples(wav).Count(v => v != 0) > 1 ? "202000336"
                : attempts switch { 1 => "233", 2 => "202", 3 => "0", _ => "336" }), default);
        Assert.Equal(4, attempts);
        Assert.Equal(new short[] { 2, 3, 3, 3, 4 }, Samples(audio).Where(v => v != 0));
    }

    [Theory]
    [InlineData("en")]
    [InlineData("ar")]
    public async Task Failed_group_and_digit_checks_play_a_screen_reference_without_any_wrong_number(string language)
    {
        var attempts = 0;
        var checks = 0;
        var requests = new List<string>();
        var audio = await VoiceNumberSpeech.Synthesize("202000336", language,
            (text, _) => { requests.Add(text); return Task.FromResult(Wav((short)++attempts)); },
            (_, _) => { checks++; return Task.FromResult("2020003366"); }, default);
        Assert.Equal(8, checks);
        Assert.Equal(9, attempts);
        Assert.Equal(new short[] { 9 }, Samples(audio).Where(v => v != 0));
        Assert.DoesNotContain(requests[^1], c => char.IsDigit(c));
    }

    [Fact]
    public async Task Surrounding_explanation_and_leading_zeros_are_preserved()
    {
        var requests = new List<string>();
        var audio = await VoiceNumberSpeech.Synthesize("The number is 00001. Please check it.", "en",
            (text, _) => { requests.Add(text); return Task.FromResult(Wav((short)requests.Count)); },
            (wav, _) => Task.FromResult(Samples(wav).Count(v => v != 0) > 1 ? "The number is 00001. Please check it."
                : requests.Count == 2 ? "zero" : "zero one"), default);
        Assert.Equal("The number is", requests[0]);
        Assert.Equal(". Please check it.", requests[^1]);
        Assert.Equal(new short[] { 1, 2, 2, 2, 3, 4 }, Samples(audio).Where(v => v != 0));
        Assert.True(ConfiguredSpeech.ValidWave(audio));
    }

    [Fact]
    public async Task Other_numeric_answers_keep_one_unchanged_synthesis_and_no_verification_call()
    {
        const string text = "Your GPA is 3.75 and you completed 120 credits in 2026.";
        var original = Wav(44);
        var requests = new List<string>();
        var audio = await VoiceNumberSpeech.Synthesize(text, "en", (part, _) =>
        { requests.Add(part); return Task.FromResult(original); }, (_, _) => throw new Exception("Must not verify ordinary speech"), default);
        Assert.Same(original, audio);
        Assert.Equal(new[] { text }, requests);
    }

    [Fact]
    public async Task Interrupting_verification_never_returns_the_unverified_audio()
    {
        using var cancellation = new CancellationTokenSource();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => VoiceNumberSpeech.Synthesize("12345", "en",
            (_, _) => Task.FromResult(Wav(1)), (_, ct) =>
            { cancellation.Cancel(); ct.ThrowIfCancellationRequested(); return Task.FromResult("12345"); }, cancellation.Token));
    }

    [Fact]
    public async Task Unavailable_verification_uses_the_screen_reference_without_replaying_any_action()
    {
        var calls = 0;
        var audio = await VoiceNumberSpeech.Synthesize("202000336", "en",
            (_, _) => Task.FromResult(Wav((short)++calls)),
            (_, _) => throw new HttpRequestException("Unavailable"), default);
        Assert.Equal(2, calls);
        Assert.Equal(new short[] { 2 }, Samples(audio).Where(v => v != 0));
    }

    [Theory]
    [InlineData("en", "00000000000000000000")]
    [InlineData("ar", "٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠")]
    public async Task Repeated_digits_are_assembled_in_source_order_without_regenerating_them(string language, string identifier)
    {
        var calls = 0;
        var checks = 0;
        var audio = await VoiceNumberSpeech.Synthesize(identifier, language,
            (_, _) => { calls++; return Task.FromResult(Wav(9)); },
            (wav, _) => { checks++; return Task.FromResult(Samples(wav).Count(v => v != 0) > 1 ? new string('0', identifier.Length) : "0"); }, default);
        Assert.Equal(1, calls);
        Assert.Equal(2, checks); // The isolated digit and the complete assembled reading.
        Assert.Equal(Enumerable.Repeat((short)9, identifier.Length), Samples(audio).Where(v => v != 0));
    }

    [Fact]
    public async Task Failure_of_a_later_group_discards_the_entire_identifier()
    {
        var calls = 0;
        var audio = await VoiceNumberSpeech.Synthesize("12345", "en",
            (_, _) => Task.FromResult(Wav((short)++calls)),
            (_, _) => Task.FromResult(calls == 1 ? "123" : "incorrect"), default);
        Assert.Equal(new short[] { (short)calls }, Samples(audio).Where(v => v != 0));
        Assert.Equal(10, calls); // One valid group, four rejected groups, four rejected digits, fallback.
    }

    [Fact]
    public async Task An_unclear_group_can_be_read_as_verified_individual_digits()
    {
        var calls = 0;
        var audio = await VoiceNumberSpeech.Synthesize("123123", "en",
            (_, _) => Task.FromResult(Wav((short)++calls)),
            (wav, _) => Task.FromResult(Samples(wav).Count(v => v != 0) > 1 ? "123123"
                : calls switch { 5 => "1", 6 => "2", 7 => "3", _ => "wrong" }), default);
        Assert.Equal(new short[] { 5, 6, 7, 5, 6, 7 }, Samples(audio).Where(v => v != 0));
    }

    [Fact]
    public async Task Caller_cancellation_is_not_retried_or_converted_to_a_fallback()
    {
        var calls = 0;
        using var cancellation = new CancellationTokenSource();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => VoiceNumberSpeech.Synthesize("00000", "en",
            (_, _) => { calls++; cancellation.Cancel(); throw new OperationCanceledException(cancellation.Token); },
            (_, _) => throw new Exception("Must not verify after cancellation"), cancellation.Token));
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task A_service_that_rejects_a_bare_digit_can_use_a_verified_framed_reading()
    {
        var requests = new List<string>();
        var audio = await VoiceNumberSpeech.Synthesize("1111111", "en", (text, _) =>
        {
            requests.Add(text);
            if (!text.StartsWith("Number:"))
                throw new Sanadi.Domain.Exceptions.SanadiException("Unavailable", 502, "tts_service_unavailable");
            return Task.FromResult(Wav(1));
        }, (wav, _) => Task.FromResult(Samples(wav).Count(v => v != 0) > 1 ? "1111111" : "Number: one"), default);
        Assert.InRange(requests.Count, 3, 11);
        Assert.Equal(Enumerable.Repeat((short)1, 7), Samples(audio).Where(v => v != 0));
    }

    [Fact]
    public async Task Authentication_failure_is_not_retried_as_a_pronunciation_failure()
    {
        var calls = 0;
        var error = await Assert.ThrowsAsync<Sanadi.Domain.Exceptions.SanadiException>(() => VoiceNumberSpeech.Synthesize(
            "11111", "en", (_, _) =>
            { calls++; throw new Sanadi.Domain.Exceptions.SanadiException("Rejected", 502, "tts_auth_failed"); },
            (_, _) => throw new Exception("Must not verify rejected requests"), default));
        Assert.Equal("tts_auth_failed", error.Code);
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task Splitting_an_identifier_does_not_bypass_the_existing_speech_length_limit()
    {
        await Assert.ThrowsAsync<ArgumentException>(() => VoiceNumberSpeech.Synthesize(new string('0', 1300), "en",
            (_, _) => throw new Exception("Oversized speech must not be synthesized"),
            (_, _) => throw new Exception("Oversized speech must not be verified"), default));
    }

    [Fact]
    public async Task An_unclear_complete_reading_is_retried_with_the_whole_source_sentence()
    {
        var calls = 0;
        var requests = new List<string>();
        var audio = await VoiceNumberSpeech.Synthesize("12345", "en", (text, _) =>
        { requests.Add(text); return Task.FromResult(Wav((short)++calls)); },
            (wav, _) => Task.FromResult(Samples(wav).Count(v => v != 0) > 1 ? "123445"
                : calls == 1 ? "123" : calls == 2 ? "45" : "12345"), default);
        Assert.Equal("12345", requests[^1]);
        Assert.Equal(new short[] { 3 }, Samples(audio).Where(v => v != 0));
    }

    [Fact]
    public async Task A_failed_whole_reply_check_never_returns_any_unverified_number_audio()
    {
        var calls = 0;
        var audio = await VoiceNumberSpeech.Synthesize("12345", "en",
            (_, _) => Task.FromResult(Wav((short)++calls)),
            (wav, _) => Task.FromResult(Samples(wav).Count(v => v != 0) > 1 ? "123445"
                : calls == 1 ? "123" : calls == 2 ? "45" : "123445"), default);
        Assert.Equal(5, calls);
        Assert.Equal(new short[] { 5 }, Samples(audio).Where(v => v != 0));
    }

    [Theory]
    [InlineData("The number is 202000336.", "The number is two zero two, number zero zero zero, three three six.", true)]
    [InlineData("الرقم هو ٢٠٢٠٠٠٣٣٦.", "الرقم هو اثنان صفر اثنان صفر صفر صفر ثلاثة ثلاثة ستة", true)]
    [InlineData("Your ID is 202000336.", "Your I D is 202-000-336.", true)]
    [InlineData("Your ID is 202000336.", "Your ID is 2020003366.", false)]
    [InlineData("Your ID is 202000336.", "Your ID is 202000336. Thanks for watching.", false)]
    [InlineData("Your ID is 202000336. You are not eligible.", "Your ID is 202000336. You are eligible.", false)]
    [InlineData("ID 202000336. GPA 3.75.", "ID 202000336. GPA 37.5.", false)]
    [InlineData("ID 202000336. GPA 3.75.", "ID 202-000-336. GPA 3.75.", true)]
    public void The_complete_check_preserves_digits_qualifications_and_other_numeric_values(string source, string transcript, bool expected)
        => Assert.Equal(expected, VoiceNumberPronunciation.MatchesReply(transcript, source));

    [Theory]
    [InlineData("Number: 202000336", true)]
    [InlineData("Number: two zero two zero zero zero three three six", true)]
    [InlineData("الرقم هو اثنان صفر اثنان صفر صفر صفر ثلاثة ثلاثة ستة", true)]
    [InlineData("الرقم هو ٢٠٢٠٠٠٣٣٦", true)]
    [InlineData("2020003366", false)]
    [InlineData("202333336", false)]
    [InlineData("202000336 Thanks for watching", false)]
    [InlineData("Number: two zero two zero zero three three six", false)]
    public void Verification_rejects_changed_missing_extra_digits_and_unrelated_speech(string text, bool expected)
        => Assert.Equal(expected, VoiceNumberPronunciation.Matches(text, "202000336"));

    private static byte[] Wav(short sample)
    {
        using var data = new MemoryStream(); using var writer = new BinaryWriter(data);
        writer.Write("RIFF"u8); writer.Write(38); writer.Write("WAVEfmt "u8);
        writer.Write(16); writer.Write((short)1); writer.Write((short)1);
        writer.Write(24000); writer.Write(48000); writer.Write((short)2); writer.Write((short)16);
        writer.Write("data"u8); writer.Write(2); writer.Write(sample); return data.ToArray();
    }

    private static IEnumerable<short> Samples(byte[] wav)
    {
        for (var offset = 44; offset + 2 <= wav.Length; offset += 2)
            yield return BinaryPrimitives.ReadInt16LittleEndian(wav.AsSpan(offset));
    }
}
