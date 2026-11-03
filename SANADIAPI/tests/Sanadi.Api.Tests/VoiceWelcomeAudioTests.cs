using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using System.Security.Claims;
using System.Text.Json.Nodes;
using Sanadi.Api.AI;
using Sanadi.Api.Controllers;

namespace Sanadi.Api.Tests;

public sealed class VoiceWelcomeAudioTests
{
    private static readonly ConfiguredSpeech.Settings Settings = new("https://voice.test/v1", "test-key");

    [Theory]
    [InlineData("mira", "en")]
    [InlineData("mira", "ar")]
    [InlineData("suhail", "en")]
    [InlineData("suhail", "ar")]
    public async Task Prepared_welcome_is_available_without_another_speech_request(string agent, string language)
    {
        var cache = new VoiceWelcomeAudio();
        var calls = 0;
        Task<byte[]> Generate(string text, CancellationToken ct)
        {
            calls++;
            Assert.Equal(VoiceCallGreeting.Text(agent, language), text);
            return Task.FromResult(Wav());
        }
        var prepared = await cache.Get(Settings, agent, language, Generate, default);
        var opening = cache.Get(Settings, agent, language, Generate, default);
        Assert.True(opening.IsCompletedSuccessfully);
        Assert.Same(prepared, await opening);
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task Different_voice_language_or_gateway_settings_do_not_reuse_the_wrong_welcome()
    {
        var cache = new VoiceWelcomeAudio();
        var calls = 0;
        Task<byte[]> Generate(string _, CancellationToken ct) { calls++; return Task.FromResult(Wav()); }
        foreach (var agent in new[] { "mira", "suhail" })
            foreach (var language in new[] { "en", "ar" })
                await cache.Get(Settings, agent, language, Generate, default);
        await cache.Get(Settings with { Key = "rotated-key" }, "mira", "en", Generate, default);
        await cache.Get(Settings with { Url = "https://new-voice.test/v1" }, "mira", "en", Generate, default);
        Assert.Equal(6, calls);
    }

    [Fact]
    public async Task A_click_during_preparation_shares_the_same_generation()
    {
        var cache = new VoiceWelcomeAudio();
        var generated = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
        var calls = 0;
        Task<byte[]> Generate(string _, CancellationToken ct) { calls++; return generated.Task; }
        var preparing = cache.Get(Settings, "mira", "en", Generate, default);
        var opening = cache.Get(Settings, "mira", "en", Generate, default);
        Assert.False(opening.IsCompleted);
        generated.SetResult(Wav());
        Assert.Same(await preparing, await opening);
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task Cancelled_warmup_does_not_poison_the_next_call()
    {
        var cache = new VoiceWelcomeAudio();
        using var cancel = new CancellationTokenSource();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => cache.Get(Settings, "mira", "en",
            (_, _) => { cancel.Cancel(); return Task.FromResult(Wav()); }, cancel.Token));
        var calls = 0;
        await cache.Get(Settings, "mira", "en", (_, _) => { calls++; return Task.FromResult(Wav()); }, default);
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task Failed_or_invalid_generation_is_not_cached()
    {
        var cache = new VoiceWelcomeAudio();
        await Assert.ThrowsAsync<HttpRequestException>(() => cache.Get(Settings, "mira", "en",
            (_, _) => throw new HttpRequestException(), default));
        await Assert.ThrowsAsync<InvalidOperationException>(() => cache.Get(Settings, "mira", "en",
            (_, _) => Task.FromResult(new byte[] { 1, 2, 3 }), default));
        Assert.Equal(Wav(), await cache.Get(Settings, "mira", "en", (_, _) => Task.FromResult(Wav()), default));
    }

    [Fact]
    public async Task Arbitrary_inputs_cannot_fill_the_cache_and_the_prepare_route_requires_login()
    {
        var cache = new VoiceWelcomeAudio();
        await Assert.ThrowsAsync<ArgumentException>(() => cache.Get(Settings, "other", "en",
            (_, _) => throw new Exception("Must not generate"), default));
        var action = typeof(VoiceCallController).GetMethod(nameof(VoiceCallController.PrepareWelcome))!;
        Assert.NotEmpty(action.GetCustomAttributes(typeof(AuthorizeAttribute), true));
        Assert.Empty(action.GetCustomAttributes(typeof(AllowAnonymousAttribute), true));
    }

    private static byte[] Wav()
    {
        using var output = new MemoryStream(); using var writer = new BinaryWriter(output);
        writer.Write("RIFF"u8); writer.Write(38); writer.Write("WAVEfmt "u8);
        writer.Write(16); writer.Write((short)1); writer.Write((short)1); writer.Write(24000); writer.Write(48000);
        writer.Write((short)2); writer.Write((short)16); writer.Write("data"u8); writer.Write(2); writer.Write((short)100);
        return output.ToArray();
    }

    [Theory]
    [InlineData("mira", "en", "Hello Mira")]
    [InlineData("suhail", "en", "Hello Suhail")]
    [InlineData("mira", "ar", "مرحبا ميرا")]
    [InlineData("suhail", "ar", "مرحبا سهيل")]
    public async Task Prepared_greeting_chunks_are_immediately_ready_without_a_live_tts_request(string agent, string language, string question)
    {
        var cache = new VoiceWelcomeAudio();
        var calls = 0;
        Task<byte[]> Generate(string text, CancellationToken ct) { calls++; return Task.FromResult(Wav()); }
        var segments = await VoiceWelcomeAudio.StandardGreetingSegments(agent, language);
        Assert.NotEmpty(segments);
        foreach (var segment in segments)
        {
            var prepared = await cache.GetGreeting(Settings, agent, language, "Hello", segment, false, Generate, default);
            var live = cache.GetGreeting(Settings, agent, language, question, segment, false, Generate, default);
            Assert.True(live.IsCompletedSuccessfully);
            Assert.Same(prepared, await live);
        }
        Assert.Equal(segments.Length, calls);
        var result = new JsonObject { ["answer"] = ConversationalTurn.ImmediateGreetingReply(question, language, agent),
            ["toolsUsed"] = new JsonArray("greeting"), ["verified"] = true };
        Assert.True(VoiceWelcomeAudio.IsFixedGreeting(result, question, agent, language));
        var actual = new List<string>();
        var splitter = new VoiceSentences(language, s => { actual.Add(s); return Task.CompletedTask; },
            firstChunkChars: 160, naturalPhrasing: true, separateFirstSentence: true);
        await splitter.Push(VoiceReplyNarration.Overview(result, question, language), final: true);
        Assert.Equal(segments, actual);
    }

    [Theory]
    [InlineData("en", "How are you?", "mira")]
    [InlineData("ar", "شلونك؟", "suhail")]
    [InlineData("en", "What is your name?", "suhail")]
    [InlineData("ar", "شو اسمج؟", "mira")]
    public async Task Other_fixed_social_replies_are_reused_after_first_playback(string language, string question, string agent)
    {
        var cache = new VoiceWelcomeAudio();
        var text = VoiceSpeechFormatter.ToSpeech(ConversationalTurn.ImmediateGreetingReply(question, language, agent)!, language);
        var calls = 0;
        Task<byte[]> Generate(string _, CancellationToken ct) { calls++; return Task.FromResult(Wav()); }
        var first = await cache.GetGreeting(Settings, agent, language, question, text, false, Generate, default);
        Assert.Same(first, await cache.GetGreeting(Settings, agent, language, question, text, false, Generate, default));
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task Public_greeting_audio_never_replaces_a_student_answer_or_model_response()
    {
        var cache = new VoiceWelcomeAudio();
        var calls = 0;
        Task<byte[]> Generate(string text, CancellationToken ct) { calls++; return Task.FromResult(Wav()); }
        foreach (var input in new[] { ("Hello Mira", "Your student ID is 202000336."),
                     ("Hello, what is my GPA?", "Hello.") })
        {
            await cache.GetGreeting(Settings, "mira", "en", input.Item1, input.Item2, false, Generate, default);
            await cache.GetGreeting(Settings, "mira", "en", input.Item1, input.Item2, false, Generate, default);
        }
        Assert.Equal(4, calls);
        var expected = ConversationalTurn.ImmediateGreetingReply("Hello", "en", "mira");
        foreach (var result in new[] {
            new JsonObject { ["answer"] = expected, ["verified"] = false, ["toolsUsed"] = new JsonArray("greeting") },
            new JsonObject { ["answer"] = expected, ["verified"] = true, ["toolsUsed"] = new JsonArray("profile") },
            new JsonObject { ["answer"] = "Your student ID is 202000336.", ["verified"] = true, ["toolsUsed"] = new JsonArray("greeting") } })
            Assert.False(VoiceWelcomeAudio.IsFixedGreeting(result, "Hello", "mira", "en"));
    }

    [Fact]
    public async Task Introductions_voices_languages_and_rotated_settings_keep_separate_greeting_audio()
    {
        var cache = new VoiceWelcomeAudio();
        var calls = 0;
        Task<byte[]> Generate(string text, CancellationToken ct) { calls++; return Task.FromResult(Wav()); }
        foreach (var agent in new[] { "mira", "suhail" })
        foreach (var language in new[] { "en", "ar" })
        {
            var segment = (await VoiceWelcomeAudio.StandardGreetingSegments(agent, language))[0];
            var plain = await cache.GetGreeting(Settings, agent, language, "Hello", segment, false, Generate, default);
            var introduction = VoiceCallDelivery.Introduction(agent, language) + segment;
            var introduced = await cache.GetGreeting(Settings, agent, language, "Hello", introduction, true, Generate, default);
            Assert.NotSame(plain, introduced);
            Assert.Same(introduced, await cache.GetGreeting(Settings, agent, language, "Hello", introduction, true, Generate, default));
        }
        var english = (await VoiceWelcomeAudio.StandardGreetingSegments("mira", "en"))[0];
        await cache.GetGreeting(Settings with { Key = "rotated" }, "mira", "en", "Hello", english, false, Generate, default);
        await cache.GetGreeting(Settings with { Url = "https://new-voice.test/v1" }, "mira", "en", "Hello", english, false, Generate, default);
        Assert.Equal(10, calls);
    }

    [Fact]
    public async Task Greeting_warmup_and_live_playback_share_generation_and_cancelled_waiters_do_not_poison_it()
    {
        var cache = new VoiceWelcomeAudio();
        var generated = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
        var segment = (await VoiceWelcomeAudio.StandardGreetingSegments("mira", "en"))[0];
        var calls = 0;
        Task<byte[]> Generate(string _, CancellationToken ct) { calls++; return generated.Task; }
        var warming = cache.GetGreeting(Settings, "mira", "en", "Hello", segment, false, Generate, default);
        using var cancelled = new CancellationTokenSource();
        var interrupted = cache.GetGreeting(Settings, "mira", "en", "Hello Mira", segment, false, Generate, cancelled.Token);
        cancelled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => interrupted);
        generated.SetResult(Wav());
        Assert.Same(await warming, await cache.GetGreeting(Settings, "mira", "en", "Hello", segment, false, Generate, default));
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task Greeting_preparation_is_authenticated_and_rejects_arbitrary_selections()
    {
        var action = typeof(VoiceCallController).GetMethod(nameof(VoiceCallController.PrepareGreeting))!;
        Assert.NotEmpty(action.GetCustomAttributes(typeof(AuthorizeAttribute), true));
        var controller = new VoiceCallController(null!, null!, null!, new ConfigurationBuilder().Build(), null!,
            NullLogger<VoiceCallController>.Instance, new VoiceWelcomeAudio())
        { ControllerContext = new() { HttpContext = new DefaultHttpContext() } };
        Assert.IsType<UnauthorizedObjectResult>(await controller.PrepareGreeting(new("mira", "en", 0), default));
        controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", Guid.NewGuid().ToString())], "Cookie"));
        Assert.IsType<BadRequestObjectResult>(await controller.PrepareGreeting(new("other", "en", 0), default));
        Assert.IsType<BadRequestObjectResult>(await controller.PrepareGreeting(new("mira", "bn", 0), default));
        Assert.IsType<BadRequestObjectResult>(await controller.PrepareGreeting(new("mira", "en", -1), default));
        Assert.IsType<BadRequestObjectResult>(await controller.PrepareGreeting(new("mira", "en", 999), default));
        var full = typeof(VoiceCallController).GetMethod(nameof(VoiceCallController.PrepareGreetingReply))!;
        Assert.NotEmpty(full.GetCustomAttributes(typeof(AuthorizeAttribute), true));
        Assert.IsType<BadRequestObjectResult>(await controller.PrepareGreetingReply(new("other", "en"), default));
        Assert.IsType<BadRequestObjectResult>(await controller.PrepareGreetingReply(new("mira", "bn"), default));
        controller.HttpContext.User = new ClaimsPrincipal();
        Assert.IsType<UnauthorizedObjectResult>(await controller.PrepareGreetingReply(new("mira", "en"), default));
    }

    [Theory]
    [InlineData("mira", "en")]
    [InlineData("suhail", "en")]
    [InlineData("mira", "ar")]
    [InlineData("suhail", "ar")]
    public async Task A_complete_prepared_greeting_is_available_without_repeating_synthesis(string agent, string language)
    {
        var cache = new VoiceWelcomeAudio();
        Assert.Null(cache.ReadyGreetingReply(Settings, agent, language));
        var calls = 0;
        Task<byte[]> Generate(string text, CancellationToken ct)
        {
            calls++;
            Assert.Equal(ConversationalTurn.GreetingReply("Hello", language), text);
            return Task.FromResult(Wav());
        }
        var wav = await cache.GetGreetingReply(Settings, agent, language, Generate, default);
        Assert.Same(wav, cache.ReadyGreetingReply(Settings, agent, language));
        Assert.Same(wav, await cache.GetGreetingReply(Settings, agent, language, Generate, default));
        Assert.Null(cache.ReadyGreetingReply(Settings with { Key = "changed" }, agent, language));
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task Unfinished_full_greeting_preparation_cannot_delay_the_existing_live_path()
    {
        var cache = new VoiceWelcomeAudio();
        var generated = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
        var loading = cache.GetGreetingReply(Settings, "mira", "en", (_, _) => generated.Task, default);
        Assert.Null(cache.ReadyGreetingReply(Settings, "mira", "en"));
        generated.SetResult(Wav());
        Assert.Same(await loading, cache.ReadyGreetingReply(Settings, "mira", "en"));
    }

    [Theory]
    [InlineData("en")]
    [InlineData("ar")]
    public async Task Public_cues_reuse_configured_audio_but_never_another_kind_or_language(string language)
    {
        var cache=new VoiceWelcomeAudio();var calls=0;
        Task<byte[]> Generate(string text,CancellationToken ct) { calls++;Assert.False(string.IsNullOrWhiteSpace(text));return Task.FromResult(Wav()); }
        var first=await cache.GetCue(Settings,"mira",language,"initial",0,Generate,default);
        Assert.Same(first,await cache.GetCue(Settings,"mira",language,"initial",0,Generate,default));
        Assert.Equal(1,calls);
        await cache.GetCue(Settings,"mira",language,"waiting",0,Generate,default);
        await cache.GetCue(Settings,"mira",language=="ar"?"en":"ar","initial",0,Generate,default);
        Assert.Equal(3,calls);
        Assert.Throws<ArgumentException>(()=> { _=cache.GetCue(Settings,"mira",language,"user-text",0,Generate,default); });
        Assert.Throws<ArgumentException>(()=> { _=cache.GetCue(Settings,"mira",language,"initial",999,Generate,default); });
        Assert.Equal(3,calls);
    }

    [Fact]
    public void Cue_phrases_are_brief_unique_and_do_not_claim_completion()
    {
        foreach(var kind in new[]{"initial","waiting"})
        foreach(var language in new[]{"en","ar"})
        {
            var count=kind=="initial"?VoiceProcessingCues.Initial.Length:VoiceProcessingCues.Waiting.Length;
            var phrases=Enumerable.Range(0,count).Select(i=>VoiceProcessingCues.Text(kind,i,language)).ToArray();
            Assert.Equal(phrases.Length,phrases.Distinct().Count());
            Assert.All(phrases,p=>Assert.True(p.Split(' ',StringSplitOptions.RemoveEmptyEntries).Length<8));
            Assert.All(phrases,p=>Assert.DoesNotContain("Almost",p,StringComparison.OrdinalIgnoreCase));
        }
        var action=typeof(VoiceCallController).GetMethod(nameof(VoiceCallController.PrepareCue))!;
        Assert.NotEmpty(action.GetCustomAttributes(typeof(AuthorizeAttribute),true));
    }

    [Fact]
    public async Task Disabled_cues_make_no_settings_or_speech_call()
    {
        // Null dependencies would fail if optional synthesis were reached.
        var controller=CueController(false);
        Assert.IsType<NoContentResult>(await controller.PrepareCue(new("mira","en","initial",0),default));
    }

    [Fact]
    public async Task Abandoned_preparation_never_starts_settings_or_speech_work()
    {
        using var cancel=new CancellationTokenSource();cancel.Cancel();
        var controller=CueController(true);
        Assert.IsType<EmptyResult>(await controller.PrepareWelcome(new("mira","en",true),cancel.Token));
        Assert.IsType<EmptyResult>(await controller.PrepareCue(new("mira","en","initial",0),cancel.Token));
    }

    [Fact]
    public async Task Client_cancellation_of_preparation_is_quiet_but_other_failures_are_not_hidden()
    {
        using var cancel=new CancellationTokenSource();
        var result=await VoiceCallController.CompletePreparation(cancel.Token,()=>
        {cancel.Cancel();return Task.FromCanceled<IActionResult>(cancel.Token);});
        Assert.IsType<EmptyResult>(result);
        await Assert.ThrowsAsync<TaskCanceledException>(()=>VoiceCallController.CompletePreparation(default,
            ()=>throw new TaskCanceledException("upstream timeout without caller cancellation")));
        await Assert.ThrowsAsync<InvalidOperationException>(()=>VoiceCallController.CompletePreparation(default,
            ()=>throw new InvalidOperationException("real failure")));
    }

    [Theory]
    [InlineData("other","en","initial",0)]
    [InlineData("mira","invalid","initial",0)]
    [InlineData("mira","ar","user provided text",0)]
    [InlineData("mira","ar","initial",-1)]
    [InlineData("mira","ar","waiting",999)]
    public async Task Cue_endpoint_accepts_only_bounded_public_selections(string agent,string language,string kind,int index)
        => Assert.IsType<BadRequestObjectResult>(await CueController(true).PrepareCue(new(agent,language,kind,index),default));

    private static VoiceCallController CueController(bool enabled)=>new(null!,null!,null!,
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { [VoiceProcessingCues.EnabledSetting]=enabled.ToString() }).Build(),
        null!,NullLogger<VoiceCallController>.Instance,new VoiceWelcomeAudio())
    {
        ControllerContext=new ControllerContext { HttpContext=new DefaultHttpContext {
            User=new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub",Guid.NewGuid().ToString())],"Cookie")) } }
    };
}
