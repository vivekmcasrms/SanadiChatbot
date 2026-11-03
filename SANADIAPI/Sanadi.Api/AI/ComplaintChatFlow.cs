using System.Text.RegularExpressions;

namespace Sanadi.Api.AI;

internal static class ComplaintChatFlow
{
    // Route only an explicit complaint or a reported service failure here.
    // Generic words such as "problem" and "issue" also appear in academic
    // and informational questions, so they must not select the complaint agent.
    internal static bool IsComplaintIntent(string text)
    {
        const RegexOptions options = RegexOptions.IgnoreCase | RegexOptions.CultureInvariant;
        return Regex.IsMatch(text,
            @"\b(?:complaints?|complain(?:ing|ed)?|unfair(?:ness)?|harassment|grievance)\b|شكوى|تظلم|تظلّم|تحرش",
            options) || IsServiceComplaint(text);
    }

    // Recognise a reported service failure, not a timetable question or an academic topic.
    // This detects intent only; the configured AI and active routing catalogue select the unit.
    internal static bool IsServiceComplaint(string text)
    {
        const RegexOptions options = RegexOptions.IgnoreCase | RegexOptions.CultureInvariant;
        if (Regex.IsMatch(text, @"\b(?:what if|hypothetically|if (?:the |my )?(?:bus|buses|shuttle))\b|ماذا لو", options)) return false;
        return Regex.IsMatch(text,
            @"\b(?:buses|bus|shuttle|transport|service|staff|office|room|internet|wifi|wi-fi|meal|food)\b.{0,80}\b(?:always late|often late|keeps? (?:being late|breaking)|(?:is|are|was|were) (?:very |so |too )?late|never (?:arrives?|comes?|responds?)|(?:is|are) not working|doesn['’]?t work|didn['’]?t (?:arrive|come|show up)|unacceptable)\b|(?:الحافلات|الحافلة|الباص|الخدمة|المواصلات|الإنترنت).{0,60}(?:تتأخر|يتأخر|لا تعمل|لا يعمل|لم تصل)", options);
    }

    internal static string Answer(string unit, string lang, bool canSubmit)
    {
        unit = unit.Replace("|", "\\|").Replace("\r", " ").Replace("\n", " ");
        if (lang == "ar")
            return $"آسف لما واجهته. أعددت تفاصيل شكواك لتوجيهها إلى **{unit}**.\n\n" +
                $"### تفاصيل التقديم\n\n- النوع: شكوى\n- الجهة المسؤولة: {unit}\n- موعد الاستجابة: يظهر في طلباتي بعد الموافقة على التقديم\n\n" +
                (canSubmit ? "راجع التفاصيل واضغط **تقديم هذه الشكوى**، ثم وافق في نافذة التأكيد. لن يتم إنشاء طلب قبل موافقتك. بعد التقديم يظهر الرقم المرجعي وموعد الاستجابة في طلباتي."
                    : "تقديم الشكوى عبر المحادثة غير متاح لحسابك حالياً. يمكنك مراجعة الجهة المختصة.");
        return $"I’m sorry about the difficulties you’ve experienced. I have prepared your complaint for **{unit}**.\n\n" +
            $"### Submission details\n\n- Type: Complaint\n- Unit: {unit}\n- Expected response time: Shown in My Requests after approval\n\n" +
            (canSubmit ? "Please review the details and select **Submit this complaint**, then approve in the confirmation window. Nothing is submitted until you approve. After submission, your reference number and response deadline will appear in My Requests."
                : "Chat submission is currently unavailable for your account. You can contact the responsible unit for assistance.");
    }
}
