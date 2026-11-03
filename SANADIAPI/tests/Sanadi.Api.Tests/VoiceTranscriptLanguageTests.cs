using Sanadi.Infrastructure.AppFunctions;

namespace Sanadi.Api.Tests;

public sealed class VoiceTranscriptLanguageTests
{
    [Theory]
    [InlineData("Thank you!")]
    [InlineData("شُكْرًا!")]
    [InlineData("ما هو GPA في Computer Science؟")]
    [InlineData("ID 00200336, GPA 3.75, ١٢٣")]
    [InlineData("José, Noe\u0308l, Østberg")]
    [InlineData("👍 ❤️")]
    [InlineData("")]
    public void Supported_transcripts_names_numbers_and_silence_are_preserved(string text)
        => Assert.True(VoiceTranscriptLanguage.IsSupported(text));

    [Theory]
    [InlineData("সুক্রান")]
    [InlineData("धन्यवाद")]
    [InlineData("谢谢")]
    [InlineData("спасибо")]
    [InlineData("شكرا धन्यवाद")]
    [InlineData("Thank you こんにちは")]
    public void Unsupported_or_mixed_third_script_is_rejected(string text)
        => Assert.False(VoiceTranscriptLanguage.IsSupported(text));
}
