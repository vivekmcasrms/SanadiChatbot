using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Sanadi.Api.AI;
using Sanadi.Infrastructure.AppFunctions;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.Tests;

public sealed class VoiceTranscriptTranslatorTests
{
    [Theory]
    [InlineData("en", "I need an enrolment letter.")]
    [InlineData("ar", "أحتاج إفادة تسجيل.")]
    [InlineData("ar", "ما هو معدلي GPA؟")]
    [InlineData("en", "3.75")]
    public async Task Matching_language_passes_through_without_settings_or_model_access(string language, string text)
    {
        // Null dependencies prove that the same-language path makes no external calls.
        var translator = new VoiceTranscriptTranslator(null!, null!, null!, NullLogger<VoiceTranscriptTranslator>.Instance);
        Assert.Equal(text, await translator.Translate(text, language, Guid.NewGuid(), default));
    }

    [Theory]
    [InlineData("ar", "أحتاج إفادة تسجيل.")]
    [InlineData("en", "I need an enrolment letter.")]
    public void Translated_question_is_returned_in_the_selected_language(string language, string translated)
        => Assert.Equal(translated, VoiceTranscriptTranslator.Parse(JsonSerializer.Serialize(new { text = translated }), language));

    [Theory]
    [InlineData("ar", "I need an enrolment letter.")]
    [InlineData("en", "أحتاج إفادة تسجيل.")]
    [InlineData("ar", "")]
    [InlineData("en", "")]
    public void Wrong_language_or_empty_model_output_cannot_be_submitted_as_the_question(string language, string translated)
        => Assert.Throws<JsonException>(() => VoiceTranscriptTranslator.Parse(JsonSerializer.Serialize(new { text = translated }), language));

    [Theory]
    [InlineData("ar", "সুক্রান")]
    [InlineData("en", "সুক্রান")]
    [InlineData("ar", "شكرا धन्यवाद")]
    [InlineData("en", "Thank you спасибо")]
    public void Unsupported_translation_requests_repetition_instead_of_returning_wrong_text(string language, string translated)
    {
        var error = Assert.Throws<SanadiException>(() => VoiceTranscriptTranslator.Parse(JsonSerializer.Serialize(new { text = translated }), language));
        Assert.Equal(VoiceTranscriptLanguage.ErrorCode, error.Code);
    }

    [Theory]
    [InlineData("en")]
    [InlineData("ar")]
    public async Task Unsupported_script_is_not_mistaken_for_selected_language(string language)
    {
        var translator = new VoiceTranscriptTranslator(null!, null!, null!, NullLogger<VoiceTranscriptTranslator>.Instance);
        var error = await Assert.ThrowsAsync<SanadiException>(() => translator.Translate("সুক্রান", language, Guid.NewGuid(), default));
        Assert.Equal(VoiceTranscriptLanguage.ErrorCode, error.Code);
    }

    [Fact]
    public async Task Cancellation_also_stops_matching_language_input()
    {
        var translator = new VoiceTranscriptTranslator(null!, null!, null!, NullLogger<VoiceTranscriptTranslator>.Instance);
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => translator.Translate("My courses", "en", Guid.NewGuid(), cancellation.Token));
    }
}
