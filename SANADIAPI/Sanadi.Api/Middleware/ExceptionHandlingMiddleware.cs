using System.Text.Json;
using Sanadi.Domain.Exceptions;
using Microsoft.Data.SqlClient;
using Sanadi.Api.Routing;

namespace Sanadi.Api.Middleware;

public sealed class ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        // Do not start business work for a request the caller has already abandoned.
        if (context.RequestAborted.IsCancellationRequested) return;
        try
        {
            await next(context);
        }
        catch (Exception ex) when (ApiErrorPolicy.IsClientCancellation(ex, context.RequestAborted))
        {
            // The caller has gone away; there is no response to send or failure to log.
        }
        catch (Exception ex)
        {
            Sanadi.Infrastructure.Diagnostics.SsoDiagnostics.Error("HTTP_UNHANDLED", ex);
            ApiErrorPolicy.LogOnce(logger, ex, context, FunctionName(context));
            // Keep the real failure logged, but do not write to a disconnected client.
            if (context.RequestAborted.IsCancellationRequested) return;
            if (context.Response.HasStarted)
            {
                // A partial stream/download cannot be rewritten as a successful JSON response.
                context.Abort();
                return;
            }

            var known = ex switch
            {
                BadHttpRequestException bad => new SanadiException("Invalid request.", bad.StatusCode, "invalid_request"),
                SqlException { Number: TicketAssignment.SqlErrorNumber } => TicketAssignment.Unavailable(),
                _ => ex as SanadiException
            };
            var message = known?.Message ?? "Unexpected server error.";
            var code = known?.Code ?? "internal";
            try
            {
                context.Response.StatusCode = known?.StatusCode ?? StatusCodes.Status500InternalServerError;
                context.Response.ContentLength = null;
                context.Response.Headers.Remove("Content-Disposition");
                context.Response.Headers.Remove("Content-Encoding");
                context.Response.ContentType = "application/json; charset=utf-8";
                // Keep the flat fields and status codes consumed by the existing UI.
                await context.Response.WriteAsync(JsonSerializer.Serialize(new
                {
                    msg = message,
                    message,
                    error = message,
                    error_description = message,
                    code,
                    error_code = code
                }), context.RequestAborted);
            }
            catch (Exception writeError) when (ApiErrorPolicy.IsClientCancellation(writeError, context.RequestAborted))
            {
                // The client disconnected while the error response was being sent.
            }
            catch (Exception writeError)
            {
                // Keep the original failure as the main diagnostic; do not recursively write errors.
                if (!ApiErrorPolicy.HasLoggedFailure(context))
                    ApiErrorPolicy.LogOnce(logger, writeError, context, FunctionName(context));
                context.Abort();
            }
        }
    }

    private static string FunctionName(HttpContext context) =>
        context.GetEndpoint()?.DisplayName ?? $"{context.Request.Method} {context.Request.Path}";
}
