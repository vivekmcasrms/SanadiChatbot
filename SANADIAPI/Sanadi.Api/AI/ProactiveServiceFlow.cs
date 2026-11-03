using System.Text.RegularExpressions;

namespace Sanadi.Api.AI;

// Services that no longer need a student request. Campus entry is proactive:
// the UAEU ID opens the gate, so the answer is the approved wording with no
// case, form, or service-owner route.
internal static class ProactiveServiceFlow
{
    internal sealed record Reply(string Answer, string Category, string ServiceCode);

    private const string Access =
        @"\b(entry|enter|entrance|access|gate|barrier|parking|car ?park|vehicle|car|drive in|driving in)\b|دخول|الدخول|بوابة|البوابة|حاجز|موقف|مواقف|مركبة|المركبة|سيارة|سيارتي";
    private const string Permit =
        @"\b(permit|permits|pass|sticker|badge|tag|clearance|authoris|authoriz|apply|application|request|need|require|how do i)\b|تصريح|تصاريح|ملصق|بطاقة دخول|تسجيل|طلب|أطلب|كيف";
    private const string Campus =
        @"\b(campus|university|uaeu|gate|parking|car ?park)\b|الحرم|الجامعة|جامعة الإمارات|البوابة|موقف|مواقف";
    private const string ExplicitPermit =
        @"\b(entry permit|campus (entry|access)|parking (permit|access|pass)|vehicle (permit|access|pass)|gate (access|pass|permit))\b|تصريح\s*(دخول)?|دخول (الحرم|الجامعة)|تصريح المواقف";
    private const string Problem =
        @"\b(not work\w*|doesn't work|didn't work|won't \w*open\w*|not \w*open\w*|didn't \w*open\w*|can't \w*open\w*|cannot \w*open\w*|declined|rejected|denied|failed|problem|issue|error|stuck|broken)\b|لا تعمل|لم تعمل|لا تفتح|لم تفتح|لا يفتح|لا يعمل|مشكلة|تعذر|مرفوضة|لا تستجيب";

    internal static bool IsCampusEntry(string text)
    {
        if (string.IsNullOrWhiteSpace(text) || !Matches(text, Access)) return false;
        if (Matches(text, ExplicitPermit)) return true;
        return Matches(text, Permit) && Matches(text, Campus);
    }

    internal static bool IsAccessProblem(string text)
    {
        if (string.IsNullOrWhiteSpace(text) || !Matches(text, Problem)) return false;
        return Matches(text, Access) || Matches(text, @"uaeu id|id card|بطاقة|الهوية الجامعية");
    }

    internal static Reply? Resolve(string text, string lang)
        => IsAccessProblem(text) ? Build(true, lang) : IsCampusEntry(text) ? Build(false, lang) : null;

    internal static Reply Build(bool accessProblem, string lang)
    {
        var ar = lang == "ar";
        if (accessProblem)
            return new(ar
                ? "نعتذر عن ذلك — من المفترض أن تفتح بطاقة الهوية الجامعية الخاصة بجامعة الإمارات البوابة دون أي طلب إضافي.\n\nيرجى تجربة البطاقة على قارئ بوابة آخر أولاً. وإذا لم تفتح البوابة بعد، توجه إلى مكتب الأمن في الحرم الجامعي مع بطاقتك الجامعية وسيتحققون من صلاحية الدخول فوراً.\n\nهل تريد أن أبلّغ فريق الأمن ليتمكنوا من التحقق من صلاحية بطاقتك؟"
                : "Sorry about that — your UAEU ID should open the gate without any extra request.\n\nPlease try your card at another gate reader first. If it still doesn't open, visit the Security Office on campus with your UAEU ID and they will check your access on the spot.\n\nWould you like me to report this to the Security team so they can check your card access?",
                "campus_entry_problem", "SVC-CAMPUS-ENTRY");
        return new(ar
            ? "**خبر سار — تم تسهيل دخولك إلى الحرم الجامعي مسبقاً.**\n\nلم تعد بحاجة إلى تقديم طلب منفصل أو انتظار الموافقة.\n\nيمكنك التوجه مباشرة إلى موقف السيارات المخصص واستخدام بطاقة الهوية الجامعية الخاصة بجامعة الإمارات للدخول عبر البوابة.\n\n**لا يلزمك اتخاذ أي إجراء إضافي — كل شيء جاهز لك.**"
            : "**Good news — your campus access is already taken care of.**\n\nYou no longer need to submit a separate request or wait for approval.\n\nSimply proceed to the designated parking area and use your UAEU ID to access the gate.\n\n**Nothing else is required from you — you're all set.**",
            "campus_entry_proactive", "SVC-CAMPUS-ENTRY");
    }

    private static bool Matches(string text, string pattern) =>
        Regex.IsMatch(text, pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
}
