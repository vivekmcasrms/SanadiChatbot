using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Sanadi.Api.Middleware;

/// <summary>
/// Records unexpected controller-action failures once. The shared middleware
/// converts the exception to the existing UI response after the action unwinds.
/// </summary>
public sealed class ApiFunctionErrorLoggingFilter(ILogger<ApiFunctionErrorLoggingFilter> logger) : IAsyncExceptionFilter
{
    public const string LoggedItemKey = "sanadi-api-function-error-logged";

    public Task OnExceptionAsync(ExceptionContext context)
    {
        if (context.ExceptionHandled) return Task.CompletedTask;
        var action = context.ActionDescriptor.DisplayName ?? context.HttpContext.Request.Path.Value ?? "unknown";
        ApiErrorPolicy.LogOnce(logger, context.Exception, context.HttpContext, Describe(context.Exception, action));
        return Task.CompletedTask;
    }

    public static string Describe(Exception ex, string fallback)
    {
        var named = Regex.Match(ex.ToString(), @"<([A-Za-z_][A-Za-z0-9_]*)>");
        return named.Success ? named.Groups[1].Value : fallback;
    }
}
