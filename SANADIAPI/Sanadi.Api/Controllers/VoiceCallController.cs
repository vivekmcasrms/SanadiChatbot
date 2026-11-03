using System.Net.WebSockets;
using System.Diagnostics;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Sanadi.Api.AI;
using Sanadi.Api.Security;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.Controllers;

/// <summary>One authenticated browser voice call; turns can be interrupted without closing the socket.</summary>
[ApiController, Route("api/voice/call"), EnableRateLimiting("voice")]
public sealed class VoiceCallController(
    VoiceRoomTickets tickets, ConfiguredSpeech speech, AssistantController assistant,
    IConfiguration config, VoiceMetricsStore metrics, ILogger<VoiceCallController> logger,
    VoiceWelcomeAudio welcome) : ControllerBase
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record Command(string Type, Guid? TurnId, string? Message, string? Agent,
        Guid? ConversationId, bool Introduce, int? Sequence, string? Language);
    public sealed record WelcomeRequest(string Agent, string Language, bool IncludeAudio = false);
    public sealed record CueRequest(string Agent, string Language, string Kind, int Index);
    public sealed record GreetingRequest(string Agent, string Language, int Index);

    [Authorize, HttpPost("prepare")]
    public async Task<IActionResult> PrepareWelcome([FromBody] WelcomeRequest request, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        if (CurrentUser.FromPrincipal(User).UserId is not Guid userId || userId == Guid.Empty)
            return Unauthorized(new { error = "voice_session_expired" });
        if (!config.GetValue("Voice:Enabled", true)) return StatusCode(503, new { error = "voice_disabled" });
        if (request.Agent is not ("mira" or "suhail") || request.Language is not ("en" or "ar"))
            return BadRequest(new { error = "invalid_voice_selection" });
        return await CompletePreparation(ct, async () =>
        {
            var settings = await speech.Load(ct);
            var audio = await welcome.Get(settings, request.Agent, request.Language,
                (text, token) => speech.SpeakForCall(settings, text, request.Language, request.Agent, userId, token), ct);
            if (request.IncludeAudio)
                return Ok(new { text = VoiceCallGreeting.Text(request.Agent, request.Language), audioBase64 = Convert.ToBase64String(audio),
                    cuesEnabled = config.GetValue(VoiceProcessingCues.EnabledSetting, false),
                    initialCount = VoiceProcessingCues.Initial.Length, waitingCount = VoiceProcessingCues.Waiting.Length,
                    greetingCount = (await VoiceWelcomeAudio.StandardGreetingSegments(request.Agent, request.Language)).Length,
                    greetingReplyAvailable = true });
            return NoContent();
        });
    }

    [Authorize, HttpPost("cue"), EnableRateLimiting("voice-presentation")]
    public async Task<IActionResult> PrepareCue([FromBody] CueRequest request, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        if (CurrentUser.FromPrincipal(User).UserId is not Guid userId || userId == Guid.Empty)
            return Unauthorized(new { error = "voice_session_expired" });
        if (!config.GetValue("Voice:Enabled", true) || !config.GetValue(VoiceProcessingCues.EnabledSetting, false))
            return NoContent();
        if (request.Agent is not ("mira" or "suhail")) return BadRequest(new { error = "invalid_voice_selection" });
        string text;
        try { text = VoiceProcessingCues.Text(request.Kind, request.Index, request.Language); }
        catch (ArgumentException) { return BadRequest(new { error = "invalid_voice_selection" }); }
        return await CompletePreparation(ct, async () =>
        {
            var settings = await speech.Load(ct);
            var audio = await welcome.GetCue(settings, request.Agent, request.Language, request.Kind, request.Index,
                (phrase, token) => speech.SpeakForCall(settings, phrase, request.Language, request.Agent, userId, token), ct);
            return Ok(new { text, audioBase64 = Convert.ToBase64String(audio) });
        });
    }

    internal static async Task<IActionResult> CompletePreparation(CancellationToken ct, Func<Task<IActionResult>> prepare)
    {
        if (ct.IsCancellationRequested) return new EmptyResult();
        try { return await prepare(); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Closing/changing the voice selection abandons optional public audio only.
            // No error response, empty WAV or successful speech result is sent.
            return new EmptyResult();
        }
    }

    [Authorize, HttpPost("greeting"), EnableRateLimiting("voice-presentation")]
    public async Task<IActionResult> PrepareGreeting([FromBody] GreetingRequest request, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        if (CurrentUser.FromPrincipal(User).UserId is not Guid userId || userId == Guid.Empty)
            return Unauthorized(new { error = "voice_session_expired" });
        if (!config.GetValue("Voice:Enabled", true)) return NoContent();
        if (request.Agent is not ("mira" or "suhail") || request.Language is not ("en" or "ar"))
            return BadRequest(new { error = "invalid_voice_selection" });
        var segments = await VoiceWelcomeAudio.StandardGreetingSegments(request.Agent, request.Language);
        if (request.Index < 0 || request.Index >= segments.Length)
            return BadRequest(new { error = "invalid_voice_selection" });
        return await CompletePreparation(ct, async () =>
        {
            var settings = await speech.Load(ct);
            await welcome.GetGreeting(settings, request.Agent, request.Language, "Hello", segments[request.Index], false,
                (text, token) => speech.SpeakForCall(settings, text, request.Language, request.Agent, userId, token), ct);
            return NoContent();
        });
    }

    [Authorize, HttpPost("greeting-reply"), EnableRateLimiting("voice-presentation")]
    public async Task<IActionResult> PrepareGreetingReply([FromBody] WelcomeRequest request, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        if (CurrentUser.FromPrincipal(User).UserId is not Guid userId || userId == Guid.Empty)
            return Unauthorized(new { error = "voice_session_expired" });
        if (!config.GetValue("Voice:Enabled", true)) return NoContent();
        if (request.Agent is not ("mira" or "suhail") || request.Language is not ("en" or "ar"))
            return BadRequest(new { error = "invalid_voice_selection" });
        return await CompletePreparation(ct, async () =>
        {
            var settings = await speech.Load(ct);
            var audio = await welcome.GetGreetingReply(settings, request.Agent, request.Language,
                (text, token) => speech.SpeakForCall(settings, text, request.Language, request.Agent, userId, token), ct);
            return Ok(new { text = ConversationalTurn.GreetingReply("Hello", request.Language), audioBase64 = Convert.ToBase64String(audio) });
        });
    }

    [AllowAnonymous, HttpPost("ticket")]
    public IActionResult Ticket()
    {
        Response.Headers.CacheControl = "no-store";
        if (User.Identity?.IsAuthenticated != true || CurrentUser.FromPrincipal(User).UserId is null)
            return Unauthorized(new { error = "voice_session_expired" });
        if (!config.GetValue("Voice:Enabled", true))
            return StatusCode(503, new { error = "voice_disabled" });
        return Ok(new { ticket = tickets.Issue(User, Request.Headers.Origin.ToString()) });
    }

    [AllowAnonymous, HttpGet]
    public async Task Call(CancellationToken requestAborted)
    {
        if (!HttpContext.WebSockets.IsWebSocketRequest) { Response.StatusCode = 400; return; }
        var key = HttpContext.WebSockets.WebSocketRequestedProtocols.FirstOrDefault(p => p.StartsWith("ticket."))?[7..] ?? "";
        var ticket = tickets.Take(key, Request.Headers.Origin.ToString());
        if (ticket is null || !config.GetValue("Voice:Enabled", true)) { Response.StatusCode = 401; return; }
        var user = CurrentUser.FromPrincipal(ticket.Principal);
        if (user.UserId is not Guid userId) { Response.StatusCode = 401; return; }
        HttpContext.User = ticket.Principal;
        HttpContext.Items[CurrentUserMiddleware.ItemKey] = user;
        assistant.ControllerContext = new ControllerContext { HttpContext = HttpContext };
        using var socket = await HttpContext.WebSockets.AcceptWebSocketAsync("sanadi-voice");
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(requestAborted);
        lifetime.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(config.GetValue("Voice:MaxSessionSeconds", 600), 60, 3600)));
        tickets.Enter(userId, lifetime);
        using var sendLock = new SemaphoreSlim(1);
        CancellationTokenSource? active = null;
        Guid? activeId = null;
        VoiceAudioWindow? activeAudio = null;
        var delivery = new VoiceCallDelivery(config);
        Task running = Task.CompletedTask;
        void Interrupt()
        {
            try { active?.Cancel(); } catch (ObjectDisposedException) { }
        }
        async Task Send(object message, CancellationToken ct)
        {
            await sendLock.WaitAsync(ct);
            // Cancelling a turn must not abort the shared WebSocket mid-frame.
            try
            {
                ct.ThrowIfCancellationRequested();
                await socket.SendAsync(JsonSerializer.SerializeToUtf8Bytes(message, Json),
                    WebSocketMessageType.Text, true, lifetime.Token);
            }
            finally { sendLock.Release(); }
        }
        async Task SendAudio(object header, byte[] wav, CancellationToken ct)
        {
            await sendLock.WaitAsync(ct);
            try
            {
                ct.ThrowIfCancellationRequested();
                // Metadata + one complete binary WAV stay atomic relative to pongs/other turns.
                // Finish the pair even if this turn is interrupted; clients discard stale turn IDs.
                await socket.SendAsync(JsonSerializer.SerializeToUtf8Bytes(header, Json),
                    WebSocketMessageType.Text, true, lifetime.Token);
                for (var offset = 0; offset < wav.Length; offset += 32768)
                {
                    var size = Math.Min(32768, wav.Length - offset);
                    await socket.SendAsync(wav.AsMemory(offset, size), WebSocketMessageType.Binary,
                        offset + size == wav.Length, lifetime.Token);
                }
            }
            finally { sendLock.Release(); }
        }
        async Task Turn(Command command, CancellationTokenSource turn, VoiceAudioWindow audioWindow, Task previous)
        {
            var ct = turn.Token;
            using var work = CancellationTokenSource.CreateLinkedTokenSource(ct);
            Task? synthesis = null;
            var pendingMetrics = new System.Collections.Concurrent.ConcurrentBag<Task>();
            var turnTimer = Stopwatch.StartNew();
            void Metric(string type, double? duration = null) => pendingMetrics.Add(
                metrics.RecordAsync(type, command.Language, null, userId, duration, command.TurnId));
            try
            {
                // Keep the assistant's database/workflow execution serial while the
                // receiver remains available for interruption and End Call.
                await previous;
                ct.ThrowIfCancellationRequested();
                var preparation = Stopwatch.StartNew();
                var opening = command.Type == "greet";
                var text = opening ? VoiceCallGreeting.Text(command.Agent!, command.Language!) : command.Message!.Trim();
                var endCall = !opening && VoiceConversationPolicy.EndsCall(text);
                var language = command.Language ?? AssistantController.ReplyLanguage(text, null);
                if (!opening)
                {
                    Metric("voice_interaction");
                    await Send(new { type = "transcript", turnId = command.TurnId, text, language }, ct);
                    await Send(new { type = "stage", turnId = command.TurnId, stage = "thinking" }, ct);
                }
                var settings = await speech.Load(ct);
                if (opening)
                {
                    // Ready before microphone activation when the UI's optional warm-up has completed.
                    // A cold/missed warm-up uses the same configured voice and greeting as before.
                    var wav = await welcome.Get(settings, command.Agent!, language,
                        (greeting, token) => speech.SpeakForCall(settings, greeting, language, command.Agent!, userId, token), work.Token);
                    await audioWindow.Reserve(0, work.Token);
                    await SendAudio(new { type = "audio", turnId = command.TurnId, sequence = 0,
                        bytes = wav.Length, text, language, agent = command.Agent, pauseBeforeMs = 0, rate = 1 }, wav, ct);
                    await Send(new { type = "done", turnId = command.TurnId, endCall = false }, ct);
                    return;
                }
                var queued = Channel.CreateBounded<VoiceCallDelivery.Segment>(new BoundedChannelOptions(2)
                { SingleReader = true, SingleWriter = true, FullMode = BoundedChannelFullMode.Wait });
                var fixedGreeting = false;
                async Task Synthesize()
                {
                    try
                    {
                        var sequence = 0;
                        await foreach (var sentence in queued.Reader.ReadAllAsync(work.Token))
                        {
                            // Browser playback acknowledgements bound both memory and wasted generation.
                            await audioWindow.Reserve(sequence, work.Token);
                            var wav = fixedGreeting
                                ? await welcome.GetGreeting(settings, command.Agent!, language, text, sentence.Text, command.Introduce,
                                    (phrase, token) => speech.SpeakForCall(settings, phrase, language, command.Agent!, userId, token), work.Token)
                                : await speech.SpeakForCall(settings, sentence.Text, language, command.Agent!, userId, work.Token);
                            await SendAudio(new { type = "audio", turnId = command.TurnId, sequence,
                                bytes = wav.Length, text = sentence.Text, language, agent = command.Agent,
                                pauseBeforeMs = sequence == 0
                                    ? VoiceCallDelivery.RemainingStartPause(sentence.PauseBeforeMs, preparation.Elapsed)
                                    : sentence.PauseBeforeMs,
                                rate = sentence.Rate }, wav, work.Token);
                            if (sequence == 0) Metric("first_audio_ms", preparation.Elapsed.TotalMilliseconds);
                            sequence++;
                        }
                    }
                    catch (Exception error)
                    {
                        queued.Writer.TryComplete(error);
                        work.Cancel();
                        throw;
                    }
                }
                synthesis = Synthesize();
                // The welcome above is presentation only; normal turns still use the shared text pipeline.
                {
                    var result = await assistant.RunTurn(new AssistantController.AskRequest(text,
                        command.ConversationId, language, null, command.Agent), userId, work.Token, voiceSignOff: endCall);
                    // Publish the unchanged, confirmed full result before the bounded speech queue can wait.
                    // Confirm the sign-off before synthesis so microphone echo cannot reopen the call.
                    await Send(new { type = "result", turnId = command.TurnId, response = result, language, endCall }, ct);
                    if (result["receipt"] is not null)
                        Metric("voice_action_completed");
                    if (!string.IsNullOrWhiteSpace((string?)result["clarifyingQuestion"]))
                        Metric("clarification_needed");
                    var overview = endCall ? result["answer"]!.GetValue<string>() : VoiceReplyNarration.Overview(result, text, language);
                    var confirmationPrompt = VoiceConversationPolicy.ConfirmationPrompt(result, language);
                    if (confirmationPrompt.Length > 0) overview += " " + confirmationPrompt;
                    fixedGreeting = VoiceWelcomeAudio.IsFixedGreeting(result, text, command.Agent!, language);
                    var plan = delivery.Prepare(result, overview, language);
                    var preparedGreeting = fixedGreeting && !command.Introduce &&
                        overview == ConversationalTurn.GreetingReply("Hello", language)
                        ? welcome.ReadyGreetingReply(settings, command.Agent!, language) : null;
                    if (preparedGreeting is not null)
                    {
                        await audioWindow.Reserve(0, work.Token);
                        await SendAudio(new { type = "audio", turnId = command.TurnId, sequence = 0,
                            bytes = preparedGreeting.Length, text = overview, language, agent = command.Agent,
                            pauseBeforeMs = 0, rate = plan.Rate }, preparedGreeting, ct);
                        Metric("first_audio_ms", preparation.Elapsed.TotalMilliseconds);
                    }
                    else
                    {
                        var reply = plan.Reply(overview, command.Agent, language, command.Introduce && !endCall);
                        var segmentIndex = 0;
                        foreach (var segment in VoiceConversationPolicy.SpeechSegments(reply.Text))
                            await queued.Writer.WriteAsync(plan.Sentence(segment, segmentIndex++), work.Token);
                    }
                }
                queued.Writer.TryComplete();
                // Deterministic service/transaction outcomes are synthesized only after RunTurn confirms them.
                await synthesis;
                await Send(new { type = "done", turnId = command.TurnId, endCall }, ct);
                Metric("voice_turn_completed", turnTimer.Elapsed.TotalMilliseconds);
                // The browser drains the farewell audio before sending End Call.
                // Ordinary turns keep the same connection open.
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { Metric("turn_cancelled"); }
            catch (Exception error)
            {
                var failure = synthesis?.Exception?.GetBaseException() ?? error;
                var code = failure is SanadiException speechError && speechError.Code.StartsWith("tts_")
                    ? speechError.Code : "voice_turn_failed";
                logger.LogWarning("Voice call turn failed: {ErrorCode} ({ErrorType})", code, failure.GetType().Name);
                Metric(code.StartsWith("tts_") ? "speech_service_fail" : "voice_turn_failed");
                if (!lifetime.IsCancellationRequested)
                    try { await Send(new { type = "error", turnId = command.TurnId, error = code }, lifetime.Token); } catch { }
            }
            finally
            {
                work.Cancel();
                if (synthesis is not null) try { await synthesis; } catch { }
                await Task.WhenAll(pendingMetrics);
                turn.Dispose();
            }
        }
        try
        {
            await Send(new { type = "ready", audio = "wav", audioWindow = 2 }, lifetime.Token);
            while (!lifetime.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                using var data = new MemoryStream();
                var buffer = new byte[4096];
                ValueWebSocketReceiveResult received;
                do
                {
                    received = await socket.ReceiveAsync(buffer.AsMemory(), lifetime.Token);
                    if (received.MessageType == WebSocketMessageType.Close) return;
                    if (received.MessageType != WebSocketMessageType.Text || data.Length + received.Count > 16000)
                        throw new InvalidOperationException("invalid_voice_command");
                    data.Write(buffer, 0, received.Count);
                } while (!received.EndOfMessage);
                var command = JsonSerializer.Deserialize<Command>(data.ToArray(), Json)
                    ?? throw new InvalidOperationException("invalid_voice_command");
                if (command.Type == "end") break;
                if (command.Type == "ping")
                {
                    await Send(new { type = "pong" }, lifetime.Token);
                    continue;
                }
                if (command.Type == "interrupt")
                {
                    if (command.TurnId == activeId)
                    {
                        Interrupt();
                    }
                    continue;
                }
                if (command.Type == "played")
                {
                    if (command.TurnId == activeId && command.Sequence is >= 0)
                        activeAudio?.Played(command.Sequence.Value);
                    continue;
                }
                if (command.Type is not ("turn" or "greet") || command.TurnId is null || command.Agent is not ("mira" or "suhail")
                    || command.Language is not (null or "en" or "ar")
                    || command.Type == "greet" && command.Language is null
                    || command.Type == "turn" && (string.IsNullOrWhiteSpace(command.Message) || command.Message.Length > 6000))
                    throw new InvalidOperationException("invalid_voice_turn");
                Interrupt();
                active = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
                activeId = command.TurnId;
                activeAudio = new VoiceAudioWindow();
                running = Turn(command, active, activeAudio, running);
            }
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
        catch (WebSocketException) { }
        catch (Exception error) when (error is JsonException or InvalidOperationException)
        {
            logger.LogWarning("Invalid voice call command ({ErrorType})", error.GetType().Name);
        }
        finally
        {
            lifetime.Cancel();
            Interrupt();
            await running;
            tickets.Leave(userId, lifetime);
            if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
            {
                using var close = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                try { await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "call_ended", close.Token); }
                catch { socket.Abort(); }
            }
        }
    }
}
