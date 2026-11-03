using System.Diagnostics;
using System.Net.WebSockets;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Sanadi.Api.AI;
using Sanadi.Api.Security;

namespace Sanadi.Api.Controllers;

/// <summary>Authenticated PCM activity checks only; no transcription, language detection or audio storage.</summary>
[ApiController, Route("api/voice/activity"), EnableRateLimiting("voice-activity")]
public sealed class VoiceActivityController(
    VoiceActivitySessions sessions, VoiceActivityDetector detector,
    IConfiguration config, ILogger<VoiceActivityController> logger) : ControllerBase
{
    internal const int FrameBytes = 1024;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [AllowAnonymous, HttpPost("ticket"), EnableRateLimiting("voice-activity-ticket")]
    public IActionResult Ticket()
    {
        Response.Headers.CacheControl = "no-store";
        var user = CurrentUser.FromPrincipal(User);
        if (User.Identity?.IsAuthenticated != true || user.UserId is null || user.UserId == Guid.Empty)
            return Unauthorized(new { error = "voice_session_expired" });
        if (!config.GetValue("Voice:Enabled", true))
            return StatusCode(503, new { error = "voice_disabled" });
        return Ok(new { ticket = sessions.Issue(User, Request.Headers.Origin.ToString()) });
    }

    [AllowAnonymous, HttpGet]
    public async Task Activity(CancellationToken requestAborted)
    {
        Response.Headers.CacheControl = "no-store";
        if (!HttpContext.WebSockets.IsWebSocketRequest) { Response.StatusCode = 400; return; }
        var protocols = HttpContext.WebSockets.WebSocketRequestedProtocols;
        if (!protocols.Contains("sanadi-voice")) { Response.StatusCode = 400; return; }
        var key = protocols.FirstOrDefault(p => p.StartsWith("ticket.", StringComparison.Ordinal))?[7..] ?? "";
        if (key.Length != 64 || key.Any(c => !Uri.IsHexDigit(c))) { Response.StatusCode = 401; return; }
        var ticket = sessions.Take(key, Request.Headers.Origin.ToString());
        if (ticket is null || !config.GetValue("Voice:Enabled", true)) { Response.StatusCode = 401; return; }
        var user = CurrentUser.FromPrincipal(ticket.Principal);
        if (ticket.Principal.Identity?.IsAuthenticated != true || user.UserId is not Guid userId || userId == Guid.Empty)
        { Response.StatusCode = 401; return; }
        HttpContext.User = ticket.Principal;
        HttpContext.Items[CurrentUserMiddleware.ItemKey] = user;

        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(requestAborted);
        lifetime.CancelAfter(TimeSpan.FromSeconds(65));
        sessions.Enter(userId, lifetime);
        WebSocket? socket = null;
        async Task Send(object message, CancellationToken ct) =>
            await socket!.SendAsync(JsonSerializer.SerializeToUtf8Bytes(message, Json),
                WebSocketMessageType.Text, true, ct);
        try
        {
            // Model initialization succeeds before accepting any microphone frames.
            using var stream = detector.OpenStream();
            lifetime.Token.ThrowIfCancellationRequested();
            socket = await HttpContext.WebSockets.AcceptWebSocketAsync("sanadi-voice");
            await Send(new { type = "ready", sampleRate = 16000, frameSamples = 512 }, lifetime.Token);
            var elapsed = Stopwatch.StartNew();
            var sequence = 0;
            while (!lifetime.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                // One receive/inference/reply at a time: no unbounded inference queue.
                using var idle = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
                idle.CancelAfter(TimeSpan.FromSeconds(5));
                var frame = await ReceiveFrame(socket, idle.Token);
                if (frame is null) return;
                if (!WithinFrameBudget(sequence + 1, elapsed.Elapsed))
                    throw new InvalidOperationException("invalid_voice_activity_rate");
                var activity = stream.ProcessPcm16(frame);
                await Send(new { type = "activity", sequence, @event = activity.Event }, lifetime.Token);
                sequence++;
                if (activity.Event == "pause") break;
            }
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
        catch (WebSocketException) { }
        catch (Exception error)
        {
            // Never log PCM, tickets, model paths, credentials or client-provided data.
            logger.LogWarning("Voice activity capture unavailable ({ErrorType})", error.GetType().Name);
            if (socket?.State == WebSocketState.Open && !lifetime.IsCancellationRequested)
            {
                using var notice = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                try { await Send(new { type = "error", error = "voice_activity_unavailable" }, notice.Token); }
                catch { socket.Abort(); }
            }
            else if (!Response.HasStarted)
            {
                Response.StatusCode = 503;
                await Response.WriteAsJsonAsync(new { error = "voice_activity_unavailable" }, requestAborted);
            }
        }
        finally
        {
            lifetime.Cancel();
            sessions.Leave(userId, lifetime);
            if (socket is not null)
            {
                if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
                {
                    using var close = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                    try { await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "activity_ended", close.Token); }
                    catch { socket.Abort(); }
                }
                socket.Dispose();
            }
        }
    }

    internal static bool WithinFrameBudget(int frames, TimeSpan elapsed) =>
        frames > 0 && elapsed >= TimeSpan.Zero && frames <= (elapsed.TotalSeconds + 1) * 50;

    internal static async Task<byte[]?> ReceiveFrame(WebSocket socket, CancellationToken ct)
    {
        var frame = new byte[FrameBytes];
        var receivedBytes = 0;
        for (var fragments = 0; fragments < 8; fragments++)
        {
            if (receivedBytes == FrameBytes) throw new InvalidOperationException("invalid_voice_activity_frame");
            var received = await socket.ReceiveAsync(frame.AsMemory(receivedBytes), ct);
            if (received.MessageType == WebSocketMessageType.Close) return null;
            if (received.MessageType != WebSocketMessageType.Binary || received.Count <= 0)
                throw new InvalidOperationException("invalid_voice_activity_frame");
            receivedBytes += received.Count;
            if (!received.EndOfMessage) continue;
            if (receivedBytes != FrameBytes) throw new InvalidOperationException("invalid_voice_activity_frame");
            return frame;
        }
        throw new InvalidOperationException("invalid_voice_activity_frame");
    }
}
