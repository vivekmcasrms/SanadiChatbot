namespace Sanadi.Api.Middleware;

/// <summary>Wraps CORS, authentication, controllers and errors without changing their payloads.</summary>
public sealed class ApiSecurityHeadersMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        context.Response.OnStarting(() =>
        {
            var headers = context.Response.Headers;
            headers["X-Content-Type-Options"] = "nosniff";
            // Deprecated browser XSS filters are replaced by CSP. The edge must
            // also remove its injected X-XSS-Protection: 0 header.
            headers.Remove("X-XSS-Protection");
            headers["X-Frame-Options"] = "DENY";
            headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
            headers["Referrer-Policy"] = "no-referrer";
            headers["Permissions-Policy"] = "camera=(), geolocation=(), payment=(), usb=(), microphone=()";
            headers["Cache-Control"] = "no-store";
            headers["Pragma"] = "no-cache";
            if (context.Request.IsHttps)
                headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
            if (context.Response.StatusCode == StatusCodes.Status401Unauthorized &&
                !headers.ContainsKey("WWW-Authenticate"))
                headers.WWWAuthenticate = "Bearer";
            // Include explicit metadata for empty preflight/trace/error responses.
            // Do not override PDF, audio, event-stream or other controller types.
            if (context.Response.StatusCode != StatusCodes.Status101SwitchingProtocols &&
                string.IsNullOrEmpty(context.Response.ContentType))
                context.Response.ContentType = "text/plain; charset=utf-8";
            return Task.CompletedTask;
        });
        await next(context);
    }
}
