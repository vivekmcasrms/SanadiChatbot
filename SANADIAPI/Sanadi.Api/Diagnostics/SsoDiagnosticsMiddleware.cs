using System.Diagnostics;
using Microsoft.Extensions.Logging;
using Sanadi.Api.Middleware;
using Sanadi.Infrastructure.Diagnostics;

namespace Sanadi.Api.Diagnostics;

public sealed class SsoDiagnosticsMiddleware(RequestDelegate next)
{
    public const string FlowHeader = "X-Sanadi-Sso-Flow-Id";
    private static readonly HashSet<string> Paths = new(StringComparer.OrdinalIgnoreCase)
    {
        "/api/v1/auth/sso/authorize", "/api/v1/auth/sso/initiatesso", "/api/v1/auth/sso/callback",
        "/api/v1/auth/sso/session", "/api/v1/auth/sso/trace", "/api/v1/auth/user",
        "/api/v1/auth/token", "/api/v1/auth/logout", "/auth/v1/user", "/auth/v1/token", "/auth/v1/logout"
    };

    public async Task InvokeAsync(HttpContext context, ILogger<SsoDiagnosticsMiddleware> logger)
    {
        var path = context.Request.Path.Value?.TrimEnd('/');
        if (path is null || !Paths.Contains(path)) { await next(context); return; }
        var flowHeader = context.Request.Headers[FlowHeader].ToString();
        var flowId = flowHeader.Length <= 40 && Guid.TryParse(flowHeader, out var parsed) ? parsed.ToString("D") : null;
        var operation = path.ToLowerInvariant().Replace('/', '.').TrimStart('.');
        // Trace posts already contain one bounded event; suppress duplicate request lines for them.
        var isTrace = path.Equals("/api/v1/auth/sso/trace", StringComparison.OrdinalIgnoreCase);
        // Keep diagnostics request-local and route them through the application's
        // normal logging pipeline; do not create/write SSO text files.
        void Write(SsoDiagnosticEvent entry) => logger.LogDebug(
            "SSO diagnostic {Step} outcome={Outcome} operation={Operation} status={StatusCode} flow={FlowId}",
            entry.Step, entry.Outcome, entry.Operation, entry.StatusCode, entry.FlowId);
        using var scope = SsoDiagnostics.BeginRequest(Write, context.TraceIdentifier, flowId);
        var timer = Stopwatch.StartNew();
        if (!isTrace) SsoDiagnostics.Step("HTTP_REQUEST", "begin", operation);
        try { await next(context); }
        catch (Exception ex) when (ApiErrorPolicy.IsClientCancellation(ex, context.RequestAborted)) { throw; }
        catch (Exception ex)
        {
            logger.LogError(ex, "SSO request failed. Operation={Operation} TraceId={TraceId} FlowId={FlowId}",
                operation, context.TraceIdentifier, flowId);
            SsoDiagnostics.Error("HTTP_REQUEST", ex, operation);
            throw;
        }
        finally
        {
            if (!isTrace || context.Response.StatusCode >= 400)
                Write(new SsoDiagnosticEvent(DateTimeOffset.UtcNow, context.TraceIdentifier, flowId,
                    "HTTP_RESPONSE", context.RequestAborted.IsCancellationRequested ? "cancelled" :
                    context.Response.StatusCode >= 400 ? "error" : "ok", operation,
                    context.Response.StatusCode, DurationMs: Math.Round(timer.Elapsed.TotalMilliseconds, 1)));
        }
    }
}
