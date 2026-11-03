using System.Text.Json;
using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class OllamaChatRequestTests
{
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Request_uses_supplied_database_values_and_authenticated_user_id(bool enableThinking)
    {
        const string url = "https://llm.example.test/v1/chat/completions";
        const string appKey = "database-app-key";
        const string model = "qwen-fast";
        const string prompt = "student prompt";
        const int maxTokens = 731;
        var userId = Guid.NewGuid();

        using var request = OllamaChatRequest.Create(
            url, appKey, userId, model, prompt, maxTokens, enableThinking);

        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal(url, request.RequestUri?.AbsoluteUri);
        Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
        Assert.Equal(appKey, request.Headers.Authorization?.Parameter);
        Assert.Equal(userId.ToString(), request.Headers.GetValues("X-LLM-User-ID").Single());
        Assert.Equal("application/json", request.Content?.Headers.ContentType?.MediaType);

        using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        Assert.Equal(model, body.RootElement.GetProperty("model").GetString());
        Assert.Equal(maxTokens, body.RootElement.GetProperty("max_tokens").GetInt32());
        Assert.Equal(enableThinking, body.RootElement.GetProperty("chat_template_kwargs")
            .GetProperty("enable_thinking").GetBoolean());
        var message = body.RootElement.GetProperty("messages")[0];
        Assert.Equal("user", message.GetProperty("role").GetString());
        Assert.Equal(prompt, message.GetProperty("content").GetString());
    }
}
