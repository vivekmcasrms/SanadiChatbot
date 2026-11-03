using Dapper;
using Sanadi.Application.Auth;
using Sanadi.Infrastructure.Diagnostics;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Auth;

public sealed class SqlSsoStateStore(ISqlConnectionFactory connections) : ISsoStateStore
{
    public async Task StoreAsync(
        string stateHash,
        string protectedContext,
        DateTimeOffset expiresAt,
        CancellationToken cancellationToken)
    {
        const string step = "SSO_STATE_SQL_STORE";
        SsoDiagnostics.Step(step, "begin", "usp_Sso_CreateState");
        try
        {
            await using var connection = connections.Create();
            SsoDiagnostics.SqlTarget(connection.DataSource, connection.Database);
            await connection.ExecuteAsync(DbProc.Call(
                "usp_Sso_CreateState",
                new { stateHash, protectedContext, expiresAt },
                cancellationToken));
            SsoDiagnostics.Step(step, operation: "usp_Sso_CreateState");
        }
        catch (Exception ex)
        {
            SsoDiagnostics.Error(step, ex, "usp_Sso_CreateState");
            throw;
        }
    }

    public async Task<string?> ConsumeAsync(
        string stateHash,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        const string step = "SSO_STATE_SQL_CONSUME";
        SsoDiagnostics.Step(step, "begin", "usp_Sso_ConsumeState");
        try
        {
            await using var connection = connections.Create();
            SsoDiagnostics.SqlTarget(connection.DataSource, connection.Database);
            var result = await connection.ExecuteScalarAsync<string?>(DbProc.Call(
                "usp_Sso_ConsumeState",
                new { stateHash, now },
                cancellationToken));
            SsoDiagnostics.Step(step, operation: result is null ? "missing_or_used" : result == "sso_expired" ? "expired" : "consumed");
            return result;
        }
        catch (Exception ex)
        {
            SsoDiagnostics.Error(step, ex, "usp_Sso_ConsumeState");
            throw;
        }
    }
}
