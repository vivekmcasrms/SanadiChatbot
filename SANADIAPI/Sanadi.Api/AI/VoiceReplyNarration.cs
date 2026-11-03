using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Sanadi.Api.AI;

/// <summary>
/// Speaks complete key sentences from the existing answer, without a second model call.
/// Full text and service results are untouched by the speech presentation.
/// </summary>
internal sealed class VoiceReplyNarration(string question, string language, VoiceSentences sentences)
{
    private const int HighlightWords = 45;
    /// <summary>
    /// Shared voice presentation after the text pipeline completes. Selects source
    /// sentences only; it never generates an answer or modifies the response envelope.
    /// </summary>
    internal static string Overview(JsonObject result, string question, string language)
    {
        var answer = result["answer"]?.GetValue<string>() ?? "";
        // Failures, uncertainty and clarification must retain their leading qualification.
        var preserveOpening = result["verified"]?.GetValue<bool>() == false ||
            result["fallbackUsed"]?.GetValue<bool>() == true || result["humanHandoff"]?.GetValue<bool>() == true ||
            result["responseType"]?.GetValue<string>() == "error" ||
            !string.IsNullOrWhiteSpace(result["clarifyingQuestion"]?.GetValue<string>());
        return string.Join(" ", Select(answer, question, language, PreserveFullReply(result), preserveOpening)
            .Select(part => part.Text));
    }

    private string streamed = "";
    private int forwarded;
    private bool openingComplete;

    internal async Task Push(string delta)
    {
        if (openingComplete) return;
        streamed += delta;
        var boundary = VoicePhrasing.Boundaries(streamed).FirstOrDefault();
        var end = boundary > 0 ? boundary : streamed.Length;
        await sentences.Push(streamed[forwarded..end], final: boundary > 0);
        forwarded = end;
        openingComplete = boundary > 0;
    }

    internal async Task Complete(JsonObject result)
    {
        var answer = result["answer"]?.GetValue<string>() ?? "";
        // Document issuance is deterministic and only reaches here after the backend
        // confirms it. Speak its outcome and delivery options, not the entire facts card.
        // The original result is still sent to the UI and stored without modification.
        if (forwarded == 0 && DocumentBriefing(result, question, language) is { } briefing)
        {
            await sentences.Push(briefing, final: true);
            return;
        }
        // The model stream's final answer is trimmed by VoiceModelStream/PhraseGreeting.
        // Ignore those outer spaces when locating the already-spoken opening.
        var prefix = streamed[..forwarded].Trim();
        var leading = answer.Length - answer.TrimStart().Length;
        var skip = answer[leading..].StartsWith(prefix, StringComparison.Ordinal) ? leading + prefix.Length : 0;
        var remaining = new System.Text.StringBuilder();
        foreach (var part in Select(answer, question, language, PreserveFullReply(result)))
        {
            if (part.End <= skip) continue;
            var start = Math.Max(part.Start, skip);
            remaining.Append(answer[start..part.End]);
            // Source boundaries are retained even when intermediate sentences are omitted.
            remaining.Append(' ');
        }
        await sentences.Push(remaining.ToString(), final: true);
    }

    internal static bool PreserveFullReply(JsonObject result) =>
        result["toolsUsed"] is JsonArray tools && tools.Any(t => (string?)t == "greeting") ||
        result["proposedActions"] is JsonArray { Count: > 0 } ||
        result["responseType"]?.GetValue<string>() == "action_proposal";

    private static string? DocumentBriefing(JsonObject result, string question, string language)
    {
        if (PreserveFullReply(result) || result["verified"]?.GetValue<bool>() != true ||
            result["responseType"]?.GetValue<string>() != "receipt" ||
            result["receipt"] is not JsonObject receipt ||
            receipt["actionType"]?.GetValue<string>() != "issue_enrollment_letter" ||
            result["issuedDocument"] is not JsonObject document ||
            document["status"]?.GetValue<string>() != "valid" ||
            string.IsNullOrWhiteSpace(document["documentId"]?.GetValue<string>()))
            return null;

        // A request for a particular detail must still answer that question. The
        // ordinary ranked summary keeps the requested values from the source text.
        if (Regex.IsMatch(question,
            @"\b(?:reference|number|language|status|type|programme|program|college|details|read|everything|full)\b|" +
            @"(?:مرجع|رقم|لغة|حالة|نوع|برنامج|كلية|تفاصيل|اقرأ|اقرا|كامل|بالكامل)", RegexOptions.IgnoreCase))
            return null;

        return language == "ar"
            ? "إفادة التسجيل جاهزة. تقدر تنزّلها أو تشاركها من هنا، وبتحصلها أيضاً في «وثائقي»."
            : "Your enrolment letter is ready. You can download or share it here, and find it later in My Documents.";
    }

    internal sealed record Part(int Start, int End, string Text);

    internal static IReadOnlyList<Part> Select(string answer, string question, string language, bool preserveFull = false,
        bool preserveOpening = true)
    {
        var parts = new List<Part>();
        var start = 0;
        foreach (var boundary in VoicePhrasing.Boundaries(answer))
        {
            Add(boundary);
        }
        Add(answer.Length);
        void Add(int end)
        {
            var spoken = VoiceSpeechFormatter.ToSpeech(answer[start..end], language);
            if (spoken.Length > 0) parts.Add(new Part(start, end, spoken));
            start = end;
        }
        // Short replies/approval prompts retain their wording. Long replies must not
        // bypass summarization merely because they contain three long paragraphs.
        var totalWords = parts.Sum(p => WordCount(p.Text));
        if (preserveFull && totalWords <= 110 || parts.Count <= 2 && totalWords <= HighlightWords) return parts;

        var words = Words(question);
        // Keep a statement and its caveat together in either direction. Otherwise
        // selecting a positive statement alone could misrepresent eligibility.
        var groups = new List<List<int>> { new() { 0 } };
        for (var i = 1; i < parts.Count; i++)
        {
            if (parts[i - 1].Text.EndsWith(":.", StringComparison.Ordinal) ||
                Regex.IsMatch(parts[i].Text, @"^(?:However|But|Only|Unless|Except|Otherwise|لكن|ولكن|إلا|فقط|بشرط)\b", RegexOptions.IgnoreCase))
                groups[^1].Add(i);
            else groups.Add(new List<int> { i });
        }
        // A completed reply has no streamed opening to preserve. Reserve its budget
        // for the requested detail first, including any attached qualification.
        // Relevance only selects existing answer text; the question cannot supply facts.
        var anchor = preserveOpening || preserveFull ? groups[0] : groups
            .OrderByDescending(group => group.SelectMany(i => Words(parts[i].Text)).Distinct().Intersect(words).Count())
            .ThenBy(group => group[0]).First();
        var chosen = anchor.ToHashSet();
        var wordCount = anchor.Sum(i => WordCount(parts[i].Text));
        // Prefer the answer's explanation over reading headings and facts cards.
        // When the question asks for a card value, relevance still puts that value first.
        // This is Markdown presentation only; no intent or service-specific rule is added.
        bool DisplayDetail(int i) => Regex.IsMatch(answer[parts[i].Start..parts[i].End],
            @"^\s*(?:#{1,6}\s|[-*•▪◦]\s|\p{N}+[.)]\s|\||\*\*[^*]+\*\*\s*$|__[^_]+__\s*$)");
        var narrativeCount = Enumerable.Range(0, parts.Count).Count(i => !DisplayDetail(i));
        var limit = Math.Min(4, Math.Min(parts.Count - 1, narrativeCount >= 3 ? narrativeCount : 4));
        // Important words used to bypass the budget entirely, so long procedural
        // answers were read in full. Rank them within a bounded spoken overview.
        var ranked = groups.Where(group => !ReferenceEquals(group, anchor))
            .Where(group => narrativeCount < 2 || group.Any(i => !DisplayDetail(i)
                || Words(parts[i].Text).Intersect(words).Any()))
            .OrderByDescending(group => group.Max(i =>
                Words(parts[i].Text).Intersect(words).Count() * 16
                + (Essential(parts[i].Text) ? 10 : 0)
                + (DisplayDetail(i) ? 0 : 16)
                + (Regex.IsMatch(parts[i].Text, @"\p{N}") ? 2 : 0)))
            .ThenBy(group => group[0]);
        foreach (var group in ranked)
        {
            var count = group.Sum(i => WordCount(parts[i].Text));
            if (chosen.Count + group.Count > limit || wordCount + count > HighlightWords) continue;
            chosen.UnionWith(group);
            wordCount += count;
        }
        return chosen.Order().Select(i => parts[i]).ToArray();
    }

    private static int WordCount(string text) => Regex.Matches(text, @"\S+").Count;

    private static HashSet<string> Words(string text) => Regex.Matches(
        Regex.Replace(text.ToLowerInvariant(), @"[\u0640\u064B-\u065F\u0670]", ""), @"[\p{L}\p{N}]{2,}")
        .Select(m => NormalizeWord(m.Value)).Where(w => !StopWords.Contains(w)).ToHashSet();

    // Match Arabic spelling/attached articles for relevance only. Spoken source text is unchanged.
    private static string NormalizeWord(string word)
    {
        word = word.Replace('أ', 'ا').Replace('إ', 'ا').Replace('آ', 'ا').Replace('ى', 'ي');
        if (word.Length > 5 && word.StartsWith("وال", StringComparison.Ordinal)) return word[3..];
        return word.Length > 4 && word.StartsWith("ال", StringComparison.Ordinal) ? word[2..] : word;
    }

    private static readonly HashSet<string> StopWords = new(
        "the and for your you are can how what which please this that with from have about should will would could does is my of to an in on at as by it we us be or do معلومات اريد أريد كيف هذا هذه التي الذي ممكن عند على الى إلى في من عن ما هو هي هل لي".Split(' ').Select(NormalizeWord));

    private static bool Essential(string text) => Regex.IsMatch(text,
        @"\b(?:must|required|requirement|need to|cannot|can't|not|never|only|unless|except|however|deadline|due|before|fee|cost|pay|amount|confirm|approval|approve|submit|submitted|failed|failure|reference|next step|download|contact)\b|" +
        @"(?:يجب|لازم|مطلوب|يشترط|بشرط|لا يمكن|لم يتم|لن يتم|فقط|إلا|لكن|الموعد النهائي|قبل|رسوم|تكلفة|مبلغ|موافقة|تأكيد|تقديم|تم تقديم|تعذر|رقم الطلب|الخطوة التالية|نزّل|تنزيل|تواصل)",
        RegexOptions.IgnoreCase);

}
