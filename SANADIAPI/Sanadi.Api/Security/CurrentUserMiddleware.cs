using Microsoft.Extensions.Options;
using Sanadi.Domain.Security;
using Sanadi.Infrastructure.Options;

namespace Sanadi.Api.Security;

public sealed class CurrentUserMiddleware(RequestDelegate next, IOptions<ApiKeyOptions> keys)
{
    public const string ItemKey = "SanadiCurrentUser";

    public async Task InvokeAsync(HttpContext context)
    {
        var opts = keys.Value;
        var auth = context.Request.Headers.Authorization.ToString();
        var apiKey = context.Request.Headers["apikey"].ToString();
        var bearer = auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? auth["Bearer ".Length..].Trim() : "";

        if (!string.IsNullOrEmpty(opts.ServiceRoleKey) &&
            (bearer.Equals(opts.ServiceRoleKey, StringComparison.Ordinal) || apiKey.Equals(opts.ServiceRoleKey, StringComparison.Ordinal)))
        {
            context.Items[ItemKey] = CurrentUser.ServiceRole();
            await next(context);
            return;
        }

        if (!string.IsNullOrEmpty(bearer) && context.User.Identity?.IsAuthenticated == true)
        {
            context.Items[ItemKey] = CurrentUser.FromPrincipal(context.User);
            await next(context);
            return;
        }

        context.Items[ItemKey] = CurrentUser.Anonymous();
        await next(context);
    }
}

public static class CurrentUserExtensions
{
    public static ICurrentUser GetSanadiUser(this HttpContext context) =>
        context.Items[CurrentUserMiddleware.ItemKey] as ICurrentUser ?? CurrentUser.Anonymous();
}
