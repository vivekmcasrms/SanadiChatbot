using System.Net.WebSockets;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Sanadi.Api.AI;
using Sanadi.Api.Controllers;

namespace Sanadi.Api.Tests;

public sealed class VoiceActivityEndpointTests
{
    [Fact]
    public void Anonymous_request_cannot_obtain_a_microphone_ticket()
    {
        var controller = Controller(new VoiceActivitySessions(), null);
        Assert.IsType<UnauthorizedObjectResult>(controller.Ticket());
        Assert.Equal("no-store", controller.Response.Headers.CacheControl);
    }

    [Fact]
    public void An_unauthenticated_identity_with_a_subject_is_still_rejected()
    {
        var controller = Controller(new VoiceActivitySessions(), null);
        controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", Guid.NewGuid().ToString())]));
        Assert.IsType<UnauthorizedObjectResult>(controller.Ticket());
    }

    [Fact]
    public void Disabled_voice_never_issues_a_ticket()
    {
        var controller = Controller(new VoiceActivitySessions(), Guid.NewGuid(), enabled: false);
        var response = Assert.IsType<ObjectResult>(controller.Ticket());
        Assert.Equal(503, response.StatusCode);
    }

    [Fact]
    public void Tickets_are_bound_to_authenticated_identity_origin_and_one_use()
    {
        var sessions = new VoiceActivitySessions();
        var user = Guid.NewGuid();
        var controller = Controller(sessions, user);
        var response = Assert.IsType<OkObjectResult>(controller.Ticket());
        var key = JsonSerializer.SerializeToElement(response.Value).GetProperty("ticket").GetString()!;
        var ticket = Assert.IsType<VoiceRoomTickets.Ticket>(sessions.Take(key, "https://ui.example.test"));
        Assert.Equal(user.ToString(), ticket.Principal.FindFirst("sub")!.Value);
        Assert.Null(sessions.Take(key, "https://ui.example.test"));
        Assert.Equal("no-store", controller.Response.Headers.CacheControl);
    }

    [Fact]
    public async Task Wrong_origin_is_rejected_before_socket_acceptance_or_inference()
    {
        var sessions = new VoiceActivitySessions();
        var controller = Controller(sessions, Guid.NewGuid());
        var key = sessions.Issue(controller.User, "https://ui.example.test");
        var feature = new SocketFeature();
        controller.HttpContext.Features.Set<IHttpWebSocketFeature>(feature);
        controller.Request.Headers.SecWebSocketProtocol = $"sanadi-voice, ticket.{key}";
        controller.Request.Headers.Origin = "https://other.example.test";
        await controller.Activity(default);
        Assert.Equal(401, controller.Response.StatusCode);
        Assert.Equal(0, feature.Accepts);
    }

    [Theory]
    [InlineData("sanadi-voice")]
    [InlineData("sanadi-voice, ticket.not-a-ticket")]
    [InlineData("sanadi-voice, ticket.0000000000000000000000000000000000000000000000000000000000000000")]
    public async Task Missing_malformed_or_unknown_ticket_cannot_start_inference(string protocols)
    {
        var controller = Controller(new VoiceActivitySessions(), null);
        var feature = new SocketFeature();
        controller.HttpContext.Features.Set<IHttpWebSocketFeature>(feature);
        controller.Request.Headers.SecWebSocketProtocol = protocols;
        await controller.Activity(default);
        Assert.Equal(401, controller.Response.StatusCode);
        Assert.Equal(0, feature.Accepts);
    }

    [Fact]
    public async Task Plain_HTTP_cannot_start_a_stream()
    {
        var controller = Controller(new VoiceActivitySessions(), Guid.NewGuid());
        await controller.Activity(default);
        Assert.Equal(400, controller.Response.StatusCode);
    }

    [Fact]
    public async Task Authenticated_capture_returns_ready_and_ordered_activity_then_closes_without_STT()
    {
        using var detector = new VoiceActivityDetector();
        var sessions = new VoiceActivitySessions();
        var controller = Controller(sessions, Guid.NewGuid(), detector: detector);
        var key = sessions.Issue(controller.User, "https://ui.example.test");
        using var socket = new FrameSocket(
            new Part(new byte[1024], WebSocketMessageType.Binary, true),
            new Part(new byte[1024], WebSocketMessageType.Binary, true),
            new Part([], WebSocketMessageType.Close, true));
        var feature = new SocketFeature { Socket = socket };
        controller.HttpContext.Features.Set<IHttpWebSocketFeature>(feature);
        controller.Request.Headers.SecWebSocketProtocol = $"sanadi-voice, ticket.{key}";
        await controller.Activity(default);
        Assert.Equal(1, feature.Accepts);
        Assert.Null(sessions.Take(key, "https://ui.example.test"));
        Assert.Equal(3, socket.Messages.Count);
        var ready = JsonSerializer.Deserialize<JsonElement>(socket.Messages[0]);
        Assert.Equal("ready", ready.GetProperty("type").GetString());
        Assert.Equal(16000, ready.GetProperty("sampleRate").GetInt32());
        Assert.Equal(512, ready.GetProperty("frameSamples").GetInt32());
        for (var i = 0; i < 2; i++)
        {
            var reply = JsonSerializer.Deserialize<JsonElement>(socket.Messages[i + 1]);
            Assert.Equal("activity", reply.GetProperty("type").GetString());
            Assert.Equal(i, reply.GetProperty("sequence").GetInt32());
            Assert.Equal("continue", reply.GetProperty("event").GetString());
            Assert.Equal(3, reply.EnumerateObject().Count());
        }
    }

    [Fact]
    public void New_capture_cancels_only_older_VAD_capture_not_the_assistant_call()
    {
        var user = Guid.NewGuid();
        var assistant = new VoiceRoomTickets();
        var captures = new VoiceActivitySessions();
        using var assistantCall = new CancellationTokenSource();
        using var oldCapture = new CancellationTokenSource();
        using var newCapture = new CancellationTokenSource();
        assistant.Enter(user, assistantCall);
        captures.Enter(user, oldCapture);
        captures.Enter(user, newCapture);
        Assert.True(oldCapture.IsCancellationRequested);
        Assert.False(assistantCall.IsCancellationRequested);
        Assert.False(newCapture.IsCancellationRequested);
        captures.Leave(user, oldCapture);
        using var thirdCapture = new CancellationTokenSource();
        captures.Enter(user, thirdCapture);
        Assert.True(newCapture.IsCancellationRequested);
        captures.Leave(user, thirdCapture);
        assistant.Leave(user, assistantCall);
    }

    [Fact]
    public async Task Complete_or_fragmented_fixed_PCM_frames_preserve_every_byte()
    {
        var expected = Enumerable.Range(0, 1024).Select(i => (byte)(i % 256)).ToArray();
        using var socket = new FrameSocket(
            new Part(expected[..300], WebSocketMessageType.Binary, false),
            new Part(expected[300..], WebSocketMessageType.Binary, true));
        Assert.Equal(expected, await VoiceActivityController.ReceiveFrame(socket, default));
        using var complete = new FrameSocket(new Part(expected, WebSocketMessageType.Binary, true));
        Assert.Equal(expected, await VoiceActivityController.ReceiveFrame(complete, default));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    [InlineData(1023)]
    public async Task Partial_or_empty_PCM_messages_are_rejected(int bytes)
    {
        using var socket = new FrameSocket(new Part(new byte[bytes], WebSocketMessageType.Binary, true));
        await Assert.ThrowsAsync<InvalidOperationException>(() => VoiceActivityController.ReceiveFrame(socket, default));
    }

    [Fact]
    public async Task Oversized_message_is_rejected_without_reading_or_allocating_its_remainder()
    {
        using var socket = new FrameSocket(
            new Part(new byte[1024], WebSocketMessageType.Binary, false),
            new Part(new byte[1024], WebSocketMessageType.Binary, true));
        await Assert.ThrowsAsync<InvalidOperationException>(() => VoiceActivityController.ReceiveFrame(socket, default));
        Assert.Equal(1, socket.Reads);
    }

    [Fact]
    public async Task Excessive_fragmentation_is_rejected()
    {
        using var socket = new FrameSocket(Enumerable.Range(0, 9)
            .Select(_ => new Part(new byte[1], WebSocketMessageType.Binary, false)).ToArray());
        await Assert.ThrowsAsync<InvalidOperationException>(() => VoiceActivityController.ReceiveFrame(socket, default));
        Assert.Equal(8, socket.Reads);
    }

    [Fact]
    public async Task Text_is_rejected_and_a_normal_close_discards_partial_audio()
    {
        using var text = new FrameSocket(new Part(new byte[1024], WebSocketMessageType.Text, true));
        await Assert.ThrowsAsync<InvalidOperationException>(() => VoiceActivityController.ReceiveFrame(text, default));
        using var close = new FrameSocket(
            new Part(new byte[400], WebSocketMessageType.Binary, false),
            new Part([], WebSocketMessageType.Close, true));
        Assert.Null(await VoiceActivityController.ReceiveFrame(close, default));
    }

    [Fact]
    public async Task Receive_honors_cancellation_before_reading_audio()
    {
        using var socket = new FrameSocket(new Part(new byte[1024], WebSocketMessageType.Binary, true));
        using var cancel = new CancellationTokenSource();
        cancel.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => VoiceActivityController.ReceiveFrame(socket, cancel.Token));
        Assert.Equal(0, socket.Reads);
    }

    [Theory]
    [InlineData(50, 0, true)]
    [InlineData(51, 0, false)]
    [InlineData(313, 10, true)]
    [InlineData(551, 10, false)]
    [InlineData(0, 0, false)]
    public void A_bounded_startup_burst_is_allowed_but_floods_are_not(int frames, int seconds, bool allowed) =>
        Assert.Equal(allowed, VoiceActivityController.WithinFrameBudget(frames, TimeSpan.FromSeconds(seconds)));

    private static VoiceActivityController Controller(VoiceActivitySessions sessions, Guid? user, bool enabled = true,
        VoiceActivityDetector? detector = null)
    {
        var controller = new VoiceActivityController(sessions, detector!, new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Voice:Enabled"] = enabled.ToString() }).Build(),
            NullLogger<VoiceActivityController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = user.HasValue
                        ? new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", user.Value.ToString())], "Cookie"))
                        : new ClaimsPrincipal(new ClaimsIdentity())
                }
            }
        };
        controller.Request.Headers.Origin = "https://ui.example.test";
        return controller;
    }

    private sealed class SocketFeature : IHttpWebSocketFeature
    {
        public bool IsWebSocketRequest => true;
        public int Accepts { get; private set; }
        public WebSocket? Socket { get; init; }
        public Task<WebSocket> AcceptAsync(WebSocketAcceptContext context)
        {
            Accepts++;
            if (Socket is not null) return Task.FromResult(Socket);
            throw new InvalidOperationException("Unexpected socket acceptance in a rejected request.");
        }
    }

    private sealed record Part(byte[] Bytes, WebSocketMessageType Type, bool End);
    private sealed class FrameSocket(params Part[] parts) : WebSocket
    {
        private readonly Queue<Part> pending = new(parts);
        public int Reads { get; private set; }
        public List<string> Messages { get; } = [];
        public override WebSocketCloseStatus? CloseStatus => null;
        public override string? CloseStatusDescription => null;
        public override WebSocketState State => WebSocketState.Open;
        public override string? SubProtocol => "sanadi-voice";
        public override void Abort() { }
        public override void Dispose() { }
        public override Task CloseAsync(WebSocketCloseStatus status, string? description, CancellationToken ct) => Task.CompletedTask;
        public override Task CloseOutputAsync(WebSocketCloseStatus status, string? description, CancellationToken ct) => Task.CompletedTask;
        public override Task SendAsync(ArraySegment<byte> buffer, WebSocketMessageType type, bool end, CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();
            Messages.Add(Encoding.UTF8.GetString(buffer.AsSpan()));
            return Task.CompletedTask;
        }
        public override Task<WebSocketReceiveResult> ReceiveAsync(ArraySegment<byte> buffer, CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();
            Reads++;
            var next = pending.Dequeue();
            next.Bytes.AsSpan().CopyTo(buffer.AsSpan());
            return Task.FromResult(new WebSocketReceiveResult(next.Bytes.Length, next.Type, next.End));
        }
    }
}
