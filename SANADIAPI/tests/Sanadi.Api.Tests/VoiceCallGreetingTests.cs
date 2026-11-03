using Sanadi.Api.AI;
using Sanadi.Api.Controllers;

namespace Sanadi.Api.Tests;

public sealed class VoiceCallGreetingTests
{
    [Fact]
    public void Meera_welcome_matches_the_requested_English_message()
        => Assert.Equal("Hi, I'm Meera from Sanadi, UAEU student services. How can I help you?", VoiceCallGreeting.Text("mira", "en"));

    [Theory]
    [InlineData("mira", "ar", "ميرا")]
    [InlineData("suhail", "ar", "سهيل")]
    [InlineData("mira", "en", "Meera")]
    [InlineData("suhail", "en", "Suhail")]
    public void Welcome_respects_selected_language_and_voice_identity(string agent, string language, string name)
    {
        var text = VoiceCallGreeting.Text(agent, language);
        Assert.Contains(name, text);
        Assert.Equal(language, AssistantController.ReplyLanguage(text, null));
    }

    [Theory]
    [InlineData("unknown", "en")]
    [InlineData("mira", "unknown")]
    public void Unsupported_selections_do_not_produce_a_welcome(string agent, string language)
        => Assert.Throws<ArgumentException>(() => VoiceCallGreeting.Text(agent, language));
}
