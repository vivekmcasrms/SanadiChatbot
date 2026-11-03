using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Sanadi.Api.AI;

// Presentation adapter for the existing deterministic Career analysis. Never scores roles.
internal static class CareerChatFlow
{
    internal sealed record Reply(string Answer, JsonObject Card, JsonArray NextSteps);
    internal static string? Topic(string text)
    {
        bool Has(string pattern) => Regex.IsMatch(text, pattern, RegexOptions.IgnoreCase);
        // Keep bookings, human counsellors, interview coaching and definitions on their own paths.
        if (Has(@"\b(counsell?or|advisor|adviser|interview|appointment)\b|مرشد|مستشار|موعد|مقابلة")) return null;
        if (Has(@"^(what (is|are)|define|explain|ما هو|ما هي)\b") && !Has(@"\b(my|me|i)\b|سيرتي|تخصصي|مهاراتي")) return null;
        if (Has(@"\b(ats|applicant tracking|resume score|cv score|screening system|keyword(s)? (match|missing))\b|نظام الفرز|أنظمة الفرز|درجة السيرة|درجة سيرتي")) return "ats";
        if (Has(@"\b((review|check|improve|fix|rewrite) my (cv|resume)|feedback on my (cv|resume)|cv review|is my (cv|resume) (good|strong|ready))\b|مراجعة سيرتي|تحسين سيرتي|السيرة الذاتية")) return "cv_review";
        if (Has(@"\b(skills? gaps?|what skills|missing skills|what am i missing|learn next|upskill|what should i learn|what do i need to learn)\b|المهارات (الناقصة|المطلوبة)|ماذا أتعلم|مهارات.{0,40}ناقص|ناقصتني|ناقصني|ينقصني")) return "skill_gap";
        if (Has(@"\b(am i ready|ready to apply|application readiness|how employable|am i competitive|ready for the job market|graduate ready)\b|هل أنا جاهز|جاهزية التقديم")) return "readiness";
        return Has(@"\b(career|careers|jobs?|roles?|profession|employment|what (can|could) i (do|work|apply)|suits my degree|matches my (degree|major|programme|program))\b|مسار مهني|وظائف|الوظائف|فرص عمل|تخصصي.*(وظيفة|عمل)|الإرشاد المهني") ? "matches" : null;
    }

    private static string Str(JsonNode? n) => n?.GetValue<string>() ?? "";
    private static bool Flag(JsonNode? n) => n?.GetValue<bool>() == true;
    private static IEnumerable<JsonNode> Items(JsonNode? n) => (n as JsonArray)?.OfType<JsonNode>() ?? [];
    private static JsonArray Strings(IEnumerable<string> values) => new(values.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());
    private static string Bi(JsonNode? n, bool ar, string en = "en", string arabic = "ar") => Str(n?[ar ? arabic : en]) is { Length: > 0 } s ? s : Str(n?[en]);

    internal static Reply Build(JsonObject a, JsonNode? counselling, string topic, string lang)
    {
        var ar = lang == "ar";
        var hasCv = Flag(a["hasCv"]); var usable = Flag(a["cvAnalyzed"]);
        var hasEvidence = Flag(a["evidence"]?["hasProfile"]) || usable;
        var roles = hasEvidence ? Items(a["matches"]).Take(3).ToArray() : [];
        var ats = a["ats"]; var gaps = a["skillGaps"];
        var next = new List<string>();
        if (!usable) next.Add(hasCv
            ? (ar ? "استبدل سيرتك الذاتية بملف قابل للقراءة باستخدام الزر هنا في المحادثة." : "Use Replace CV here in the chat to upload a readable CV.")
            : (ar ? "استخدم زر «رفع السيرة الذاتية» هنا في المحادثة وسأحلّلها فوراً." : "Use the Upload CV button here in the chat and I will analyse it straight away."));
        if (counselling is null) next.Add(ar ? "اطلب مني ترتيب موعد مع مرشد مهني في أي وقت." : "Ask me to arrange a session with a career counsellor at any time.");
        string[] Skills(string key) => hasEvidence ? Items(gaps?[key]).Take(6).Select(n => Str(n["skill"])).ToArray() : [];
        var card = new JsonObject
        {
            ["topic"] = topic,
            ["cv"] = new JsonObject { ["hasCv"] = hasCv, ["analysed"] = usable, ["fileName"] = a["cvFileName"]?.DeepClone(), ["uploadedAt"] = a["cvUploadedAt"]?.DeepClone(), ["cvId"] = a["cvId"]?.DeepClone() },
            ["ats"] = ats is null ? null : new JsonObject { ["overall"] = ats["overall"]?.DeepClone(), ["band"] = Bi(ats["band"], ar, "labelEn", "labelAr"),
                ["strengths"] = Strings(Items(ats["strengths"]).Take(4).Select(n => Bi(n, ar))), ["improvements"] = Strings(Items(ats["improvements"]).Take(4).Select(n => Bi(n, ar))) },
            ["matches"] = new JsonArray(roles.Select(m => (JsonNode)new JsonObject {
                ["roleCode"] = m["roleCode"]?.DeepClone(), ["title"] = Bi(m, ar, "titleEn", "titleAr"),
                ["fitScore"] = m["fitScore"]?.DeepClone(), ["readinessScore"] = m["jobReadinessScore"]?.DeepClone(),
                ["reason"] = Items(m["evidenceItems"]).Select(e => Bi(e,ar,"textEn","textAr")).FirstOrDefault() ?? "" }).ToArray()),
            ["skillGaps"] = gaps is null || !hasEvidence ? null : new JsonObject { ["targetRole"] = Bi(gaps,ar,"targetRoleEn","targetRoleAr"), ["strong"] = Strings(Skills("strong")), ["developing"] = Strings(Skills("developing")), ["missing"] = Strings(Skills("missing")) },
            ["recommendedActions"] = Strings(hasEvidence ? Items(a["actionPlan"]).Take(4).Select(p => Bi(p,ar,"titleEn","titleAr")) : []),
            ["counsellingRequest"] = counselling is null ? null : new JsonObject { ["reference"] = counselling["reference"]?.DeepClone(), ["status"] = counselling["status"]?.DeepClone() },
            ["analysisVersion"] = a["versionNo"]?.DeepClone(), ["calculatedAt"] = a["calculatedAt"]?.DeepClone()
        };
        var noCv = hasCv
            ? (ar ? "السيرة الذاتية المحفوظة غير قابلة للتحليل، لذلك يعتمد هذا على سجلك الجامعي فقط. ارفع نسخة قابلة للقراءة هنا في المحادثة." : "Your saved CV could not be analysed, so this is based on your university record only. Upload a readable copy here in the chat.")
            : (ar ? "لا توجد سيرة ذاتية محفوظة لديك حتى الآن، لذلك يعتمد هذا على سجلك الجامعي فقط. ارفع سيرتك الذاتية هنا في المحادثة وسأقيّمها وأعود إليك بالنتائج مباشرة." : "I do not have a CV on file for you yet, so this is based on your university record only. Upload your CV right here in the chat and I will score it and come straight back with the results.");
        var parts = new List<string>();
        void Section(string en, string arabic, IEnumerable<string> entries)
        {
            var list = entries.Where(s => !string.IsNullOrWhiteSpace(s)).ToArray();
            if (list.Length > 0) parts.Add($"**{(ar ? arabic : en)}**\n" + string.Join("\n", list.Select(s => "- " + s)));
        }
        if (!hasEvidence)
            parts.Add(ar ? "لم أجد سجلاً أكاديمياً مرتبطاً بحسابك أو سيرة ذاتية قابلة للتحليل، لذلك لا أستطيع تحديد مسارات مهنية مناسبة بعد." : "I could not find a linked academic record or a readable CV, so I cannot identify suitable career paths yet.");
        else if (topic is "ats" or "cv_review")
        {
            if (ats is null) parts.Add(ar ? "لا يمكن حساب درجة أنظمة الفرز بدون سيرة ذاتية قابلة للقراءة." : "An ATS score needs a readable CV on file.");
            else
            {
                parts.Add(ar ? $"درجة سيرتك الذاتية في أنظمة الفرز الآلي هي **{ats["overall"]} من 100**." : $"Your CV scores **{ats["overall"]} out of 100** for automated screening.");
                Section("Strengths", "نقاط القوة", Items(ats["strengths"]).Take(3).Select(n => Bi(n,ar)));
                Section("What to improve", "ما يجب تحسينه", Items(ats["improvements"]).Take(5).Select(n => Bi(n,ar)));
                if (topic == "cv_review")
                {
                    Section("Date issues", "مشكلات في التواريخ", Items(ats["dateIssues"]).Select(n => Bi(n,ar)));
                    Section("Keywords worth adding", "كلمات مفتاحية ينبغي إضافتها", Items(ats["recommendedKeywords"]).Take(8).Select(Str));
                    Section("Differences against your university record", "اختلافات مقابل سجلك الجامعي", Items(a["discrepancies"]).Take(4).Select(Str));
                }
                var disclaimer = Bi(ats["disclaimer"],ar); if (disclaimer.Length > 0) parts.Add(disclaimer);
            }
        }
        else if (topic is "skill_gap" or "readiness")
        {
            if (roles.Length > 0)
            {
                var top = roles[0]; var title = Bi(top,ar,"titleEn","titleAr");
                parts.Add(topic == "readiness"
                    ? (ar ? $"جاهزيتك لدور **{title}** هي **{top["jobReadinessScore"]}%** (توافق {top["fitScore"]}%)." : $"Your readiness for **{title}** is **{top["jobReadinessScore"]}%** (fit {top["fitScore"]}%).")
                    : (ar ? $"مقارنة بمتطلبات دور **{title}**:" : $"Compared with what **{title}** requires:"));
            }
            Section("Demonstrated strengths", "نقاط قوة مثبتة", Skills("strong"));
            Section("Developing (coursework only)", "قيد التطوير (من المقررات)", Skills("developing"));
            Section("Missing", "ناقصة", Skills("missing"));
            Section("Next steps", "الخطوات التالية", Items(a["actionPlan"]).Take(3).Select(p => Bi(p,ar,"titleEn","titleAr") + ": " + Bi(p,ar,"detailEn","detailAr")));
        }
        else if (roles.Length > 0)
        {
            parts.Add(ar ? "بناءً على برنامجك ومقرراتك المكتملة" + (usable ? " وسيرتك الذاتية" : "") + "، هذه أقوى المسارات المهنية لك:"
                : $"Based on your programme and completed coursework{(usable ? " and your CV" : "")}, these are your strongest career paths:");
            parts.Add(string.Join("\n",roles.Select((m,i) => {
                var reasons = string.Join("; ",Items(m["evidenceItems"]).Take(2).Select(e => Bi(e,ar,"textEn","textAr")));
                return $"{i+1}. **{Bi(m,ar,"titleEn","titleAr")}** — {(ar ? "التوافق" : "fit")} {m["fitScore"]}%, {(ar ? "الجاهزية" : "readiness")} {m["jobReadinessScore"]}%" + (reasons.Length > 0 ? "\n   " + reasons : "");
            })));
        }
        if (parts.Count == 0) parts.Add(ar ? "لم أتمكن من حساب مسارات مهنية مطابقة من سجلك الحالي." : "I could not compute matching career paths from your current record.");
        if (!usable && hasEvidence) parts.Add(noCv);
        return new(string.Join("\n\n",parts),card,Strings(next));
    }
}
