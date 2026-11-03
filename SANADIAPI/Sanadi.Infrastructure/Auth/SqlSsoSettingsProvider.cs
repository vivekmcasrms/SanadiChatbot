using Dapper;
using Microsoft.Extensions.Configuration;
using Sanadi.Application.Auth;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Diagnostics;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Auth;

public sealed class SqlSsoSettingsProvider(
    ISqlConnectionFactory connections,
    IConfiguration configuration) : ISsoSettingsProvider
{
    public async Task<SsoSettings> GetAsync(CancellationToken cancellationToken)
    {
        const string step = "SSO_SETTINGS_READ";
        SsoDiagnostics.Step(step, "begin", "usp_Sso_GetSettings");
        try
        {
            await using var connection = connections.Create();
            SsoDiagnostics.SqlTarget(connection.DataSource, connection.Database);
            var isProductionEntry = configuration.GetValue("SsoRouting:IsProductionEntry", true);
            SsoDiagnostics.Step("SSO_SETTINGS_ROUTE", operation: isProductionEntry ? "production" : "staging");
            var row = await connection.QuerySingleOrDefaultAsync<SettingsRow>(
                DbProc.Call("usp_Sso_GetSettings", new { IsProductionEntry = isProductionEntry }, cancellationToken));

            if (row is null)
                throw new SanadiException("SSO is not configured.", 503, "sso_not_configured");

            SsoDiagnostics.Step(step, operation: "usp_Sso_GetSettings");
            return new SsoSettings(
                row.SsoIsEnabled,
                row.SsoClientId ?? "",
                row.SsoClientSecret ?? "",
                row.SsoAuthorizationEndpoint ?? "",
                row.SsoTokenEndpoint ?? "",
                row.SsoUserInfoEndpoint,
                row.SsoIntrospectEndpoint,
                row.SsoRedirectUri?.Trim() ?? "",
                row.SsoScope ?? "openid profile",
                row.SsoUiOrigin?.Trim() ?? "",
                row.HeaderDomain);
        }
        catch (Exception ex)
        {
            SsoDiagnostics.Error(step, ex, "usp_Sso_GetSettings");
            throw;
        }
    }

    private sealed record SettingsRow(
        bool SsoIsEnabled,
        string? SsoClientId,
        string? SsoClientSecret,
        string? SsoAuthorizationEndpoint,
        string? SsoTokenEndpoint,
        string? SsoUserInfoEndpoint,
        string? SsoIntrospectEndpoint,
        string? SsoRedirectUri,
        string? SsoScope,
        string? SsoUiOrigin,
        string? HeaderDomain);
}
