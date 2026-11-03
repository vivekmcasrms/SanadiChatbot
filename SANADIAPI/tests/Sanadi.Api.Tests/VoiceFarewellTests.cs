using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class VoiceFarewellTests
{
    [Theory]
    [InlineData("Thanks")]
    [InlineData("thank you!")]
    [InlineData("Thank you very much, Mira.")]
    [InlineData("Suhail, thanks a lot!")]
    [InlineData("Thanks so much")]
    [InlineData("thank you for your help")]
    [InlineData("Shukran")]
    [InlineData("Shokran, Suhail!")]
    [InlineData("shukran jazeelan")]
    [InlineData("شُكْراً")]
    [InlineData("شكراً جزيلاً يا ميرا")]
    [InlineData("مشكور يا سهيل")]
    [InlineData("مشكورة")]
    [InlineData("يعطيج العافية")]
    [InlineData("جزاك الله خيراً")]
    public void Standalone_gratitude_is_a_farewell(string text) => Assert.True(VoiceFarewell.IsThankYou(text));

    [Theory]
    [InlineData("Thanks, what is my GPA?")]
    [InlineData("Shukran, can you help with another question?")]
    [InlineData("What does shukran mean?")]
    [InlineData("Thank you. Submit my complaint.")]
    [InlineData("Thank you but I need another letter")]
    [InlineData("No thanks")]
    [InlineData("شكرا، كم معدلي؟")]
    [InlineData("شكرا اريد تقديم شكوى")]
    [InlineData("لا شكرا")]
    [InlineData("السلام عليكم، كيف حالك؟ أنت زين، شو اسمك؟")]
    [InlineData("Hello")]
    [InlineData("Please write a thank you letter")]
    public void Requests_declines_and_existing_greetings_continue_normally(string text) => Assert.False(VoiceFarewell.IsThankYou(text));

    [Fact]
    public void Farewell_matches_selected_language_without_claiming_a_service_was_executed()
    {
        Assert.Equal("You're welcome! Happy to help. Goodbye!", VoiceFarewell.Reply("en"));
        Assert.Equal("العفو، حياك الله! يسعدني أساعدك. مع السلامة.", VoiceFarewell.Reply("ar"));
    }
}
