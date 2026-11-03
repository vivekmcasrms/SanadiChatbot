using Dapper;
using Sanadi.Application.Auth;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Auth;

public sealed class SqlSsoEmailTokenStore(ISqlConnectionFactory sql) : ISsoEmailTokenStore
{
    public async Task StoreAsync(Guid userId, Guid sessionId, string protectedTokens, CancellationToken ct)
    {
        await using var db = sql.Create();
        if (!await db.ExecuteScalarAsync<bool>(DbProc.Call("usp_SsoEmail_Store",
            new { userId, sessionId, protectedTokens }, ct))) throw new UnauthorizedException();
    }
    public async Task<SsoEmailTokenLease?> AcquireAsync(Guid userId, CancellationToken ct)
    {
        await using var db = sql.Create();
        return await db.QuerySingleOrDefaultAsync<SsoEmailTokenLease>(DbProc.Call("usp_SsoEmail_Acquire",
            new { userId, leaseId = Guid.NewGuid() }, ct));
    }
    public async Task SaveAsync(Guid userId, Guid sessionId, Guid leaseId, string protectedTokens, CancellationToken ct)
    {
        await using var db = sql.Create();
        if (!await db.ExecuteScalarAsync<bool>(DbProc.Call("usp_SsoEmail_Save",
            new { userId, sessionId, leaseId, protectedTokens }, ct))) throw new UnauthorizedException();
    }
    public async Task ReleaseAsync(Guid userId, Guid sessionId, Guid leaseId, CancellationToken ct)
    {
        await using var db = sql.Create();
        await db.ExecuteAsync(DbProc.Call("usp_SsoEmail_Release", new { userId, sessionId, leaseId }, ct));
    }
}
