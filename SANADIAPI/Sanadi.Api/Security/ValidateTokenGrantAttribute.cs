using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Sanadi.Api.Security;

/// <summary>
/// Reject unsupported/ambiguous token grants before MVC reads or binds the body.
/// A grant is a fixed operation name, never a URL or outbound destination.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class ValidateTokenGrantAttribute : Attribute, IResourceFilter
{
    public static bool IsSupported(string? value) => value is "password" or "refresh_token";

    public static BadRequestObjectResult Rejected() => new(new { error = "unsupported_grant_type" });

    public void OnResourceExecuting(ResourceExecutingContext context)
    {
        // ASP.NET decodes the query once. Do not recursively decode, trim, or
        // normalize unsupported values into an allowed operation.
        var grants = context.HttpContext.Request.Query["grant_type"];
        if (grants.Count != 1 || !IsSupported(grants[0])) context.Result = Rejected();
    }

    public void OnResourceExecuted(ResourceExecutedContext context) { }
}
