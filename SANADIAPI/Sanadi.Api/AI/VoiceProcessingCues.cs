namespace Sanadi.Api.AI;

/// <summary>Public presentation clips only. They neither classify nor execute a student request.</summary>
internal static class VoiceProcessingCues
{
    internal const string EnabledSetting = "Voice:ProcessingAcknowledgments:Enabled";
    internal static readonly (string En, string Ar)[] Initial = [
        ("Sure, I'm checking that now.", "بالتأكيد، أتحقق من ذلك الآن."),
        ("Got it, let me check.", "فهمت، دعني أتحقق."),
        ("Absolutely, one moment.", "حاضر، لحظة من فضلك."),
        ("I'll look into that.", "سأبحث في الأمر."),
        ("Let me find that for you.", "دعني أجد ذلك لك."),
        ("I'm on it.", "أنا أتابع الأمر الآن."),
        ("I'll check the details.", "سأراجع التفاصيل."),
        ("Understood, let me review that.", "فهمت، دعني أراجع ذلك.")
    ];
    // No speculative progress (such as "almost there") or claims of completion.
    internal static readonly (string En, string Ar)[] Waiting = [
        ("Thanks for your patience.", "شكرًا لصبرك."),
        ("I'm still checking that.", "ما زلت أتحقق من ذلك."),
        ("This is taking a little longer.", "الأمر يستغرق وقتًا أطول قليلًا."),
        ("I'm working on it.", "ما زلت أعمل على طلبك."),
        ("I'm still processing your request.", "ما زلت أعالج طلبك.")
    ];

    internal static string Text(string kind, int index, string language)
    {
        var phrases = kind switch { "initial" => Initial, "waiting" => Waiting, _ => throw new ArgumentException("Invalid cue kind.") };
        if (language is not ("en" or "ar") || index < 0 || index >= phrases.Length)
            throw new ArgumentException("Invalid cue selection.");
        return language == "ar" ? phrases[index].Ar : phrases[index].En;
    }
}
