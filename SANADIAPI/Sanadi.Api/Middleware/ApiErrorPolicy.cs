using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Diagnostics;

namespace Sanadi.Api.Middleware;

/// <summary>Quiet expected rejections; record each unexpected request failure once.</summary>
internal static class ApiErrorPolicy
{
    internal static bool IsClientCancellation(Exception error, CancellationToken requestAborted) =>
        requestAborted.IsCancellationRequested && error is OperationCanceledException or IOException;

    internal static bool ShouldLog(Exception error, CancellationToken requestAborted) =>
        !IsClientCancellation(error, requestAborted)
        && error is not BadHttpRequestException { StatusCode: >= 400 and < 500 }
        && error is not SanadiException { StatusCode: >= 400 and < 500 };

    internal static bool HasLoggedFailure(HttpContext context) =>
        context.Items.TryGetValue(ApiFunctionErrorLoggingFilter.LoggedItemKey, out var logged)
        && logged is HashSet<Exception> { Count: > 0 };

    internal static void LogOnce(ILogger logger, Exception error, HttpContext context, string function, string? traceId = null)
    {
        if (!ShouldLog(error, context.RequestAborted)) return;
        if (!context.Items.TryGetValue(ApiFunctionErrorLoggingFilter.LoggedItemKey, out var value)
            || value is not HashSet<Exception> logged)
        {
            logged = new HashSet<Exception>(ReferenceEqualityComparer.Instance);
            context.Items[ApiFunctionErrorLoggingFilter.LoggedItemKey] = logged;
        }
        if (!logged.Add(error)) return;
        ErrorLogging.LogOnce(logger, error, function, traceId ?? context.TraceIdentifier);
    }
}
