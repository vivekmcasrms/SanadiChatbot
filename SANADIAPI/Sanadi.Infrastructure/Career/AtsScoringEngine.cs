using System.Text.RegularExpressions;

namespace Sanadi.Infrastructure.Career;

/// <summary>
/// Deterministic ATS engine (ats.v2 / ats-weights.v1) — port of core ats.server.ts.
/// Scores come only from structured CV evidence + verified student profile; never hardcoded.
/// </summary>
public static class AtsScoringEngine
{
    public const string EngineVersion = "ats.v2";
    public const string WeightsVersion = "ats-weights.v1";

    public static readonly BiText Disclaimer = new()
    {
        en = "ATS systems differ across employers. This score estimates CV readability and role alignment using Sanadi's scoring model and does not guarantee employer screening outcomes.",
        ar = "تختلف أنظمة الفرز الآلي بين جهات التوظيف. تقدّر هذه الدرجة وضوح السيرة الذاتية ومدى توافقها مع الوظيفة وفق نموذج سندي، ولا تضمن نتائج الفرز لدى جهة التوظيف.",
    };

    private static readonly AtsBandDto[] DefaultBands =
    [
        new() { min = 90, labelEn = "Excellent ATS Readiness", labelAr = "جاهزية ممتازة لأنظمة الفرز" },
        new() { min = 80, labelEn = "Strong", labelAr = "قوية" },
        new() { min = 70, labelEn = "Good, with improvements recommended", labelAr = "جيدة مع تحسينات مقترحة" },
        new() { min = 60, labelEn = "Needs Improvement", labelAr = "تحتاج إلى تحسين" },
        new() { min = 0, labelEn = "Significant Improvement Needed", labelAr = "تحتاج إلى تحسين جوهري" },
    ];

    private static readonly Dictionary<string, int> GeneralWeights = new()
    {
        ["parsing"] = 15, ["contact"] = 10, ["education"] = 10, ["skills"] = 15,
        ["experienceProject"] = 20, ["achievement"] = 10, ["keyword"] = 10,
        ["completeness"] = 5, ["clarity"] = 5,
    };

    private static readonly Dictionary<string, int> RoleWeights = new()
    {
        ["requiredSkills"] = 25, ["preferredSkills"] = 10, ["tools"] = 15, ["projects"] = 15,
        ["experience"] = 15, ["coursework"] = 10, ["certifications"] = 5, ["terminology"] = 5,
    };

    private static readonly string[] ActionVerbs =
    [
        "built", "developed", "designed", "implemented", "analysed", "analyzed", "led", "improved", "automated",
        "delivered", "created", "reduced", "increased", "deployed", "trained", "managed", "optimised", "optimized",
        "engineered", "researched", "presented", "launched", "migrated", "integrated",
    ];

    private static readonly string[] ProfessionalTerms =
    [
        "project", "team", "data", "analysis", "research", "design", "development", "testing", "report",
        "stakeholder", "requirements", "documentation", "presentation", "collaboration", "problem solving",
        "internship", "capstone", "dashboard", "database", "automation", "customer", "process", "quality",
    ];

    private static readonly Dictionary<string, string> Synonyms = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ml"] = "machine learning", ["ai"] = "artificial intelligence", ["js"] = "javascript", ["ts"] = "typescript",
        ["power-bi"] = "power bi", ["powerbi"] = "power bi", ["postgresql"] = "postgres",
        ["node js"] = "node.js", ["nodejs"] = "node.js", ["sklearn"] = "scikit-learn",
        ["sci-kit learn"] = "scikit-learn", ["ms excel"] = "excel", ["microsoft excel"] = "excel",
        ["nlp"] = "natural language processing", ["k8s"] = "kubernetes", ["amazon web services"] = "aws", ["cicd"] = "ci/cd",
    };

    private static readonly Dictionary<string, double> StrengthCredit = new()
    {
        ["none"] = 0, ["mentioned"] = 0.5, ["demonstrated"] = 0.85, ["strong"] = 1,
    };

    public static AtsScoreDto? ScoreGeneral(
        ParsedCv cv,
        string rawText,
        string? parsingStatus,
        StudentAtsEvidence evidence,
        CareerRoleAtsInput? targetRole,
        string? cvVersion = null)
    {
        var now = DateTime.UtcNow;
        var parsing = AssessParsing(cv, rawText, parsingStatus);
        if (parsing.confidence == "failed") return null;

        var strengths = new List<BiText>();
        var improvements = new List<BiText>();
        var text = rawText.ToLowerInvariant();
        var words = rawText.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length;
        var bullets = cv.experience.SelectMany(e => e.bullets).ToList();
        var descriptions = bullets.Concat(cv.projects.Select(p => p.description ?? "")).Where(d => !string.IsNullOrWhiteSpace(d)).ToList();

        if (parsing.ratio >= 0.9)
            strengths.Add(Bi("The CV parses cleanly and all standard sections are recognised.", "يتم تحليل السيرة الذاتية بوضوح ويتم التعرّف على جميع الأقسام القياسية."));
        else
            improvements.Add(Bi("Use clearly labelled, single-column sections (Education, Experience, Projects, Skills) so parsers read the CV correctly.", "استخدم أقساماً واضحة بعمود واحد (التعليم، الخبرة، المشاريع، المهارات) ليقرأ نظام الفرز سيرتك بشكل صحيح."));

        var hasLocation = Regex.IsMatch(rawText, @"\b(uae|emirates|abu dhabi|dubai|sharjah|al ain|ajman|fujairah|ras al khaimah|umm al quwain)\b", RegexOptions.IgnoreCase);
        var professionalEmail = cv.email is not null && !Regex.IsMatch(cv.email, @"(temp|fake|test)@", RegexOptions.IgnoreCase);
        double contactRatio = 0;
        if (!string.IsNullOrWhiteSpace(cv.fullName)) contactRatio += 0.25;
        if (cv.email is not null && professionalEmail) contactRatio += 0.35;
        if (!string.IsNullOrWhiteSpace(cv.phone)) contactRatio += 0.25;
        if (hasLocation) contactRatio += 0.05;
        if (cv.links.Count > 0) contactRatio += 0.1;
        contactRatio = Clamp01(contactRatio);
        var contactNotes = new List<BiText>();
        if (string.IsNullOrWhiteSpace(cv.email) || string.IsNullOrWhiteSpace(cv.phone))
        {
            contactNotes.Add(Bi("Add a professional email address and phone number at the top of the CV.", "أضف بريداً إلكترونياً مهنياً ورقم هاتف في أعلى السيرة الذاتية."));
            improvements.Add(contactNotes[^1]);
        }
        else if (cv.links.Count == 0)
        {
            contactNotes.Add(Bi("Add a LinkedIn or GitHub/portfolio link.", "أضف رابط LinkedIn أو GitHub أو معرض أعمالك."));
            improvements.Add(contactNotes[^1]);
        }
        else strengths.Add(Bi("Contact details are complete and machine-readable.", "بيانات التواصل كاملة وقابلة للقراءة الآلية."));

        double educationRatio = 0;
        if (cv.education.Count > 0) educationRatio += 0.5;
        if (cv.education.Any(e => !string.IsNullOrWhiteSpace(e.institution))) educationRatio += 0.15;
        if (cv.education.Any(e => !string.IsNullOrWhiteSpace(e.qualification))) educationRatio += 0.2;
        if (cv.education.Any(e => !string.IsNullOrWhiteSpace(e.period))) educationRatio += 0.15;
        educationRatio = Clamp01(educationRatio);
        var educationNotes = new List<BiText>();
        if (educationRatio < 1)
        {
            educationNotes.Add(Bi("State your university, degree/programme and expected graduation date on the education entry.", "اذكر الجامعة والدرجة/البرنامج وتاريخ التخرج المتوقع في بند التعليم."));
            improvements.Add(educationNotes[0]);
        }

        var uniqueSkills = cv.skills.Concat(cv.tools).Concat(cv.projects.SelectMany(p => p.technologies))
            .Select(Norm).Where(s => s.Length > 1).ToHashSet(StringComparer.Ordinal);
        var evidencedSkills = uniqueSkills.Select(s => SkillEvidence(cv, s)).ToList();
        var demonstratedCount = evidencedSkills.Count(e => e.strength is "demonstrated" or "strong");
        var skillsRatio = Clamp01(0.7 * Math.Min(1, uniqueSkills.Count / 10.0) + 0.3 * Math.Min(1, demonstratedCount / 4.0));
        var skillsNotes = new List<BiText>();
        if (uniqueSkills.Count < 10)
        {
            skillsNotes.Add(Bi("List at least 10 distinct technical skills, tools and languages in a dedicated Skills section.", "أدرج ما لا يقل عن 10 مهارات وأدوات ولغات تقنية مختلفة في قسم مخصص للمهارات."));
            improvements.Add(skillsNotes[^1]);
        }
        if (demonstratedCount < 4)
        {
            skillsNotes.Add(Bi("Show your key skills in action inside project or experience bullets, not only as a list.", "أظهر مهاراتك الأساسية داخل وصف المشاريع أو الخبرات، وليس كقائمة فقط."));
            improvements.Add(skillsNotes[^1]);
        }
        if (uniqueSkills.Count >= 12 && demonstratedCount >= 4)
            strengths.Add(Bi("Skills are both listed and demonstrated in your projects.", "المهارات مذكورة وموثقة في مشاريعك أيضاً."));

        var describedItems = cv.experience.Select(e => string.Join(" ", e.bullets))
            .Concat(cv.projects.Select(p => $"{p.description} {string.Join(" ", p.technologies)}"))
            .Count(d => d.Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length >= 8);
        var totalItems = cv.experience.Count + cv.projects.Count;
        var hasActionVerbs = descriptions.Any(d => ActionVerbs.Any(v => d.Contains(v, StringComparison.OrdinalIgnoreCase)));
        var datedItems = cv.experience.Count(e => !string.IsNullOrWhiteSpace(e.period))
            + cv.education.Count(e => !string.IsNullOrWhiteSpace(e.period));
        double expRatio =
            Math.Min(0.45, cv.experience.Count * 0.2) +
            Math.Min(0.3, cv.projects.Count * 0.12) +
            (evidence.hasInternship ? 0.15 : 0) +
            Math.Min(0.2, describedItems * 0.07) +
            (hasActionVerbs ? 0.1 : 0) +
            (datedItems > 0 ? 0.05 : 0);
        expRatio = Clamp01(expRatio);
        var expNotes = new List<BiText>();
        if (totalItems < 2)
        {
            expNotes.Add(Bi("Add at least two projects (capstone, coursework or personal) with a short description of what you did.", "أضف مشروعين على الأقل (مشروع تخرج أو دراسي أو شخصي) مع وصف موجز لما قمت به."));
            improvements.Add(expNotes[^1]);
        }
        if (!hasActionVerbs)
        {
            expNotes.Add(Bi("Start each bullet with an action verb (built, analysed, automated, delivered).", "ابدأ كل نقطة بفعل إجرائي (بنيت، حللت، أتمتت، أنجزت)."));
            improvements.Add(expNotes[^1]);
        }
        if (evidence.hasInternship && cv.experience.Count == 0)
        {
            expNotes.Add(Bi("Your verified internship is missing from the CV — add it as an experience entry.", "تدريبك العملي المعتمد غير مذكور في السيرة الذاتية — أضفه كخبرة."));
            improvements.Add(expNotes[^1]);
        }

        var quantified = bullets.Concat(cv.achievements)
            .Count(b => Regex.IsMatch(b.ToLowerInvariant(), @"\d+\s*(%|percent|users|students|hours|records|aed|k\b)|\b\d{2,}\b"));
        var leadership = Regex.IsMatch(rawText, @"\b(led|president|captain|founder|chair|organis|organiz|volunteer|mentor)", RegexOptions.IgnoreCase);
        var achievementRatio = Clamp01(
            Math.Min(0.5, quantified * 0.17) +
            (cv.certifications.Count > 0 ? 0.2 : 0) +
            (cv.achievements.Count > 0 ? 0.2 : 0) +
            (leadership ? 0.1 : 0));
        var achievementNotes = new List<BiText>();
        if (quantified < 3)
        {
            achievementNotes.Add(Bi("Quantify at least three results (accuracy achieved, records processed, hours saved, users reached).", "أضف نتائج قابلة للقياس في ثلاث نقاط على الأقل (دقة النموذج، عدد السجلات، الساعات الموفّرة، عدد المستخدمين)."));
            improvements.Add(achievementNotes[^1]);
        }
        else strengths.Add(Bi("Several achievements are quantified with measurable outcomes.", "عدد من الإنجازات موثق بنتائج قابلة للقياس."));
        if (cv.certifications.Count == 0)
            achievementNotes.Add(Bi("Add any certifications, competitions or awards you have completed.", "أضف الشهادات أو المسابقات أو الجوائز التي حصلت عليها."));

        var matchedTerms = ProfessionalTerms.Count(t => text.Contains(t));
        var roleKeywords = targetRole?.ats_keywords ?? [];
        var matchedRoleKeywords = roleKeywords.Where(k =>
            text.Contains(k.ToLowerInvariant()) || uniqueSkills.Any(s => s.Contains(Norm(k)))).ToArray();
        var recommendedKeywords = roleKeywords.Where(k => !matchedRoleKeywords.Contains(k)).Take(10).ToList();
        var keywordRatio = Clamp01(roleKeywords.Length > 0
            ? 0.5 * Math.Min(1, matchedTerms / 10.0) + 0.5 * (matchedRoleKeywords.Length / (double)roleKeywords.Length)
            : Math.Min(1, matchedTerms / 10.0));
        var keywordNotes = new List<BiText>();
        if (recommendedKeywords.Count > 0 && targetRole is not null)
        {
            keywordNotes.Add(Bi(
                $"Mirror the professional wording used in {targetRole.title_en} adverts where it is genuinely true of you: {string.Join(", ", recommendedKeywords.Take(6))}.",
                $"استخدم المصطلحات المهنية الواردة في إعلانات وظيفة {targetRole.title_ar} عندما تنطبق عليك فعلاً: {string.Join("، ", recommendedKeywords.Take(6))}."));
            improvements.Add(keywordNotes[0]);
        }

        var dateIssues = ValidateDates(cv, now);
        var duplicateBullets = bullets.Count - bullets.Select(b => b.Trim().ToLowerInvariant()).Distinct().Count();
        var completenessRatio = Clamp01(
            (!string.IsNullOrWhiteSpace(cv.summary) ? 0.3 : 0) +
            (cv.education.Count > 0 && (cv.experience.Count > 0 || cv.projects.Count > 0) && uniqueSkills.Count > 0 ? 0.3 : 0) +
            (dateIssues.Count == 0 ? 0.2 : 0) +
            (duplicateBullets == 0 ? 0.2 : 0));
        var completenessNotes = new List<BiText>();
        if (string.IsNullOrWhiteSpace(cv.summary))
        {
            completenessNotes.Add(Bi("Open with a two or three line professional summary naming your target role.", "ابدأ سيرتك بملخص مهني من سطرين أو ثلاثة يذكر الوظيفة المستهدفة."));
            improvements.Add(completenessNotes[^1]);
        }
        completenessNotes.AddRange(dateIssues);
        if (duplicateBullets > 0)
            completenessNotes.Add(Bi("Remove duplicated bullet points.", "احذف النقاط المكررة."));

        var clarityRatio = Clamp01(
            (words >= 200 ? 0.4 : words >= 120 ? 0.2 : 0) +
            (words <= 1400 ? 0.2 : 0) +
            (bullets.Count + cv.projects.Count >= 3 ? 0.2 : 0) +
            (cv.sections.Count >= 3 ? 0.2 : 0));
        var clarityNotes = new List<BiText>();
        if (words < 200)
        {
            clarityNotes.Add(Bi("The CV is very short — describe your projects and experience in more detail.", "السيرة الذاتية قصيرة جداً — فصّل أكثر في وصف مشاريعك وخبراتك."));
            improvements.Add(clarityNotes[0]);
        }
        else if (words > 1400)
        {
            clarityNotes.Add(Bi("The CV is very long — keep the most relevant content and tighten the bullets.", "السيرة الذاتية طويلة جداً — أبقِ المحتوى الأكثر صلة واختصر النقاط."));
            improvements.Add(clarityNotes[0]);
        }

        var parts = new (string key, double ratio, string labelEn, string labelAr, List<BiText> notes)[]
        {
            ("parsing", parsing.ratio, "Parsing & Readability", "قابلية القراءة الآلية", parsing.notes),
            ("contact", contactRatio, "Contact Information", "بيانات التواصل", contactNotes),
            ("education", educationRatio, "Education", "التعليم", educationNotes),
            ("skills", skillsRatio, "Skills", "المهارات", skillsNotes),
            ("experienceProject", expRatio, "Experience & Projects", "الخبرات والمشاريع", expNotes),
            ("achievement", achievementRatio, "Achievements & Evidence", "الإنجازات والأدلة", achievementNotes),
            ("keyword", keywordRatio, "Keywords & Professional Language", "المصطلحات المهنية", keywordNotes),
            ("completeness", completenessRatio, "Completeness & Consistency", "الاكتمال والاتساق", completenessNotes),
            ("clarity", clarityRatio, "Clarity & Formatting", "الوضوح والتنسيق", clarityNotes),
        };

        var categories = parts.Select(p =>
        {
            var max = GeneralWeights.GetValueOrDefault(p.key);
            return new AtsCategoryDto
            {
                key = p.key, labelEn = p.labelEn, labelAr = p.labelAr,
                max = max, score = Math.Min(max, (int)Math.Round(Clamp01(p.ratio) * max)), notes = p.notes,
            };
        }).ToList();

        var overall = Math.Clamp(categories.Sum(c => c.score), 0, 100);
        if (parsing.confidence == "low")
        {
            improvements.Insert(0, Bi(
                "Your CV could not be read reliably. Please upload a cleaner PDF or DOCX for a more accurate ATS assessment.",
                "تعذّرت قراءة سيرتك الذاتية بشكل موثوق. يرجى رفع ملف PDF أو Word أوضح للحصول على تقييم أدق لأنظمة الفرز."));
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var uniqueImprovements = improvements.Where(i => seen.Add(i.en)).ToList();

        return new AtsScoreDto
        {
            cvVersion = cvVersion,
            calculatedAt = now.ToString("o"),
            confidence = parsing.confidence,
            confidenceNote = parsing.confidence == "low"
                ? Bi("Your CV could not be read reliably, so this score is indicative only.", "تعذّرت قراءة سيرتك الذاتية بشكل موثوق، لذا فهذه الدرجة استرشادية فقط.")
                : null,
            overall = overall,
            band = BandFor(overall),
            categories = categories,
            strengths = strengths,
            improvements = uniqueImprovements,
            recommendedKeywords = recommendedKeywords,
            evidence = evidencedSkills.Where(e => e.strength != "none").Take(40).ToList(),
            dateIssues = dateIssues,
        };
    }

    public static RoleAtsScoreDto ScoreRole(
        CareerRoleAtsInput role,
        ParsedCv cv,
        string rawText,
        StudentAtsEvidence evidence,
        string? cvVersion = null)
    {
        var now = DateTime.UtcNow;
        var text = (rawText ?? "").ToLowerInvariant();

        (double ratio, List<SkillEvidenceDto> items) Credit(string[] skills)
        {
            if (skills.Length == 0) return (1, []);
            var items = skills.Select(s => SkillEvidence(cv, s)).ToList();
            var total = items.Sum(i => StrengthCredit.GetValueOrDefault(i.strength));
            return (Clamp01(total / skills.Length), items);
        }

        var required = Credit(role.required_hard_skills);
        var preferred = Credit(role.preferred_hard_skills);
        var tools = Credit(role.preferred_tools);
        var certs = Credit(role.certifications);

        var roleTerms = role.required_hard_skills.Concat(role.preferred_hard_skills).Concat(role.preferred_tools).ToArray();
        var relevantProjects = cv.projects.Where(p =>
            roleTerms.Any(s => Mentions($"{p.title} {p.description} {string.Join(" ", p.technologies)}", s))).ToList();
        var projectsRatio = Clamp01(
            Math.Min(0.7, relevantProjects.Count * 0.35) +
            (relevantProjects.Any(p => (p.description ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length >= 12) ? 0.2 : 0) +
            (relevantProjects.Any(p => Regex.IsMatch(p.description ?? "", @"\d")) ? 0.1 : 0));

        var relevantExperience = cv.experience.Where(e =>
            roleTerms.Any(s => Mentions(string.Join(" ", new[] { e.title ?? "" }.Concat(e.bullets)), s))).ToList();
        var experienceRatio = Clamp01(
            Math.Min(0.6, relevantExperience.Count * 0.35) +
            (evidence.hasInternship ? 0.3 : 0) +
            (relevantExperience.Any(e => e.bullets.Any(b => Regex.IsMatch(b, @"\d"))) ? 0.1 : 0));

        var courseText = string.Join(" ", evidence.completedCourses.SelectMany(c => new[] { c.title, c.code }));
        var matchedCourses = role.preferred_courses.Where(c => Mentions(courseText, c)).ToArray();
        var programmeMatch = role.suitable_programmes.Any(p => Mentions(evidence.programmeEn ?? "", p));
        var courseworkRatio = Clamp01(
            (role.preferred_courses.Length > 0 ? 0.7 * (matchedCourses.Length / (double)role.preferred_courses.Length) : 0.5) +
            (programmeMatch ? 0.3 : 0));

        var keywords = role.ats_keywords;
        var matchedKeywords = keywords.Where(k => text.Contains(k.ToLowerInvariant())).ToArray();
        var terminologyRatio = keywords.Length > 0 ? Clamp01(matchedKeywords.Length / (double)keywords.Length) : 0.5;

        var parts = new (string key, double ratio, string labelEn, string labelAr)[]
        {
            ("requiredSkills", required.ratio, "Required skills", "المهارات المطلوبة"),
            ("preferredSkills", preferred.ratio, "Preferred skills", "المهارات المفضلة"),
            ("tools", tools.ratio, "Tools & platforms", "الأدوات والمنصات"),
            ("projects", projectsRatio, "Relevant projects", "المشاريع ذات الصلة"),
            ("experience", experienceRatio, "Relevant experience", "الخبرة ذات الصلة"),
            ("coursework", courseworkRatio, "Coursework & education", "المقررات والتعليم"),
            ("certifications", certs.ratio, "Certifications", "الشهادات"),
            ("terminology", terminologyRatio, "Role terminology", "مصطلحات الوظيفة"),
        };

        var categories = parts.Select(p =>
        {
            var max = RoleWeights.GetValueOrDefault(p.key);
            return new AtsCategoryDto
            {
                key = p.key, labelEn = p.labelEn, labelAr = p.labelAr,
                max = max, score = Math.Min(max, (int)Math.Round(Clamp01(p.ratio) * max)), notes = [],
            };
        }).ToList();

        var overall = Math.Clamp(categories.Sum(c => c.score), 0, 100);
        var allItems = required.items.Concat(preferred.items).Concat(tools.items).ToList();
        var strongMatches = allItems.Where(i => i.strength is "demonstrated" or "strong").Take(8).ToList();
        var missing = allItems.Where(i => i.strength == "none").Select(i => i.skill).ToList();
        if (relevantProjects.Count == 0)
            missing.Add(role.portfolio_expectations ?? "Portfolio project");
        if (relevantExperience.Count == 0 && !evidence.hasInternship)
            missing.Add(role.experience_expectations ?? "Applied experience");

        return new RoleAtsScoreDto
        {
            roleId = role.id.ToString("D"),
            roleCode = role.role_code,
            titleEn = role.title_en,
            titleAr = role.title_ar,
            overall = overall,
            band = BandFor(overall),
            categories = categories,
            strongMatches = strongMatches,
            missingEvidence = missing.Take(8).ToList(),
            cvVersion = cvVersion,
            calculatedAt = now.ToString("o"),
        };
    }

    private static (string confidence, double ratio, List<BiText> notes) AssessParsing(ParsedCv cv, string rawText, string? parsingStatus)
    {
        var notes = new List<BiText>();
        if (parsingStatus == "failed" || string.IsNullOrWhiteSpace(rawText) || rawText.Trim().Length < 60)
        {
            return ("failed", 0, [
                Bi("No readable text could be extracted from this file. Upload a text-based PDF or a DOCX rather than a scan.",
                    "تعذّر استخراج نص قابل للقراءة من هذا الملف. يرجى رفع ملف PDF نصي أو ملف Word بدلاً من صورة ممسوحة ضوئياً.")
            ]);
        }

        var words = rawText.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length;
        var corrupted = Regex.Matches(rawText, @"[\uFFFD]|[\u0000-\u0008\u000B\u000C\u000E-\u001F]").Count;
        var corruptRatio = corrupted / (double)Math.Max(1, rawText.Length);
        var lines = rawText.Split('\n').Where(l => !string.IsNullOrWhiteSpace(l)).ToArray();
        var columnArtefacts = lines.Count(l => Regex.IsMatch(l, @"\S {4,}\S {4,}\S")) / (double)Math.Max(1, lines.Length);

        var expected = new[] { "education", "experience", "skills", "projects" };
        var lower = rawText.ToLowerInvariant();
        var found = expected.Where(s => lower.Contains(s) || cv.sections.Any(x => Norm(x).Contains(s))).ToArray();

        double ratio = 0;
        ratio += words >= 120 ? 0.3 : words >= 60 ? 0.15 : 0;
        ratio += 0.3 * (found.Length / (double)expected.Length);
        ratio += corruptRatio < 0.001 ? 0.2 : corruptRatio < 0.01 ? 0.1 : 0;
        ratio += columnArtefacts < 0.15 ? 0.2 : columnArtefacts < 0.35 ? 0.1 : 0;
        ratio = Clamp01(ratio);

        if (found.Length < expected.Length)
            notes.Add(Bi($"Some standard sections were not recognised: {string.Join(", ", expected.Except(found))}.",
                $"لم يتم التعرّف على بعض الأقسام القياسية: {string.Join("، ", expected.Except(found))}."));
        if (columnArtefacts >= 0.35)
            notes.Add(Bi("Multi-column or table layout is interfering with text extraction. A single-column layout parses more reliably.",
                "التنسيق متعدد الأعمدة أو الجداول يعيق استخراج النص. التنسيق بعمود واحد أسهل في القراءة الآلية."));
        if (corruptRatio >= 0.001)
            notes.Add(Bi("Some characters were extracted incorrectly, which can confuse automated screening.",
                "تم استخراج بعض المحارف بشكل غير صحيح، ما قد يربك أنظمة الفرز الآلي."));

        var structured = cv.education.Count + cv.experience.Count + cv.projects.Count + cv.skills.Count;
        var confidence = parsingStatus == "parsed" && ratio >= 0.75 && structured >= 4 ? "high"
            : ratio >= 0.5 && structured >= 2 ? "medium" : "low";
        return (confidence, ratio, notes);
    }

    public static SkillEvidenceDto SkillEvidence(ParsedCv cv, string skill)
    {
        var listed = cv.skills.Concat(cv.tools).Concat(cv.certifications).Any(s => Mentions(s, skill));
        var contexts = Sentences(
            cv.experience.SelectMany(e => new[] { $"{e.title} {e.organisation}" }.Concat(e.bullets))
                .Concat(cv.projects.Select(p => $"{p.title} {p.description} {string.Join(", ", p.technologies)}"))
                .Concat(cv.achievements)
                .Append(cv.summary)
        ).Where(s => Mentions(s, skill)).ToList();

        if (contexts.Count == 0)
            return new SkillEvidenceDto { skill = skill, strength = listed ? "mentioned" : "none" };

        var strong = contexts.FirstOrDefault(c => Regex.IsMatch(c, @"\d") && ActionVerbs.Any(v => c.Contains(v, StringComparison.OrdinalIgnoreCase)));
        if (strong is not null)
            return new SkillEvidenceDto { skill = skill, strength = "strong", excerpt = strong[..Math.Min(220, strong.Length)] };
        var demonstrated = contexts.FirstOrDefault(c => c.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length >= 5) ?? contexts[0];
        return new SkillEvidenceDto { skill = skill, strength = "demonstrated", excerpt = demonstrated[..Math.Min(220, demonstrated.Length)] };
    }

    private static List<BiText> ValidateDates(ParsedCv cv, DateTime now)
    {
        // Keep lightweight — flag only obviously broken "Present" mismatches via period text order.
        var issues = new List<BiText>();
        foreach (var e in cv.experience.Where(x => !string.IsNullOrWhiteSpace(x.period)))
        {
            var parts = Regex.Split(e.period!, @"[–—-]|\bto\b", RegexOptions.IgnoreCase)
                .Select(p => p.Trim()).Where(p => p.Length > 0).ToArray();
            if (parts.Length < 2) continue;
            var startYear = Regex.Match(parts[0], @"\b(19|20)\d{2}\b");
            var endYear = Regex.Match(parts[1], @"\b(19|20)\d{2}\b");
            if (startYear.Success && endYear.Success &&
                int.Parse(startYear.Value) > int.Parse(endYear.Value))
            {
                issues.Add(Bi($"\"{e.title ?? e.organisation ?? "experience"}\" starts after it ends ({e.period}).",
                    $"\"{e.title ?? e.organisation ?? "experience"}\" يبدأ بعد تاريخ انتهائه ({e.period})."));
            }
        }
        return issues;
    }

    private static AtsBandDto BandFor(int score) =>
        DefaultBands.OrderByDescending(b => b.min).First(b => score >= b.min);

    private static IEnumerable<string> Sentences(IEnumerable<string?> parts)
    {
        var outSet = new HashSet<string>(StringComparer.Ordinal);
        foreach (var p in parts)
        {
            if (string.IsNullOrWhiteSpace(p)) continue;
            foreach (var s in Regex.Split(p, @"(?<=[.;!?])\s+|\n+"))
            {
                var t = s.Trim();
                if (t.Length >= 8) outSet.Add(t);
            }
        }
        return outSet;
    }

    private static bool Mentions(string haystack, string needle)
    {
        var n = Norm(needle);
        if (n.Length < 2) return false;
        var h = $" {Norm(haystack)} ";
        return h.Contains($" {n} ") || h.Contains($"{n} ") || h.Contains($" {n}") || Norm(haystack).Contains(n);
    }

    public static string Norm(string value)
    {
        var s = Regex.Replace(value.ToLowerInvariant(), @"[\u2018\u2019']", "");
        s = Regex.Replace(s, @"[^a-z0-9+#./ -]", " ");
        s = Regex.Replace(s, @"\s+", " ").Trim();
        return Synonyms.GetValueOrDefault(s) ?? s;
    }

    private static double Clamp01(double n) => double.IsFinite(n) ? Math.Max(0, Math.Min(1, n)) : 0;

    private static BiText Bi(string en, string ar) => new() { en = en, ar = ar };
}
