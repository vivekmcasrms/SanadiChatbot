using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Sanadi.Api.AI;
using Sanadi.Api.Security;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.Controllers;

[ApiController, Authorize, Route("api/voice/advisor"), EnableRateLimiting("voice")]
public sealed class VoiceAdvisorController(OllamaVoiceTranscription transcription, AdvisorSpeech output, IConfiguration config) : ControllerBase
{
    public sealed record SpeechRequest(string Text, string Language, string Agent);

    [HttpGet("availability")]
    public IActionResult Availability()
    {
        Response.Headers.CacheControl = "no-store";
        return Ok(new {
            available = output.Available,
            audioMode = "websocket",
            sessionSeconds = Math.Clamp(config.GetValue("Voice:MaxSessionSeconds", 600), 60, 1800),
            idleSeconds = Math.Clamp(config.GetValue("Voice:IdleSeconds", 120), 30, 300)
        });
    }

    [HttpPost("transcribe"), RequestSizeLimit(3_000_000)]
    public async Task<IActionResult> Transcribe([FromForm] IFormFile audio, [FromForm] string? language, CancellationToken ct)
    {
        var user = CurrentUser.FromPrincipal(User).UserId;
        if (user is null || user == Guid.Empty) return Unauthorized(new { error = "voice_session_expired" });
        if (audio.Length is < 2048 or > 2_900_000) return BadRequest(new { error = "invalid_recording" });
        using var buffer = new MemoryStream();
        await audio.CopyToAsync(buffer, ct);
        var bytes = buffer.ToArray();
        if (!PrivateVoiceService.ValidWav(bytes)) return BadRequest(new { error = "invalid_recording" });
        try
        {
            var text = await transcription.Transcribe(bytes, user.Value, ct, language ?? "auto");
            Response.Headers.CacheControl = "no-store";
            return Ok(new { text, language = language is "en" or "ar" ? language : AssistantController.ReplyLanguage(text, null) });
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (InvalidOperationException e) when (e.Message == "unsupported_spoken_language")
        { return UnprocessableEntity(new { error = "speak_arabic_or_english" }); }
        catch (SanadiException e) { return StatusCode(e.StatusCode, new { error = e.Code }); }
        catch { return StatusCode(502, new { error = "private_transcription_unavailable" }); }
    }

    [HttpPost("speech"), RequestSizeLimit(32_000)]
    public async Task<IActionResult> Speak(SpeechRequest request, CancellationToken ct)
    {
        if (request.Agent is not ("mira" or "suhail") || request.Language is not ("ar" or "en")
            || string.IsNullOrWhiteSpace(request.Text) || request.Text.Length > 6000)
            return BadRequest(new { error = "invalid_speech" });
        try
        {
            var audio = await output.Speak(request.Text, request.Language, request.Agent, ct);
            Response.Headers.CacheControl = "no-store";
            return File(audio, "audio/wav");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (InvalidOperationException e) when (e.Message.StartsWith("voice_missing_"))
        { return StatusCode(503, new { error = e.Message }); }
        catch { return StatusCode(502, new { error = "private_speech_unavailable" }); }
    }
}
