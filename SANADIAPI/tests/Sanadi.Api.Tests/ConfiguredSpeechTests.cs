using System.Net;
using System.Text;
using System.Text.Json;
using Sanadi.Api.AI;
using Sanadi.Api.Controllers;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.Tests;

public sealed class ConfiguredSpeechTests
{
    [Theory]
    [InlineData("https://ai.test", "https://ai.test/audio/speech", "https://ai.test/chat/completions")]
    [InlineData("https://ai.test/v1/", "https://ai.test/v1/audio/speech", "https://ai.test/v1/chat/completions")]
    [InlineData("https://ai.test/gateway/v1/chat/completions/", "https://ai.test/gateway/v1/audio/speech", "https://ai.test/gateway/v1/chat/completions")]
    [InlineData("https://ai.test/v1/audio/speech", "https://ai.test/v1/audio/speech", "https://ai.test/v1/chat/completions")]
    [InlineData("https://ai.test/v1/audio/transcriptions/", "https://ai.test/v1/audio/speech", "https://ai.test/v1/chat/completions")]
    [InlineData("https://ai.test/v1/chat/completions?api-version=test", "https://ai.test/v1/audio/speech?api-version=test", "https://ai.test/v1/chat/completions?api-version=test")]
    public void Both_operations_preserve_configured_gateway_prefix_without_duplicate_suffixes(string url, string speech, string chat)
    {
        Assert.Equal(speech, AiServerEndpoint.For(url, "audio/speech").AbsoluteUri);
        using var request = OllamaChatRequest.Create(url, "test-key", Guid.NewGuid(), "test-model", "question", 100, false);
        Assert.Equal(chat, request.RequestUri!.AbsoluteUri);
    }

    [Theory]
    [InlineData("mira", "Welcome to the university.", "ar", "en", "female")]
    [InlineData("suhail", "Welcome to the university.", "ar", "en", "male")]
    [InlineData("mira", "مرحباً بكم في الجامعة.", "en", "ar", "female")]
    [InlineData("suhail", "مرحباً بكم في الجامعة.", "en", "ar", "male")]
    public async Task Both_languages_preserve_assistant_voice_identity_with_database_key_and_login_id(
        string agent, string question, string profileLanguage, string expectedLanguage, string expectedVoice)
    {
        var settings = new ConfiguredSpeech.Settings("https://ai.test/gateway/v1/chat/completions", "database-key");
        var userId = Guid.NewGuid();
        var language = AssistantController.ReplyLanguage(question, profileLanguage);
        using var handler = new Handler(async (request, ct) =>
        {
            Assert.Equal("https://ai.test/gateway/v1/audio/speech", request.RequestUri!.AbsoluteUri);
            Assert.Equal("Bearer database-key", request.Headers.Authorization!.ToString());
            Assert.Equal(userId.ToString(), request.Headers.GetValues("X-LLM-User-ID").Single());
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct));
            Assert.Equal("chatterbox-multilingual", body.RootElement.GetProperty("model").GetString());
            Assert.Equal(question, body.RootElement.GetProperty("input").GetString());
            Assert.Equal(expectedLanguage, body.RootElement.GetProperty("language").GetString());
            Assert.Equal(expectedVoice, body.RootElement.GetProperty("voice").GetString());
            Assert.False(body.RootElement.TryGetProperty("gender", out _));
            Assert.Equal("wav", body.RootElement.GetProperty("response_format").GetString());
            Assert.False(body.RootElement.TryGetProperty("language_id", out _));
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Wav()) };
        });
        using var client = new HttpClient(handler);
        Assert.Equal(Wav(), await ConfiguredSpeech.Speak(client, settings, question, language, agent, userId, default));
        Assert.Equal(1, handler.Calls);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, "tts_auth_failed")]
    [InlineData(HttpStatusCode.Forbidden, "tts_auth_failed")]
    [InlineData(HttpStatusCode.NotFound, "tts_endpoint_missing")]
    [InlineData(HttpStatusCode.BadRequest, "tts_request_rejected")]
    [InlineData(HttpStatusCode.ServiceUnavailable, "tts_service_unavailable")]
    public async Task Provider_failure_does_not_leak_details_retry_or_switch_voices(HttpStatusCode status, string expectedCode)
    {
        using var handler = new Handler((_, _) => Task.FromResult(new HttpResponseMessage(status)
        { Content = new StringContent("secret-key and student text") }));
        using var client = new HttpClient(handler);
        var error = await Assert.ThrowsAsync<SanadiException>(() => ConfiguredSpeech.Speak(client,
            new("https://ai.test/v1", "secret-key"), "Hello", "en", "mira", Guid.NewGuid(), default));
        Assert.Equal(expectedCode, error.Code);
        Assert.DoesNotContain("secret-key", error.ToString());
        Assert.DoesNotContain("student text", error.ToString());
        Assert.Equal(1, handler.Calls);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Json_or_truncated_wav_is_rejected_before_browser_playback(bool truncated)
    {
        var bytes = truncated ? Wav()[..^2] : Encoding.UTF8.GetBytes("{\"url\":\"not-a-wav\"}");
        using var handler = new Handler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        { Content = new ByteArrayContent(bytes) }));
        using var client = new HttpClient(handler);
        var error = await Assert.ThrowsAsync<SanadiException>(() => ConfiguredSpeech.Speak(client,
            new("https://ai.test/v1", "key"), "Hello", "en", "mira", Guid.NewGuid(), default));
        Assert.Equal("tts_invalid_audio", error.Code);
    }

    [Fact]
    public async Task Interrupt_cancels_in_progress_synthesis_without_fallback()
    {
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var handler = new Handler(async (_, ct) =>
        {
            started.SetResult();
            await Task.Delay(Timeout.Infinite, ct);
            return new HttpResponseMessage(HttpStatusCode.OK);
        });
        using var client = new HttpClient(handler);
        using var turn = new CancellationTokenSource();
        var generating = ConfiguredSpeech.Speak(client, new("https://ai.test", "key"),
            "Hello", "en", "suhail", Guid.NewGuid(), turn.Token);
        await started.Task;
        turn.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => generating);
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task Playback_window_prefetches_one_sentence_and_ignores_duplicate_acknowledgements()
    {
        var window = new VoiceAudioWindow();
        using var turn = new CancellationTokenSource();
        await window.Reserve(0, turn.Token);
        await window.Reserve(1, turn.Token);
        var third = window.Reserve(2, turn.Token);
        Assert.False(third.IsCompleted);
        window.Played(0);
        await third;
        window.Played(0); // Duplicate cannot create another synthesis slot.
        window.Played(99);
        var fourth = window.Reserve(3, turn.Token);
        Assert.False(fourth.IsCompleted);
        turn.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => fourth);
    }

    [Theory]
    [InlineData("en", "mira")]
    [InlineData("en", "suhail")]
    [InlineData("ar", "mira")]
    [InlineData("ar", "suhail")]
    public async Task Call_recovers_a_transient_sentence_failure_without_changing_the_request(string language, string agent)
    {
        var bodies = new List<string>();
        using var handler = new Handler(async (request, ct) =>
        {
            bodies.Add(await request.Content!.ReadAsStringAsync(ct));
            return bodies.Count == 1
                ? new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
                : new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Wav()) };
        });
        using var client = new HttpClient(handler);
        var wav = await ConfiguredSpeech.SpeakForCall(client, new("https://ai.test", "key"),
            language == "ar" ? "تم تأكيد طلبك." : "Your request is confirmed.", language, agent, Guid.NewGuid(), default);
        Assert.Equal(Wav(), wav);
        Assert.Equal(2, handler.Calls);
        Assert.Equal(bodies[0], bodies[1]);
        using var body = JsonDocument.Parse(bodies[1]);
        Assert.Equal(agent == "mira" ? "female" : "male", body.RootElement.GetProperty("voice").GetString());
        Assert.Equal(language, body.RootElement.GetProperty("language").GetString());
    }

    [Theory]
    [InlineData(HttpStatusCode.ServiceUnavailable, 2)]
    [InlineData(HttpStatusCode.Unauthorized, 1)]
    [InlineData(HttpStatusCode.BadRequest, 1)]
    public async Task Call_retry_is_bounded_and_does_not_retry_authentication_or_voice_settings(HttpStatusCode status, int expectedCalls)
    {
        using var handler = new Handler((_, _) => Task.FromResult(new HttpResponseMessage(status)));
        using var client = new HttpClient(handler);
        await Assert.ThrowsAsync<SanadiException>(() => ConfiguredSpeech.SpeakForCall(client,
            new("https://ai.test", "key"), "Hello.", "en", "mira", Guid.NewGuid(), default));
        Assert.Equal(expectedCalls, handler.Calls);
    }

    [Fact]
    public async Task Interruption_prevents_a_failed_chunk_from_being_retried()
    {
        using var cancel = new CancellationTokenSource();
        using var handler = new Handler((_, _) =>
        {
            cancel.Cancel();
            throw new HttpRequestException("Connection closed");
        });
        using var client = new HttpClient(handler);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => ConfiguredSpeech.SpeakForCall(client,
            new("https://ai.test", "key"), "Hello.", "en", "mira", Guid.NewGuid(), cancel.Token));
        Assert.Equal(1, handler.Calls);
    }

    [Theory]
    [InlineData("en", "mira")]
    [InlineData("ar", "suhail")]
    public async Task A_header_timeout_retries_only_the_unsent_audio_with_the_same_text_and_voice(string language,string agent)
    {
        var requests=new List<string>();
        using var handler=new Handler(async (request,ct)=>
        {
            requests.Add(await request.Content!.ReadAsStringAsync(ct));
            if(requests.Count==1)throw new TaskCanceledException("simulated speech-service timeout");
            return new HttpResponseMessage(HttpStatusCode.OK){Content=new ByteArrayContent(Wav())};
        });
        using var client=new HttpClient(handler);
        var result=await ConfiguredSpeech.SpeakForCall(client,new("https://ai.test","key"),
            language=="ar"?"طلبك ظاهر على الشاشة.":"Your result is on screen.",language,agent,Guid.NewGuid(),default);
        Assert.Equal(Wav(),result);
        Assert.Equal(2,handler.Calls);
        Assert.Equal(requests[0],requests[1]);
    }

    [Fact]
    public async Task Repeated_timeouts_remain_a_real_failure_after_one_speech_retry()
    {
        using var handler=new Handler((_,_)=>throw new TaskCanceledException("provider-private-detail"));
        using var client=new HttpClient(handler);
        var error=await Assert.ThrowsAsync<SanadiException>(()=>ConfiguredSpeech.SpeakForCall(client,
            new("https://ai.test","key"),"Hello.","en","mira",Guid.NewGuid(),default));
        Assert.Equal(504,error.StatusCode);
        Assert.Equal("tts_service_unavailable",error.Code);
        Assert.DoesNotContain("provider-private-detail",error.ToString());
        Assert.Equal(2,handler.Calls);
    }

    [Fact]
    public async Task A_stalled_wav_body_is_bounded_disposed_and_retried_before_any_audio_is_returned()
    {
        var stalled=new StalledStream();
        var calls=0;
        using var handler=new Handler((_,_)=>Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {Content=++calls==1?new StreamContent(stalled):new ByteArrayContent(Wav())}));
        using var client=new HttpClient(handler){Timeout=TimeSpan.FromMilliseconds(100)};
        using var safety=new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var result=await ConfiguredSpeech.SpeakForCall(client,new("https://ai.test","key"),
            "Hello.","en","mira",Guid.NewGuid(),safety.Token);
        Assert.Equal(Wav(),result);
        Assert.Equal(2,handler.Calls);
        Assert.True(stalled.Disposed);
        Assert.False(safety.IsCancellationRequested);
    }

    [Fact]
    public async Task End_call_during_wav_download_cancels_without_retry_or_partial_audio()
    {
        var stalled=new StalledStream();
        using var handler=new Handler((_,_)=>Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=new StreamContent(stalled)}));
        using var client=new HttpClient(handler){Timeout=Timeout.InfiniteTimeSpan};
        using var turn=new CancellationTokenSource();
        var pending=ConfiguredSpeech.SpeakForCall(client,new("https://ai.test","key"),"Hello.","en","mira",Guid.NewGuid(),turn.Token);
        await stalled.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        turn.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>pending);
        Assert.Equal(1,handler.Calls);
        Assert.True(stalled.Disposed);
    }

    private sealed class StalledStream:Stream
    {
        internal readonly TaskCompletionSource Started=new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal bool Disposed;
        public override bool CanRead=>true;
        public override bool CanWrite=>false;
        public override bool CanSeek=>false;
        public override long Length=>throw new NotSupportedException();
        public override long Position {get=>throw new NotSupportedException();set=>throw new NotSupportedException();}
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer,CancellationToken ct=default)
        {Started.TrySetResult();await Task.Delay(Timeout.Infinite,ct);return 0;}
        public override int Read(byte[] buffer,int offset,int count)=>throw new NotSupportedException();
        public override long Seek(long offset,SeekOrigin origin)=>throw new NotSupportedException();
        public override void SetLength(long value)=>throw new NotSupportedException();
        public override void Write(byte[] buffer,int offset,int count)=>throw new NotSupportedException();
        public override void Flush()=>throw new NotSupportedException();
        protected override void Dispose(bool disposing){Disposed=true;base.Dispose(disposing);}
    }

    private static byte[] Wav()
    {
        using var data = new MemoryStream();
        using var writer = new BinaryWriter(data);
        writer.Write("RIFF"u8); writer.Write(40); writer.Write("WAVEfmt "u8);
        writer.Write(16); writer.Write((short)1); writer.Write((short)1);
        writer.Write(24000); writer.Write(48000); writer.Write((short)2); writer.Write((short)16);
        writer.Write("data"u8); writer.Write(4); writer.Write((short)10); writer.Write((short)-10);
        return data.ToArray();
    }

    private sealed class Handler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        { Calls++; return send(request, ct); }
    }
}
