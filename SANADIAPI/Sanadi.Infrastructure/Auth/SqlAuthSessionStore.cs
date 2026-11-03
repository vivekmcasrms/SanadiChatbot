using System.Security.Cryptography;
using System.Text;
using Dapper;
using Sanadi.Infrastructure.Diagnostics;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Auth;

public sealed class SqlAuthSessionStore(ISqlConnectionFactory connections)
{
    // Called only after signature/lifetime validation. No positive cache: logout
    // must take effect immediately across API instances and browser tabs.
    public async Task<bool> IsActiveAsync(string token, Guid? sessionId, CancellationToken ct)
    {
        const string step = "AUTH_SESSION_ACTIVE_CHECK";
        SsoDiagnostics.Step(step, "begin", "usp_AuthIsSessionActive");
        try
        {
            await using var connection = connections.Create();
            SsoDiagnostics.SqlTarget(connection.DataSource, connection.Database);
            var active = await connection.ExecuteScalarAsync<bool>(DbProc.Call("usp_AuthIsSessionActive", new
            {
                sessionId, accessHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)))
            }, ct));
            SsoDiagnostics.Step(step, active ? "ok" : "rejected", "usp_AuthIsSessionActive");
            return active;
        }
        catch (Exception ex)
        {
            SsoDiagnostics.Error(step, ex, "usp_AuthIsSessionActive");
            throw;
        }
    }
}
