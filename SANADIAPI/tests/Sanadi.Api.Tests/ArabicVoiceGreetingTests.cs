using Sanadi.Api.AI;
using Sanadi.Api.Controllers;

namespace Sanadi.Api.Tests;

public sealed class ArabicVoiceGreetingTests
{
    [Theory]
    [InlineData("السلام عليكم، كيف حالك؟ أنت زين، شو اسمك؟")]
    [InlineData("السَّلامُ عَلَيْكُم وَرَحْمَةُ اللهِ وَبَرَكَاتُهُ")]
    [InlineData("وعليكم السلام ورحمة الله وبركاته")]
    [InlineData("مرحبا الساع يا سهيل")]
    [InlineData("يا مرحبا الساع، شخبارك؟")]
    [InlineData("مرحبا مليون، كيف حالكم؟")]
    [InlineData("مراحب ميرا")]
    [InlineData("مرحبتين، شعلومك؟")]
    [InlineData("يا هلا وغلا، شحالج اليوم؟")]
    [InlineData("هلا والله يا ميرا، شو أخبارج؟")]
    [InlineData("هلا ومرحبا، شحالكم؟")]
    [InlineData("هلا فيج، طمنيني عليج")]
    [InlineData("أهلاً وسهلاً يا سهيل، كيف الأحوال؟")]
    [InlineData("أهلين، شو حالك؟")]
    [InlineData("حياج الله يا ميرا")]
    [InlineData("حياكم الله، عساكم بخير")]
    [InlineData("الله يحييك، كيف يومك؟")]
    [InlineData("الله يحييج، كيف صحتج؟")]
    [InlineData("حيا الله من يانا")]
    [InlineData("صبحك الله بالخير، عساك طيب")]
    [InlineData("صبحج الله بالخير، عساج طيبة")]
    [InlineData("صبحكم الله بالخير، شخباركم؟")]
    [InlineData("صباح الورد، أنت زين؟")]
    [InlineData("صباح النور يا سنادي")]
    [InlineData("يسعد صباحك")]
    [InlineData("مساج الله بالخير")]
    [InlineData("مساكم الله بالخير، شعلومكم؟")]
    [InlineData("مسا النور، كيف الأمور؟")]
    [InlineData("مساء الورد يا سهيل")]
    [InlineData("أسعد الله مساءك")]
    [InlineData("شلونك؟")]
    [InlineData("شحالكن؟")]
    [InlineData("انتي زينة؟ كل شي تمام؟")]
    [InlineData("عساك بخير، طمني عنك")]
    [InlineData("يا حي الله")]
    [InlineData("تحية طيبة، ما اسمك؟")]
    [InlineData("منو انتي؟")]
    [InlineData("شو اسمج يا ميرا؟")]
    [InlineData("شو اسمك يا سهيل؟")]
    [InlineData("شوسمك؟")]
    [InlineData("  هــلا\n  ميرا،\t شحالج؟  ")]
    public void Arabic_social_turns_use_voice_greeting_route_and_arabic_reply(string text)
    {
        Assert.True(ArabicVoiceGreetings.IsGreeting(text, voicePresentation: true));
        Assert.Equal("ar", AssistantController.ReplyLanguage(text, "en"));
        Assert.False(ArabicVoiceGreetings.IsGreeting(text, voicePresentation: false));
        Assert.Equal("ar", AssistantController.ReplyLanguage(ArabicVoiceGreetings.Reply(text, "mira")!, "en"));
    }

    [Theory]
    [InlineData("Hello, how are you?")]
    [InlineData("If I like to check out work,")]
    [InlineData("Salam, what is my GPA?")]
    [InlineData("السلام عليكم، كم معدلي؟")]
    [InlineData("هلا والله، وين المكتبة؟")]
    [InlineData("مرحبا الساع، أريد تقديم شكوى عن الباص")]
    [InlineData("شحالج؟ ممكن تطلعين إفادة تسجيل؟")]
    [InlineData("مساء الخير، أريد حجز موعد")]
    [InlineData("صباح النور، عندي اقتراح لتحسين السكن")]
    [InlineData("يا هلا، في حريق في المبنى")]
    [InlineData("مرحبا، ما اسمي؟")]
    [InlineData("هلا، شو رقمي الجامعي؟")]
    [InlineData("هلا، tell me my grades")]
    [InlineData("مرحبا، قدم الطلب")]
    [InlineData("ميرا")]
    [InlineData("")]
    public void Does_not_relabel_english_or_hide_a_student_service_request(string text)
    {
        Assert.False(ArabicVoiceGreetings.IsGreeting(text, voicePresentation: true));
        Assert.Null(ArabicVoiceGreetings.Reply(text, "mira"));
    }

    [Theory]
    [InlineData("مرحبا الساع يا ميرا، شحالج؟", "هلا ومرحبا.")]
    [InlineData("صبحك الله بالخير", "صباح النور.")]
    [InlineData("مساكم الله بالخير", "مساء النور.")]
    [InlineData("السلام عليكم", "وعليكم السلام.")]
    public void Simple_greetings_match_the_greeting_without_reintroducing_the_agent(string text, string opening)
    {
        foreach (var agent in new[] { "mira", "suhail" })
        {
            var reply = ArabicVoiceGreetings.Reply(text, agent)!;
            Assert.StartsWith(opening, reply);
            Assert.DoesNotContain("ميرا", reply);
            Assert.DoesNotContain("سهيل", reply);
            Assert.DoesNotContain("؟", reply);
        }
    }

    [Theory]
    [InlineData("mira", "ميرا", "سهيل")]
    [InlineData("suhail", "سهيل", "ميرا")]
    public void Supplied_phrase_answers_wellbeing_and_selected_name(string agent, string name, string other)
    {
        var reply = ArabicVoiceGreetings.Reply("السلام عليكم، كيف حالك؟ أنت زين، شو اسمك؟", agent)!;
        Assert.StartsWith("وعليكم السلام.", reply);
        Assert.Contains("بخير", reply);
        Assert.Contains(name, reply);
        Assert.DoesNotContain(other, reply);
    }
}
