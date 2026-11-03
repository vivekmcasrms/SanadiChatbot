using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Sanadi.Api.Middleware;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.Tests;

public sealed class ErrorLoggingTests
{
    [Fact]
    public async Task Unexpected_failure_logs_once_and_keeps_the_existing_safe_response()
    {
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        var error = new InvalidOperationException("Internal diagnostic detail");
        var context = Context();
        await new ExceptionHandlingMiddleware(_ => Task.FromException(error), logger).InvokeAsync(context);

        var entry = Assert.Single(logger.Entries);
        Assert.Equal(LogLevel.Error, entry.Level);
        Assert.Same(error, entry.Exception);
        Assert.Contains(context.TraceIdentifier, entry.Message);
        Assert.Equal(500, context.Response.StatusCode);
        context.Response.Body.Position = 0;
        var json = await JsonDocument.ParseAsync(context.Response.Body);
        Assert.Equal("internal", json.RootElement.GetProperty("code").GetString());
        Assert.Equal("Unexpected server error.", json.RootElement.GetProperty("message").GetString());
        Assert.DoesNotContain(error.Message, json.RootElement.GetRawText());
    }

    [Theory]
    [InlineData(400, 0)]
    [InlineData(401, 0)]
    [InlineData(403, 0)]
    [InlineData(404, 0)]
    [InlineData(409, 0)]
    [InlineData(422, 0)]
    [InlineData(429, 0)]
    [InlineData(500, 1)]
    [InlineData(502, 1)]
    [InlineData(503, 1)]
    public async Task Expected_client_rejections_are_quiet_and_server_errors_are_logged(int status, int logs)
    {
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        var context = Context();
        var error = new SanadiException("Existing response", status, "existing_code");
        await new ExceptionHandlingMiddleware(_ => Task.FromException(error), logger).InvokeAsync(context);
        Assert.Equal(status, context.Response.StatusCode);
        Assert.Equal(logs, logger.Entries.Count);
        Assert.All(logger.Entries, entry => Assert.Equal(LogLevel.Error, entry.Level));
        context.Response.Body.Position = 0;
        var json = await JsonDocument.ParseAsync(context.Response.Body);
        Assert.Equal(error.Message, json.RootElement.GetProperty("message").GetString());
        Assert.Equal(error.Code, json.RootElement.GetProperty("code").GetString());
        foreach (var field in new[] { "msg", "message", "error", "error_description" })
            Assert.Equal(error.Message, json.RootElement.GetProperty(field).GetString());
        Assert.Equal(error.Code, json.RootElement.GetProperty("error_code").GetString());
        Assert.Equal(6, json.RootElement.EnumerateObject().Count());
    }

    [Fact]
    public async Task Successful_request_is_not_logged_or_modified()
    {
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        var context = Context();
        await new ExceptionHandlingMiddleware(c => { c.Response.StatusCode = 204; return Task.CompletedTask; }, logger)
            .InvokeAsync(context);
        Assert.Equal(204, context.Response.StatusCode);
        Assert.Empty(logger.Entries);
    }

    [Theory]
    [InlineData("operation")]
    [InlineData("task")]
    [InlineData("disconnect")]
    public async Task Client_cancellation_and_disconnection_are_silent(string kind)
    {
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        var context = Context();
        using var cancellation = new CancellationTokenSource();
        context.RequestAborted = cancellation.Token;
        var cleanedUp = false;
        var committed = false;
        await new ExceptionHandlingMiddleware(async _ =>
        {
            try
            {
                cancellation.Cancel();
                Exception error = kind switch
                {
                    "disconnect" => new IOException("Disconnected"),
                    "task" => new TaskCanceledException("Stopped", null, cancellation.Token),
                    _ => new OperationCanceledException(cancellation.Token)
                };
                await Task.FromException(error);
                committed = true;
            }
            finally { cleanedUp = true; }
        }, logger).InvokeAsync(context);
        Assert.True(cleanedUp);
        Assert.False(committed);
        Assert.Empty(logger.Entries);
        Assert.Equal(0, context.Response.Body.Length);
    }

    [Fact]
    public async Task Already_cancelled_request_does_not_start_business_work()
    {
        var context = Context();
        context.RequestAborted = new CancellationToken(true);
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        var called = false;
        await new ExceptionHandlingMiddleware(_ => { called = true; return Task.CompletedTask; }, logger).InvokeAsync(context);
        Assert.False(called);
        Assert.Empty(logger.Entries);
        Assert.Equal(0, context.Response.Body.Length);
    }

    [Fact]
    public async Task Genuine_failure_is_logged_even_if_the_client_also_disconnects()
    {
        using var cancellation = new CancellationTokenSource();
        var context = Context();
        context.RequestAborted = cancellation.Token;
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        var error = new InvalidOperationException("Business action failed");
        await new ExceptionHandlingMiddleware(_ =>
        {
            cancellation.Cancel();
            return Task.FromException(error);
        }, logger).InvokeAsync(context);
        Assert.Same(error, Assert.Single(logger.Entries).Exception);
        Assert.Equal(0, context.Response.Body.Length);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Server_side_timeout_is_still_a_real_failure(bool taskCancellation)
    {
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        var context = Context();
        Exception error = taskCancellation ? new TaskCanceledException("Upstream timeout") : new OperationCanceledException("Upstream timeout");
        await new ExceptionHandlingMiddleware(_ => Task.FromException(error), logger)
            .InvokeAsync(context);
        Assert.Single(logger.Entries);
        Assert.Equal(500, context.Response.StatusCode);
    }

    [Fact]
    public async Task Controller_filter_and_middleware_log_the_same_failure_only_once()
    {
        var filterLogger = new CapturingLogger<ApiFunctionErrorLoggingFilter>();
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        var context = Context();
        var error = new InvalidOperationException("Service failed");
        var filter = new ApiFunctionErrorLoggingFilter(filterLogger);
        await new ExceptionHandlingMiddleware(async ctx =>
        {
            await filter.OnExceptionAsync(ExceptionContext(ctx, error));
            throw error;
        }, logger).InvokeAsync(context);
        Assert.Single(filterLogger.Entries);
        Assert.Empty(logger.Entries);
        Assert.Equal(500, context.Response.StatusCode);
    }

    [Fact]
    public async Task Expected_controller_rejection_is_quiet_in_both_handlers()
    {
        var filterLogger = new CapturingLogger<ApiFunctionErrorLoggingFilter>();
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        var context = Context();
        var error = new ForbiddenException("Existing permission rejection");
        await new ExceptionHandlingMiddleware(async ctx =>
        {
            await new ApiFunctionErrorLoggingFilter(filterLogger).OnExceptionAsync(ExceptionContext(ctx, error));
            throw error;
        }, logger).InvokeAsync(context);
        Assert.Empty(filterLogger.Entries);
        Assert.Empty(logger.Entries);
        Assert.Equal(403, context.Response.StatusCode);
    }

    [Fact]
    public async Task Distinct_failures_in_one_request_are_not_hidden_by_deduplication()
    {
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        var context = Context();
        var first = new InvalidOperationException("Optional service failed");
        ApiErrorPolicy.LogOnce(logger, first, context, "OptionalService");
        ApiErrorPolicy.LogOnce(logger, first, context, "OptionalService");
        var second = new IOException("Required service failed");
        await new ExceptionHandlingMiddleware(_ => Task.FromException(second), logger).InvokeAsync(context);
        Assert.Equal(2, logger.Entries.Count);
        Assert.Same(second, logger.Entries[1].Exception);
    }

    [Fact]
    public async Task Failed_required_step_unwinds_cleanup_without_continuing_to_success()
    {
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        var context = Context();
        var committed = false;
        var cleanedUp = false;
        await new ExceptionHandlingMiddleware(async _ =>
        {
            try
            {
                await Task.FromException(new InvalidOperationException("Required write failed"));
                committed = true;
            }
            finally { cleanedUp = true; }
        }, logger).InvokeAsync(context);
        Assert.False(committed);
        Assert.True(cleanedUp);
        Assert.Equal(500, context.Response.StatusCode);
    }

    [Fact]
    public async Task Existing_handled_optional_failure_keeps_its_successful_fallback()
    {
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        var context = Context();
        await new ExceptionHandlingMiddleware(async ctx =>
        {
            try { await Task.FromException(new FormatException("Optional metadata")); }
            catch (FormatException) { }
            ctx.Response.StatusCode = 201;
            await ctx.Response.WriteAsync("existing fallback");
        }, logger).InvokeAsync(context);
        Assert.Equal(201, context.Response.StatusCode);
        Assert.Empty(logger.Entries);
        context.Response.Body.Position = 0;
        Assert.Equal("existing fallback", await new StreamReader(context.Response.Body).ReadToEndAsync());
    }

    [Fact]
    public async Task Started_response_is_aborted_without_rewriting_headers_or_appending_json()
    {
        var context = Context();
        var response = new StartedResponseFeature();
        var lifetime = new LifetimeFeature();
        context.Features.Set<IHttpResponseFeature>(response);
        context.Features.Set<IHttpRequestLifetimeFeature>(lifetime);
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        await new ExceptionHandlingMiddleware(_ => Task.FromException(new IOException("Stream failed")), logger).InvokeAsync(context);
        Assert.True(lifetime.Aborted);
        Assert.Equal(200, response.StatusCode);
        Assert.Equal(0, response.Body.Length);
        Assert.Single(logger.Entries);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Failed_error_response_does_not_escape_or_repeat_the_primary_error(bool expectedRejection)
    {
        var context = Context();
        var lifetime = new LifetimeFeature();
        context.Features.Set<IHttpRequestLifetimeFeature>(lifetime);
        var writeError = new IOException("Cannot write to connection");
        context.Response.Body = new FailingStream(writeError);
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        Exception primary = expectedRejection ? new ForbiddenException() : new InvalidOperationException("Main failure");
        await new ExceptionHandlingMiddleware(_ => Task.FromException(primary), logger).InvokeAsync(context);
        Assert.True(lifetime.Aborted);
        Assert.Same(expectedRejection ? writeError : primary, Assert.Single(logger.Entries).Exception);
    }

    [Fact]
    public async Task Logging_failure_does_not_replace_the_existing_error_response()
    {
        var context = Context();
        await new ExceptionHandlingMiddleware(_ => Task.FromException(new InvalidOperationException("Main failure")), new FailingLogger())
            .InvokeAsync(context);
        Assert.Equal(500, context.Response.StatusCode);
        context.Response.Body.Position = 0;
        using var json = await JsonDocument.ParseAsync(context.Response.Body);
        Assert.Equal("internal", json.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Error_response_removes_stale_download_headers_but_keeps_cors()
    {
        var context = Context();
        context.Response.ContentLength = 1234;
        context.Response.Headers.ContentDisposition = "attachment; filename=letter.pdf";
        context.Response.Headers.ContentEncoding = "gzip";
        context.Response.Headers.AccessControlAllowOrigin = "https://ui.test";
        await new ExceptionHandlingMiddleware(_ => Task.FromException(new InvalidOperationException()), new CapturingLogger<ExceptionHandlingMiddleware>())
            .InvokeAsync(context);
        Assert.NotEqual(1234, context.Response.ContentLength);
        Assert.Equal("application/json; charset=utf-8", context.Response.ContentType);
        Assert.False(context.Response.Headers.ContainsKey("Content-Disposition"));
        Assert.False(context.Response.Headers.ContainsKey("Content-Encoding"));
        Assert.Equal("https://ui.test", context.Response.Headers.AccessControlAllowOrigin);
    }

    [Fact]
    public async Task Proxy_setup_failure_is_caught_by_the_outer_error_boundary()
    {
        var context = Context();
        context.Request.Method = "GET";
        context.Request.Path = "/api/public/test";
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        { ["AppServer:UpstreamUrl"] = "http://[" }).Build();
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        using var client = new HttpClient(new NoNetworkHandler());
        var proxy = new AppServerProxyMiddleware(_ => Task.CompletedTask, config,
            new ClientFactory(client), new CapturingLogger<AppServerProxyMiddleware>());
        await new ExceptionHandlingMiddleware(proxy.InvokeAsync, logger).InvokeAsync(context);
        Assert.Equal(500, context.Response.StatusCode);
        Assert.Single(logger.Entries);
    }

    private static ExceptionContext ExceptionContext(HttpContext context, Exception error) =>
        new(new ActionContext(context, new RouteData(), new ActionDescriptor { DisplayName = "Test action" }), []) { Exception = error };

    private static DefaultHttpContext Context()
    {
        var context = new DefaultHttpContext { TraceIdentifier = "test-trace" };
        context.Response.Body = new MemoryStream();
        return context;
    }

    private sealed class CapturingLogger<T> : ILogger<T>
    {
        public List<(LogLevel Level, Exception? Exception, string Message)> Entries { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel level) => true;
        public void Log<TState>(LogLevel level, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            => Entries.Add((level, exception, formatter(state, exception)));
    }

    private sealed class LifetimeFeature : IHttpRequestLifetimeFeature
    {
        public CancellationToken RequestAborted { get; set; }
        public bool Aborted { get; private set; }
        public void Abort() => Aborted = true;
    }

    private sealed class StartedResponseFeature : IHttpResponseFeature
    {
        public int StatusCode { get => 200; set => throw new InvalidOperationException("Response started"); }
        public string? ReasonPhrase { get; set; }
        public IHeaderDictionary Headers { get; set; } = new HeaderDictionary();
        public Stream Body { get; set; } = new MemoryStream();
        public bool HasStarted => true;
        public void OnStarting(Func<object, Task> callback, object state) { }
        public void OnCompleted(Func<object, Task> callback, object state) { }
    }

    private sealed class FailingStream(Exception error) : MemoryStream
    {
        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
            => ValueTask.FromException(error);
        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
            => Task.FromException(error);
    }

    private sealed class FailingLogger : ILogger<ExceptionHandlingMiddleware>
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel level) => true;
        public void Log<TState>(LogLevel level, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            => throw new IOException("Logging sink unavailable");
    }

    private sealed class ClientFactory(HttpClient client) : IHttpClientFactory
    { public HttpClient CreateClient(string name) => client; }

    private sealed class NoNetworkHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => throw new InvalidOperationException("Network calls are not part of this test");
    }
}
