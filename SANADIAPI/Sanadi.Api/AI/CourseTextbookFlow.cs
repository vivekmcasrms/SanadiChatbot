using System.Text.RegularExpressions;

namespace Sanadi.Api.AI;

// C# counterpart of src/lib/agent/textbook.server.ts. The existing service
// provides course material proactively through Blackboard, without an application.
internal static class CourseTextbookFlow
{
    internal sealed record Course(string Code, string TitleEn, string? TitleAr, int CreditHours = 0);
    internal sealed record Reply(string Answer, Course? Course, bool AwaitingCourse);

    private static readonly Regex Intent = new(
        @"\btext ?books?\b.*\b(course|class|subject|module|syllabus|my)\b|\b(course|class|subject)\b.*\btext ?books?\b|\btext ?books?\s+for\b|\bmy text ?books?\b|\brequired (text|reading|book|materials?)\b|\bcourse (materials?|readings?)\b|\bwhere (can|do) i (get|find|buy|order) (the |a |my )?(text ?book|course book)|كتاب المقرر|الكتاب المقرر|كتب المقرر|الكتب المقررة|كتاب المادة|كتب المواد|الكتاب الدراسي|الكتب الدراسية|مقرر.*كتاب|كتاب.*مقرر|أين أجد كتاب|وين كتاب|ألقى كتاب|القى كتاب",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex AdditionalResources = new(
        @"\b(another|additional|alternative|extra|other)\s+(text ?books?|books?|readings?|resources?|materials?)\b|كتب إضافية|كتاب آخر|مراجع إضافية|مصادر إضافية",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex CourseCode = new(@"(?<![\p{L}\p{N}])[a-z]{2,10}[\s-]*\d{2,4}[a-z]?(?![\p{L}\p{N}])", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    internal static bool IsQuestion(string text) => Intent.IsMatch(text) && !AdditionalResources.IsMatch(text);
    private static string Normalize(string text) => Regex.Replace(text.ToLowerInvariant(), @"[^\p{L}\p{N}]+", " ").Trim();
    private static string Compact(string text) => Regex.Replace(text.ToUpperInvariant(), @"[\s-]+", "");

    internal static Course? Resolve(string text, IReadOnlyList<Course> courses)
    {
        var codes = CourseCode.Matches(text).Select(m => Compact(m.Value)).Distinct().ToArray();
        // An explicit unknown code must not silently resolve to a different course by its title.
        if (codes.Length > 0)
            return codes.Length == 1 ? courses.FirstOrDefault(c => Compact(c.Code) == codes[0]) : null;
        var words = Normalize(text).Split(' ').Where(w => w.Length > 2).ToHashSet();
        words.ExceptWith(["the", "for", "and", "course", "class", "subject", "textbook", "material", "materials", "مقرر", "كتاب", "المقرر"]);
        if (Regex.IsMatch(text, @"\bai\b|a\.i\.", RegexOptions.IgnoreCase)) words.Add("artificial");
        var matches = courses.Select(c => new { Course = c, Score = Normalize(c.TitleEn + " " + c.TitleAr).Split(' ').Distinct().Count(words.Contains) })
            .Where(c => c.Score > 0).OrderByDescending(c => c.Score).ToArray();
        return matches.Length == 0 || (matches.Length > 1 && matches[0].Score == matches[1].Score) ? null : matches[0].Course;
    }

    // Only a course selection can continue a previous textbook turn. A new question,
    // greeting, booking, or request for extra books must keep its own existing route.
    internal static bool IsSelection(string text, IReadOnlyList<Course> courses)
    {
        if (text.Length > 100 || AdditionalResources.IsMatch(text)) return false;
        var clean = Normalize(text);
        if (courses.Any(c => clean == Normalize(c.TitleEn) || (!string.IsNullOrWhiteSpace(c.TitleAr) && clean == Normalize(c.TitleAr)))) return true;
        var remaining = CourseCode.Replace(text, "");
        return CourseCode.IsMatch(text) && Regex.IsMatch(Normalize(remaining), @"^(?:(?:for|the|please|course|yes|مقرر|المقرر|نعم|من فضلك)\s*)*$");
    }

    internal static Reply Build(string text, IReadOnlyList<Course> courses, string lang)
    {
        var ar = lang == "ar";
        var course = Resolve(text, courses);
        if (course is not null)
        {
            var name = ar && !string.IsNullOrWhiteSpace(course.TitleAr) ? course.TitleAr : course.TitleEn;
            return new(ar
                ? $"**خبر سار — تم توفير كتاب المقرر أو المادة التعليمية الرقمية لك بشكل استباقي.**\n\nيمكنك الوصول إلى النسخة الرقمية المتاحة من خلال مقرر **{course.Code} — {name}** على Blackboard.\n\n**لا تحتاج إلى تقديم أي طلب منفصل.**"
                : $"**Good news — your textbook is already taken care of.**\n\nThe textbook or available digital learning material for **{course.Code} — {name}** is proactively added to the corresponding Blackboard course.\n\nSimply open **{course.Code} in Blackboard** to access the available soft copy or course material.\n\n**No separate request is needed.**", course, false);
        }
        if (courses.Count == 0)
            return new(ar
                ? "**تم توفير كتب المقررات بشكل استباقي عبر Blackboard.**\n\nلكن لا أرى مقررات مسجلة لك حالياً في سجلك الأكاديمي، لذا لا أستطيع تحديد مقرر معين. إذا كنت مسجلاً حديثاً، يظهر مقررك على Blackboard فور اكتمال التسجيل.\n\n**لا حاجة إلى تقديم أي طلب.**"
                : "**Textbooks are proactively provided through Blackboard.**\n\nHowever, I don't see any courses registered on your record right now, so I can't point to a specific one. If you registered recently, your course appears on Blackboard as soon as registration completes.\n\n**No request is needed.**", null, false);
        var list = string.Join("\n", courses.Take(5).Select(c => $"- {c.Code} — {(ar && !string.IsNullOrWhiteSpace(c.TitleAr) ? c.TitleAr : c.TitleEn)}"));
        return new(ar ? $"**بالتأكيد. أي مقرر تقصد؟**\n\nمقرراتك المسجلة حالياً:\n{list}"
            : $"**Of course. Which course do you mean?**\n\nYour current courses:\n{list}", null, true);
    }
}
