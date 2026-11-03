using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Configuration;
using Sanadi.Api.Controllers;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.AppFunctions;
using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class VoiceTranscribeEndpointTests
{
    [Theory]
    [InlineData("I need an enrolment letter.", "ar", "أحتاج إفادة تسجيل.")]
    [InlineData("أحتاج إفادة تسجيل.", "en", "I need an enrolment letter.")]
    public async Task Selected_output_language_translates_detected_speech_before_returning_the_question(
        string original, string target, string translated)
    {
        var user = Guid.NewGuid();
        var adapter = new CaptureTranscriber { Transcript = original };
        var translator = new CaptureTranslator { Output = translated };
        var result = Assert.IsType<OkObjectResult>(await Controller(adapter, user, translator).Transcribe(
            new(Convert.ToBase64String(new byte[2048]), target, target), default));
        Assert.Equal("auto", adapter.Language);
        Assert.Equal(original, translator.Text);
        Assert.Equal(target, translator.Language);
        Assert.Equal(user, translator.UserId);
        Assert.Equal(1, translator.Calls);
        Assert.Equal(translated, JsonSerializer.SerializeToElement(result.Value).GetProperty("text").GetString());
    }

    [Fact]
    public async Task Invalid_translation_target_never_sends_audio()
    {
        var adapter = new CaptureTranscriber();
        var result = await Controller(adapter, Guid.NewGuid()).Transcribe(
            new(Convert.ToBase64String(new byte[2048]), "auto", "invalid"), default);
        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(0, adapter.Calls);
    }

    [Fact]
    public async Task Silence_never_reaches_translation()
    {
        var translator = new CaptureTranslator();
        var result = Assert.IsType<OkObjectResult>(await Controller(new CaptureTranscriber(), Guid.NewGuid(), translator)
            .Transcribe(new(Convert.ToBase64String(new byte[2048]), "auto", "ar"), default));
        Assert.Equal(0, translator.Calls);
        Assert.Equal("", JsonSerializer.SerializeToElement(result.Value).GetProperty("text").GetString());
    }

    [Fact]
    public async Task Translation_failure_is_not_returned_as_an_untranslated_question()
    {
        var adapter = new CaptureTranscriber { Transcript = "My courses" };
        var result = Assert.IsType<ObjectResult>(await Controller(adapter, Guid.NewGuid())
            .Transcribe(new(Convert.ToBase64String(new byte[2048]), "auto", "ar"), default));
        Assert.Equal(503, result.StatusCode);
        Assert.Equal("stt_translation_unavailable", JsonSerializer.SerializeToElement(result.Value).GetProperty("error").GetString());
    }

    [Theory]
    [InlineData("Hello, what are my courses?", "ar")]
    [InlineData("مرحباً، ما هي مقرراتي؟", "en")]
    public async Task Passes_selected_language_and_authenticated_identity_without_rewriting_transcript(string text, string preference)
    {
        var userId = Guid.NewGuid();
        var adapter = new CaptureTranscriber { Transcript = " " + text + " " };
        var controller = Controller(adapter, userId);
        var result = Assert.IsType<OkObjectResult>(await controller.Transcribe(
            new(Convert.ToBase64String(new byte[2048]), preference), default));
        var json = JsonSerializer.SerializeToElement(result.Value);
        Assert.Equal(text, json.GetProperty("text").GetString());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("confidence").ValueKind);
        Assert.Equal(2, json.EnumerateObject().Count());
        Assert.Equal(userId, adapter.UserId);
        Assert.Equal(preference, adapter.Language);
        Assert.Equal(2048, adapter.Audio!.Length);
        Assert.Equal(1, adapter.Calls);
    }

    [Fact]
    public async Task Missing_user_never_sends_audio()
    {
        var adapter = new CaptureTranscriber();
        var result = await Controller(adapter, null).Transcribe(new(Convert.ToBase64String(new byte[2048]), "auto"), default);
        Assert.IsType<UnauthorizedObjectResult>(result);
        Assert.Equal(0, adapter.Calls);
    }

    [Theory]
    [InlineData(100, "auto")]
    [InlineData(2048, "invalid")]
    public async Task Invalid_input_never_sends_audio(int bytes, string language)
    {
        var adapter = new CaptureTranscriber();
        var result = await Controller(adapter, Guid.NewGuid()).Transcribe(new(Convert.ToBase64String(new byte[bytes]), language), default);
        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(0, adapter.Calls);
    }

    [Fact]
    public async Task Provider_failure_is_not_replayed_through_another_provider()
    {
        var adapter = new CaptureTranscriber { Fail = true };
        var result = await Controller(adapter, Guid.NewGuid()).Transcribe(new(Convert.ToBase64String(new byte[2048]), "auto"), default);
        var failure = Assert.IsType<ObjectResult>(result);
        Assert.Equal(503, failure.StatusCode);
        Assert.Equal("stt_audio_unsupported", JsonSerializer.SerializeToElement(failure.Value).GetProperty("error").GetString());
        Assert.Equal(1, adapter.Calls);
    }

    [Fact]
    public async Task Cancelled_request_never_sends_audio()
    {
        var adapter = new CaptureTranscriber();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Controller(adapter, Guid.NewGuid())
            .Transcribe(new(Convert.ToBase64String(new byte[2048]), "auto"), cancellation.Token));
        Assert.Equal(0, adapter.Calls);
    }

    [Theory]
    [InlineData("What are my courses?", "ar", "ما هي مقرراتي؟", "en", false)]
    [InlineData("ما هي مقرراتي؟", "en", "What are my courses?", "ar", false)]
    [InlineData("أريد review my courses", "ar", "أريد مراجعة مقرراتي", "en", false)]
    [InlineData("أريد معرفة تفاصيل مقرراتي في Computer Science", "en", "Review my Computer Science courses", "ar", false)]
    [InlineData("Hello", "ar", "مرحبا", "en", true)]
    [InlineData("شكرا", "en", "Thank you", "ar", true)]
    [InlineData("Thank you, what are my courses?", "ar", "شكرا، ما هي مقرراتي؟", "en", false)]
    public async Task Optional_feedback_uses_original_language_and_never_changes_translated_chat_input(
        string original,string target,string translated,string detected,bool skip)
    {
        var result=Assert.IsType<OkObjectResult>(await Controller(new CaptureTranscriber{Transcript=original},Guid.NewGuid(),
            new CaptureTranslator{Output=translated},true).Transcribe(new(Convert.ToBase64String(new byte[2048]),"auto",target,true),default));
        var json=JsonSerializer.SerializeToElement(result.Value);
        Assert.Equal(translated,json.GetProperty("text").GetString());
        Assert.Equal(detected,json.GetProperty("feedbackLanguage").GetString());
        Assert.Equal(skip,json.GetProperty("skipAcknowledgment").GetBoolean());
        Assert.Equal(original,json.GetProperty("sourceText").GetString());
    }

    [Fact]
    public async Task Disabled_flag_prevents_feedback_even_for_an_opted_in_client()
    {
        var result=Assert.IsType<OkObjectResult>(await Controller(new CaptureTranscriber{Transcript="What are my courses?"},Guid.NewGuid())
            .Transcribe(new(Convert.ToBase64String(new byte[2048]),"auto",null,true),default));
        Assert.True(JsonSerializer.SerializeToElement(result.Value).GetProperty("skipAcknowledgment").GetBoolean());
    }

    [Theory]
    [InlineData("Hello", true)]
    [InlineData("Hello Mira", true)]
    [InlineData("Hello Suhail", true)]
    [InlineData("Howdy Meera", true)]
    [InlineData("يا هلا وغلا، شحالج؟", true)]
    [InlineData("السَّلامُ عَلَيْكُم", true)]
    [InlineData("مساج الله بالخير", true)]
    [InlineData("صباح النور يا سهيل", true)]
    [InlineData("مرحبا Mira", true)]
    [InlineData("Hello ميرا، كيف حالك؟", true)]
    [InlineData("Hello Mira, find a library book", false)]
    [InlineData("هلا سهيل، أريد حجز موعد", false)]
    public async Task Greetings_skip_all_cues_but_service_requests_keep_them(string text, bool skip)
    {
        var result = Assert.IsType<OkObjectResult>(await Controller(new CaptureTranscriber { Transcript = text }, Guid.NewGuid(),
            feedbackEnabled: true).Transcribe(new(Convert.ToBase64String(new byte[2048]), "auto", null, true), default));
        var json = JsonSerializer.SerializeToElement(result.Value);
        Assert.Equal(text, json.GetProperty("text").GetString());
        Assert.Equal(skip, json.GetProperty("skipAcknowledgment").GetBoolean());
    }

    [Theory]
    [InlineData("Hello", "en", true)]
    [InlineData("Hello Mira", "en", true)]
    [InlineData("Hello Suhail", "en", true)]
    [InlineData("مرحبا يا ميرا", "ar", true)]
    [InlineData("أهلاً سهيل", "ar", true)]
    [InlineData("السلام عليكم", "ar", true)]
    [InlineData("Hello Mira, find a book", "en", false)]
    [InlineData("مرحبا، أريد شهادة تسجيل", "ar", false)]
    [InlineData("مرحبا، اعرض درجات طالب آخر", "ar", false)]
    [InlineData("Thank you", "en", false)]
    public async Task Only_a_complete_standard_greeting_can_authorize_early_public_audio(string text, string language, bool immediate)
    {
        var result = Assert.IsType<OkObjectResult>(await Controller(new CaptureTranscriber { Transcript = text }, Guid.NewGuid())
            .Transcribe(new(Convert.ToBase64String(new byte[2048]), "auto", null, true), default));
        var json = JsonSerializer.SerializeToElement(result.Value);
        var greeting = json.GetProperty("greetingReply");
        Assert.Equal(text, json.GetProperty("text").GetString());
        if (!immediate) { Assert.Equal(JsonValueKind.Null, greeting.ValueKind); return; }
        Assert.Equal(language, greeting.GetProperty("language").GetString());
        Assert.Equal(ConversationalTurn.GreetingReply("Hello", language), greeting.GetProperty("text").GetString());
    }

    [Theory]
    [InlineData("ar", "شكراً", false)]
    [InlineData("en", "Thank you", false)]
    [InlineData("ar", "شكراً", true)]
    [InlineData("en", "Thank you", true)]
    public async Task Misdetected_language_rereads_same_recording_once_and_preserves_farewell(string language, string corrected, bool providerDetected)
    {
        var adapter = new CaptureTranscriber { Transcript = "সুক্রান", RecoveryTranscript = corrected, RejectFirstLanguage = providerDetected };
        var translator = new CaptureTranslator { Output = corrected };
        var result = Assert.IsType<OkObjectResult>(await Controller(adapter, Guid.NewGuid(), translator, true)
            .Transcribe(new(Convert.ToBase64String(new byte[2048]), "auto", language, true), default));
        var json = JsonSerializer.SerializeToElement(result.Value);
        Assert.Equal(new[] { "auto", language }, adapter.Languages);
        Assert.Same(adapter.Recordings[0], adapter.Recordings[1]);
        Assert.Equal(corrected, json.GetProperty("text").GetString());
        Assert.Equal(corrected, json.GetProperty("sourceText").GetString());
        Assert.Equal(corrected, translator.Text);
        Assert.True(json.GetProperty("skipAcknowledgment").GetBoolean());
        Assert.True(VoiceFarewell.IsThankYou(corrected));
    }

    [Theory]
    [InlineData("ar", 2)]
    [InlineData("en", 2)]
    [InlineData(null, 1)]
    public async Task Repeated_unsupported_transcript_is_rejected_without_guessing_or_translation(string? target, int calls)
    {
        var adapter = new CaptureTranscriber { Transcript = "সুক্রান" };
        var translator = new CaptureTranslator();
        var result = Assert.IsType<ObjectResult>(await Controller(adapter, Guid.NewGuid(), translator)
            .Transcribe(new(Convert.ToBase64String(new byte[2048]), "auto", target), default));
        Assert.Equal(422, result.StatusCode);
        Assert.Equal(VoiceTranscriptLanguage.ErrorCode, JsonSerializer.SerializeToElement(result.Value).GetProperty("error").GetString());
        Assert.Equal(calls, adapter.Calls);
        Assert.Equal(0, translator.Calls);
    }

    [Fact]
    public async Task Cancellation_prevents_language_recovery()
    {
        using var cancel = new CancellationTokenSource();
        var adapter = new CaptureTranscriber { Transcript = "সুক্রান", AfterFirstCall = cancel.Cancel };
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Controller(adapter, Guid.NewGuid())
            .Transcribe(new(Convert.ToBase64String(new byte[2048]), "auto", "ar"), cancel.Token));
        Assert.Equal(1, adapter.Calls);
    }

    [Fact]
    public async Task Translator_cannot_introduce_unsupported_script_into_a_valid_question()
    {
        var result = Assert.IsType<ObjectResult>(await Controller(new CaptureTranscriber { Transcript = "Thank you" }, Guid.NewGuid(),
            new CaptureTranslator { Output = "সুক্রান" }).Transcribe(new(Convert.ToBase64String(new byte[2048]), "auto", "ar"), default));
        Assert.Equal(422, result.StatusCode);
        Assert.Equal(VoiceTranscriptLanguage.ErrorCode, JsonSerializer.SerializeToElement(result.Value).GetProperty("error").GetString());
    }

    [Theory]
    [InlineData("ar", "ما هي مقرراتي؟")]
    [InlineData("en", "What are my courses?")]
    public async Task Recognition_hint_recovers_auto_detection_without_translation(string hint, string corrected)
    {
        var adapter = new CaptureTranscriber { Transcript = "সুক্রান", RecoveryTranscript = corrected };
        var translator = new CaptureTranslator();
        var result = Assert.IsType<OkObjectResult>(await Controller(adapter, Guid.NewGuid(), translator).Transcribe(
            new(Convert.ToBase64String(new byte[2048]), "auto", IncludeFeedbackContext: true, RecognitionHint: hint), default));
        Assert.Equal(new[] { "auto", hint }, adapter.Languages);
        Assert.Same(adapter.Recordings[0], adapter.Recordings[1]);
        var json = JsonSerializer.SerializeToElement(result.Value);
        Assert.Equal(corrected, json.GetProperty("text").GetString());
        Assert.Equal(corrected, json.GetProperty("sourceText").GetString());
        Assert.Equal(0, translator.Calls);
    }

    [Fact]
    public async Task Successful_arabic_auto_detection_ignores_english_hint_and_does_not_translate()
    {
        var adapter = new CaptureTranscriber { Transcript = "ما هي مقرراتي؟" };
        var translator = new CaptureTranslator();
        var result = Assert.IsType<OkObjectResult>(await Controller(adapter, Guid.NewGuid(), translator).Transcribe(
            new(Convert.ToBase64String(new byte[2048]), "auto", RecognitionHint: "en"), default));
        Assert.Equal(adapter.Transcript, JsonSerializer.SerializeToElement(result.Value).GetProperty("text").GetString());
        Assert.Equal(new[] { "auto" }, adapter.Languages);
        Assert.Equal(0, translator.Calls);
    }

    [Fact]
    public async Task Recognition_hint_retry_remains_bounded_and_rejects_unsupported_output()
    {
        var adapter = new CaptureTranscriber { Transcript = "সুক্রান", RejectFirstLanguage = true };
        var result = Assert.IsType<ObjectResult>(await Controller(adapter, Guid.NewGuid()).Transcribe(
            new(Convert.ToBase64String(new byte[2048]), "auto", RecognitionHint: "ar"), default));
        Assert.Equal(422, result.StatusCode);
        Assert.Equal(new[] { "auto", "ar" }, adapter.Languages);
    }

    [Fact]
    public async Task Invalid_recognition_hint_does_not_send_audio()
    {
        var adapter = new CaptureTranscriber();
        Assert.IsType<BadRequestObjectResult>(await Controller(adapter, Guid.NewGuid()).Transcribe(
            new(Convert.ToBase64String(new byte[2048]), "auto", RecognitionHint: "invalid"), default));
        Assert.Equal(0, adapter.Calls);
    }

    private static VoiceController Controller(IVoiceTranscriber adapter, Guid? userId, IVoiceTranscriptTranslator? translator = null, bool feedbackEnabled=false) => new(
        null!, new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["Voice:ProcessingAcknowledgments:Enabled"]=feedbackEnabled.ToString() }).Build(),
        NullLogger<VoiceController>.Instance, new VoiceTranscriptionService(adapter, translator), null!, new VoiceMetricsStore(), null!)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = userId.HasValue
                    ? new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", userId.Value.ToString())], "Cookie"))
                    : new ClaimsPrincipal(new ClaimsIdentity())
            }
        }
    };

    private sealed class CaptureTranslator : IVoiceTranscriptTranslator
    {
        public string Output { get; init; } = "";
        public string? Text { get; private set; }
        public string? Language { get; private set; }
        public Guid UserId { get; private set; }
        public int Calls { get; private set; }
        public Task<string> Translate(string text, string targetLanguage, Guid userId, CancellationToken ct)
        {
            Calls++;
            Text = text;
            Language = targetLanguage;
            UserId = userId;
            return Task.FromResult(Output);
        }
    }

    private sealed class CaptureTranscriber : IVoiceTranscriber
    {
        public string Transcript { get; init; } = "";
        public bool Fail { get; init; }
        public string? RecoveryTranscript { get; init; }
        public bool RejectFirstLanguage { get; init; }
        public Action? AfterFirstCall { get; init; }
        public List<string> Languages { get; } = [];
        public List<byte[]> Recordings { get; } = [];
        public int Calls { get; private set; }
        public Guid UserId { get; private set; }
        public string? Language { get; private set; }
        public byte[]? Audio { get; private set; }
        public Task<string> Transcribe(byte[] wav, Guid userId, CancellationToken ct, string language = "auto")
        {
            Calls++;
            UserId = userId;
            Language = language;
            Audio = wav;
            Languages.Add(language);
            Recordings.Add(wav);
            if (Calls == 1) AfterFirstCall?.Invoke();
            if (Calls == 1 && RejectFirstLanguage) throw VoiceTranscriptLanguage.Unsupported();
            if (Fail) throw new SanadiException("The configured AI model does not support audio input.", 503, "stt_audio_unsupported");
            return Task.FromResult(Calls > 1 ? RecoveryTranscript ?? Transcript : Transcript);
        }
    }
}
