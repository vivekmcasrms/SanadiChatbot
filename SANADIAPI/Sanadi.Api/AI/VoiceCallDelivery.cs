using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Sanadi.Api.AI;

/// <summary>Per-call speech presentation. Never changes or reclassifies a chat result.</summary>
internal sealed class VoiceCallDelivery(IConfiguration configuration)
{
    internal sealed record Acknowledgment(string En, string Ar);
    internal sealed record Segment(string Text, int PauseBeforeMs = 0, double Rate = 1);
    internal sealed record Plan(string? Acknowledgment, int InitialPauseMs, int DetailPauseMs, double Rate)
    {
        internal Segment Sentence(string text, int index) => new(text,
            index == 0 ? (Acknowledgment is null ? InitialPauseMs : 120) : DetailPauseMs,
            index == 0 ? Rate : Math.Max(.98, Rate - .01));

        // A completed overview is one utterance, including its optional lead-in.
        // Keep natural punctuation inside it; do not create a second audio node.
        internal Segment Reply(string overview, string? agent, string language, bool introduce)
        {
            if (string.IsNullOrWhiteSpace(overview)) return new("");
            var text = (introduce ? Introduction(agent, language) : "") + overview;
            if (Acknowledgment is { } acknowledgment) text = acknowledgment + " " + text;
            return new(text, InitialPauseMs, Rate);
        }
    }

    private int turns;
    private int eligibleTurns;
    private int acknowledgmentIndex;
    private string? previousAcknowledgment;

    // Model/TTS preparation already gives the student a natural pause. Do not add it again.
    internal static int RemainingStartPause(int targetMilliseconds, TimeSpan preparation)
        => Math.Max(0, targetMilliseconds - (int)Math.Clamp(preparation.TotalMilliseconds, 0, 1000));

    internal static string Introduction(string? agent, string language) => language == "ar"
        ? $"مرحباً، أنا {SupportAgentPersona.Name(agent, language)}، مساعدك في خدمات جامعة الإمارات. "
        : $"Hi, I'm {SupportAgentPersona.Name(agent, language)}, your UAEU support advisor. ";

    internal Plan Prepare(JsonObject result, string overview, string language)
    {
        turns++;
        var tools = result["toolsUsed"] as JsonArray;
        var direct = tools?.Any(t => (string?)t is "greeting" or "authenticated_profile_scope") == true ||
            result["receipt"] is JsonObject || result["issuedDocument"] is JsonObject;
        var sensitive = result["humanHandoff"]?.GetValue<bool>() == true ||
            result["fallbackUsed"]?.GetValue<bool>() == true ||
            result["proposedActions"] is JsonArray { Count: > 0 } ||
            !string.IsNullOrWhiteSpace(result["clarifyingQuestion"]?.GetValue<string>());
        var sentences = VoicePhrasing.Boundaries(overview).Count() + 1;
        // Infer presentation complexity from the completed response structure, never user keywords.
        var complex = !direct && !sensitive && sentences >= 3 &&
            Regex.Matches(overview, @"\S+").Count >= 40;
        var pause = complex ? 150 + turns % 3 * 25 : 100 + turns % 3 * 25;
        if (result["humanHandoff"]?.GetValue<bool>() == true) pause = 100;
        string? acknowledgment = null;
        if (complex && result["verified"]?.GetValue<bool>() == true && ++eligibleTurns % 3 == 0)
        {
            var choices = configuration.GetSection("Voice:Conversation:Acknowledgments").Get<Acknowledgment[]>() ?? [];
            for (var attempt = 0; attempt < choices.Length; attempt++)
            {
                var choice = choices[acknowledgmentIndex++ % choices.Length];
                var text = language == "ar" ? choice.Ar : choice.En;
                if (string.IsNullOrWhiteSpace(text) || text.Length > 100 || text == previousAcknowledgment) continue;
                acknowledgment = text;
                previousAcknowledgment = text;
                break;
            }
        }
        return new(acknowledgment, pause, 60 + turns % 3 * 20,
            complex || sensitive ? .98 : 1 + turns % 3 * .01);
    }
}
