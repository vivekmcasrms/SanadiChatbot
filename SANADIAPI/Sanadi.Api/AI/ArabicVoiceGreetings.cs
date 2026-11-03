using System.Text.RegularExpressions;

namespace Sanadi.Api.AI;

// Voice-only vocabulary. Match the whole turn so a greeting never hides a service question.
internal static class ArabicVoiceGreetings
{
    private static readonly string[] Social =
    [
        "السلام عليكم", "سلام عليكم", "السلام عليكم ورحمة الله", "السلام عليكم ورحمة الله وبركاته",
        "وعليكم السلام", "عليكم السلام", "وعليكم السلام ورحمة الله", "وعليكم السلام ورحمة الله وبركاته",
        "سلام", "سلامات", "مرحبا", "مرحبا بك", "مرحبا بكم", "مرحبا الساع", "مرحبا الساعه",
        "مرحبا مليون", "مرحبتين", "مراحب", "يا مرحبا", "يا مرحبا الساع", "يا هلا",
        "هلا", "هلا والله", "هلا وغلا", "هلا ومرحبا", "هلا بك", "هلا بج", "هلا فيك", "هلا فيج", "هلا فيكم",
        "يا هلا والله", "يا هلا وغلا", "هلا وسهلا", "أهلا", "أهلين", "أهلا وسهلا", "أهلا بك", "أهلا بكم",
        "أهلا فيك", "أهلا فيكم", "حياك الله", "حياج الله", "حياكم الله", "الله يحييك", "الله يحييج", "الله يحييكم",
        "صباح الخير", "صباح النور", "صباح الورد", "صباح الفل", "صباح العسل", "صباح السعادة", "صباحو",
        "يسعد صباحك", "صبحك الله بالخير", "صبحج الله بالخير", "صبحكم الله بالخير",
        "مساء الخير", "مساء النور", "مساء الورد", "مساء الفل", "مساء السعادة", "مسا الخير", "مسا النور",
        "يسعد مساك", "مساك الله بالخير", "مساج الله بالخير", "مساكم الله بالخير", "حيا الله من يانا",
        "كيف حالك", "كيف حالج", "كيف حالكم", "كيف الحال", "كيفك", "كيفج", "كيفكم",
        "شحالك", "شحالج", "شحالكم", "شحالكن", "شخبارك", "شخبارج", "شخباركم",
        "شو أخبارك", "شو أخبارج", "شو أخباركم", "شو الأخبار", "أخبارك", "أخبارج", "أخباركم",
        "شعلومك", "شعلومج", "شعلومكم", "شو علومك", "شو علومج", "علومك", "علومج", "علومكم",
        "شو حالك", "شو حالج", "كيف الأمور", "كيف الأحوال", "كيف يومك", "كيف يومج",
        "كيف صحتك", "كيف صحتج", "كيف الصحة", "عساك بخير", "عساج بخير", "عساكم بخير",
        "عساك طيب", "عساج طيبة", "عساكم طيبين", "أنت بخير", "انتي بخير", "انتوا بخير",
        "أنت زين", "انتي زينة", "انتوا زينين", "كل شي تمام", "كل شي زين", "طمني عنك", "طمنيني عنج",
        "طمني عليك", "طمنيني عليج", "طمنوني عنكم", "شلونك", "شلونج", "شلونكم", "كيف الأحوال معك",
        "يا حي الله", "حي الله", "حي الله من جانا", "تحية طيبة", "أسعد الله صباحك", "أسعد الله مساءك",
        "من أنت", "من انتي", "منو أنت", "منو انتي", "مين أنت", "ما اسمك", "ما اسمج", "شو اسمك", "شو اسمج",
        "شواسمك", "شواسمج", "شوسمك", "شوسمج", "وش اسمك", "إيش اسمك"
    ];

    private static readonly string[] NamesAndFillers =
        ["يا", "ميرا", "ميرة", "سهيل", "سنادي", "سناديه", "سناديّ", "سندي", "اليوم", "الحين", "والله", "لو سمحت", "لو سمحتي"];

    internal static readonly string[][] SocialWords = Social.Select(Words).DistinctBy(x => string.Join(' ', x)).ToArray();
    internal static readonly string[][] FillerWords = NamesAndFillers.Select(Words).ToArray();

    internal static bool IsGreeting(string message, bool voicePresentation)
    {
        return voicePresentation && MatchesWholeTurn(message, SocialWords, FillerWords);
    }

    internal static bool MatchesWholeTurn(string message, string[][] socialWords, string[][] fillerWords)
    {
        if (string.IsNullOrWhiteSpace(message) || message.Length > 500) return false;
        var words = Words(message);
        if (words.Length == 0) return false;
        // Track complete phrase boundaries and require at least one social phrase.
        var reachable = new bool[words.Length + 1, 2];
        reachable[0, 0] = true;
        for (var start = 0; start < words.Length; start++)
            for (var social = 0; social < 2; social++)
            {
                if (!reachable[start, social]) continue;
                foreach (var phrase in socialWords)
                    if (Matches(words, start, phrase)) reachable[start + phrase.Length, 1] = true;
                foreach (var phrase in fillerWords)
                    if (Matches(words, start, phrase)) reachable[start + phrase.Length, social] = true;
            }
        return reachable[words.Length, 1];
    }

    internal static string? Reply(string message, string? agent)
    {
        if (!IsGreeting(message, true)) return null;
        return ReplyToKnownGreeting(message, agent);
    }

    internal static string ReplyToKnownGreeting(string message, string? agent)
    {
        var text = string.Join(' ', Words(message));
        bool Has(string pattern) => Regex.IsMatch(text, @"(?:^|\s)(?:" + pattern + @")(?:\s|$)");
        var parts = new List<string>();
        if (Has("السلام|سلام|سلامات|عليكم")) parts.Add("وعليكم السلام.");
        if (Has("صباح|صباحك|صباحو|صبحك|صبحج|صبحكم")) parts.Add("صباح النور.");
        else if (Has("مساء|مساءك|مسا|مساك|مساج|مساكم")) parts.Add("مساء النور.");
        if (parts.Count == 0 && Has("مرحبا|مرحبتين|مراحب|هلا|اهلا|اهلين|حياك|حياج|حياكم|حيا|يحييك|يحييج|يحييكم|حي|تحيه"))
            parts.Add("هلا ومرحبا.");
        if (Has("كيف|كيفك|كيفج|كيفكم|شحالك|شحالج|شحالكم|شحالكن|شخبارك|شخبارج|شخباركم|اخبارك|اخبارج|اخباركم|الاخبار|شعلومك|شعلومج|شعلومكم|علومك|علومج|علومكم|عساك|عساج|عساكم|بخير|زين|زينه|زينين|تمام|طمني|طمنيني|طمنوني|شلونك|شلونج|شلونكم") || Has("شو حالك|شو حالج"))
            parts.Add("الحمد لله، بخير.");
        if (Has("اسمك|اسمج|شواسمك|شواسمج|شوسمك|شوسمج|من انت|من انتي|منو انت|منو انتي|مين انت"))
            parts.Add(string.Equals(agent, "suhail", StringComparison.OrdinalIgnoreCase)
                ? "اسمي سهيل، مساعدك في خدمات جامعة الإمارات."
                : "اسمي ميرا، مساعدتك في خدمات جامعة الإمارات.");
        return parts.Count == 0 ? "هلا ومرحبا." : string.Join(' ', parts);
    }

    private static bool Matches(string[] words, int start, string[] phrase) =>
        start + phrase.Length <= words.Length && words.AsSpan(start, phrase.Length).SequenceEqual(phrase);

    internal static string[] Words(string text)
    {
        text = Regex.Replace(text.Normalize().ToLowerInvariant(), @"[\u064B-\u065F\u0670\u0640]", "")
            .Replace('أ', 'ا').Replace('إ', 'ا').Replace('آ', 'ا').Replace('ى', 'ي').Replace('ة', 'ه');
        return Regex.Replace(text, @"[^\p{L}\p{N}\s]", " ").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
    }
}
