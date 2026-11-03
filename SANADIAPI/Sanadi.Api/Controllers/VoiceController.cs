using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.AI;
using Sanadi.Api.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.AppFunctions;
using Sanadi.Infrastructure.Persistence;
using Dapper;

using Sanadi.Api.Middleware;

namespace Sanadi.Api.Controllers;

/// <summary>Private speech adapter. Audio and transcripts are kept in memory only.</summary>
[ApiController]
[Route("api/voice")]
[Authorize]
[EnableRateLimiting("voice")]
public sealed class VoiceController(
    IHttpClientFactory clients,
    IConfiguration configuration,
    ILogger<VoiceController> logger,
    VoiceTranscriptionService transcription,
    VoiceSpeechSynthesis speech,
    VoiceMetricsStore metrics,
    ISqlConnectionFactory sql) : ControllerBase
{
    public sealed record TranscribeRequest(string? AudioBase64, string? Language, string? TargetLanguage = null,
        bool IncludeFeedbackContext = false, string? RecognitionHint = null);
    public sealed record SpeakRequest(string? Text, string? Lang, string? Agent);
    public sealed record MetricRequest(string? Type, string? Language, string? Detail, string? At,
        double? DurationMs = null, Guid? TurnId = null);

    /// <summary>Transcribe browser microphone audio on the configured private speech server.</summary>
    [HttpPost("transcribe")]
    [RequestSizeLimit(14_000_000)]
    public async Task<IActionResult> Transcribe([FromBody] TranscribeRequest? request, CancellationToken cancellationToken)
    {
        var clock = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            var userId = CurrentUser.FromPrincipal(User).UserId;
            if (userId is null || userId == Guid.Empty) return Unauthorized(new { error = "voice_session_expired" });
            var input = JsonSerializer.SerializeToElement(new
            {
                audioBase64 = request?.AudioBase64 ?? "",
                language = string.IsNullOrWhiteSpace(request?.Language) ? "auto" : request!.Language,
                targetLanguage = request?.TargetLanguage,
                recognitionHint = request?.RecognitionHint,
                includeFeedbackContext = request?.IncludeFeedbackContext == true,
            });
            var result = await transcription.Transcribe(new FunctionInput(input), userId.Value, cancellationToken);
            await metrics.RecordAsync("transcription_ok", request?.Language, null, userId, clock.Elapsed.TotalMilliseconds);
            if (request?.IncludeFeedbackContext == true)
            {
                var data = JsonSerializer.SerializeToElement(result);
                var original = data.GetProperty("sourceText").GetString() ?? "";
                var transcript = data.GetProperty("text").GetString() ?? "";
                var replyLanguage = AssistantController.ReplyLanguage(transcript, request.TargetLanguage);
                var standardGreeting = ConversationalTurn.GreetingReply("Hello", replyLanguage)!;
                var immediateGreeting = ConversationalTurn.ImmediateGreetingReply(transcript, replyLanguage, null);
                return Ok(new { text = data.GetProperty("text").GetString(), confidence = (double?)null,
                    sourceText = original, // Opt-in, in-memory echo checking before display-language translation.
                    feedbackLanguage = AssistantController.ReplyLanguage(original, request.TargetLanguage),
                    skipAcknowledgment = !configuration.GetValue(VoiceProcessingCues.EnabledSetting, false) ||
                        string.IsNullOrWhiteSpace(original) || VoiceFarewell.IsThankYou(original) ||
                        ConversationalTurn.IsGreetingOnly(original) || AssistantController.IsPersonalGreeting(original),
                    // Only a complete, server-recognized public greeting may start prepared speech early.
                    // The ordinary chat turn still owns authorization, persistence and the final result.
                    greetingReply = immediateGreeting == standardGreeting
                        ? new { text = standardGreeting, language = replyLanguage } : null });
            }
            return Ok(result);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (SanadiException exception)
        {
            await metrics.RecordAsync("transcription_fail", request?.Language, null, CurrentUser.FromPrincipal(User).UserId);
            ApiErrorPolicy.LogOnce(logger, exception, HttpContext, nameof(Transcribe));
            if (exception.StatusCode == StatusCodes.Status400BadRequest)
                return BadRequest(new { error = exception.Message });
            return StatusCode(exception.StatusCode, new { error = exception.Code });
        }
        catch (Exception exception)
        {
            await metrics.RecordAsync("transcription_fail", request?.Language, null, CurrentUser.FromPrincipal(User).UserId);
            ApiErrorPolicy.LogOnce(logger, exception, HttpContext, nameof(Transcribe));
            return StatusCode(StatusCodes.Status502BadGateway, new { error = "speech_recognition_failed" });
        }
    }

    /// <summary>Client voice operational event. No audio is accepted or stored.</summary>
    [HttpPost("metrics")]
    public async Task<IActionResult> RecordMetric([FromBody] MetricRequest? request)
    {
        var type = request?.Type?.Trim() ?? "";
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "voice_interaction", "transcription_ok", "transcription_fail",
            "clarification_needed", "voice_action_completed", "speech_service_fail",
            "first_playback_ms", "transcript_review", "interrupted",
        };
        if (!allowed.Contains(type)) return BadRequest(new { error = "invalid_metric" });
        var lang = request?.Language is "ar" or "en" or "auto" ? request.Language : null;
        Guid? userId = HttpContext.GetSanadiUser().UserId;
        await metrics.RecordAsync(type, lang, null, userId, request?.DurationMs, request?.TurnId);
        return Ok(new { ok = true });
    }

    /// <summary>Admin voice operational snapshot (no raw audio).</summary>
    [HttpGet("metrics")]
    public async Task<IActionResult> Metrics([FromQuery] int days = 14, CancellationToken ct = default)
    {
        var user = HttpContext.GetSanadiUser();
        if (user.UserId is not Guid id) throw new UnauthorizedException();
        await using var conn = sql.Create();
        var roles = (await conn.QueryAsync<string>(DbProc.Call("usp_Assistant_GetUserRoles", new { userId = id }, ct)))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (!roles.Contains("system_admin") && !roles.Contains("service_manager") && !roles.Contains("auditor"))
            throw new ForbiddenException();
        return Ok(await metrics.SnapshotAsync(days, ct));
    }

    /// <summary>
    /// Voice chat only: spoken playback for a reply. Used when the browser has no
    /// Arabic system voice, so Arabic does not depend on the student's PC settings.
    /// </summary>
    [HttpPost("speak")]
    public async Task<IActionResult> Speak([FromBody] SpeakRequest? request, CancellationToken cancellationToken)
    {
        var text = request?.Text?.Trim() ?? "";
        if (text.Length == 0) return BadRequest(new { error = "text_required" });
        var lang = AssistantController.ReplyLanguage(text, null);
        var agent = request?.Agent is "suhail" ? "suhail" : "mira";
        try
        {
            var userId = CurrentUser.FromPrincipal(User).UserId;
            if (userId is null || userId == Guid.Empty) return Unauthorized(new { error = "voice_session_expired" });
            var (audio, contentType) = await speech.Speak(text, lang, agent, userId.Value, cancellationToken);
            Response.Headers.CacheControl = "no-store";
            Response.Headers.Pragma = "no-cache";
            return File(audio, contentType);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception exception)
        {
            ApiErrorPolicy.LogOnce(logger, exception, HttpContext, nameof(Speak));
            return StatusCode(StatusCodes.Status502BadGateway, new { error = "speech_synthesis_failed" });
        }
    }

    [HttpPost("turn")]
    [RequestSizeLimit(8_000_000)]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> Turn([FromForm] IFormFile? audio, [FromForm] string? voice, CancellationToken cancellationToken)
    {
        var whisperUrl = configuration["Voice:WhisperBaseUrl"];
        var ttsUrl = configuration["Voice:TtsBaseUrl"];
        if (string.IsNullOrWhiteSpace(whisperUrl) || string.IsNullOrWhiteSpace(ttsUrl))
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "voice_services_not_configured" });
        if (audio is null || audio.Length is < 1 or > 8_000_000) return BadRequest(new { error = "invalid_audio" });
        if (voice is not ("male" or "female")) return BadRequest(new { error = "invalid_voice" });

        try
        {
            using var payload = new MultipartFormDataContent();
            await using var audioStream = audio.OpenReadStream();
            using var audioPart = new StreamContent(audioStream);
            audioPart.Headers.ContentType = MediaTypeHeaderValue.Parse(audio.ContentType ?? "audio/webm");
            payload.Add(audioPart, "file", "utterance.webm");
            payload.Add(new StringContent("whisper-1"), "model");
            payload.Add(new StringContent("json"), "response_format");
            using var sttRequest = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(whisperUrl.TrimEnd('/') + "/"), "v1/audio/transcriptions")) { Content = payload };
            CopyServiceCredential(sttRequest, "Voice:WhisperApiKey");
            using var sttResponse = await clients.CreateClient("VoiceInference").SendAsync(sttRequest, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!sttResponse.IsSuccessStatusCode) return StatusCode(StatusCodes.Status502BadGateway, new { error = "speech_recognition_failed" });
            using var sttJson = JsonDocument.Parse(await sttResponse.Content.ReadAsStringAsync(cancellationToken));
            var transcript = sttJson.RootElement.TryGetProperty("text", out var text) ? text.GetString()?.Trim() : null;
            if (string.IsNullOrWhiteSpace(transcript)) return NoContent();
            if (transcript.Length > 4000) return BadRequest(new { error = "utterance_too_long" });

            // Reuse the authenticated Sanadi assistant so its approved evidence, access checks,
            // actions, and conversation memory remain the source of answers.
            var assistantBase = configuration["Voice:AssistantBaseUrl"] ?? $"{Request.Scheme}://{Request.Host}";
            using var ask = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(assistantBase.TrimEnd('/') + "/"), "api/chat/ask"));
            CopyRequestCredentials(ask);
            ask.Content = new StringContent(JsonSerializer.Serialize(new { message = transcript, conversationId = Request.Form["conversationId"].FirstOrDefault(), lang = ContainsArabic(transcript) ? "ar" : "en", attachments = (object?)null }), Encoding.UTF8, "application/json");
            using var answerResponse = await clients.CreateClient("VoiceInference").SendAsync(ask, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!answerResponse.IsSuccessStatusCode) return StatusCode((int)answerResponse.StatusCode, new { error = "assistant_unavailable" });
            using var answerJson = JsonDocument.Parse(await answerResponse.Content.ReadAsStringAsync(cancellationToken));
            if (!answerJson.RootElement.TryGetProperty("answer", out var answerNode)) return StatusCode(502, new { error = "assistant_response_invalid" });
            var answer = answerNode.GetString();
            if (string.IsNullOrWhiteSpace(answer)) return NoContent();

            var voiceId = configuration[$"Voice:{(voice == "male" ? "Male" : "Female")}Voice"];
            if (string.IsNullOrWhiteSpace(voiceId)) return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "selected_voice_not_configured" });
            var language = ContainsArabic(transcript) ? "ar" : "en";
            using var ttsRequest = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(ttsUrl.TrimEnd('/') + "/"), "v1/audio/speech"));
            CopyServiceCredential(ttsRequest, "Voice:TtsApiKey");
            var overview = VoiceReplyNarration.Overview(
                System.Text.Json.Nodes.JsonNode.Parse(answerJson.RootElement.GetRawText())!.AsObject(), transcript, language);
            ttsRequest.Content = new StringContent(JsonSerializer.Serialize(new { model = configuration["Voice:TtsModel"] ?? "chatterbox-multilingual", input = overview, voice = voiceId, language_id = language, response_format = "wav" }), Encoding.UTF8, "application/json");
            using var ttsResponse = await clients.CreateClient("VoiceInference").SendAsync(ttsRequest, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!ttsResponse.IsSuccessStatusCode) return StatusCode(StatusCodes.Status502BadGateway, new { error = "speech_synthesis_failed" });
            Response.Headers.CacheControl = "no-store";
            Response.Headers.Pragma = "no-cache";
            var generatedAudio = await ttsResponse.Content.ReadAsByteArrayAsync(cancellationToken);
            return File(VoiceAudioCleanup.Apply(generatedAudio), ttsResponse.Content.Headers.ContentType?.MediaType ?? "audio/wav");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception exception)
        {
            ApiErrorPolicy.LogOnce(logger, exception, HttpContext, nameof(Turn));
            return StatusCode(StatusCodes.Status502BadGateway, new { error = "voice_pipeline_failed" });
        }
    }

    private static bool ContainsArabic(string value) => value.Any(c => c is >= '\u0600' and <= '\u06ff');
    private void CopyServiceCredential(HttpRequestMessage request, string key)
    {
        var token = configuration[key];
        if (!string.IsNullOrWhiteSpace(token)) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }
    private void CopyRequestCredentials(HttpRequestMessage request)
    {
        if (Request.Headers.TryGetValue("Authorization", out var authorization)) request.Headers.TryAddWithoutValidation("Authorization", authorization.ToArray());
        if (Request.Headers.TryGetValue("Cookie", out var cookie)) request.Headers.TryAddWithoutValidation("Cookie", cookie.ToArray());
    }
}
