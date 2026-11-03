using System.Net;
using System.Text.Json;
using Sanadi.Infrastructure.Knowledge;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Controllers;
using Sanadi.Api.Security;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.Tests;

public sealed class KnowledgeEmbeddingsTests
{
    [Fact]
    public async Task Api_rejects_untrusted_callers_before_provider_access()
    {
        using var http = new Capture("{}");
        var controller = new KnowledgeEmbeddingsController(new(http, new Settings(null)))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        await Assert.ThrowsAsync<UnauthorizedException>(() => controller.Embed(new(["question"]), default));
        Assert.Null(http.Uri);
    }

    [Fact]
    public async Task Api_bounds_trusted_server_requests()
    {
        using var http = new Capture("{}");
        var context = new DefaultHttpContext();
        context.Items[CurrentUserMiddleware.ItemKey] = CurrentUser.ServiceRole();
        var controller = new KnowledgeEmbeddingsController(new(http, new Settings(null)))
        {
            ControllerContext = new ControllerContext { HttpContext = context }
        };
        await Assert.ThrowsAsync<SanadiException>(() => controller.Embed(new(Enumerable.Repeat("text", 65).ToArray()), default));
        await Assert.ThrowsAsync<SanadiException>(() => controller.Embed(new([new string('x', 8001)]), default));
        Assert.Null(http.Uri);
    }

    [Theory]
    [InlineData("openai", "/v1", "/v1/embeddings")]
    [InlineData("ollama", "/v1/chat/completions", "/v1/embeddings")]
    [InlineData("custom", "/gateway/v1/embeddings", "/gateway/v1/embeddings")]
    [InlineData("azure", "/openai/deployments/chat/chat/completions", "/openai/deployments/embed-model/embeddings")]
    public async Task Uses_database_host_and_embedding_model(string provider, string path, string target)
    {
        using var http = new Capture("{\"data\":[{\"index\":1,\"embedding\":[0.5,0.25]},{\"index\":0,\"embedding\":[0.1,0.2]}]}");
        var service = new KnowledgeEmbeddingsService(http, new Settings(new(provider, "embed-model", "https://configured.test" + path + "?api-version=test", "database-key")));
        var result = await service.EmbedTextsAsync(["first", "second"]);
        Assert.Equal("[0.100000,0.200000]", result[0]);
        Assert.Equal("[0.500000,0.250000]", result[1]);
        Assert.Equal("configured.test", http.Uri!.Host);
        Assert.Equal(target, http.Uri.AbsolutePath);
        Assert.Equal("?api-version=test", http.Uri.Query);
        using var body = JsonDocument.Parse(http.Body!);
        Assert.Equal("embed-model", body.RootElement.GetProperty("model").GetString());
        Assert.Equal("database-key", http.Key);
    }

    [Theory]
    [InlineData("gemini", "/v1beta", "/v1beta/models/embed-model:batchEmbedContents", "{\"embeddings\":[{\"values\":[0.25,0.5]}]}")]
    [InlineData("ollama", "/api/chat", "/api/embed", "{\"embeddings\":[[0.25,0.5]]}")]
    public async Task Supports_provider_specific_formats(string provider, string path, string target, string response)
    {
        using var http = new Capture(response);
        var service = new KnowledgeEmbeddingsService(http, new Settings(new(provider, provider == "gemini" ? "google/embed-model" : "embed-model", "https://configured.test" + path, provider == "gemini" ? "database-key" : null)));
        Assert.Equal("[0.250000,0.500000]", await service.EmbedQueryAsync("question"));
        Assert.Equal(target, http.Uri!.AbsolutePath);
        if (provider == "gemini") Assert.Equal("database-key", http.Key);
    }

    [Theory]
    [InlineData("anthropic", "embed-model", "https://configured.test/v1")]
    [InlineData("openai", "", "https://configured.test/v1")]
    [InlineData("openai", "embed-model", "")]
    public async Task Invalid_configuration_preserves_fallback(string provider, string model, string url)
    {
        using var http = new Capture("{}");
        var service = new KnowledgeEmbeddingsService(http, new Settings(new(provider, model, url, "key")));
        Assert.Null(await service.EmbedQueryAsync("question"));
        Assert.Null(http.Uri);
    }

    [Fact]
    public async Task No_active_row_does_not_call_a_provider()
    {
        using var http = new Capture("{}");
        Assert.Null(await new KnowledgeEmbeddingsService(http, new Settings(null)).EmbedQueryAsync("question"));
        Assert.Null(http.Uri);
    }

    [Theory]
    [InlineData("{\"data\":[{\"index\":0,\"embedding\":[]}]}")]
    [InlineData("{\"data\":[]}")]
    [InlineData("{\"data\":[{\"index\":2,\"embedding\":[0.5]}]}")]
    public async Task Rejects_invalid_vectors(string response)
    {
        using var http = new Capture(response);
        var service = new KnowledgeEmbeddingsService(http, new Settings(new("openai", "embed-model", "https://configured.test/v1", "key")));
        Assert.Null(await service.EmbedQueryAsync("question"));
    }

    private sealed class Settings(EmbeddingSettings? value) : IEmbeddingSettingsProvider
    {
        public Task<EmbeddingSettings?> LoadAsync(CancellationToken ct) => Task.FromResult(value);
    }

    private sealed class Capture(string response) : HttpMessageHandler, IHttpClientFactory
    {
        public Uri? Uri { get; private set; }
        public string? Body { get; private set; }
        public string? Key { get; private set; }
        public HttpClient CreateClient(string name) => new(this, false);
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Uri = request.RequestUri;
            Body = await request.Content!.ReadAsStringAsync(ct);
            Key = request.Headers.Authorization?.Parameter;
            foreach (var header in new[] { "x-goog-api-key", "api-key" })
                if (request.Headers.TryGetValues(header, out var values)) Key = values.Single();
            return new(HttpStatusCode.OK) { Content = new StringContent(response) };
        }
    }
}
