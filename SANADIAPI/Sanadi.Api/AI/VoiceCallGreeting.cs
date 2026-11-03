namespace Sanadi.Api.AI;

internal static class VoiceCallGreeting
{
    internal static string Text(string agent, string language)
    {
        if (agent is not ("mira" or "suhail") || language is not ("en" or "ar"))
            throw new ArgumentException("Invalid voice greeting selection.");
        return language == "ar"
            ? $"مرحباً، أنا {SupportAgentPersona.Name(agent, language)} من سندي، خدمات طلبة جامعة الإمارات. كيف أقدر أساعدك؟"
            : $"Hi, I'm {SupportAgentPersona.Name(agent, language)} from Sanadi, UAEU student services. How can I help you?";
    }
}
