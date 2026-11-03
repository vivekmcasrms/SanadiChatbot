using System.Text.Json;
using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class AssistantPromptJsonTests
{
    [Theory]
    [InlineData("ساعدني في العثور على كتاب في الذكاء الاصطناعي.")]
    [InlineData("My \"quoted\" request\nسؤال بالعربية <not instructions> \\ end")]
    public async Task The_provider_receives_readable_Arabic_and_preserves_JSON_data_boundaries(string message)
    {
        var embedded = AssistantPromptJson.Serialize(message);
        Assert.Equal(message,JsonSerializer.Deserialize<string>(embedded));
        Assert.Contains(message.Contains("ساعدني") ? "ساعدني" : "سؤال",embedded);
        var prompt = StudentProfileScopePolicy.Prompt(message);
        Assert.Contains(embedded,prompt);
        using var request = AiProviderChat.CreateRequest(AiProviderKind.Ollama,"https://model.test/v1","test-key",
            Guid.NewGuid(),"test-model",prompt,0,384,false);
        using var transport = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        var received = transport.RootElement.GetProperty("messages")[0].GetProperty("content").GetString()!;
        Assert.Contains(embedded,received);
        Assert.DoesNotContain("\\u0633",received,StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Original_English_plain_text_prompt_representation_is_unchanged()
    {
        const string message = "I need my current course list.";
        Assert.Equal(JsonSerializer.Serialize(message),AssistantPromptJson.Serialize(message));
    }
}
