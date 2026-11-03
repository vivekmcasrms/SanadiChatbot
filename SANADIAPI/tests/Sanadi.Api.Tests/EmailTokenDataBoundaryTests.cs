using Microsoft.Extensions.Caching.Memory;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Data;
using Sanadi.Api.Security;
using Sanadi.Application.Data;

namespace Sanadi.Api.Tests;

public sealed class EmailTokenDataBoundaryTests
{
    [Theory]
    [InlineData("notification_deliveries","POST")]
    [InlineData("notification_deliveries","PATCH")]
    [InlineData("notification_deliveries","DELETE")]
    [InlineData("email_templates","PATCH")]
    [InlineData("notification_settings","PATCH")]
    [InlineData("ApplicationSettings","GET")]
    [InlineData("ApplicationSettings","PATCH")]
    public async Task Browser_users_cannot_forge_deliveries_or_read_or_change_provider_credentials(string table,string method)
    {
        var service=new SqlDataQueryService(null!,null!,null!,null!);
        var user=new CurrentUser{UserId=Guid.NewGuid(),IsAuthenticated=true,Roles=["student"]};
        await Assert.ThrowsAsync<ForbiddenException>(()=>service.ExecuteAsync(new DataQueryRequest{Table=table,Method=method},user,default));
    }
    [Theory]
    [InlineData("sso_email_tokens")]
    [InlineData("SSO_EMAIL_TOKENS")]
    [InlineData("ticket_email_activation")]
    public async Task Email_server_tables_cannot_be_resolved_through_generic_browser_data_API(string table)
    {
        using var cache=new MemoryCache(new MemoryCacheOptions());
        var catalog=new SchemaCatalog(null!,cache);
        // Denied before accessing the connection factory, regardless of the caller's role.
        await Assert.ThrowsAsync<NotFoundException>(()=>catalog.ResolveTableAsync(table,default));
    }
}
