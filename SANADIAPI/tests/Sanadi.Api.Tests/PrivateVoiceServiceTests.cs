using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class PrivateVoiceServiceTests
{
    private sealed class Transport : HttpMessageHandler, IHttpClientFactory
    {
        public List<string> Bodies { get; } = [];
        public string Reply { get; set; } = "";
        public HttpStatusCode Status { get; set; } = HttpStatusCode.OK;
        public HttpClient CreateClient(string name) => new(this, false);
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Bodies.Add(await request.Content!.ReadAsStringAsync(ct));
            var audio = new byte[44];
            Encoding.ASCII.GetBytes("RIFF").CopyTo(audio, 0);
            Encoding.ASCII.GetBytes("WAVE").CopyTo(audio, 8);
            return new HttpResponseMessage(Status) {
                Content = Reply.Length > 0 ? new StringContent(Reply) : new ByteArrayContent(audio)
            };
        }
    }
    private static IConfiguration Configuration(string male = "male") => new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?> {
            ["Voice:TtsBaseUrl"] = "http://127.0.0.1:8091",
            ["Voice:WhisperBaseUrl"] = "http://127.0.0.1:8091",
            ["Voice:FemaleVoice"] = "female", ["Voice:MaleVoice"] = male
        }).Build();

    [Theory]
    [InlineData("mira", "en", "female")]
    [InlineData("mira", "ar", "female")]
    [InlineData("suhail", "en", "male")]
    [InlineData("suhail", "ar", "male")]
    public async Task Selection_and_language_are_passed_to_one_private_synthesis(string agent, string language, string voice)
    {
        var transport = new Transport();
        var service = new PrivateVoiceService(Configuration(), transport);
        await service.Speak("A verified reply.", language, agent, default);
        Assert.Single(transport.Bodies);
        using var body = JsonDocument.Parse(transport.Bodies[0]);
        Assert.Equal(voice, body.RootElement.GetProperty("voice").GetString());
        Assert.Equal(language, body.RootElement.GetProperty("language_id").GetString());
        Assert.Equal("wav", body.RootElement.GetProperty("response_format").GetString());
    }

    [Fact]
    public void Missing_or_identical_voices_are_not_treated_as_ready()
    {
        var transport = new Transport();
        Assert.False(new PrivateVoiceService(new ConfigurationBuilder().Build(), transport).Configured);
        Assert.False(new PrivateVoiceService(Configuration("female"), transport).Configured);
    }

    [Fact]
    public async Task Failed_voice_never_falls_back_to_another_gender_or_provider()
    {
        var transport = new Transport { Status = HttpStatusCode.ServiceUnavailable };
        await Assert.ThrowsAsync<HttpRequestException>(() =>
            new PrivateVoiceService(Configuration(), transport).Speak("Reply", "ar", "mira", default));
        Assert.Single(transport.Bodies);
    }

    [Fact]
    public async Task Transcription_detects_language_without_forcing_english()
    {
        var transport = new Transport { Reply = """{"text":"ما هو معدلي؟","language":"ar"}""" };
        var result = await new PrivateVoiceService(Configuration(), transport).Transcribe(new byte[2048], default);
        Assert.Equal("ar", result.Language);
        Assert.DoesNotContain("name=language", transport.Bodies[0]);
        Assert.DoesNotContain("name=\"language\"", transport.Bodies[0]);
    }

    [Fact]
    public async Task Unsupported_detected_language_is_not_spoken_using_an_english_voice()
    {
        var transport = new Transport { Reply = """{"text":"bonjour","language":"fr"}""" };
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            new PrivateVoiceService(Configuration(), transport).Transcribe(new byte[2048], default));
    }
}
