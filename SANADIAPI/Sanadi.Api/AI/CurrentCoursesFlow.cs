using System.Text.RegularExpressions;

namespace Sanadi.Api.AI;

// Registered-subjects questions are answered from the student's enrollment.
// A later message that is only a course code asks for details the record does
// not hold (syllabus, instructor, schedule), so it becomes an enquiry.
internal static class CurrentCoursesFlow
{
    internal sealed record Course(string Code, string TitleEn, string? TitleAr, int CreditHours);

    private static readonly Regex Question = new(
        @"(courses?|subjects?|classes|modules?).{0,40}(am i (currently )?(taking|registered|enrolled)|i am (currently )?(taking|registered|enrolled)|this (semester|term)|current(ly)?)|(current|this term) (courses?|subjects?|registration)|المواد (الحالية|المسجلة)|المقررات (الحالية|المسجلة)|ماذا أدرس (الآن|هذا الفصل)|المواد المسجلة هذا الفصل",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly Regex CodeOnly = new(
        @"^(?<code>[A-Za-z]{2,10}[\s-]?\d{2,4}[A-Za-z]?)\s*[.!?؟]*$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    internal static bool IsQuestion(string text) =>
        !CourseTextbookFlow.IsQuestion(text) && Question.IsMatch(text.Trim());

    internal static string? ChosenCode(string text)
    {
        var match = CodeOnly.Match(text.Trim());
        if (!match.Success) return null;
        return Regex.Replace(match.Groups["code"].Value.ToUpperInvariant(), @"[\s-]+", "");
    }

    internal static Course? Match(string code, IReadOnlyList<Course> courses) =>
        courses.FirstOrDefault(c => Regex.Replace(c.Code.ToUpperInvariant(), @"[\s-]+", "") == code);

    internal static string Answer(IReadOnlyList<Course> courses, string lang)
    {
        var ar = lang == "ar";
        if (courses.Count == 0)
            return ar
                ? "لا توجد مواد مسجلة لك في الفصل الحالي."
                : "You are not registered for any courses this semester.";
        var lines = courses.Select((c, i) =>
        {
            var title = ar && !string.IsNullOrWhiteSpace(c.TitleAr) ? c.TitleAr : c.TitleEn;
            return $"{i + 1}. {c.Code} — {title} · {c.CreditHours} {(ar ? "س.م" : "cr")}";
        });
        var total = courses.Sum(c => c.CreditHours);
        var heading = ar ? "مواد الفصل الحالي" : "Current courses";
        var summary = ar
            ? $"المجموع: {courses.Count} مادة، {total} ساعة معتمدة هذا الفصل."
            : $"Total: {courses.Count} course(s), {total} credit hours this semester.";
        var link = ar ? "[عرض سجلي الأكاديمي الكامل](/academic#current)" : "[View full academic record](/academic#current)";
        return $"**{heading}**\n{string.Join("\n", lines)}\n\n{summary}\n\n{link}";
    }

    internal static string Inquiry(Course course, string unitName, string unitCode, string lang)
    {
        var ar = lang == "ar";
        var title = ar && !string.IsNullOrWhiteSpace(course.TitleAr) ? course.TitleAr : course.TitleEn;
        var subject = $"{course.Code} — {title}";
        if (ar)
            return $"""
                لطلب التفاصيل الكاملة حول توصيف المقرر أو المدرّس أو الجدول، يمكنني تقديم استفسار إلى **{unitName}**.

                **ملخص الطلب**
                - العنوان: استفسار عن تفاصيل مقرر {subject}
                - النوع: استفسار
                - الجهة المسؤولة: {unitName} ({unitCode})
                - مدة المعالجة: حتى 5 أيام عمل

                هل ترغب في المتابعة وتقديم هذا الطلب؟

                ملاحظة: تفصيل ثانوي واحد لم يتم تأكيده من مصدر رسمي، لذلك لم أعرضه.
                """;
        return $"""
            To request full details regarding the course syllabus, instructor, or schedule, I can submit an inquiry case to the **{unitName}**.

            **Request summary**
            TITLE: Inquiry about {course.Code} Course Details
            TYPE: Query
            RESPONSIBLE UNIT: {unitName} ({unitCode})
            PROCESSING TIME: Up to 5 working days

            Would you like me to proceed with submitting this request?

            Note: one secondary detail could not be confirmed from an official source, so I left it out.
            """;
    }
}
