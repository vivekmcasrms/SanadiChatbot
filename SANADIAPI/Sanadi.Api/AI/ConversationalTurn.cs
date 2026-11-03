using System.Text.RegularExpressions;

namespace Sanadi.Api.AI;

// Short social turns. These never search policy and never offer a case.
internal static class ConversationalTurn
{
    private static readonly Regex Greeting = new(
        @"^(hi+|hey+|hello+|yo|good\s?(morning|afternoon|evening|day)|salam|as-?salamu?\s?alaikum|السلام عليكم|مرحبا|اهلا|هلا|صباح الخير|مساء الخير)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    // Reuse the established social vocabulary across routing and optional voice cues.
    // Unlike the legacy greeting prefix, every word must belong to a complete social turn.
    private static readonly string[] EnglishSocial =
    [
        "hi", "hii", "hey", "hello", "heya", "yo", "hiya", "howdy", "greetings", "welcome",
        "good morning", "good afternoon", "good evening", "good day", "good night",
        "how are you", "how're you", "how are you doing", "how is everything", "how's everything",
        "how is it going", "how's it going", "how do you do", "what's up", "whats up", "wassup",
        "nice to meet you", "pleased to meet you", "good to see you",
        "salam", "assalamu alaikum", "as salamu alaikum", "salaam alaikum",
        "who are you", "what is your name", "what's your name"
    ];
    private static readonly string[][] SocialWords = ArabicVoiceGreetings.SocialWords
        .Concat(EnglishSocial.Select(ArabicVoiceGreetings.Words)).ToArray();
    private static readonly string[][] FillerWords = ArabicVoiceGreetings.FillerWords
        .Concat(new[] { "there", "friend", "everyone", "all", "today", "bro", "man", "mira", "sanadi" }
            .Concat(new[] { "mira", "suhail" }.SelectMany(agent => new[] { "en", "ar" }
                .Select(language => SupportAgentPersona.Name(agent, language))))
            .Select(ArabicVoiceGreetings.Words)).ToArray();

    internal static bool IsGreetingOnly(string message) =>
        ArabicVoiceGreetings.MatchesWholeTurn(message, SocialWords, FillerWords);

    internal static string? ImmediateGreetingReply(string message, string lang, string? agent)
    {
        if (!IsGreetingOnly(message)) return null;
        // Keep existing short-greeting text exactly as it was.
        if (GreetingReply(message, lang) is { } existing) return existing;
        if (lang == "ar") return ArabicVoiceGreetings.ReplyToKnownGreeting(message, agent);
        var words = string.Join(' ', ArabicVoiceGreetings.Words(message));
        if (Regex.IsMatch(words, @"\b(who are you|what is your name|what s your name)\b"))
            return $"I'm {SupportAgentPersona.Name(agent, lang)}, your assistant for UAEU student services. How can I help you?";
        if (Regex.IsMatch(words, @"\b(how|what s up|whats up|wassup)\b"))
            return "I'm here and ready to help. How can I help you?";
        return GreetingReply("Hello", lang);
    }

    // The chat screen appends routing instructions after the student's sentence.
    // Those instructions mention complaints and suggestions, so they must not be
    // stored or classified as part of the question.
    internal static string StudentText(string message)
    {
        var text = message.Trim();
        const string marker = "Answer the user's exact question directly";
        var index = text.IndexOf(marker, StringComparison.Ordinal);
        if (index > 0)
        {
            var cut = text.LastIndexOf('\n', index);
            if (cut > 0) text = text[..cut];
        }
        return text.Trim();
    }

    internal static string? GreetingReply(string message, string lang)
    {
        var text = Regex.Replace(message.Trim(), @"[!.،؟?,\s]+$", "");
        if (text.Length is 0 or > 40) return null;
        text = Regex.Replace(text, @"[\u064B-\u0652]", "");
        text = text.Replace('أ', 'ا').Replace('إ', 'ا').Replace('آ', 'ا').Replace('ى', 'ي').Replace('ة', 'ه');
        if (!Greeting.IsMatch(text)) return null;
        return lang == "ar"
            ? "أهلاً فيك. أقدر أساعدك في الأسئلة الدراسية والإيقافات وتقدم التخرج والشكاوى والاقتراحات والمواعيد. تبي نبدأ بشنو؟"
            : "Hello. I can help with academic questions, holds, graduation progress, complaints, suggestions and appointments. What would you like to do?";
    }
}
