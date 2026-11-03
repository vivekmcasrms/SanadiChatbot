using System.Globalization;
using System.Text;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Infrastructure.AppFunctions;

/// <summary>Voice-only script validation. Does not classify or rewrite chat requests.</summary>
public static class VoiceTranscriptLanguage
{
    public const string ErrorCode = "stt_unsupported_language";

    public static bool IsSupported(string text)
    {
        foreach (var rune in text.EnumerateRunes())
        {
            var value = rune.Value;
            if (Rune.IsLetter(rune))
            {
                // Latin names/course codes and Arabic may coexist in either supported language.
                if (value is >= 'A' and <= 'Z' or >= 'a' and <= 'z'
                    or >= 0x00C0 and <= 0x024F or >= 0x1E00 and <= 0x1EFF
                    or >= 0x0600 and <= 0x06FF or >= 0x0750 and <= 0x077F
                    or >= 0x0870 and <= 0x08FF or >= 0xFB50 and <= 0xFDFF
                    or >= 0xFE70 and <= 0xFEFF or >= 0x1EE00 and <= 0x1EEFF) continue;
                return false;
            }
            if (Rune.GetUnicodeCategory(rune) is UnicodeCategory.NonSpacingMark or UnicodeCategory.SpacingCombiningMark
                && value is not (>= 0x0300 and <= 0x036F or >= 0x0600 and <= 0x06FF
                    or >= 0x08A0 and <= 0x08FF or >= 0xFE00 and <= 0xFE0F)) return false;
        }
        return true;
    }

    public static void RequireSupported(string text)
    {
        if (!IsSupported(text)) throw Unsupported();
    }

    public static SanadiException Unsupported() => new(
        "Speech could not be recognized in English or Arabic. Please repeat.", 422, ErrorCode);
}
