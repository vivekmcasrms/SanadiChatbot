using System.Diagnostics;
using System.Runtime.CompilerServices;
using Microsoft.Extensions.Logging;

namespace Sanadi.Infrastructure.Diagnostics;

/// <summary>Keep a service failure's diagnostic when it crosses the API error boundary.</summary>
public static class ErrorLogging
{
    private static readonly ConditionalWeakTable<Exception, LogState> Failures = new();

    public static void LogOnce(ILogger logger, Exception error, string function, string? traceId = null)
    {
        var state = Failures.GetValue(error, _ => new LogState());
        lock (state)
        {
            if (state.Attempted) return;
            state.Attempted = true;
            try
            {
                logger.LogError(error, "API function {Function} failed. TraceId={TraceId}",
                    function, traceId ?? Activity.Current?.TraceId.ToString());
            }
            catch
            {
                // Logging must not replace the original failure or change the UI response.
            }
        }
    }

    private sealed class LogState
    {
        public bool Attempted;
    }
}
