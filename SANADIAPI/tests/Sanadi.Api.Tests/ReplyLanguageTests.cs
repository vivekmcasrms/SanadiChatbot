using Sanadi.Api.Controllers;

namespace Sanadi.Api.Tests;

public sealed class ReplyLanguageTests
{
    [Theory]
    [InlineData("Hello Mira", "ar", "ar")]
    [InlineData("مرحبا يا سهيل", "en", "en")]
    [InlineData("What is my GPA?", "en", "en")]
    [InlineData("السلام عليكم", "ar", "ar")]
    [InlineData("Where is مكتبة?", "en", "en")]
    [InlineData("Hello", null, "en")]
    [InlineData("السلام عليكم", null, "ar")]
    public void Voice_respects_explicit_language_and_preserves_unselected_clients(string text, string? selected, string expected)
        => Assert.Equal(expected, AssistantController.VoiceReplyLanguage(text, selected));

    [Theory]
    [InlineData("Do I need to apply for a campus entry permit?", "ar", "en")]
    [InlineData("Can you create my enrolment letter?", "ar", "en")]
    [InlineData("Where can I find the textbook for CSBP301 — Artificial Intelligence course?", "ar", "en")]
    [InlineData("Hi", "ar", "en")]
    public void English_text_is_answered_in_english_whatever_the_interface_language(string text, string uiLang, string expected)
        => Assert.Equal(expected, AssistantController.ReplyLanguage(text, uiLang));

    [Theory]
    [InlineData("هل أحتاج أقدم طلب تصريح دخول للحرم؟", "en")]
    [InlineData("ممكن تطلع لي إفادة تسجيل؟", "en")]
    [InlineData("وين أقدر ألقى كتاب مقررالذكاء الاصطناعي؟", "en")]
    [InlineData("مرحباً", "en")]
    [InlineData("ضاع مني المحفظة في الحرم الجامعي.", null)]
    public void Arabic_text_is_answered_in_arabic_whatever_the_interface_language(string text, string? uiLang)
        => Assert.Equal("ar", AssistantController.ReplyLanguage(text, uiLang));

    [Theory]
    [InlineData("Where can I find the textbook for CSBP301 — الذكاء الاصطناعي?", "en")]
    [InlineData("وين ألقى كتاب مقرر CSBP301 Artificial Intelligence؟", "ar")]
    public void Mixed_text_follows_the_dominant_script(string text, string expected)
        => Assert.Equal(expected, AssistantController.ReplyLanguage(text, null));

    [Theory]
    [InlineData("12345", "ar", "ar")]
    [InlineData("👍", "en", "en")]
    [InlineData("", null, "en")]
    public void Text_without_letters_falls_back_to_the_interface_language(string text, string? uiLang, string expected)
        => Assert.Equal(expected, AssistantController.ReplyLanguage(text, uiLang));
}
