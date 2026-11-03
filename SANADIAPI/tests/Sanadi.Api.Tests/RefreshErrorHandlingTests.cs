using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Sanadi.Api.Middleware;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Auth;
using Sanadi.Infrastructure.Options;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Tests;

public sealed class RefreshErrorHandlingTests
{
    private static readonly string RefreshToken = Convert.ToBase64String(new byte[48]);
    [Theory]
    [InlineData(401, "unauthorized")]
    [InlineData(401, "session_expired")]
    [InlineData(403, "forbidden")]
    public async Task Expected_refresh_errors_keep_the_same_ui_response_without_error_logging(int status, string code)
    {
        var error = new SanadiException("Existing authentication error", status, code);
        var logger = new CaptureLogger<SqlAuthService>();
        var boundaryLogger = new CaptureLogger<ExceptionHandlingMiddleware>();
        var context = Context();
        var service = Service(error, logger);

        await new ExceptionHandlingMiddleware(async _ =>
            await service.RefreshAsync(new(RefreshToken), default), boundaryLogger).InvokeAsync(context);

        Assert.Empty(logger.Errors);
        Assert.Empty(boundaryLogger.Errors);
        Assert.Equal(status, context.Response.StatusCode);
        context.Response.Body.Position = 0;
        using var json = await JsonDocument.ParseAsync(context.Response.Body);
        Assert.Equal(code, json.RootElement.GetProperty("code").GetString());
        Assert.Equal(error.Message, json.RootElement.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Unexpected_refresh_failure_is_logged_locally_once_and_does_not_return_tokens()
    {
        var error = new InvalidOperationException("Database unavailable");
        var logger = new CaptureLogger<SqlAuthService>();
        var service = Service(error, logger);

        var actual = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.RefreshAsync(new(RefreshToken), default));

        Assert.Same(error, actual);
        var entry = Assert.Single(logger.Errors);
        Assert.Same(error, entry.Error);
        Assert.Contains(nameof(SqlAuthService.RefreshAsync), entry.Message);
        Assert.DoesNotContain(RefreshToken, entry.Message);
    }

    [Fact]
    public async Task Refresh_failure_reaches_the_ui_without_duplicate_middleware_logging()
    {
        var error = new InvalidOperationException("Private database diagnostic");
        var logger = new CaptureLogger<SqlAuthService>();
        var boundaryLogger = new CaptureLogger<ExceptionHandlingMiddleware>();
        var context = Context();
        var service = Service(error, logger);

        await new ExceptionHandlingMiddleware(async _ =>
            await service.RefreshAsync(new(RefreshToken), default), boundaryLogger).InvokeAsync(context);

        Assert.Single(logger.Errors);
        Assert.Empty(boundaryLogger.Errors);
        Assert.Equal(500, context.Response.StatusCode);
        context.Response.Body.Position = 0;
        using var json = await JsonDocument.ParseAsync(context.Response.Body);
        Assert.Equal("internal", json.RootElement.GetProperty("code").GetString());
        Assert.DoesNotContain(error.Message, json.RootElement.GetRawText());
    }

    [Fact]
    public async Task Cancelled_refresh_stays_quiet_and_does_not_return_tokens()
    {
        var cancellation = new CancellationToken(true);
        var error = new OperationCanceledException(cancellation);
        var logger = new CaptureLogger<SqlAuthService>();
        var service = Service(error, logger);

        var actual = await Assert.ThrowsAsync<OperationCanceledException>(() =>
            service.RefreshAsync(new(RefreshToken), cancellation));

        Assert.Same(error, actual);
        Assert.Empty(logger.Errors);
    }

    [Fact]
    public async Task Logging_failure_does_not_replace_the_refresh_failure()
    {
        var error = new InvalidOperationException("Refresh failed");
        var logger = new CaptureLogger<SqlAuthService> { FailLogging = true };
        var service = Service(error, logger);

        var actual = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.RefreshAsync(new(RefreshToken), default));

        Assert.Same(error, actual);
    }

    private static SqlAuthService Service(Exception error, ILogger<SqlAuthService> logger) =>
        new(new FailingConnections(error), null!, null!, Options.Create(new JwtOptions()), logger);

    private static DefaultHttpContext Context()
    {
        var context = new DefaultHttpContext();
        context.Response.Body = new MemoryStream();
        return context;
    }

    private sealed class FailingConnections(Exception error) : ISqlConnectionFactory
    {
        public SqlConnection Create() => throw error;
    }

    private sealed class CaptureLogger<T> : ILogger<T>
    {
        public bool FailLogging { get; init; }
        public List<(Exception? Error, string Message)> Errors { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel level) => true;
        public void Log<TState>(LogLevel level, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (FailLogging) throw new InvalidOperationException("Logger failed");
            if (level == LogLevel.Error) Errors.Add((exception, formatter(state, exception)));
        }
    }
}
