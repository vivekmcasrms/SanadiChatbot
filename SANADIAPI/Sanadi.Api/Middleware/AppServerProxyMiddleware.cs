using System.Net.Http.Headers;

namespace Sanadi.Api.Middleware;

/// <summary>
/// Forwards TanStack Start app-function and chat-stream traffic to the local
/// App Server. The static UI calls the API host (not /_serverFn on itself).
/// </summary>
public sealed class AppServerProxyMiddleware(RequestDelegate next, IConfiguration config, IHttpClientFactory httpClientFactory, ILogger<AppServerProxyMiddleware> logger)
{
    private static readonly HashSet<string> HopByHopHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "Connection",
        "Keep-Alive",
        "Proxy-Authenticate",
        "Proxy-Authorization",
        "TE",
        "Trailers",
        "Transfer-Encoding",
        "Upgrade",
        // Let the App Server send uncompressed responses so the proxy can
        // copy the body cleanly (avoids AbortError / truncated 500s).
        "Accept-Encoding",
    };

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? "";
        if (!ShouldProxy(path))
        {
            await next(context);
            return;
        }

        var upstream = config["AppServer:UpstreamUrl"]?.TrimEnd('/');
        if (string.IsNullOrWhiteSpace(upstream))
        {
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            context.Response.ContentType = "text/plain";
            await context.Response.WriteAsync("App server is not configured.");
            return;
        }

        var target = upstream + context.Request.Path + context.Request.QueryString;
        var client = httpClientFactory.CreateClient("AppServerProxy");

        using var request = new HttpRequestMessage(new HttpMethod(context.Request.Method), target);

        if (HttpMethods.IsPost(context.Request.Method)
            || HttpMethods.IsPut(context.Request.Method)
            || HttpMethods.IsPatch(context.Request.Method))
        {
            request.Content = new StreamContent(context.Request.Body);
            if (context.Request.ContentType is { Length: > 0 } ct)
                request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(ct);
        }

        foreach (var header in context.Request.Headers)
        {
            if (header.Key.Equals("Host", StringComparison.OrdinalIgnoreCase)) continue;
            if (header.Key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase)) continue;
            if (HopByHopHeaders.Contains(header.Key)) continue;
            if (!request.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray())
                && request.Content is not null)
            {
                request.Content.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
            }
        }

        HttpResponseMessage upstreamResponse;
        try
        {
            upstreamResponse = await client.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                context.RequestAborted);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            return;
        }
        catch (Exception ex)
        {
            ApiErrorPolicy.LogOnce(logger, ex, context, $"App server proxy {path}");
            context.Response.StatusCode = StatusCodes.Status502BadGateway;
            context.Response.ContentType = "text/plain";
            await context.Response.WriteAsync(
                "The service is temporarily unavailable. Please try again later.");
            return;
        }

        using (upstreamResponse)
        {
            context.Response.StatusCode = (int)upstreamResponse.StatusCode;
            foreach (var header in upstreamResponse.Headers)
            {
                if (HopByHopHeaders.Contains(header.Key)) continue;
                context.Response.Headers[header.Key] = header.Value.ToArray();
            }
            foreach (var header in upstreamResponse.Content.Headers)
            {
                if (HopByHopHeaders.Contains(header.Key)) continue;
                context.Response.Headers[header.Key] = header.Value.ToArray();
            }
            context.Response.Headers.Remove("transfer-encoding");

            try
            {
                await upstreamResponse.Content.CopyToAsync(context.Response.Body, context.RequestAborted);
            }
            catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
            {
                // Browser or IIS aborted the response — not an App Server fault.
            }
        }
    }

    /// <summary>
    /// Only legacy Node app-server routes. Do not match <c>/api/chat</c> as a
    /// prefix — that steals <c>/api/chats</c> and <c>/api/chat/*</c> from the
    /// native C# <c>ChatController</c> / <c>AssistantController</c> (502 when
    /// the Node process on :8787 is not running).
    /// </summary>
    private static bool ShouldProxy(string path) =>
        path.StartsWith("/_serverFn", StringComparison.OrdinalIgnoreCase)
        || path.StartsWith("/api/public/", StringComparison.OrdinalIgnoreCase)
        || path.Equals("/api/public", StringComparison.OrdinalIgnoreCase);
}
