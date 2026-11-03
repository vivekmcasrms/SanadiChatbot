using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Sanadi.Api.AI;
using Sanadi.Api.Security;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.Controllers;

[ApiController, Route("api/voice/room"), EnableRateLimiting("voice")]
public sealed class VoiceRoomController(
    VoiceRoomTickets tickets, AdvisorSpeech speech,
    OllamaVoiceTranscription transcription, AssistantController assistant,
    VoiceMetricsStore metrics, ILogger<VoiceRoomController> logger) : ControllerBase
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record Start(string Agent, Guid? ConversationId, bool Introduce, string? Message, bool BrowserSpeech = false, string? Language = null);

    [AllowAnonymous, HttpPost("ticket")]
    public IActionResult Ticket([FromQuery] bool browserSpeech = false)
    {
        Response.Headers.CacheControl = "no-store";
        // Authentication middleware validates both SSO cookies and bearer tokens.
        // Check its principal directly: the legacy current-user adapter requires a
        // bearer header, and the shared challenge handler can return an empty 200.
        if (User.Identity?.IsAuthenticated != true || CurrentUser.FromPrincipal(User).UserId is null)
            return Unauthorized(new { error = "voice_session_expired" });
        if (!speech.Enabled || (!browserSpeech && !speech.Available))
            return StatusCode(503, new { error = "server_tts_not_configured" });
        return Ok(new { ticket = tickets.Issue(User, Request.Headers.Origin.ToString()) });
    }

    [AllowAnonymous, HttpGet]
    public async Task Room(CancellationToken requestAborted)
    {
        if (!HttpContext.WebSockets.IsWebSocketRequest) { Response.StatusCode = 400; return; }
        var key = HttpContext.WebSockets.WebSocketRequestedProtocols.FirstOrDefault(p => p.StartsWith("ticket."))?[7..] ?? "";
        var ticket = tickets.Take(key, Request.Headers.Origin.ToString());
        if (ticket is null || !speech.Enabled) { Response.StatusCode = 401; return; }
        HttpContext.User = ticket.Principal;
        var user = CurrentUser.FromPrincipal(ticket.Principal);
        if (user.UserId is not Guid userId) { Response.StatusCode = 401; return; }
        HttpContext.Items[CurrentUserMiddleware.ItemKey] = user;
        using var socket = await HttpContext.WebSockets.AcceptWebSocketAsync("sanadi-voice");
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(requestAborted);
        stop.CancelAfter(TimeSpan.FromMinutes(3));
        tickets.Enter(userId, stop);
        using var sendLock = new SemaphoreSlim(1);
        async Task Send(object value)
        {
            await sendLock.WaitAsync(stop.Token);
            try { await socket.SendAsync(JsonSerializer.SerializeToUtf8Bytes(value, Json), WebSocketMessageType.Text, true, stop.Token); }
            finally { sendLock.Release(); }
        }
        Task? monitor = null;
        Task? playback = null;
        var language = "en";
        try
        {
            var startBytes = await Receive(socket, WebSocketMessageType.Text, 16000, stop.Token);
            var start = JsonSerializer.Deserialize<Start>(startBytes, Json) ?? throw new InvalidOperationException("invalid_turn");
            if (start.Agent is not ("mira" or "suhail")) throw new InvalidOperationException("invalid_agent");
            if (!start.BrowserSpeech && !speech.Available) throw new InvalidOperationException("server_tts_not_configured");
            string question;
            if (start.Message is { Length: > 0 and <= 6000 }) question = start.Message.Trim();
            else
            {
                var audio = await Receive(socket, WebSocketMessageType.Binary, 2_900_000, stop.Token);
                if (!PrivateVoiceService.ValidWav(audio) || audio.Length < 2048) throw new InvalidOperationException("invalid_recording");
                // Receive remains active during STT/LLM/TTS so a closed room cancels immediately.
                monitor = MonitorClose(socket, stop);
                await Send(new { type = "stage", stage = "transcribing" });
                question = await transcription.Transcribe(audio, userId, stop.Token, start.Language ?? "auto");
                language = AssistantController.ReplyLanguage(question, null);
                await metrics.RecordAsync("transcription_ok", language, null, userId);
            }
            monitor ??= MonitorClose(socket, stop);
            if (string.IsNullOrWhiteSpace(question)) throw new InvalidOperationException("empty_recording");
            // Preserve existing response-language and TTS behavior after STT.
            language = AssistantController.ReplyLanguage(question, language);
            await Send(new { type = "transcript", text = question, language });
            var routed = AssistantController.ResolveWorkingAgent("query", language);
            await Send(new { type = "stage", stage = routed.Key, agent = routed });
            await metrics.RecordAsync("voice_interaction", language, null, userId);
            var sentences = Channel.CreateBounded<string>(new BoundedChannelOptions(4)
            { SingleReader = true, SingleWriter = true, FullMode = BoundedChannelFullMode.Wait });
            var sequence = 0;
            playback = Task.Run(async () =>
            {
                try
                {
                    await foreach (var sentence in sentences.Reader.ReadAllAsync(stop.Token))
                    {
                        if (start.BrowserSpeech)
                        {
                            await Send(new { type = "speech", sequence = sequence++, text = sentence, language, agent = start.Agent });
                            continue;
                        }
                        var wav = await speech.Speak(sentence, language, start.Agent, stop.Token);
                        await sendLock.WaitAsync(stop.Token);
                        try
                        {
                            await socket.SendAsync(JsonSerializer.SerializeToUtf8Bytes(new {
                                type = "audio", sequence = sequence++, bytes = wav.Length, text = sentence, language
                            }, Json), WebSocketMessageType.Text, true, stop.Token);
                            for (var offset = 0; offset < wav.Length; offset += 32768)
                                await socket.SendAsync(wav.AsMemory(offset, Math.Min(32768, wav.Length - offset)),
                                    WebSocketMessageType.Binary, true, stop.Token);
                        }
                        finally { sendLock.Release(); }
                    }
                }
                catch (Exception e) { sentences.Writer.TryComplete(e); throw; }
            }, stop.Token);
            assistant.ControllerContext = new ControllerContext { HttpContext = HttpContext };
            try
            {
                var result = await assistant.RunTurn(new AssistantController.AskRequest(
                    question, start.ConversationId, language, null, start.Agent), userId, stop.Token,
                    onStage: agent => Send(new { type = "stage", stage = agent.Key, agent }));
                var working = AssistantController.ResolveWorkingAgent((string?)result["agent"] ?? "knowledge", language);
                await Send(new { type = "stage", stage = working.Key, agent = working });
                // Keep the complete text response on screen; shorten only its speech rendering.
                await Send(new { type = "result", response = result, language });
                var overview = VoiceReplyNarration.Overview(result, question, language);
                if (!string.IsNullOrWhiteSpace(overview))
                    await sentences.Writer.WriteAsync((start.Introduce
                        ? VoiceCallDelivery.Introduction(start.Agent, language) : "") + overview, stop.Token);
                sentences.Writer.TryComplete();
                await playback;
                await Send(new { type = "done" });
                await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "turn_complete", stop.Token);
                // Let the browser receive the final sentence/done frame and
                // acknowledge the close before disposing the connection.
                // Aborting immediately here can drop those frames and cut off TTS.
                try { await monitor.WaitAsync(TimeSpan.FromSeconds(2), requestAborted); }
                catch (TimeoutException) { }
            }
            finally { sentences.Writer.TryComplete(); }
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
        catch (Exception e)
        {
            await metrics.RecordAsync("speech_service_fail", language, null, userId);
            var failure = playback?.Exception?.GetBaseException() ?? e;
            var code = failure is InvalidOperationException && failure.Message.StartsWith("voice_missing_")
                ? failure.Message
                : failure is SanadiException { Code: "stt_auth_failed" or "stt_audio_unsupported" or "stt_not_configured" or "stt_service_unavailable" } stt ? stt.Code
                : failure.Message == "Speech-to-text is not configured." ? "stt_not_configured" : "voice_stream_failed";
            logger.LogWarning("Voice room failed: {ErrorCode} ({ErrorType})", code, failure.GetType().Name);
            try { if (!stop.IsCancellationRequested) await Send(new { type = "error", error = code }); } catch { }
        }
        finally
        {
            stop.Cancel();
            if (playback is not null) try { await playback; } catch { }
            if (monitor is not null) try { await monitor; } catch { }
            tickets.Leave(userId, stop);
            if (socket.State != WebSocketState.Closed) socket.Abort();
        }
    }

    private static async Task<byte[]> Receive(WebSocket socket, WebSocketMessageType type, int maximum, CancellationToken ct)
    {
        using var data = new MemoryStream();
        var buffer = new byte[16384];
        ValueWebSocketReceiveResult result;
        do
        {
            result = await socket.ReceiveAsync(buffer.AsMemory(), ct);
            if (result.MessageType != type || data.Length + result.Count > maximum)
                throw new InvalidOperationException("invalid_voice_message");
            data.Write(buffer, 0, result.Count);
        } while (!result.EndOfMessage);
        return data.ToArray();
    }
    private static async Task MonitorClose(WebSocket socket, CancellationTokenSource stop)
    {
        try { await socket.ReceiveAsync(new byte[256].AsMemory(), stop.Token); }
        catch (WebSocketException) { }
        catch (OperationCanceledException) { }
        finally { await stop.CancelAsync(); }
    }
}
