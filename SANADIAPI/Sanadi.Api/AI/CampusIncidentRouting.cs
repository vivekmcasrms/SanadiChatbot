using System.Text.Json;
using System.Text.RegularExpressions;

namespace Sanadi.Api.AI;

// Same deterministic contact matching used by the original emergency.server.ts flow.
// Names, keywords and contact channels are supplied by the active database register.
internal static class CampusIncidentRouting
{
    internal sealed class Contact
    {
        public Guid Id { get; set; }
        public string Code { get; set; } = "";
        public string? CategoryEn { get; set; }
        public string? CategoryAr { get; set; }
        public string? TypeEn { get; set; }
        public string? TypeAr { get; set; }
        public string? UnitEn { get; set; }
        public string? UnitAr { get; set; }
        public string? Mobile { get; set; }
        public string? EmergencyNumber { get; set; }
        public string? Email { get; set; }
        public string? NotesEn { get; set; }
        public string? NotesAr { get; set; }
        public string Keywords { get; set; } = "[]";
        public int Priority { get; set; } = 100;
    }

    private const string Strong = @"emergency|urgent|fire|smoke|burning|explosion|ambulance|bleeding|unconscious|choking|gas leak|طوارئ|طارئ|طارئة|عاجل|حريق|دخان|انفجار|إسعاف|نزيف|إغماء|تسرب غاز";
    private const string Incident = @"\bi\b|\bmy\b|\bwe\b|there is|there's|help|broken|not working|doesn'?t work|stopped|leak|leaking|stuck|missing|stolen|lost|who (do i|should i) (call|contact)|number to call|عندي|لدي|عندنا|يوجد|في\s|ساعد|النجدة|لا يعمل|ما يعمل|معطل|عطل|تسرب|مفقود|فقدت|سرق|ضاع|أتصل|اتصل|رقم";
    private const string Policy = @"policy|procedure|regulation|guideline|document|report form|سياسة|لائحة|إجراء|نموذج|وثيقة";
    private const string OtherService = @"skill|cv|resume|ats|score|career|job|role|course|credit|gpa|grade|graduat|register|registration|academic|semester|internship|letter|certificate|case|complaint|suggestion|request|library|book|appointment|مهار|سيرة ذاتية|مهني|وظيف|درجة|معدل|مقرر|ساعات|تسجيل|شهادة|خطاب|حالتي|طلبي|مكتبة|موعد";
    private const string Lost = @"lost|missing|stolen|misplaced|left behind|فقد|مفقود|ضاع|سرق|نسيت";
    private const string Property = @"wallet|purse|phone|mobile|laptop|bag|backpack|keys?|card|id\b|emirates id|passport|watch|glasses|jacket|book|charger|headphone|earbud|usb|umbrella|ring|necklace|money|property|belonging|item|محفظ|هاتف|جوال|حاسوب|لابتوب|حقيب|مفاتيح|بطاق|هوي|جواز|ساع|نظار|كتاب|شاحن|سماع|مقتنيات|أغراض|غرض";
    private static bool Matches(string text, string pattern) => Regex.IsMatch(text, pattern, RegexOptions.IgnoreCase);

    internal static bool IsCandidate(string text)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > 400) return false;
        if (Matches(text, Strong)) return true;
        if (!Matches(text, Incident) || Matches(text, Policy)) return false;
        var lost = Matches(text, Lost);
        var property = Matches(text, Property);
        if (!(lost && property) && Matches(text, OtherService)) return false;
        return !lost || property;
    }

    private static string Normalize(string text) => Regex.Replace(text.ToLowerInvariant()
        .Replace('أ', 'ا').Replace('إ', 'ا').Replace('آ', 'ا').Replace('ى', 'ي').Replace('ة', 'ه'), @"[\u064B-\u0652]", "");

    internal static Contact? Match(string message, IEnumerable<Contact> contacts)
    {
        if (!IsCandidate(message)) return null;
        var text = Normalize(message);
        Contact? best = null;
        var bestScore = 0;
        foreach (var contact in contacts)
        {
            if (string.IsNullOrWhiteSpace(contact.EmergencyNumber) && string.IsNullOrWhiteSpace(contact.Mobile) && string.IsNullOrWhiteSpace(contact.Email)) continue;
            string[] keywords;
            try { keywords = JsonSerializer.Deserialize<string[]>(contact.Keywords) ?? []; }
            catch (JsonException) { continue; }
            var score = 0;
            foreach (var raw in keywords)
            {
                if (string.IsNullOrWhiteSpace(raw)) continue;
                var kw = Normalize(raw);
                if (Matches(kw, @"[\u0600-\u06FF]"))
                {
                    if (text.Contains(kw)) score += kw.Length > 3 ? 2 : 1;
                }
                else if (Matches(text, @"(^|[^a-z0-9])" + Regex.Escape(kw) + @"([^a-z0-9]|$)"))
                    score += kw.Contains(' ') ? 3 : kw.Length > 3 ? 2 : 1;
            }
            if (score > bestScore || (score > 0 && score == bestScore && contact.Priority < best!.Priority))
            { best = contact; bestScore = score; }
        }
        return bestScore >= (Matches(message, Strong) ? 1 : 2) ? best : null;
    }

    internal static string UnitName(Contact contact, string lang) =>
        (lang == "ar" ? contact.UnitAr ?? contact.UnitEn : contact.UnitEn ?? contact.UnitAr)
        ?? (lang == "ar" ? "الجهة المسؤولة" : "the responsible unit");

    internal static string Answer(Contact contact, string lang)
    {
        var ar = lang == "ar";
        var category = (ar ? contact.CategoryAr ?? contact.CategoryEn : contact.CategoryEn) ?? (ar ? "طوارئ" : "Emergency");
        var lines = new List<string> { ar ? $"## {category} — اتصل الآن" : $"## {category} — call now" };
        void Add(string label, string? value) { if (!string.IsNullOrWhiteSpace(value)) lines.Add($"**{label}:** {value}"); }
        Add(ar ? "نوع الحالة" : "Situation", ar ? contact.TypeAr ?? contact.TypeEn : contact.TypeEn);
        Add(ar ? "الجهة المسؤولة" : "Responsible unit", UnitName(contact, lang));
        Add(ar ? "رقم الطوارئ" : "Emergency number", contact.EmergencyNumber);
        Add(ar ? "الهاتف المتحرك" : "Mobile", contact.Mobile);
        Add(ar ? "البريد الإلكتروني" : "Email", contact.Email);
        var notes = ar ? contact.NotesAr ?? contact.NotesEn : contact.NotesEn;
        if (!string.IsNullOrWhiteSpace(notes)) lines.Add(notes);
        lines.Add(ar ? "إذا كانت الحياة في خطر، اتصل بالرقم 999 فوراً." : "If life is at risk, call 999 immediately.");
        return string.Join("\n\n", lines);
    }
}
