using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.IO.Pipelines;
using Microsoft.Extensions.Configuration;
using Sanadi.Api.AI;
using Sanadi.Api.Controllers;

namespace Sanadi.Api.Tests;

public sealed class VoiceStreamingTests
{
    [Fact]
    public async Task Stream_request_keeps_database_connection_identity_and_enables_streaming()
    {
        using var request = OllamaChatRequest.Create("https://university.example/v1", "db-key",
            Guid.Parse("00000000-0000-4000-8000-000000000001"), "db-model", "question", 777, false, stream: true, temperature: 0.3m);
        using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        Assert.Equal("https://university.example/v1/chat/completions", request.RequestUri!.AbsoluteUri);
        Assert.Equal("db-key", request.Headers.Authorization!.Parameter);
        Assert.Equal("db-model", body.RootElement.GetProperty("model").GetString());
        Assert.Equal(777, body.RootElement.GetProperty("max_tokens").GetInt32());
        Assert.True(body.RootElement.GetProperty("stream").GetBoolean());
        Assert.Equal(0.3m, body.RootElement.GetProperty("temperature").GetDecimal());
        Assert.False(body.RootElement.GetProperty("chat_template_kwargs").GetProperty("enable_thinking").GetBoolean());
    }

    [Fact]
    public async Task Sse_emits_content_incrementally_without_reasoning_or_repeated_full_reply()
    {
        var chunks = new List<string>();
        var input = string.Join("\n", new[] {
            """data: {"choices":[{"delta":{"reasoning_content":"secret reasoning"}}]}""",
            """data: {"choices":[{"delta":{"content":"<thi"}}]}""",
            """data: {"choices":[{"delta":{"content":"nk>private</think>Your GPA is 3."}}]}""",
            """data: {"choices":[{"delta":{"content":"5. You are eligible."}}]}""",
            """data: {"choices":[{"delta":{},"finish_reason":"stop"}]}""",
            "data: [DONE]", ""
        });
        var text = await VoiceModelStream.Read(new MemoryStream(Encoding.UTF8.GetBytes(input)),
            chunk => { chunks.Add(chunk); return Task.CompletedTask; }, default);
        Assert.Equal("Your GPA is 3.5. You are eligible.", text);
        Assert.Equal(2, chunks.Count);
        Assert.DoesNotContain("secret", string.Concat(chunks));
        Assert.DoesNotContain("private", string.Concat(chunks));
    }

    [Fact]
    public async Task First_content_arrives_while_upstream_stream_is_still_open()
    {
        var pipe = new Pipe();
        var first = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var reading = VoiceModelStream.Read(pipe.Reader.AsStream(), _ =>
        { first.TrySetResult(); return Task.CompletedTask; }, timeout.Token);
        await pipe.Writer.WriteAsync(Encoding.UTF8.GetBytes(
            "data: {\"choices\":[{\"delta\":{\"content\":\"First sentence. \"}}]}\n"), timeout.Token);
        await first.Task.WaitAsync(timeout.Token);
        Assert.False(reading.IsCompleted);
        await pipe.Writer.WriteAsync(Encoding.UTF8.GetBytes("data: [DONE]\n"), timeout.Token);
        await pipe.Writer.CompleteAsync();
        Assert.Equal("First sentence.", await reading);
    }

    [Fact]
    public async Task Native_Arabic_stream_ignores_thinking_and_preserves_spoken_language()
    {
        var input = """
            {"message":{"thinking":"hidden","content":"معدلك "},"done":false}
            {"message":{"content":"ثلاثة ونصف."},"done":true}

            """;
        var text = await VoiceModelStream.Read(new MemoryStream(Encoding.UTF8.GetBytes(input)), _ => Task.CompletedTask, default);
        Assert.Equal("معدلك ثلاثة ونصف.", text);
        Assert.Equal("ar", AssistantController.ReplyLanguage(text, "en"));
        Assert.Equal("en", AssistantController.ReplyLanguage("What is my GPA?", "ar"));
    }

    [Fact]
    public async Task Truncated_stream_fails_instead_of_replaying_a_fallback()
    {
        using var input = new MemoryStream(Encoding.UTF8.GetBytes("""data: {"choices":[{"delta":{"content":"Partial"}}]}"""));
        await Assert.ThrowsAsync<InvalidOperationException>(() => VoiceModelStream.Read(input, _ => Task.CompletedTask, default));
    }

    [Fact]
    public async Task Sentence_queue_starts_before_end_and_does_not_split_decimal()
    {
        var chunks = new List<string>();
        var splitter = new VoiceSentences("en", s => { chunks.Add(s); return Task.CompletedTask; });
        await splitter.Push("Your GPA is 3.");
        Assert.Empty(chunks);
        await splitter.Push("5. You ");
        Assert.Equal(new[] { "Your GPA is 3.5." }, chunks);
        await splitter.Push("are eligible.", final: true);
        Assert.Equal(new[] { "Your GPA is 3.5.", "You are eligible." }, chunks);
    }

    [Theory]
    [InlineData("en", "You can check your current course details and your registration status, ", "then open the student portal to view the full timetable.")]
    [InlineData("ar", "تقدر تراجع تفاصيل مقرراتك الحالية وحالة تسجيلك من خلال حسابك الجامعي، ", "وبعدها تفتح بوابة الطالب للاطلاع على جدولك الدراسي بالكامل.")]
    public async Task First_voice_clause_is_ready_for_synthesis_before_the_rest_of_the_answer(string language, string clause, string rest)
    {
        var chunks = new List<string>();
        var splitter = new VoiceSentences(language, s => { chunks.Add(s); return Task.CompletedTask; }, firstChunkChars: 160);
        await splitter.Push(clause);
        Assert.Single(chunks); // No wait for the final sentence or final model event.
        Assert.StartsWith(clause.Trim(), chunks[0]);
        await splitter.Push(rest, final: true);
        Assert.Equal(2, chunks.Count);
        Assert.Equal(rest, chunks[1]);
    }

    [Theory]
    [InlineData("en", "You can review your current registration details in the student portal and check your GPA of 3.75 together with your course information and your current academic schedule before choosing the service you need today.")]
    [InlineData("ar", "تقدر تراجع تفاصيل تسجيلك الحالية من خلال بوابة الطالب وتتحقق من معدلك وهو 3.75 مع معلومات مقرراتك الدراسية وجدولك الأكاديمي الحالي قبل اختيار الخدمة الجامعية التي تحتاجها اليوم ومتابعة تفاصيل الطلب من حسابك الشخصي.")]
    public async Task Long_first_sentence_starts_with_a_short_chunk_without_losing_words_or_splitting_gpa(string language, string answer)
    {
        var chunks = new List<string>();
        var splitter = new VoiceSentences(language, s => { chunks.Add(s); return Task.CompletedTask; }, firstChunkChars: 160);
        await splitter.Push(answer);
        Assert.Single(chunks);
        Assert.InRange(chunks[0].Length, 60, 161);
        await splitter.Push("", final: true);
        Assert.Equal(2, chunks.Count);
        var joined = string.Join(" ", chunks.Select(chunk => chunk.TrimEnd('.')));
        Assert.Equal(answer.TrimEnd('.'), joined);
        Assert.Contains("3.75", joined);
    }

    [Theory]
    [InlineData("en", "Your GPA is 3.", "75. You are eligible.")]
    [InlineData("ar", "معدلك الحالي هو 3.", "75. أنت مؤهل.")]
    public async Task Short_replies_keep_natural_sentence_boundaries_with_fast_start_enabled(string language, string first, string rest)
    {
        var chunks = new List<string>();
        var splitter = new VoiceSentences(language, s => { chunks.Add(s); return Task.CompletedTask; }, firstChunkChars: 160);
        await splitter.Push(first);
        Assert.Empty(chunks);
        await splitter.Push(rest, final: true);
        Assert.Equal(2, chunks.Count);
        Assert.EndsWith("3.75.", chunks[0]);
    }

    [Fact]
    public async Task Cancellation_stops_stream_callbacks()
    {
        using var cancel = new CancellationTokenSource();
        var count = 0;
        using var input = new MemoryStream(Encoding.UTF8.GetBytes(
            "data: {\"choices\":[{\"delta\":{\"content\":\"One. \"}}]}\n" +
            "data: {\"choices\":[{\"delta\":{\"content\":\"Two.\"}}]}\ndata: [DONE]\n"));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => VoiceModelStream.Read(input, _ =>
        { count++; cancel.Cancel(); return Task.CompletedTask; }, cancel.Token));
        Assert.Equal(1, count);
    }

    [Fact]
    public void Room_tickets_are_origin_bound_and_single_use_and_new_turn_cancels_old_turn()
    {
        var tickets = new VoiceRoomTickets();
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", Guid.NewGuid().ToString())], "test"));
        var ticket = tickets.Issue(principal, "https://ui.example");
        Assert.NotNull(tickets.Take(ticket, "https://ui.example"));
        Assert.Null(tickets.Take(ticket, "https://ui.example"));
        Assert.Null(tickets.Take(tickets.Issue(principal, "https://ui.example"), "https://other.example"));
        using var first = new CancellationTokenSource();
        using var second = new CancellationTokenSource();
        var user = Guid.NewGuid();
        tickets.Enter(user, first);
        tickets.Enter(user, second);
        Assert.True(first.IsCancellationRequested);
        tickets.Leave(user, first);
        Assert.False(second.IsCancellationRequested);
        tickets.Leave(user, second);
    }

    [Theory]
    [InlineData("mira")]
    [InlineData("suhail")]
    public async Task Installed_server_English_voice_produces_real_wave_audio_without_device_playback(string agent)
    {
        if (!OperatingSystem.IsWindows()) return;
        var config = new ConfigurationBuilder().Build();
        var service = new AdvisorSpeech(new PrivateVoiceService(config, new NoHttp()), config);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var audio = await service.Speak("Your university advisor is ready.", "en", agent, timeout.Token);
        Assert.True(PrivateVoiceService.ValidWav(audio));
        Assert.True(audio.Length > 1000);
    }
    private sealed class NoHttp : IHttpClientFactory
    { public HttpClient CreateClient(string name) => throw new InvalidOperationException("Unexpected external request"); }
}
