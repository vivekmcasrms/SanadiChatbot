using System.Text.Json.Nodes;
using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class VoiceNaturalPhrasingTests
{
    [Theory]
    [InlineData("en", "I'm ready to help.", "How can I assist you today?")]
    [InlineData("ar", "أنا جاهزة أساعدك.", "كيف أقدر أساعدك اليوم؟")]
    public async Task Call_can_synthesize_the_first_complete_sentence_without_waiting_for_a_combined_clip(string language, string first, string rest)
    {
        var audio = new List<string>();
        var speaker = new VoiceSentences(language, phrase => { audio.Add(phrase); return Task.CompletedTask; },
            firstChunkChars: 160, naturalPhrasing: true, separateFirstSentence: true);
        await speaker.Push(first + " " + rest, final: true);
        Assert.Equal(first, audio[0]);
        Assert.Equal(first + " " + rest, string.Join(" ", audio));
    }

    private static VoiceSentences Speaker(string language, List<string> audio) => new(language,
        phrase => { audio.Add(phrase); return Task.CompletedTask; }, firstChunkChars: 160, naturalPhrasing: true);

    [Theory]
    [InlineData("en", "You can review your current registration details in the student portal and check your GPA of 3.75 together with your course information and your current academic schedule.")]
    [InlineData("ar", "تقدر تراجع تفاصيل تسجيلك الحالية من خلال بوابة الطالب وتتحقق من معدلك وهو 3.75 مع معلومات مقرراتك الدراسية وجدولك الأكاديمي الحالي قبل اختيار الخدمة الجامعية المطلوبة.")]
    public async Task Complete_available_sentence_is_not_cut_at_the_old_character_target(string language, string answer)
    {
        Assert.InRange(answer.Length, 161, 320);
        var audio = new List<string>();
        await Speaker(language, audio).Push(answer, final: true);
        Assert.Equal(new[] { answer }, audio);
    }

    [Theory]
    [InlineData("en", "You can review your current registration details and your course information, ", "then choose the service you need.", ",")]
    [InlineData("ar", "تقدر تراجع تفاصيل تسجيلك الحالي ومعلومات مقرراتك من خلال حسابك الجامعي، ", "وبعدها تختار الخدمة المطلوبة.", "،")]
    public async Task First_clause_starts_early_with_a_pause_instead_of_an_artificial_full_stop(string language, string first, string rest, string pause)
    {
        var audio = new List<string>();
        var speaker = Speaker(language, audio);
        await speaker.Push(first);
        Assert.Equal(new[] { first.Trim() }, audio);
        Assert.EndsWith(pause, audio[0]);
        await speaker.Push(rest, final: true);
        Assert.Equal((first + rest).Trim(), string.Join(" ", audio));
    }

    [Theory]
    [InlineData("en", "You're welcome! Happy to help. Goodbye!")]
    [InlineData("ar", "العفو، حياك الله! يسعدني أساعدك. مع السلامة.")]
    public async Task Available_farewell_is_spoken_as_one_phrase_without_extra_TTS_gaps(string language, string answer)
    {
        var audio = new List<string>();
        var narration = new VoiceReplyNarration("Thanks", language, Speaker(language, audio));
        await narration.Complete(new JsonObject { ["answer"] = answer, ["toolsUsed"] = new JsonArray("greeting", "voice_farewell") });
        Assert.Equal(new[] { answer }, audio);
    }

    [Theory]
    [InlineData("en", "Hello! ")]
    [InlineData("ar", "وعليكم السلام! ")]
    public async Task Streaming_greeting_never_waits_for_a_second_sentence(string language, string greeting)
    {
        var audio = new List<string>();
        await Speaker(language, audio).Push(greeting);
        Assert.Equal(new[] { greeting.Trim() }, audio);
    }

    [Theory]
    [InlineData("Contact Dr. Ahmed for your appointment. ", "Contact Dr. Ahmed for your appointment.")]
    [InlineData("Meet Prof. Smith at 10.30 tomorrow. ", "Meet Prof. Smith at 10.30 tomorrow.")]
    [InlineData("1. Download the letter from My Documents. ", "Download the letter from My Documents.")]
    [InlineData("١. نزّل الخطاب من وثائقي. ", "نزّل الخطاب من وثائقي.")]
    [InlineData("**Your GPA is 3.75.** ", "Your GPA is 3.75.")]
    [InlineData("The status is “approved.” ", "The status is “approved.”")]
    [InlineData("The status is 'approved.' ", "The status is 'approved.'")]
    public async Task Titles_list_markers_and_formatting_do_not_produce_spoken_fragments(string answer, string expected)
    {
        var audio = new List<string>();
        var narration = new VoiceReplyNarration("question", "en", Speaker("en", audio));
        foreach (var character in answer) await narration.Push(character.ToString());
        await narration.Complete(new JsonObject { ["answer"] = answer.Trim() });
        Assert.Equal(new[] { expected }, audio);
    }

    [Theory]
    [InlineData("en", "## Next steps\nDownload the letter.", "Next steps: Download the letter.")]
    [InlineData("ar", "الخطوة التالية:\nنزّل الخطاب من وثائقي.", "الخطوة التالية: نزّل الخطاب من وثائقي.")]
    public async Task Heading_flows_into_its_detail_without_an_isolated_heading_clip(string language, string answer, string expected)
    {
        var audio = new List<string>();
        var narration = new VoiceReplyNarration("question", language, Speaker(language, audio));
        foreach (var character in answer) await narration.Push(character.ToString());
        await narration.Complete(new JsonObject { ["answer"] = answer });
        Assert.Equal(new[] { expected }, audio);
    }

    [Fact]
    public async Task Long_unpunctuated_stream_still_starts_and_keeps_all_words()
    {
        var audio = new List<string>();
        var speaker = Speaker("en", audio);
        var words = string.Join(" ", Enumerable.Repeat("registration information", 20));
        await speaker.Push(words);
        Assert.Single(audio);
        Assert.EndsWith(",", audio[0]);
        Assert.InRange(audio[0].Length, 200, 321);
        await speaker.Push(".", final: true);
        Assert.Equal(words, string.Join(" ", audio.Select(p => p.TrimEnd(',', '.'))));
    }

    [Theory]
    [InlineData("en", "\n  Your GPA is 3.75. ", "Your GPA is 3.75.")]
    [InlineData("ar", "\n\n معدلك 3.75. ", "معدلك 3.75.")]
    public async Task Leading_whitespace_and_trimmed_result_never_duplicate_or_drop_an_answer(string language, string streamed, string answer)
    {
        var audio = new List<string>();
        var narration = new VoiceReplyNarration("question", language, Speaker(language, audio));
        foreach (var character in streamed) await narration.Push(character.ToString());
        Assert.Equal(new[] { answer }, audio); // Leading blank lines must not delay speech until the final result.
        await narration.Complete(new JsonObject { ["answer"] = answer });
        Assert.Equal(new[] { answer }, audio);
    }

    [Fact]
    public async Task Speech_formatting_does_not_change_approval_text_numbers_or_response_cards()
    {
        var answer = "**Review before submitting:**\nSubject: Request for a letter.\nFee: AED 50.\n" +
            "You must approve before submission.\nReference: REQ-2026-12345.";
        var result = new JsonObject { ["answer"] = answer, ["proposedActions"] = new JsonArray(new JsonObject { ["key"] = "submit" }) };
        var unchanged = result.ToJsonString();
        var audio = new List<string>();
        await new VoiceReplyNarration("letter", "en", Speaker("en", audio)).Complete(result);
        var spoken = string.Join(" ", audio);
        Assert.Contains("You must approve before submission.", spoken);
        Assert.Contains("AED 50", spoken);
        Assert.Contains("REQ-2026-12345", spoken);
        Assert.Equal(unchanged, result.ToJsonString());
    }

    [Fact]
    public async Task Interruption_stops_emitting_the_rest_of_a_ready_reply()
    {
        var calls = 0;
        var speaker = new VoiceSentences("en", _ => { calls++; throw new OperationCanceledException(); }, naturalPhrasing: true);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => speaker.Push(
            "This is a complete first sentence with the relevant information for the student. This is the next sentence.", true));
        Assert.Equal(1, calls);
    }
}
