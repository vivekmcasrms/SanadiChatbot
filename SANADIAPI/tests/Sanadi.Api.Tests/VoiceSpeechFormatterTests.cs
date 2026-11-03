using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class VoiceSpeechFormatterTests
{
    [Fact]
    public void Text_layout_becomes_plain_spoken_sentences()
    {
        const string answer = "✅ **Good news!** Textbooks for HIST120 are provided through Blackboard.\n\n" +
                              "**How to access:**\n- Open [Blackboard](https://bb.uaeu.ac.ae)\n- Select the course\n- Open the Textbook section\n\n" +
                              "**No request is needed.**";
        var speech = VoiceSpeechFormatter.ToSpeech(answer, "en");

        Assert.DoesNotContain("**", speech);
        Assert.DoesNotContain("- ", speech);
        Assert.DoesNotContain("https://", speech);
        Assert.DoesNotContain("✅", speech);
        Assert.Contains("Good news! Textbooks for HIST120 are provided through Blackboard.", speech);
        Assert.Contains("Open Blackboard.", speech);
        Assert.Contains("No request is needed.", speech);
    }

    [Fact]
    public void Arabic_layout_is_kept_in_arabic()
    {
        var speech = VoiceSpeechFormatter.ToSpeech("**خبر سار!** لا يلزم طلب منفصل.\n- افتح بلاك بورد\n- اختر المقرر", "ar");
        Assert.DoesNotContain("**", speech);
        Assert.Contains("خبر سار! لا يلزم طلب منفصل.", speech);
        Assert.Contains("افتح بلاك بورد.", speech);
    }

    [Fact]
    public void Empty_answer_gives_empty_speech()
    {
        Assert.Equal("", VoiceSpeechFormatter.ToSpeech(null, "en"));
        Assert.Equal("", VoiceSpeechFormatter.ToSpeech("   ", "en"));
    }

    [Fact]
    public void Highlights_read_key_values_not_the_full_layout()
    {
        const string answer =
            "✅ **Good news!** Here is your academic snapshot.\n\n" +
            "**GPA:** 3.42\n**Attendance:** 92%\n**Holds:** None\n\n" +
            "**How to access:**\n- Open [Blackboard](https://bb.uaeu.ac.ae)\n- Select the course\n- Open the Textbook section";
        var speech = VoiceSpeechFormatter.ToHighlights(answer, "en");
        Assert.Contains("GPA is 3.42", speech);
        Assert.Contains("Attendance is 92%", speech);
        Assert.DoesNotContain("Open Blackboard", speech);
        Assert.Contains("on the screen", speech);
    }
}
