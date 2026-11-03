using System.Net;
using System.Reflection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Sanadi.Api.Controllers;
using Sanadi.Api.Diagnostics;
using Sanadi.Api.Middleware;
using Sanadi.Api.Notifications;
using Sanadi.Application.Auth;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Knowledge;
using Sanadi.Infrastructure.Library;
using Sanadi.Infrastructure.Options;

namespace Sanadi.Api.Tests;

public sealed class CancellationHandlingTests
{
    [Fact]
    public async Task Cancelled_embedding_batch_does_not_fall_back_or_start_another_batch()
    {
        using var cancellation = new CancellationTokenSource();
        using var http = new FakeHttp((_, ct) =>
        {
            cancellation.Cancel();
            throw new TaskCanceledException("Stopped", null, ct);
        });
        var service = new KnowledgeEmbeddingsService(http, new Embeddings());
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            service.EmbedTextsAsync(Enumerable.Repeat("document", 65).ToArray(), cancellation.Token));
        Assert.Single(http.Paths);
    }

    [Fact]
    public async Task Already_cancelled_embedding_does_not_load_settings_or_make_a_request()
    {
        var service = new KnowledgeEmbeddingsService(null!, null!);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            service.EmbedQueryAsync("question", new CancellationToken(true)));
    }

    [Fact]
    public async Task Embedding_timeout_preserves_the_existing_optional_fallback()
    {
        using var http = new FakeHttp((_, _) => throw new TaskCanceledException("Provider timeout"));
        var service = new KnowledgeEmbeddingsService(http, new Embeddings());
        Assert.Null(await service.EmbedQueryAsync("question"));
        Assert.Single(http.Paths);
    }

    [Theory]
    [InlineData("before", 0)]
    [InlineData("robots", 1)]
    [InlineData("page", 2)]
    [InlineData("robots-timeout", 2)]
    public async Task Cancelled_crawl_does_not_write_fetch_failures_or_continue_requests(string phase, int calls)
    {
        using var cancellation = new CancellationTokenSource();
        if (phase == "before") cancellation.Cancel();
        using var http = new FakeHttp((request, ct) =>
        {
            if (request.RequestUri!.AbsolutePath == "/robots.txt" && phase != "robots")
            {
                if (phase == "robots-timeout") throw new TaskCanceledException("Robots timeout");
                return new HttpResponseMessage(HttpStatusCode.NotFound);
            }
            cancellation.Cancel();
            throw new TaskCanceledException("Stopped", null, ct);
        });
        var service = new KnowledgeWebCrawlService(http, null!);
        // No database is supplied: cancellation must unwind before any failure/status write.
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.CrawlAndIndexAsync(
            null!, Guid.NewGuid(), "https://knowledge.test/", "Source", null, "same_domain", 1, 10,
            [], [], [], cancellation.Token));
        Assert.Equal(calls, http.Paths.Count);
    }

    [Theory]
    [InlineData("cancel")]
    [InlineData("timeout")]
    [InlineData("ok")]
    public async Task Health_check_distinguishes_caller_cancellation_from_upstream_timeout(string outcome)
    {
        using var cancellation = new CancellationTokenSource();
        using var http = new FakeHttp((_, ct) =>
        {
            if (outcome == "ok") return new HttpResponseMessage(HttpStatusCode.NotFound);
            if (outcome == "cancel") cancellation.Cancel();
            throw new TaskCanceledException("Stopped", null, ct);
        });
        var logger = new CaptureLogger<HealthController>();
        var controller = new HealthController(http, new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["AppServer:UpstreamUrl"] = "https://upstream.test" }).Build(), logger)
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { RequestAborted = cancellation.Token } } };
        if (outcome == "cancel")
        {
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => controller.Get(cancellation.Token));
            Assert.Empty(logger.Errors);
        }
        else if (outcome == "timeout")
        {
            Assert.Equal(503, Assert.IsType<ObjectResult>(await controller.Get(cancellation.Token)).StatusCode);
            Assert.Single(logger.Errors);
        }
        else
        {
            Assert.Equal("All ok with API; App Server up", Assert.IsType<ContentResult>(await controller.Get(cancellation.Token)).Content);
            Assert.Empty(logger.Errors);
        }
    }

    [Theory]
    [InlineData("initiate")]
    [InlineData("callback")]
    [InlineData("restart")]
    [InlineData("redirect")]
    public async Task Cancelled_sso_does_not_restart_or_redirect_as_a_login_failure(string phase)
    {
        using var cancellation = new CancellationTokenSource();
        var sso = new CancelledSso(cancellation, phase);
        var controller = new AuthController(null!, sso, Options.Create(new JwtOptions()), new CaptureLogger<AuthController>())
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { RequestAborted = cancellation.Token } } };
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => phase == "initiate"
            ? controller.InitiateSso(cancellation.Token)
            : controller.SsoCallback("code", "state", null, null, cancellation.Token));
        Assert.Equal(phase == "redirect" ? 1 : 0, sso.Redirects);
        Assert.Equal(phase is "initiate" or "restart" ? 1 : 0, sso.Initiations);
        Assert.Equal(0, controller.Response.Headers.SetCookie.Count);
    }

    [Fact]
    public async Task Sso_diagnostics_pass_cancellation_to_shared_handler_without_error_logging()
    {
        using var cancellation = new CancellationTokenSource();
        var context = new DefaultHttpContext { RequestAborted = cancellation.Token };
        context.Request.Path = "/api/v1/auth/sso/callback";
        context.Response.Body = new MemoryStream();
        var diagnosticsLogger = new CaptureLogger<SsoDiagnosticsMiddleware>();
        var apiLogger = new CaptureLogger<ExceptionHandlingMiddleware>();
        var diagnostics = new SsoDiagnosticsMiddleware(_ =>
        {
            cancellation.Cancel();
            return Task.FromCanceled(cancellation.Token);
        });
        await new ExceptionHandlingMiddleware(c => diagnostics.InvokeAsync(c, diagnosticsLogger), apiLogger).InvokeAsync(context);
        Assert.Empty(diagnosticsLogger.Errors);
        Assert.Empty(apiLogger.Errors);
        Assert.Equal(0, context.Response.Body.Length);
    }

    [Fact]
    public async Task Email_worker_does_not_dispatch_when_already_stopped()
    {
        var scopes = new UnavailableScopes();
        var logger = new CaptureLogger<TicketEmailWorker>();
        using var worker = new TicketEmailWorker(scopes, logger);
        await ExecuteWorker(worker, new CancellationToken(true));
        Assert.Equal(0, scopes.Calls);
        Assert.Empty(logger.Errors);
    }

    [Fact]
    public async Task Email_worker_shutdown_during_timer_wait_completes_normally()
    {
        var scopes = new UnavailableScopes();
        var logger = new CaptureLogger<TicketEmailWorker>();
        using var worker = new TicketEmailWorker(scopes, logger);
        using var cancellation = new CancellationTokenSource();
        var running = ExecuteWorker(worker, cancellation.Token);
        // ExecuteAsync runs synchronously through the first attempt and suspends at the timer.
        Assert.Equal(1, scopes.Calls);
        Assert.False(running.IsCompleted);
        Assert.Equal(LogLevel.Warning, Assert.Single(logger.Errors));
        cancellation.Cancel();
        await running.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.True(running.IsCompletedSuccessfully);
        Assert.Equal(1, scopes.Calls);
    }

    [Fact]
    public async Task Cancelled_best_effort_notifications_do_not_start_database_work()
    {
        var ct = new CancellationToken(true);
        await InAppNotify.PushAsync(null!, "update", Guid.NewGuid(), Guid.NewGuid(), "Update", "/requests", ct: ct);
        await InAppNotify.PushCaseOpenedAsync(null!, Guid.NewGuid(), "TEST", Guid.NewGuid(), null, null, null, ct: ct);
        await InAppNotify.PushCaseAssignedToStudentAsync(null!, Guid.NewGuid(), "TEST", Guid.NewGuid(), Guid.NewGuid(), null, ct: ct);
        await InAppNotify.PushAdminsAsync(null!, "update", Guid.NewGuid(), "TEST", "Update", null, null, "test", ct: ct);
    }

    [Theory]
    [InlineData("cancel")]
    [InlineData("timeout")]
    [InlineData("ok")]
    public async Task Library_cancellation_is_not_reported_as_missing_data_and_timeout_fallback_is_preserved(string outcome)
    {
        using var cancellation = new CancellationTokenSource();
        using var cache = new MemoryCache(new MemoryCacheOptions());
        cache.Set("oclc:token:test-client", "synthetic-token");
        using var http = new FakeHttp((_, ct) =>
        {
            if (outcome == "ok") return new HttpResponseMessage(HttpStatusCode.OK)
            { Content = new StringContent("{\"numberOfRecords\":0,\"briefRecords\":[]}") };
            if (outcome == "cancel") cancellation.Cancel();
            throw new TaskCanceledException("Stopped", null, ct);
        });
        var logger = new CaptureLogger<OclcLibrarySearchService>();
        var service = new OclcLibrarySearchService(null!, http, cache, logger);
        // Exercise the provider boundary with synthetic settings, without a live credential/database lookup.
        var settingsType = typeof(OclcLibrarySearchService).GetNestedType("SettingsRow", BindingFlags.NonPublic)!;
        var settings = Activator.CreateInstance(settingsType)!;
        foreach (var (key, value) in new[] { ("ClientId", "test-client"), ("ClientSecret", "synthetic"),
            ("BaseUrl", "https://catalogue.test"), ("ProviderName", "Test catalogue") })
            settingsType.GetProperty(key)!.SetValue(settings, value);
        var search = (Task<LibrarySearchResultDto>)typeof(OclcLibrarySearchService)
            .GetMethod("SearchOneAsync", BindingFlags.NonPublic | BindingFlags.Instance)!
            .Invoke(service, [settings, "books", 5, DateTime.UtcNow, "test-trace", cancellation.Token])!;
        if (outcome == "cancel")
        {
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => search);
            Assert.Empty(logger.Errors);
        }
        else
        {
            var result = await search;
            Assert.Equal(outcome == "ok" ? "empty" : "unavailable", result.status);
            Assert.Empty(result.results);
            if (outcome == "timeout") { Assert.Contains("timed out", result.error); Assert.Single(logger.Errors); }
            else { Assert.Null(result.error); Assert.Empty(logger.Errors); }
        }
        Assert.Single(http.Paths);
    }

    private static Task ExecuteWorker(TicketEmailWorker worker, CancellationToken ct) =>
        (Task)typeof(TicketEmailWorker).GetMethod("ExecuteAsync", BindingFlags.NonPublic | BindingFlags.Instance)!
            .Invoke(worker, [ct])!;

    private sealed class UnavailableScopes : IServiceScopeFactory
    {
        public int Calls;
        public IServiceScope CreateScope() { Calls++; throw new InvalidOperationException("Dispatcher unavailable"); }
    }

    private sealed class Embeddings : IEmbeddingSettingsProvider
    {
        public Task<EmbeddingSettings?> LoadAsync(CancellationToken ct) =>
            Task.FromResult<EmbeddingSettings?>(new("custom", "embedding", "https://embedding.test/v1", null));
    }

    private sealed class FakeHttp(Func<HttpRequestMessage, CancellationToken, HttpResponseMessage> respond) : HttpMessageHandler, IHttpClientFactory
    {
        public List<string> Paths { get; } = [];
        public HttpClient CreateClient(string name) => new(this, false);
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Paths.Add(request.RequestUri!.AbsolutePath);
            return Task.FromResult(respond(request, ct));
        }
    }

    private sealed class CaptureLogger<T> : ILogger<T>
    {
        public List<LogLevel> Errors { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel level) => true;
        public void Log<TState>(LogLevel level, EventId id, TState state, Exception? error, Func<TState, Exception?, string> format)
        { if (level >= LogLevel.Warning) Errors.Add(level); }
    }

    private sealed class CancelledSso(CancellationTokenSource cancellation, string phase) : ISsoService
    {
        public int Redirects;
        public int Initiations;
        private Task<T> Stop<T>() { cancellation.Cancel(); return Task.FromCanceled<T>(cancellation.Token); }
        public Task<SsoInitiation> InitiateAsync(CancellationToken ct, bool forceLogin = false, string? browserChallenge = null)
        { Initiations++; return Stop<SsoInitiation>(); }
        public Task<SsoCompletion> CompleteAsync(SsoCallbackRequest request, CancellationToken ct) => phase switch
        {
            "restart" => Task.FromException<SsoCompletion>(new SanadiException("Expired", 401, "sso_expired")),
            "redirect" => Task.FromException<SsoCompletion>(new SanadiException("Invalid", 401, "sso_invalid_state")),
            _ => Stop<SsoCompletion>()
        };
        public Task<string> FailureRedirectAsync(string errorCode, CancellationToken ct)
        { Redirects++; return Stop<string>(); }
        public Task<AuthTokens> RedeemSessionAsync(string ticket, CancellationToken ct, string? verifier = null) =>
            throw new NotSupportedException();
    }
}
