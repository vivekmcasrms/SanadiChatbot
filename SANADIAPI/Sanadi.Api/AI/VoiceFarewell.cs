using System.Text.RegularExpressions;

namespace Sanadi.Api.AI;

/// <summary>Whole social turns only; gratitude within a new request must reach the existing agents.</summary>
internal static class VoiceFarewell
{
    internal static bool IsThankYou(string text)
    {
        var normalized = Regex.Replace(text.ToLowerInvariant(), @"[\u064B-\u065F\u0670\u0640]", "")
            .Replace('أ', 'ا').Replace('إ', 'ا').Replace('آ', 'ا');
        normalized = Regex.Replace(normalized, @"[^\p{L}\p{N}\s]", " ");
        normalized = Regex.Replace(normalized, @"\s+", " ").Trim();
        const string name = @"(?:mira|meera|suhail|sanadi|ميرا|ميره|سهيل|سنادي|سندي)";
        normalized = Regex.Replace(normalized, $@"^(?:{name})\s+|\s+(?:يا\s+)?{name}$", "").Trim();
        return Regex.IsMatch(normalized,
            @"^(?:thanks(?: a lot| so much| very much)?|thank you(?: very much| so much| for your help)?|" +
            @"sh[ou]kran(?: jaz[ei]+lan)?|شكرا(?: لك| لج| لكم| جزيلا| جزيلا لك| على المساعدة)?|مشكور(?:ة|ين)?|" +
            @"تسلم(?:ين)?|يعطيك العافية|يعطيج العافية|جزاك الله خير(?:ا)?)$");
    }

    internal static string Reply(string language) => language == "ar"
        ? "العفو، حياك الله! يسعدني أساعدك. مع السلامة."
        : "You're welcome! Happy to help. Goodbye!";
}
