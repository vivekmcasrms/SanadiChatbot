using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Sanadi.Api.Routing;

/// <summary>
/// Allowlist for <c>object/{bucket}/...</c> so reserved path segments
/// (<c>sign</c>, <c>authenticated</c>) never compete with those routes.
/// A blacklist-only check was not enough on some hosts and left POST
/// <c>/object/sign/...</c> throwing AmbiguousMatchException (HTTP 500).
/// </summary>
public sealed class NotReservedStorageBucketConstraint : IRouteConstraint
{
    private static readonly HashSet<string> AllowedBuckets = new(StringComparer.OrdinalIgnoreCase)
    {
        "case-evidence",
        "knowledge-files",
        "student-letters",
        "student-cvs",
    };

    public bool Match(
        HttpContext? httpContext,
        IRouter? route,
        string routeKey,
        RouteValueDictionary values,
        RouteDirection routeDirection)
    {
        if (!values.TryGetValue(routeKey, out var raw) || raw is null) return false;
        var bucket = Convert.ToString(raw);
        return !string.IsNullOrWhiteSpace(bucket) && AllowedBuckets.Contains(bucket);
    }
}
