using System.Data.Common;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Knowledge;

public sealed record RetrievedSource(
    string SourceType,
    string SourceId,
    string? ChunkId,
    string Title,
    string Snippet,
    string? SectionTitle,
    int? PageNumber,
    string? CitationUrl,
    string? OwningUnit,
    string? Version,
    string? EffectiveDate,
    string Confidentiality,
    string Domain,
    string? DocumentType,
    double Relevance,
    double Lexical,
    double Fuzzy,
    double Semantic,
    double Authority,
    double Score,
    string Language,
    bool Stale);

public sealed class KnowledgeRetrievalService(KnowledgeEmbeddingsService embeddings)
{
    public const double MinGroundingScore = 0.32;
    public const int DefaultPassageLimit = 5;

    private static readonly Dictionary<string, Regex> DomainHints = new()
    {
        ["institution"] = new(@"((how many|number of|list( of)?|what are|which)\s+(the\s+)?(colleges?|faculties|schools|departments?|programs?|programmes?|majors?|campus(es)?)|uaeu\s+(colleges?|departments?|structure|about)|كم\s*(عدد)?\s*(الكليات|الأقسام|البرامج)|(قائمة|ما هي)\s*(الكليات|الأقسام|البرامج|التخصصات))", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        ["registration"] = new(@"(regist|enrol|add\s*and\s*drop|credit hours?|overload|prerequisit|section|hold|تسجيل|حذف|إضافة|ساعات معتمدة|متطلب سابق|حجز)", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        ["withdrawal"] = new(@"(withdraw|drop the course|late withdrawal|semester withdrawal|grade of w|انسحاب|الانسحاب)", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        ["internship"] = new(@"(internship|training|placement|co-?op|تدريب|التدريب العملي)", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        ["housing"] = new(@"(housing|hostel|dorm|residence|room|bed|roommate|سكن|الغرفة|السكن الجامعي|سرير)", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        ["transfer"] = new(@"(transfer|change (my )?(college|major|programme|program)|تحويل|تغيير التخصص)", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        ["documents"] = new(@"(letter|transcript|certificate|enrol\w* letter|to whom it may concern|document|وثيقة|إفادة|كشف درجات|شهادة|خطاب)", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        ["library"] = new(@"(librar|book|borrow|catalogue|database|citation|مكتبة|استعارة|كتاب|فهرس)", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        ["career"] = new(@"(career|cv|resume|ats|interview|job|skill gap|مهني|سيرة ذاتية|مقابلة|وظيفة|مهارات)", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        ["complaints"] = new(@"(complain|suggestion|escalat|grievance|شكوى|اقتراح|تصعيد)", RegexOptions.IgnoreCase | RegexOptions.Compiled),
    };

    private static readonly (Regex Probe, string[] Terms)[] SectionConcepts =
    [
        (new(@"(objective|purpose|aim|goal|intent|rationale|why .*(policy|exist)|الهدف|الأهداف|الغرض|الغاية|لماذا)", RegexOptions.IgnoreCase | RegexOptions.Compiled),
            ["objective","purpose","aim","goal","introduction","overview","الهدف","الأهداف","الغرض"]),
        (new(@"(scope|applies to|applicability|coverage|من ينطبق|النطاق|نطاق)", RegexOptions.IgnoreCase | RegexOptions.Compiled),
            ["scope","applicability","subject","النطاق","نطاق التطبيق","الموضوع"]),
        (new(@"(defin|meaning of|terminology|التعريف|التعريفات|المصطلح)", RegexOptions.IgnoreCase | RegexOptions.Compiled),
            ["definitions","terminology","abbreviations","التعريفات","المصطلحات"]),
        (new(@"(procedure|process|steps|how (do|to)|الإجراء|الإجراءات|الخطوات|كيف)", RegexOptions.IgnoreCase | RegexOptions.Compiled),
            ["procedure","procedures","process","implementation","الإجراءات","الإجراء"]),
        (new(@"(responsib|who is in charge|accountab|المسؤول|المسؤولية|المسؤوليات)", RegexOptions.IgnoreCase | RegexOptions.Compiled),
            ["responsibilities","responsibility","roles and responsibilities","المسؤوليات"]),
        (new(@"(eligib|qualify|requirement|condition|الأهلية|الشروط|المتطلبات)", RegexOptions.IgnoreCase | RegexOptions.Compiled),
            ["eligibility","requirements","conditions","الأهلية","الشروط","المتطلبات"]),
        (new(@"(penalt|sanction|violation|discipl|عقوب|مخالف)", RegexOptions.IgnoreCase | RegexOptions.Compiled),
            ["penalties","sanctions","enforcement","compliance","العقوبات","المخالفات"]),
        (new(@"(exception|waiver|exempt|استثناء|إعفاء)", RegexOptions.IgnoreCase | RegexOptions.Compiled),
            ["exceptions","الاستثناءات"]),
    ];

    private static readonly object CacheLock = new();
    private static readonly Dictionary<string, (List<RetrievedSource> Value, long ExpiresAt)> PassageCache = new();
    private static string CorpusVersion = "v1";
    private const long CacheTtlMs = 5 * 60 * 1000;

    public static void InvalidateCache(string reason = "knowledge_change")
    {
        lock (CacheLock)
        {
            PassageCache.Clear();
            CorpusVersion = $"v{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds():x}:{reason[..Math.Min(12, reason.Length)]}";
        }
    }

    public static string? InferDomain(string query)
    {
        foreach (var (domain, re) in DomainHints)
            if (re.IsMatch(query)) return domain;
        return null;
    }

    public static List<string> SectionTermsFor(string query)
    {
        var outSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (probe, terms) in SectionConcepts)
            if (probe.IsMatch(query))
                foreach (var t in terms) outSet.Add(t.ToLowerInvariant());
        return outSet.Take(12).ToList();
    }

    public async Task<List<RetrievedSource>> RetrieveAsync(
        DbConnection db,
        string query,
        CenterPermissions perms,
        string lang,
        int limit = DefaultPassageLimit,
        string? domain = null,
        bool useCache = true,
        CancellationToken ct = default)
    {
        var clearance = KnowledgePermissions.ClearanceFor(perms);
        domain ??= InferDomain(query);
        var key = $"{CorpusVersion}|{clearance}|{lang}|{domain ?? "*"}|{limit}|{Normalise(query)}";
        var personal = Regex.IsMatch(query, @"\b(my|mine|i am|i'm|am i|do i|my own|رصيدي|معدلي|حالتي|هل أنا|لدي)\b", RegexOptions.IgnoreCase);
        var cacheable = useCache && !personal;

        if (cacheable)
        {
            lock (CacheLock)
            {
                if (PassageCache.TryGetValue(key, out var hit) && hit.ExpiresAt > Environment.TickCount64)
                    return hit.Value;
            }
        }

        var sectionTerms = SectionTermsFor(query);
        var queryVector = await embeddings.EmbedQueryAsync(query, ct);
        var passages = await RunSearch(db, query, lang, clearance, limit, domain, sectionTerms, queryVector, ct);
        if (passages.Count == 0 && domain is not null)
            passages = await RunSearch(db, query, lang, clearance, limit, null, sectionTerms, queryVector, ct);

        if (cacheable)
        {
            lock (CacheLock)
                PassageCache[key] = (passages, Environment.TickCount64 + CacheTtlMs);
        }
        return passages;
    }

    public async Task<GroundingOutcome> RetrieveForGroundingAsync(
        DbConnection db,
        string query,
        CenterPermissions perms,
        string lang,
        int limit = 8,
        bool log = false,
        CancellationToken ct = default)
    {
        var started = Environment.TickCount64;
        var domain = InferDomain(query);
        var candidates = await RetrieveAsync(db, query, perms, lang, Math.Max(limit, DefaultPassageLimit), domain, true, ct);
        var durationMs = Environment.TickCount64 - started;
        var terms = SectionTermsFor(query);

        bool Relevant(RetrievedSource p) =>
            terms.Any(t => $"{p.SectionTitle ?? ""} {p.Title}".Contains(t, StringComparison.OrdinalIgnoreCase)
                || p.Snippet.Contains(t, StringComparison.OrdinalIgnoreCase));

        var ranked = candidates;
        if (terms.Count > 0)
        {
            var matchedDocs = candidates.Where(Relevant).Select(p => p.SourceId).ToHashSet();
            if (matchedDocs.Count > 0)
                ranked = candidates.Where(p => !matchedDocs.Contains(p.SourceId) || Relevant(p)).ToList();
        }

        var generic = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "university","uaeu","student","students","policy","policies","service","services",
            "what","which","many","does","the","for","and","are","how","with","from",
            "الجامعة","الطالب","الطلبة","سياسة","الخدمة","الخدمات","كم","عدد","هي","ما"
        };
        var distinctive = Normalise(query).Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(w => w.Length > 3 && !generic.Contains(w)).ToList();

        bool Overlaps(RetrievedSource p)
        {
            if (distinctive.Count == 0) return true;
            var hay = $"{p.Title} {p.SectionTitle ?? ""} {p.Snippet}".ToLowerInvariant();
            return distinctive.Any(w => hay.Contains(w));
        }

        bool Topical(RetrievedSource p) =>
            Overlaps(p) || p.Semantic >= 0.4 || (terms.Count > 0 && Relevant(p));

        var passages = ranked.Where(p => p.Score >= MinGroundingScore && Topical(p)).Take(limit).ToList();
        var conflicts = DetectConflicts(passages);
        var top = passages.FirstOrDefault();
        var groundingStatus = conflicts.Count > 0 ? "policy_conflict"
            : top is null ? "no_evidence"
            : top.Score >= 0.45 ? "grounded" : "weak";

        return new GroundingOutcome(passages, candidates.Count, durationMs, domain, groundingStatus, conflicts, durationMs < 5);
    }

    public static List<GroundingConflict> DetectConflicts(IReadOnlyList<RetrievedSource> sources)
    {
        var patterns = new (string Topic, Regex Re)[]
        {
            ("credit-hour threshold", new(@"(\d{1,3})\s*(credit hours?|credits|ساعة معتمدة|ساعات معتمدة)", RegexOptions.IgnoreCase)),
            ("deadline week", new(@"week\s*(?:number\s*)?(\d{1,2})|الأسبوع\s*(?:ال)?(\w+)", RegexOptions.IgnoreCase)),
        };
        var conflicts = new List<GroundingConflict>();
        foreach (var (topic, re) in patterns)
        {
            var claims = new List<(RetrievedSource Source, string Value, string Sentence)>();
            foreach (var s in sources)
            {
                foreach (Match match in re.Matches(s.Snippet))
                {
                    var value = (match.Groups[1].Success ? match.Groups[1].Value : match.Groups[2].Value).ToLowerInvariant();
                    if (string.IsNullOrEmpty(value)) continue;
                    var idx = match.Index;
                    claims.Add((s, value, s.Snippet[Math.Max(0, idx - 100)..Math.Min(s.Snippet.Length, idx + 110)].Trim()));
                }
            }
            for (var i = 0; i < claims.Count; i++)
            for (var j = i + 1; j < claims.Count; j++)
            {
                var a = claims[i]; var b = claims[j];
                if (a.Value == b.Value || a.Source.SourceId == b.Source.SourceId) continue;
                if (topic == "deadline week" &&
                    !(Regex.IsMatch(a.Sentence, @"withdraw|انسحاب", RegexOptions.IgnoreCase)
                      && Regex.IsMatch(b.Sentence, @"withdraw|انسحاب", RegexOptions.IgnoreCase)))
                    continue;
                var authoritative = a.Source.Authority >= 0.9 || b.Source.Authority >= 0.9;
                conflicts.Add(new GroundingConflict(
                    topic,
                    authoritative ? "high" : "medium",
                    a.Source,
                    b.Source,
                    a.Sentence,
                    b.Sentence));
            }
        }
        return conflicts.Take(5).ToList();
    }

    private async Task<List<RetrievedSource>> RunSearch(
        DbConnection db, string query, string lang, int clearance, int limit, string? domain,
        List<string> sectionTerms, string? queryVector, CancellationToken ct)
    {
            var rows = await db.QueryAsync(DbProc.Call("usp_SearchKnowledgePassages",
                new
                {
                    p_query = query.Length > 400 ? query[..400] : query,
                    p_lang = lang == "ar" ? "ar" : "en",
                    p_clearance = clearance,
                    p_limit = limit,
                    p_candidates = Math.Max(40, limit * 8),
                    p_section_terms = JsonSerializer.Serialize(sectionTerms),
                    p_query_embedding = queryVector,
                    p_domain = domain
                }, ct));

            return rows.Select(MapRow).ToList();
    }

    private static RetrievedSource MapRow(dynamic r)
    {
        var lexical = (double)(r.lexical_score ?? 0d);
        var fuzzy = (double)(r.fuzzy_score ?? 0d);
        var semantic = (double)(r.semantic_score ?? 0d);
        var snippet = KnowledgeProcessing.NeutraliseForPrompt(Convert.ToString(r.snippet) ?? "");
        if (snippet.Length > 900) snippet = snippet[..900];
        return new RetrievedSource(
            Convert.ToString(r.source_type) ?? "document",
            Convert.ToString(r.source_id) ?? "",
            r.chunk_id is null ? null : Convert.ToString(r.chunk_id),
            Convert.ToString(r.title) ?? "",
            snippet,
            r.section_title is null ? null : Convert.ToString(r.section_title),
            r.page_number is null ? null : Convert.ToInt32(r.page_number),
            r.citation_url is null ? null : Convert.ToString(r.citation_url),
            r.owning_unit is null ? null : Convert.ToString(r.owning_unit),
            r.version is null ? null : Convert.ToString(r.version),
            r.effective_date is null ? null : Convert.ToString(r.effective_date),
            Convert.ToString(r.confidentiality) ?? "public",
            Convert.ToString(r.knowledge_domain) ?? "general",
            r.document_type is null ? null : Convert.ToString(r.document_type),
            Math.Max(lexical, Math.Max(fuzzy, semantic)),
            lexical, fuzzy, semantic,
            (double)(r.authority ?? 0.7d),
            (double)(r.score ?? 0d),
            Convert.ToString(r.language) ?? "en",
            r.stale is bool b && b);
    }

    private static string Normalise(string query) =>
        Regex.Replace(Regex.Replace(query.ToLowerInvariant(), @"[^\p{L}\p{N}\s]", " "), @"\s+", " ").Trim();
}
