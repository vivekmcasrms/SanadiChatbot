using System.Text.RegularExpressions;

namespace Sanadi.Api.AI;

internal static class SuggestionChatFlow
{
    // Same institutional-feedback framing and personal-request guard as the original UI agent.
    private const string Institution = "(the )?(university|uaeu|college|faculty|campus|library|centre|center|service|department|administration)";
    private static readonly Regex Framing = new(string.Join("|", new[] {
        "it (would|could|'d) be (helpful|nice|great|better|useful|good) if",
        "it'?d be (helpful|nice|great|better|useful) if", "would(n'?t)? it be (nice|good|better|great|helpful) if",
        "i (would like to )?(suggest|propose|recommend)", "my suggestion", "i have (a|an) (suggestion|idea)", "here is an idea",
        $"(i (think|believe|feel) )?{Institution} (should|could|needs to|need to|must|ought to|has to)",
        "students would benefit", "(we|students) (really )?need (more|better|stronger|additional)",
        "there should be (more|better|stronger|additional)",
        "you (should|could) (offer|provide|add|extend|stay|open|run|make|have|start|allow|build|create|partner)",
        $"why (don'?t|doesn'?t) (you|{Institution})", "please (consider|extend|add|offer|provide|open|stay open)",
        $"can (you|{Institution}) (please )?(consider|extend|add|offer|provide|stay open|open (earlier|later))",
        "i wish (you|the|there)", "i'?d love (if|to see)", "would love (if|to see)", "hope you (can|will|could)",
        "أقترح", "اقتراح", "لدي اقتراح", "عندي اقتراح", "يا ليت", "لماذا لا", "لمَ لا", "أتمنى (أن|لو)",
        "أود أن أقترح", "أرجو (توفير|إضافة|تمديد|النظر)", "لو (يتم|كان هناك|تقومون|تقوم)",
        "أعتقد أن (الجامعة|الكلية|الإدارة|الجهة)", "من الأفضل أن", "سيكون من (المفيد|الأفضل|الجيد)",
        "(الجامعة|الكلية|الإدارة) (يجب|ينبغي|بإمكانها|يمكنها) أن", "نحتاج (إلى )?(المزيد|شراكات|فرص)"
    }), RegexOptions.IgnoreCase | RegexOptions.Compiled);

    internal static bool IsSuggestion(string text)
    {
        if (string.IsNullOrWhiteSpace(text) || !Framing.IsMatch(text)) return false;
        var personal = Regex.IsMatch(text,@"\b(help me|for me|my (case|request|application|registration|hold|account|record|cv|resume|appointment)|i (need|want|can'?t|cannot|have|am))\b",RegexOptions.IgnoreCase);
        return !personal || Regex.IsMatch(text,"suggest|اقتراح|أقترح",RegexOptions.IgnoreCase);
    }

    internal static string Answer(string text,string unit,string lang,bool canSubmit)
    {
        if (lang == "ar")
            return $"شكراً لك. فهمت رسالتك كاقتراح لتحسين خدمة جامعية.\n\n**الاقتراح:** {text}\n\n" +
                (canSubmit ? $"يمكنني إرساله إلى **{unit}** للمراجعة وإعطاؤك رقماً مرجعياً للتتبع. اضغط **تقديم هذا الاقتراح** وراجع التفاصيل في نافذة الموافقة. لن يتم تقديمه قبل موافقتك."
                    : "تقديم الاقتراح عبر المحادثة غير متاح لحسابك حالياً.");
        return $"Thank you. I have read this as a suggestion to improve a university service.\n\n**Suggestion:** {text}\n\n" +
            (canSubmit ? $"I can submit this to **{unit}** for review and give you a tracking reference. Select **Submit this suggestion** to review the approval details. Nothing is submitted until you approve."
                : "Chat submission is currently unavailable for your account.");
    }
}
