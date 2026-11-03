using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Sanadi.Api.AI;

/// <summary>Conservative voice decisions. Never guesses identifiers or creates action arguments.</summary>
internal static class VoiceConversationPolicy
{
    internal static bool Confirms(string text) => Regex.IsMatch(text.Trim(),
        @"^(?:yes(?:[, ]+please)?|yes[, ]+submit it|submit it|confirm(?: submission)?|نعم|ايه|هيه|نعم قدمه|أكد|اكد|قدمه)[.!؟?]*$", RegexOptions.IgnoreCase);
    internal static bool Declines(string text) => Regex.IsMatch(text.Trim(),
        @"^(?:no|cancel(?: it)?|do not submit|لا|الغاء|إلغاء|الغي|ألغي)[.!؟?]*$", RegexOptions.IgnoreCase);
    internal static bool EndsCall(string text) => Regex.IsMatch(text.Trim(),
        @"^(?:goodbye|bye(?: bye)?|end (?:the )?call|hang up|مع السلامة|مع السلامه|انهاء المكالمة|إنهاء المكالمة)[.!؟?]*$", RegexOptions.IgnoreCase);

    internal static string ConfirmationPrompt(JsonObject result, string language) =>
        result["proposedActions"] is JsonArray { Count: 1 } proposals &&
        proposals[0]?["toolName"] is JsonValue && proposals[0]?["args"] is JsonObject
            ? language == "ar"
                ? "راجع تفاصيل الإجراء على الشاشة. للتأكيد قل نعم، وللإلغاء قل إلغاء."
                : "Review the action details on screen. To confirm, say yes, submit it. To cancel, say cancel."
            : "";

    internal static string? ResolveSelection(string text, JsonObject metadata)
    {
        var match = Regex.Match(text.Trim(), @"^(?:(?:tell me about|show me|choose|select)\s+)?(?:the\s+)?(first|second|third|1|2|3|that|الأول|الاول|الثاني|الثالث|هذا|هذي)(?:\s+(?:one|book|course))?[.!؟?]*$", RegexOptions.IgnoreCase);
        if (!match.Success) return null;
        if (Regex.IsMatch(text, @"\bcourse\b", RegexOptions.IgnoreCase)) return "";
        var options = metadata["libraryResults"]?["results"] as JsonArray;
        if (options is null || options.Count == 0) return "";
        var selected = match.Groups[1].Value.ToLowerInvariant();
        var index = selected switch { "first" or "1" or "الأول" or "الاول" => 0,
            "second" or "2" or "الثاني" => 1, "third" or "3" or "الثالث" => 2,
            _ => options.Count == 1 ? 0 : -1 };
        if (index < 0 || index >= options.Count || options[index]?["title"] is not JsonValue title) return "";
        return "Find the library book " + title.GetValue<string>();
    }

    internal static IEnumerable<string> SpeechSegments(string text)
    {
        var start = 0;
        foreach (var end in VoicePhrasing.Boundaries(text))
        {
            if (end - start < 55) continue; // Keep short clauses together for natural prosody.
            yield return text[start..end].Trim();
            start = end;
        }
        if (start < text.Length && !string.IsNullOrWhiteSpace(text[start..])) yield return text[start..].Trim();
    }
}
