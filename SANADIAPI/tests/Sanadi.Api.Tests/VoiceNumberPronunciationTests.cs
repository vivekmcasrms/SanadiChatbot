using System.Text.Json;
using System.Text.Json.Nodes;
using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class VoiceNumberPronunciationTests
{
    [Theory]
    [InlineData("en", "202000336", "two, zero, two, zero, zero, zero, three, three, six")]
    [InlineData("ar", "202000336", "اثنان، صفر، اثنان، صفر، صفر، صفر، ثلاثة، ثلاثة، ستة")]
    [InlineData("ar", "٢٠٢٠٠٠٣٣٦", "اثنان، صفر، اثنان، صفر، صفر، صفر، ثلاثة، ثلاثة، ستة")]
    [InlineData("ar", "۲۰۲۰۰۰۳۳۶", "اثنان، صفر، اثنان، صفر، صفر، صفر، ثلاثة، ثلاثة، ستة")]
    [InlineData("en", "000010020", "zero, zero, zero, zero, one, zero, zero, two, zero")]
    [InlineData("ar", "000010020", "صفر، صفر، صفر، صفر، واحد، صفر، صفر، اثنان، صفر")]
    public void Every_digit_including_leading_and_repeated_zeros_is_preserved(string language, string number, string expected)
        => Assert.Equal(expected, VoiceNumberPronunciation.ForSpeech(number, language));

    [Theory]
    [InlineData("GPA 3.75, 120 credits, 92%, year 2026, fee AED 1,234,567.89, deadline 2026-10-31 at 10:30.")]
    [InlineData("3.202000336 123456.78 123456,78 ٣٫٢٠٢٠٠٠٣٣٦ ١٢٣٬٤٥٦ 10/12/2026 HIST120 ABC123456")]
    public void Other_numeric_formats_and_course_codes_are_unchanged(string text)
    {
        Assert.Equal(text, VoiceNumberPronunciation.ForSpeech(text, "en"));
        Assert.Equal(text, VoiceNumberPronunciation.ForSpeech(text, "ar"));
    }

    [Theory]
    [InlineData("en", "mira", "Your student ID is 202000336.", "Your student ID is two, zero, two, zero, zero, zero, three, three, six.")]
    [InlineData("en", "suhail", "Your student ID is 202000336.", "Your student ID is two, zero, two, zero, zero, zero, three, three, six.")]
    [InlineData("ar", "mira", "الرقم الجامعي 202000336.", "الرقم الجامعي اثنان، صفر، اثنان، صفر، صفر، صفر، ثلاثة، ثلاثة، ستة.")]
    [InlineData("ar", "suhail", "الرقم الجامعي 202000336.", "الرقم الجامعي اثنان، صفر، اثنان، صفر، صفر، صفر، ثلاثة، ثلاثة، ستة.")]
    public async Task Only_the_TTS_payload_changes_and_all_digits_reach_both_voices(string language, string agent, string answer, string expected)
    {
        var result = new JsonObject { ["answer"] = answer, ["verified"] = true, ["toolsUsed"] = new JsonArray("student_profile") };
        var original = result.ToJsonString();
        var overview = VoiceReplyNarration.Overview(result, "ID", language);
        using var request = ConfiguredSpeech.Request(new("https://speech.test/v1", "test-key"), overview, language, agent, Guid.NewGuid());
        using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        Assert.Equal(expected, body.RootElement.GetProperty("input").GetString());
        Assert.Equal(agent == "mira" ? "female" : "male", body.RootElement.GetProperty("voice").GetString());
        Assert.Equal(language, body.RootElement.GetProperty("language").GetString());
        Assert.Equal(answer, overview);
        Assert.Equal(original, result.ToJsonString());
    }

    [Fact]
    public void Arbitrary_identifier_lengths_use_the_same_mapping_without_a_student_specific_rule()
    {
        string[] words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
        var random = new Random(241);
        for (var length = 5; length <= 30; length++)
        {
            var digits = Enumerable.Range(0, length).Select(_ => random.Next(10)).ToArray();
            var number = string.Concat(digits);
            var spoken = VoiceNumberPronunciation.ForSpeech(number, "en").Split(", ");
            Assert.Equal(digits, spoken.Select(word => Array.IndexOf(words, word)));
        }
    }

    [Fact]
    public void Applying_pronunciation_twice_does_not_duplicate_or_reorder_digits()
    {
        var spoken = VoiceNumberPronunciation.ForSpeech("202000336", "en");
        Assert.Equal(spoken, VoiceNumberPronunciation.ForSpeech(spoken, "en"));
    }
}
