using System.Text.RegularExpressions;

namespace Sanadi.Application.Agent;

/// <summary>
/// Deterministic small-talk detection. Greetings, thanks and farewells get a natural
/// reply and never carry the "could not verify against an official document" notice.
/// </summary>
public static partial class ConversationalDetector
{
    private static readonly string[] Patterns =
    {
        @"^(hi|hey|hello|yo|salam|salaam|assalamu\s*alaikum|مرحبا|السلام\s*عليكم|هلا|اهلا|أهلا)\b",
        @"^(thanks|thank you|thx|شكرا|شكراً|جزاك الله)\b",
        @"^(bye|goodbye|good night|see you|مع السلامة|الى اللقاء|إلى اللقاء)\b",
        @"^(good (morning|afternoon|evening)|صباح الخير|مساء الخير)\b",
        @"^(how are you|كيف حالك|شلونك)\b",
        @"^(ok|okay|got it|great|nice|تمام|تمام شكرا)\W*$",
    };

    public static bool IsSmallTalk(string message)
    {
        var text = message.Trim().ToLowerInvariant();
        if (text.Length == 0 || text.Length > 60) return false;
        // A short greeting followed by a real question is not small talk.
        if (text.Contains('?') || text.Contains('؟')) return false;
        return Patterns.Any(p => Regex.IsMatch(text, p, RegexOptions.IgnoreCase));
    }

    public static string Reply(string message, Lang lang, string? firstName)
    {
        var name = string.IsNullOrWhiteSpace(firstName) ? "" : $" {firstName}";
        var t = message.Trim().ToLowerInvariant();
        var bye = Regex.IsMatch(t, @"^(bye|goodbye|good night|see you|مع السلامة|الى اللقاء|إلى اللقاء)");
        var thanks = Regex.IsMatch(t, @"^(thanks|thank you|thx|شكرا|شكراً)");
        if (lang == Lang.Ar)
        {
            if (bye) return "مع السلامة! أنا هنا في أي وقت تحتاج فيه المساعدة.";
            if (thanks) return "على الرحب والسعة! هل يمكنني مساعدتك في شيء آخر؟";
            return $"أهلاً{name}! أنا سندي، مساعدك في خدمات الطلبة. كيف أستطيع مساعدتك اليوم؟";
        }
        if (bye) return "Goodbye! I am here whenever you need help.";
        if (thanks) return "You are very welcome. Is there anything else I can help with?";
        return $"Hello{name}! I am Sanadi, your student services assistant. How can I help you today?";
    }
}
