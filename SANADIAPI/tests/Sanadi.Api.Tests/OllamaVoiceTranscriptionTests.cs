using System.Net;
using System.Text.Json;
using Sanadi.Api.AI;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.AppFunctions;

namespace Sanadi.Api.Tests;

public sealed class OllamaVoiceTranscriptionTests
{
    private static readonly OllamaVoiceTranscription.Settings Config =
        new("https://private-speech.example/v1/audio/transcriptions", "private-test-key", "private-whisper");

    [Fact]
    public async Task Active_database_gateway_and_key_are_used_with_whisper_not_the_chat_model()
    {
        var settings = OllamaVoiceTranscription.FromAiSettings("https://private-speech.example/v1", "database-key");
        using var handler = new CaptureHandler(HttpStatusCode.OK, "{\"text\":\"مرحبا\"}");
        using var client = new HttpClient(handler);
        Assert.Equal("مرحبا", await OllamaVoiceTranscription.Transcribe(client, settings, [1, 2, 3], Guid.NewGuid(), CancellationToken.None, "ar"));
        Assert.Equal(Config.Url, handler.Url);
        Assert.Equal("Bearer database-key", handler.Authorization);
        Assert.Contains("whisper-large-v3", handler.Body);
        Assert.DoesNotContain("qwen-chat-model", handler.Body);
        Assert.Contains("name=language\r\n\r\nar", handler.Body);
    }

    [Theory]
    [InlineData("https://private-speech.example/v1")]
    [InlineData("https://private-speech.example/v1/")]
    [InlineData("https://private-speech.example/v1/chat/completions")]
    [InlineData("https://private-speech.example/v1/audio/speech")]
    [InlineData("https://private-speech.example/v1/audio/transcriptions/")]
    public void Database_base_or_endpoint_url_resolves_to_one_transcription_suffix(string url)
    {
        var settings = OllamaVoiceTranscription.FromAiSettings(url, " database-key ");
        Assert.Equal(Config.Url, settings.Url);
        Assert.Equal("database-key", settings.Key);
        Assert.Equal("whisper-large-v3", settings.Model);
    }

    [Theory]
    [InlineData("en")]
    [InlineData("ar")]
    public async Task Selected_ui_language_is_sent_as_a_multipart_field(string language)
    {
        using var handler = new CaptureHandler(HttpStatusCode.OK, "{\"text\":\"transcript\"}");
        using var client = new HttpClient(handler);
        await OllamaVoiceTranscription.Transcribe(client, Config, [1, 2, 3], Guid.NewGuid(), default, language);
        Assert.Contains("name=language\r\n\r\n" + language, handler.Body);
    }

    [Fact]
    public async Task Older_client_without_selection_keeps_auto_detection()
    {
        using var handler = new CaptureHandler(HttpStatusCode.OK, "{\"text\":\"transcript\"}");
        using var client = new HttpClient(handler);
        await OllamaVoiceTranscription.Transcribe(client, Config, [1, 2, 3], Guid.NewGuid(), default);
        Assert.DoesNotContain("name=language", handler.Body);
    }

    [Fact]
    public void Missing_database_credential_is_rejected()
    {
        var error = Assert.Throws<SanadiException>(() => OllamaVoiceTranscription.FromAiSettings("https://private-speech.example/v1", ""));
        Assert.Equal("stt_not_configured", error.Code);
    }

    [Fact]
    public async Task Invalid_ui_language_is_rejected_before_sending_audio()
    {
        using var handler = new CaptureHandler(HttpStatusCode.OK, "{}");
        using var client = new HttpClient(handler);
        await Assert.ThrowsAsync<SanadiException>(() => OllamaVoiceTranscription.Transcribe(client, Config, [1], Guid.NewGuid(), default, "invalid"));
        Assert.Equal(0, handler.Calls);
    }

    [Theory]
    [InlineData("Hello Sanadi.")]
    [InlineData("مرحبا سندي.")]
    public async Task Sends_wav_only_to_configured_private_transcription_endpoint(string transcript)
    {
        var user = Guid.NewGuid();
        var audio = new byte[] { 1, 2, 3, 4 };
        using var handler = new CaptureHandler(HttpStatusCode.OK, JsonSerializer.Serialize(new { text = transcript }));
        using var client = new HttpClient(handler);

        var result = await OllamaVoiceTranscription.Transcribe(client, Config, audio, user, CancellationToken.None);

        Assert.Equal(transcript, result);
        Assert.Equal(1, handler.Calls);
        Assert.Equal(Config.Url, handler.Url);
        Assert.Equal("Bearer " + Config.Key, handler.Authorization);
        Assert.Equal(user.ToString(), handler.User);
        Assert.StartsWith("multipart/form-data;", handler.ContentType);
        Assert.Contains("name=model", handler.Body);
        Assert.Contains(Config.Model, handler.Body);
        Assert.Contains("name=response_format", handler.Body);
        Assert.Contains("name=file; filename=question.wav", handler.Body);
        Assert.Contains("Content-Type: audio/wav", handler.Body);
        Assert.Contains("\u0001\u0002\u0003\u0004", handler.Body);
        Assert.DoesNotContain("input_audio", handler.Body);
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest, "stt_service_unavailable")]
    [InlineData(HttpStatusCode.Unauthorized, "stt_auth_failed")]
    [InlineData(HttpStatusCode.Forbidden, "stt_auth_failed")]
    [InlineData(HttpStatusCode.NotFound, "stt_service_unavailable")]
    [InlineData(HttpStatusCode.Redirect, "stt_service_unavailable")]
    public async Task Service_failure_is_not_retried_or_leaked(HttpStatusCode status, string code)
    {
        using var handler = new CaptureHandler(status, "rejected private-test-key");
        using var client = new HttpClient(handler);
        var error = await Assert.ThrowsAsync<SanadiException>(() =>
            OllamaVoiceTranscription.Transcribe(client, Config, [1, 2, 3], Guid.NewGuid(), CancellationToken.None));

        Assert.Equal(code, error.Code);
        Assert.Equal(1, handler.Calls);
        Assert.DoesNotContain(Config.Key, error.ToString());
    }

    [Theory]
    [InlineData("", "private-whisper")]
    [InlineData("https://private-speech.example/v1/chat/completions", "private-whisper")]
    [InlineData("https://huggingface.co/model", "private-whisper")]
    [InlineData("https://private-speech.example/v1/audio/transcriptions", "")]
    public async Task Missing_or_wrong_private_configuration_never_sends_audio(string url, string model)
    {
        using var handler = new CaptureHandler(HttpStatusCode.OK, "{}");
        using var client = new HttpClient(handler);
        var error = await Assert.ThrowsAsync<SanadiException>(() =>
            OllamaVoiceTranscription.Transcribe(client, Config with { Url = url, Model = model }, [1], Guid.NewGuid(), CancellationToken.None));
        Assert.Equal("stt_not_configured", error.Code);
        Assert.Equal(0, handler.Calls);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"text\":5}")]
    [InlineData("not-json")]
    [InlineData("null")]
    [InlineData("[]")]
    public async Task Invalid_transcription_response_is_rejected(string body)
    {
        using var handler = new CaptureHandler(HttpStatusCode.OK, body);
        using var client = new HttpClient(handler);
        var error = await Assert.ThrowsAsync<SanadiException>(() =>
            OllamaVoiceTranscription.Transcribe(client, Config, [1], Guid.NewGuid(), CancellationToken.None));
        Assert.Equal("stt_service_unavailable", error.Code);
    }

    [Theory]
    [InlineData("সুক্রান", null)]
    [InlineData("সুক্রান", "bn")]
    [InlineData("Bonjour", "fr")]
    [InlineData("مرحبا", "fa")]
    [InlineData("مرحبا こんにちは", "ar")]
    public async Task Unsupported_provider_language_or_script_never_leaves_recognition(string transcript, string? language)
    {
        using var handler = new CaptureHandler(HttpStatusCode.OK, JsonSerializer.Serialize(new { text = transcript, language }));
        using var client = new HttpClient(handler);
        var error = await Assert.ThrowsAsync<SanadiException>(() =>
            OllamaVoiceTranscription.Transcribe(client, Config, [1, 2, 3], Guid.NewGuid(), default));
        Assert.Equal(VoiceTranscriptLanguage.ErrorCode, error.Code);
        Assert.Equal(1, handler.Calls);
        Assert.DoesNotContain(transcript, error.Message);
    }

    [Theory]
    [InlineData("شكراً", "ar")]
    [InlineData("Thank you", "en")]
    [InlineData("أريد معرفة GPA", "Arabic")]
    [InlineData("3.75", "english")]
    public async Task Supported_provider_language_is_accepted_without_rewriting(string transcript, string language)
    {
        using var handler = new CaptureHandler(HttpStatusCode.OK, JsonSerializer.Serialize(new { text = transcript, language }));
        using var client = new HttpClient(handler);
        Assert.Equal(transcript, await OllamaVoiceTranscription.Transcribe(client, Config, [1, 2, 3], Guid.NewGuid(), default));
        Assert.Equal(1, handler.Calls);
    }

    private sealed class CaptureHandler(HttpStatusCode status, string response) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        public string? Url { get; private set; }
        public string? Authorization { get; private set; }
        public string? User { get; private set; }
        public string? ContentType { get; private set; }
        public string Body { get; private set; } = "";

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++;
            Url = request.RequestUri!.AbsoluteUri;
            Authorization = request.Headers.Authorization?.ToString();
            User = request.Headers.GetValues("X-LLM-User-ID").Single();
            ContentType = request.Content!.Headers.ContentType?.ToString();
            Body = await request.Content.ReadAsStringAsync(ct);
            return new HttpResponseMessage(status) { Content = new StringContent(response) };
        }
    }

}
