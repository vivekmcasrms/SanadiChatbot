using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.Security;

/// <summary>
/// Password login and refresh use local SQL/token services and require no outbound HTTP.
/// Apply an empty destination allowlist to those endpoints, without limiting SSO or chat.
/// </summary>
internal sealed class TokenEndpointEgressGuard(IHttpContextAccessor contexts) : DelegatingHandler
{
    private void Validate(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        // Inspect the current request, never the request that created a pooled handler.
        // Route metadata covers both aliases/casing/trailing slashes, without URL parsing
        // or DNS resolution of any caller-supplied value.
        if (contexts.HttpContext?.GetEndpoint()?.Metadata.GetMetadata<ValidateTokenGrantAttribute>() is not null)
            throw new SanadiException("Outbound HTTP is not permitted for this token operation.",
                StatusCodes.Status503ServiceUnavailable, "auth_egress_denied");
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        Validate(ct);
        return base.SendAsync(request, ct);
    }

    protected override HttpResponseMessage Send(HttpRequestMessage request, CancellationToken ct)
    {
        Validate(ct);
        return base.Send(request, ct);
    }
}

internal static class TokenEndpointEgressRegistration
{
    internal static IServiceCollection AddTokenEndpointEgressGuard(this IServiceCollection services)
    {
        services.AddHttpContextAccessor();
        services.ConfigureHttpClientDefaults(client => client.AddHttpMessageHandler(provider =>
            new TokenEndpointEgressGuard(provider.GetRequiredService<IHttpContextAccessor>())));
        return services;
    }
}
