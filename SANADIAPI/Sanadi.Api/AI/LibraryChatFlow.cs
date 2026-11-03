using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Sanadi.Infrastructure.Library;

namespace Sanadi.Api.AI;

internal static class LibraryChatFlow
{
    internal sealed record Reply(string Answer, JsonObject? Card, JsonArray NextSteps, bool Verified);
    private const string Resource = @"(?:text ?books?|e-?books?|books?|articles?|papers?|journals?|theses|thesis|dissertations?|resources?)";
    private const string ArabicResource = @"(?:كتاب|كتب|مصادر|مقالات|أبحاث|دوريات|أطروحات)";
    private const string ArabicSubject = ArabicResource + @"\s+(?:عن|حول|في|بخصوص|مشابهة لـ?)\s*(.+)";

    internal static string? SimilarQuery(string text)
    {
        // The card's complete command identifies a catalogue search. Words inside the
        // quoted title (e.g. "problems") are book data, not complaint/action intent.
        var match = Regex.Match(text.Trim(),
            """\A(?:Find resources similar to|ابحث عن مصادر مشابهة لـ)\s+["“«](?<title>.+)["”»]\s*\z""",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        if (!match.Success) return null;
        var title = match.Groups["title"].Value.Trim();
        return title.Length == 0 ? null : title[..Math.Min(title.Length,200)];
    }

    internal static string? Query(string text)
    {
        if (SimilarQuery(text) is { } similar) return similar;
        if (CourseTextbookFlow.IsQuestion(text)) return null;
        bool Has(string p) => Regex.IsMatch(text,p,RegexOptions.IgnoreCase);
        var english = Has(@"\b"+Resource+@"\b") && Has(@"\b(find|search|recommend|suggest|look(?:ing)? for|show me|do you have|where can i (?:get|find))\b|\b"+Resource+@"\s+(on|about|similar to)\b");
        // Like English "resource + subject", an Arabic subject relation identifies
        // a catalogue lookup without depending on a particular request verb.
        var arabic = Has(ArabicResource) && (Has(@"ابحث|أبحث|تبحث|أجد|ألقى|القى|اقترح|أريد|اريد|مشابهة|دلني") || Has(ArabicSubject));
        if (!english && !arabic) return null;
        var quoted=Regex.Match(text,"[\"“«]([^\"”»]{2,200})[\"”»]");
        string query;
        if (quoted.Success) query=quoted.Groups[1].Value;
        else
        {
            var subject=Regex.Match(text,@"\b"+Resource+@"\s+(?:on|about|for|similar to|related to)\s+(.+)",RegexOptions.IgnoreCase);
            if (!subject.Success) subject=Regex.Match(text,ArabicSubject);
            if (!subject.Success) subject=Regex.Match(text,@"(?:كتاب|كتب|مصادر|مقالات|أبحاث|دوريات|أطروحات)\s+(?:(?!عن\b|حول\b|في\b|بخصوص\b)[\p{L}]{2,15}\s+){1,3}(?:عن|حول|في|بخصوص)\s*(.+)");
            query=subject.Success ? subject.Groups[1].Value : Regex.Replace(text,
                @"^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:find|search(?: for)?|recommend|suggest|show|look for)\s+(?:me\s+)?(?:a\s+|the\s+|some\s+)?(?:good\s+)?", "",RegexOptions.IgnoreCase);
            query=Regex.Replace(query,@"(?:\bplease|من فضلك)\s*[?.!؟]*$","",RegexOptions.IgnoreCase);
        }
        query=query.Trim().Trim('?', '!', '.', '؟', '"', '“', '”', '«', '»').Trim();
        return query.Length>200 ? query[..200] : query;
    }

    internal static Reply Build(string query,LibrarySearchResultDto result,string lang,string? displayQuery=null)
    {
        var ar=lang=="ar";
        var shown=string.IsNullOrWhiteSpace(displayQuery)?query:displayQuery;
        if (result.status is not ("ok" or "empty"))
            return new(ar ? "لا يمكنني الوصول إلى فهرس المكتبة الآن. يرجى المحاولة مرة أخرى لاحقاً أو التواصل مع أمين المكتبة للمساعدة."
                : "I cannot reach the live library catalogue right now. Please try again later or contact a librarian for help.",null,new JsonArray(),false);
        if (result.results.Count==0)
            return new(ar ? $"لم يُرجع فهرس المكتبة نتائج للبحث عن **{shown}**. جرّب عنواناً محدداً أو اسم المؤلف أو كلمات أخرى للموضوع."
                : $"The library catalogue returned no results for **{shown}**. Try a specific title, author, or different subject terms.",null,new JsonArray(),true);
        var terms=AssistantEvidenceQuery.Terms(query);
        var topical=result.results.Any(r=>terms.Length>0&&terms.All(t=>Regex.IsMatch(r.title+" "+string.Join(" ",r.subjects)+" "+r.summary,@"(?<![\p{L}\p{N}])"+Regex.Escape(t)+@"(?![\p{L}\p{N}])",RegexOptions.IgnoreCase)));
        var answer=topical
            ? (ar ? $"وجدت نتائج في فهرس المكتبة للبحث عن **{shown}**. يمكنك مراجعة العناوين أدناه وفتح سجل الفهرس للاطلاع على التفاصيل والتوفر."
                : $"I found catalogue results for **{shown}**. Review the titles below and open the catalogue record for details and availability.")
            : (ar ? $"أعاد فهرس المكتبة نتائج عامة للبحث عن **{shown}**، لكن لم أتمكن من تأكيد تطابق دقيق من تفاصيلها. النتائج أدناه؛ جرّب عنواناً أو اسم مؤلف أكثر تحديداً."
                : $"The catalogue returned broad results for **{shown}**, but I could not confirm an exact topic match from their details. The returned records are below; try a more specific title or author.");
        var card=new JsonObject { ["query"]=query,["provider"]=result.provider,["totalMatches"]=result.total,["retrievedAt"]=result.retrievedAt,
            ["results"]=new JsonArray(result.results.Take(10).Select(r=>(JsonNode)new JsonObject {
                ["id"]=r.id,["title"]=r.title,["authors"]=new JsonArray(r.authors.Select(a=>(JsonNode?)JsonValue.Create(a)).ToArray()),["year"]=r.year,
                ["type"]=r.type,["typeLabel"]=TypeLabel(r.type,ar),["availability"]=r.availability,["availabilityLabel"]=AvailabilityLabel(r.availability,ar),
                ["library"]=null,["floor"]=null,["shelf"]=null,["callNumber"]=null,["onlineUrl"]=r.onlineUrl,["catalogueUrl"]=r.catalogueUrl,
                ["subjects"]=new JsonArray(r.subjects.Select(s=>(JsonNode?)JsonValue.Create(s)).ToArray()) }).ToArray()) };
        return new(answer,card,new JsonArray(ar ? "استخدم «عرض في الفهرس» لمراجعة السجل، أو «مصادر مشابهة» للبحث عن موارد أخرى." : "Use View in catalogue to inspect a record, or Find similar to search for more resources."),true);
    }
    private static string TypeLabel(string type,bool ar) => type switch {
        "book"=>ar?"كتاب":"Book","ebook"=>ar?"كتاب إلكتروني":"E-book","journal"=>ar?"دورية":"Journal",
        "article"=>ar?"مقال":"Article","thesis"=>ar?"أطروحة":"Thesis","database"=>ar?"قاعدة بيانات":"Database",_=>type };
    private static string AvailabilityLabel(string status,bool ar) => status switch {
        "available"=>ar?"متاح":"Available","electronic"=>ar?"متاح إلكترونياً":"Online","on_loan"=>ar?"معار":"Checked out",
        "reference_only"=>ar?"للاطلاع الداخلي":"Reference only","in_processing"=>ar?"قيد المعالجة":"In processing",
        "unavailable"=>ar?"غير متاح":"Unavailable",_=>ar?"غير معروف":"Unknown" };
}
