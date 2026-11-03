using System.Text.Json.Nodes;
using Microsoft.Extensions.Configuration;
using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class VoiceCallDeliveryTests
{
    [Theory]
    [InlineData("en", "Your student ID is 009876543. Your GPA is 3.75.", "Alright…")]
    [InlineData("ar", "رقم الطالب هو 009876543. المعدل هو 3.75.", "حسناً…")]
    public void A_completed_summary_and_optional_lead_in_are_one_speech_segment(
        string language, string summary, string acknowledgment)
    {
        var plan = new VoiceCallDelivery.Plan(acknowledgment, 150, 80, .98);
        var reply = plan.Reply(summary, "suhail", language, introduce: true);
        Assert.Equal(acknowledgment + " " + VoiceCallDelivery.Introduction("suhail", language) + summary, reply.Text);
        Assert.Equal(150, reply.PauseBeforeMs);
        Assert.Equal(.98, reply.Rate);
        Assert.Equal(summary, new VoiceCallDelivery.Plan(null, 100, 80, 1).Reply(summary, "mira", language, false).Text);
    }

    [Fact]
    public void No_final_answer_does_not_create_a_spoken_acknowledgment_or_introduction()
    {
        var plan = new VoiceCallDelivery.Plan("Alright…", 150, 80, 1);
        Assert.Empty(plan.Reply(" ", "mira", "en", true).Text);
    }

    [Theory]
    [InlineData(400, 0, 400)]
    [InlineData(400, 300, 100)]
    [InlineData(400, 400, 0)]
    [InlineData(800, 650, 150)]
    [InlineData(800, 5000, 0)]
    public void Model_and_TTS_time_count_toward_the_initial_pause(int target, int elapsed, int expected)
        => Assert.Equal(expected, VoiceCallDelivery.RemainingStartPause(target, TimeSpan.FromMilliseconds(elapsed)));

    private static VoiceCallDelivery Delivery() => new(new ConfigurationBuilder().AddInMemoryCollection(
        new Dictionary<string, string?>
        {
            ["Voice:Conversation:Acknowledgments:0:En"] = "Alright…",
            ["Voice:Conversation:Acknowledgments:0:Ar"] = "حسناً…",
            ["Voice:Conversation:Acknowledgments:1:En"] = "I see…",
            ["Voice:Conversation:Acknowledgments:1:Ar"] = "فهمت عليك…"
        }).Build());

    private static string Overview(string language) => language == "ar"
        ? string.Join(" ", Enumerable.Repeat("هذه تفاصيل موثقة من السجل الحالي للطالب ويمكن الاطلاع عليها في الرد المعروض.", 4))
        : string.Join(" ", Enumerable.Repeat("These are verified details from the student's current record and remain available in the full reply.", 4));

    private static JsonObject Result() => new()
    {
        ["answer"] = "The unchanged full answer.", ["verified"] = true,
        ["toolsUsed"] = new JsonArray("search_knowledge_base"), ["responseType"] = "answer"
    };

    [Theory]
    [InlineData("en", "Alright…", "I see…")]
    [InlineData("ar", "حسناً…", "فهمت عليك…")]
    public void Occasional_acknowledgments_vary_without_rewriting_the_answer(string language, string first, string second)
    {
        var delivery = Delivery();
        var result = Result();
        var original = result.ToJsonString();
        var plans = Enumerable.Range(0, 6).Select(_ => delivery.Prepare(result, Overview(language), language)).ToArray();
        Assert.Null(plans[0].Acknowledgment);
        Assert.Null(plans[1].Acknowledgment);
        Assert.Equal(first, plans[2].Acknowledgment);
        Assert.Null(plans[3].Acknowledgment);
        Assert.Null(plans[4].Acknowledgment);
        Assert.Equal(second, plans[5].Acknowledgment);
        Assert.All(plans, p => Assert.InRange(p.InitialPauseMs, 150, 200));
        Assert.Equal(original, result.ToJsonString());
        Assert.Equal(Overview(language), plans[2].Sentence(Overview(language), 0).Text);
        Assert.Equal(120, plans[2].Sentence("Answer", 0).PauseBeforeMs);
    }

    [Theory]
    [InlineData("simple")]
    [InlineData("greeting")]
    [InlineData("authenticated_profile_scope")]
    [InlineData("receipt")]
    [InlineData("humanHandoff")]
    [InlineData("fallbackUsed")]
    [InlineData("clarifyingQuestion")]
    [InlineData("proposedActions")]
    [InlineData("unverified")]
    public void Direct_sensitive_and_uncertain_replies_do_not_get_filler(string kind)
    {
        var delivery = Delivery();
        var result = Result();
        switch (kind)
        {
            case "greeting": case "authenticated_profile_scope": result["toolsUsed"] = new JsonArray(kind); break;
            case "receipt": result["receipt"] = new JsonObject(); break;
            case "humanHandoff": case "fallbackUsed": result[kind] = true; break;
            case "clarifyingQuestion": result[kind] = "Could you clarify?"; break;
            case "proposedActions": result[kind] = new JsonArray(new JsonObject()); break;
            case "unverified": result["verified"] = false; break;
        }
        for (var i = 0; i < 9; i++)
        {
            var plan = delivery.Prepare(result, kind == "simple" ? "Ready." : Overview("en"), "en");
            Assert.Null(plan.Acknowledgment);
            Assert.InRange(plan.Rate, .98, 1.02);
            if (kind != "unverified") Assert.InRange(plan.InitialPauseMs, 100, 150);
        }
    }

    [Fact]
    public void Language_changes_keep_the_same_delivery_timing_and_concise_source_sentences()
    {
        var en = Delivery().Prepare(Result(), Overview("en"), "en");
        var ar = Delivery().Prepare(Result(), Overview("ar"), "ar");
        Assert.Equal(en.InitialPauseMs, ar.InitialPauseMs);
        Assert.Equal(en.Rate, ar.Rate);
        Assert.Equal(en.DetailPauseMs, ar.DetailPauseMs);
        Assert.InRange(en.Sentence("Verified detail", 1).PauseBeforeMs, 60, 100);
    }

    [Fact]
    public void Repeated_configuration_entry_cannot_repeat_the_last_acknowledgment()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Voice:Conversation:Acknowledgments:0:En"] = "Okay…",
            ["Voice:Conversation:Acknowledgments:0:Ar"] = "طيب…"
        }).Build();
        var delivery = new VoiceCallDelivery(config);
        var plans = Enumerable.Range(0, 9).Select(_ => delivery.Prepare(Result(), Overview("en"), "en"));
        Assert.Single(plans.Where(p => p.Acknowledgment is not null));
    }
}
