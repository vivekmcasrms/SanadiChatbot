using System.Text.Json;
using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class AiProviderChatTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(0.2)]
    public async Task Ollama_honours_the_requested_temperature(decimal temperature)
    {
        using var request = AiProviderChat.CreateRequest(AiProviderKind.Ollama,"https://model.test/v1","test-key",
            Guid.NewGuid(),"test-model","route this request",temperature,384,false);
        using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        Assert.Equal(temperature,body.RootElement.GetProperty("temperature").GetDecimal());
    }

    [Theory]
    [InlineData("openai", "OpenAiCompatible")]
    [InlineData("custom", "OpenAiCompatible")]
    [InlineData("azure_openai", "AzureOpenAi")]
    [InlineData("gemini", "Gemini")]
    [InlineData("anthropic", "Anthropic")]
    [InlineData("ollama", "Ollama")]
    public void Resolve_selects_the_adapter_named_by_the_enabled_database_row(
        string provider, string expected)
        => Assert.Equal(Enum.Parse<AiProviderKind>(expected), AiProviderChat.Resolve(provider));

    [Fact]
    public void Resolve_does_not_default_an_unknown_provider_to_another_adapter()
        => Assert.Null(AiProviderChat.Resolve("unknown-provider"));

    [Theory]
    [InlineData("OpenAiCompatible", "https://openai.test/v1/chat/completions", "Authorization")]
    [InlineData("AzureOpenAi", "https://azure.test/openai/chat/completions", "api-key")]
    [InlineData("Gemini", "https://gemini.test/v1/models/test-model:generateContent", "x-goog-api-key")]
    [InlineData("Anthropic", "https://anthropic.test/v1/messages", "x-api-key")]
    public async Task CreateRequest_uses_each_provider_specific_protocol(
        string providerName, string expectedUrl, string expectedAuthenticationHeader)
    {
        var provider = Enum.Parse<AiProviderKind>(providerName);
        var baseUrl = provider switch
        {
            AiProviderKind.OpenAiCompatible => "https://openai.test/v1",
            AiProviderKind.AzureOpenAi => "https://azure.test/openai",
            AiProviderKind.Gemini => "https://gemini.test/v1",
            AiProviderKind.Anthropic => "https://anthropic.test/v1",
            _ => throw new InvalidOperationException()
        };

        using var request = AiProviderChat.CreateRequest(
            provider, baseUrl, "database-key", Guid.NewGuid(), "test-model", "student prompt",
            0.2m, 425, null);

        Assert.Equal(expectedUrl, request.RequestUri?.AbsoluteUri);
        Assert.True(request.Headers.Contains(expectedAuthenticationHeader));
        using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        if (provider == AiProviderKind.Gemini)
        {
            Assert.Equal("student prompt", body.RootElement.GetProperty("contents")[0]
                .GetProperty("parts")[0].GetProperty("text").GetString());
            Assert.Equal(425, body.RootElement.GetProperty("generationConfig")
                .GetProperty("maxOutputTokens").GetInt32());
        }
        else
        {
            Assert.Equal("test-model", body.RootElement.GetProperty("model").GetString());
            Assert.Equal("user", body.RootElement.GetProperty("messages")[0].GetProperty("role").GetString());
            Assert.Equal("student prompt", body.RootElement.GetProperty("messages")[0].GetProperty("content").GetString());
        }
    }

    [Theory]
    [InlineData("OpenAiCompatible", "{\"choices\":[{\"message\":{\"content\":\"OpenAI reply\"}}]}", "OpenAI reply")]
    [InlineData("AzureOpenAi", "{\"choices\":[{\"message\":{\"content\":\"Azure reply\"}}]}", "Azure reply")]
    [InlineData("Gemini", "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Gemini reply\"}]}}]}", "Gemini reply")]
    [InlineData("Anthropic", "{\"content\":[{\"type\":\"text\",\"text\":\"Anthropic reply\"}]}", "Anthropic reply")]
    [InlineData("Ollama", "{\"choices\":[{\"message\":{\"content\":\"Ollama reply\"}}]}", "Ollama reply")]
    public void ReadText_handles_each_provider_response(
        string providerName, string json, string expected)
    {
        var provider = Enum.Parse<AiProviderKind>(providerName);
        using var document = JsonDocument.Parse(json);
        Assert.Equal(expected, AiProviderChat.ReadText(provider, document.RootElement));
    }

    [Fact]
    public void Azure_preserves_database_query_parameters_when_adding_the_provider_path()
    {
        using var request = AiProviderChat.CreateRequest(
            AiProviderKind.AzureOpenAi,
            "https://azure.test/openai?api-version=database-version",
            "database-key",
            Guid.NewGuid(),
            "database-model",
            "student prompt",
            0.2m,
            425,
            null);

        Assert.Equal(
            "https://azure.test/openai/chat/completions?api-version=database-version",
            request.RequestUri?.AbsoluteUri);
    }
}
