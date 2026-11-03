using System.Text.Json.Nodes;
using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class VoiceConversationPolicyTests
{
    [Theory]
    [InlineData("yes", true)]
    [InlineData("yes, submit it", true)]
    [InlineData("هيه", true)]
    [InlineData("yes but change the date", false)]
    [InlineData("don't submit it", false)]
    [InlineData("نعم لكن غير الموعد", false)]
    public void Confirmation_requires_a_whole_unqualified_turn(string text, bool expected) =>
        Assert.Equal(expected, VoiceConversationPolicy.Confirms(text));

    [Theory]
    [InlineData("thanks", false)]
    [InlineData("شكرا", false)]
    [InlineData("goodbye", true)]
    [InlineData("مع السلامة", true)]
    [InlineData("Goodbye, but first book an appointment", false)]
    public void Only_explicit_farewell_ends_call(string text, bool expected) =>
        Assert.Equal(expected, VoiceConversationPolicy.EndsCall(text));

    [Fact]
    public void Ambiguous_selection_never_guesses_and_ordinal_uses_saved_option()
    {
        var metadata = JsonNode.Parse("""{"libraryResults":{"results":[{"title":"Calculus"},{"title":"Algebra"}]}}""")!.AsObject();
        Assert.Equal("", VoiceConversationPolicy.ResolveSelection("that one", metadata));
        Assert.Equal("Find the library book Algebra", VoiceConversationPolicy.ResolveSelection("the second one", metadata));
        Assert.Equal("", VoiceConversationPolicy.ResolveSelection("third", metadata));
        Assert.Null(VoiceConversationPolicy.ResolveSelection("book an appointment", metadata));
    }

    [Fact]
    public void Spoken_confirmation_is_offered_only_for_one_executable_proposal()
    {
        var result = JsonNode.Parse("""{"proposedActions":[{"toolName":"create_enquiry","args":{}}]}""")!.AsObject();
        Assert.Contains("yes, submit it", VoiceConversationPolicy.ConfirmationPrompt(result, "en"));
        result["proposedActions"]!.AsArray().Add(new JsonObject { ["toolName"] = "create_complaint", ["args"] = new JsonObject() });
        Assert.Equal("", VoiceConversationPolicy.ConfirmationPrompt(result, "en"));
    }

    [Fact]
    public void Speech_segmentation_keeps_numbers_and_all_words()
    {
        var answer = "Your GPA is 3.75 and Dr. Ahmed can explain your academic progress. Please review the full details in your student profile before deciding.";
        var segments = VoiceConversationPolicy.SpeechSegments(answer).ToArray();
        Assert.Equal(2, segments.Length);
        Assert.Equal(answer, string.Join(" ", segments));
    }

    [Fact]
    public void Hesitation_does_not_end_short_utterance_before_configured_window()
    {
        var gate = new SpeechActivityGate(false, false, 1200, true);
        for (var i = 0; i < 6; i++) gate.Update(.95f);
        for (var i = 0; i < 40; i++) Assert.NotEqual("pause", gate.Update(0));
        var events = Enumerable.Range(0, 10).Select(_ => gate.Update(0)).ToArray();
        Assert.Contains("pause", events);
    }
}
