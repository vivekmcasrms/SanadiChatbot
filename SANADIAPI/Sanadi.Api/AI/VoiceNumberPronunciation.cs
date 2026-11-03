using System.Text.RegularExpressions;

namespace Sanadi.Api.AI;

/// <summary>Deterministic digit pronunciation at the TTS boundary; never edits a chat response.</summary>
internal static partial class VoiceNumberPronunciation
{
    private static readonly string[] English = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
    private static readonly string[] Arabic = ["صفر", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
    internal sealed record Part(string Text, string? Identifier = null);

    internal static IReadOnlyList<Part> Parts(string text, string language)
    {
        var parts = new List<Part>();
        var start = 0;
        foreach (Match match in NumericToken().Matches(text))
        {
            if (match.Length < 5 || !match.Value.All(char.IsDigit)) continue;
            AddText(text[start..match.Index]);
            parts.Add(new(match.Value, string.Concat(match.Value.Select(digit => (int)char.GetNumericValue(digit)))));
            start = match.Index + match.Length;
        }
        if (start == 0) return [new(text)];
        AddText(text[start..]);
        return parts;

        void AddText(string value)
        {
            value = value.Trim();
            if (value.Any(char.IsLetterOrDigit)) parts.Add(new(value));
        }
    }

    internal static string DigitPrompt(string digits, string language, bool strongerPauses, bool framed = false)
    {
        var names = language == "ar" ? Arabic : English;
        var separator = strongerPauses ? ". " : language == "ar" ? "، " : ", ";
        return (framed ? language == "ar" ? "الرقم: " : "Number: " : "")
            + string.Join(separator, digits.Select(digit => names[digit - '0'])) + ".";
    }

    internal static bool Matches(string transcript, string expected)
    {
        var words = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < 10; i++) { words[English[i]] = i; words[Normalize(Arabic[i])] = i; }
        words["oh"] = 0; words["اثنين"] = 2;
        var framing = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            { "number", "numbers", "the", "is", "digits", "are", "الرقم", "رقم", "الارقام", "هي", "هو" };
        var actual = new System.Text.StringBuilder();
        foreach (Match token in Regex.Matches(Normalize(transcript), @"[\p{L}\p{Nd}]+"))
        {
            if (token.Value.All(char.IsDigit))
                foreach (var digit in token.Value) actual.Append((int)char.GetNumericValue(digit));
            else if (words.TryGetValue(token.Value, out var digit)) actual.Append(digit);
            else if (!framing.Contains(token.Value)) return false;
        }
        return actual.ToString() == expected;
    }

    // Check the assembled reply as well as its isolated digits. Keep the source wording
    // (including negatives/conditions); tolerate punctuation, digit words and number labels.
    internal static bool MatchesReply(string transcript, string source)
    {
        var identifiers = NumericToken().Matches(source).Select(match => match.Value)
            .Where(value => value.Length >= 5 && value.All(char.IsDigit))
            .Select(value => string.Concat(value.Select(c => (int)char.GetNumericValue(c)))).ToHashSet();
        IEnumerable<string> SeparatedNumbers(string text) => NumericToken().Matches(text).Select(match => match.Value)
            .Where(value => value.Any(c => !char.IsDigit(c)) && !identifiers.Contains(string.Concat(
                value.Where(char.IsDigit).Select(c => (int)char.GetNumericValue(c)))))
            .Select(value => string.Concat(value.Select(c => char.IsDigit(c) ? ((int)char.GetNumericValue(c)).ToString()
                : c == '٫' ? "." : c == '٬' ? "," : c.ToString())));
        // Punctuation may group an identifier, but must not change a GPA, amount or date.
        if (!SeparatedNumbers(source).SequenceEqual(SeparatedNumbers(transcript))) return false;
        string Canonical(string text)
        {
            var output = new System.Text.StringBuilder();
            foreach (Match token in Regex.Matches(Normalize(text).ToLowerInvariant(), @"[\p{L}\p{Nd}]+"))
            {
                var value = token.Value;
                if (value.All(char.IsDigit))
                    foreach (var digit in value) output.Append((int)char.GetNumericValue(digit));
                else if (value is not ("number" or "numbers" or "الرقم" or "رقم"))
                {
                    var index = Array.IndexOf(English, value);
                    if (index < 0) index = Array.FindIndex(Arabic, word => Normalize(word) == value);
                    if (value == "oh") index = 0;
                    if (value == "اثنين") index = 2;
                    if (index >= 0) output.Append(index); else output.Append(value);
                }
            }
            return output.ToString();
        }
        return Canonical(transcript) == Canonical(source);
    }

    private static string Normalize(string text) => Regex.Replace(text, @"[\u0640\u064B-\u065F]", "")
        .Replace('أ', 'ا').Replace('إ', 'ا');

    internal static string ForSpeech(string text, string language)
    {
        var names = language == "ar" ? Arabic : English;
        var separator = language == "ar" ? "، " : ", ";
        return NumericToken().Replace(text, match =>
        {
            var value = match.Value;
            // Long, ungrouped digit strings are read as identifiers. Years, small counts,
            // decimals, grouped quantities, dates and times retain their existing rendering.
            // Do not parse an integer: leading zeros and every repeated digit are significant.
            if (value.Length < 5 || !value.All(char.IsDigit)) return value;
            return string.Join(separator, value.Select(digit => names[(int)char.GetNumericValue(digit)]));
        });
    }

    // Match a whole numeric token so neither half of a decimal/date is converted on its own.
    [GeneratedRegex(@"(?<![\p{L}\p{Nd}])\p{Nd}+(?:[.,٫٬:/-]\p{Nd}+)*(?![\p{L}\p{Nd}])")]
    private static partial Regex NumericToken();
}
