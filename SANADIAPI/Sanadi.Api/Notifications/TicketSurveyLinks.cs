using Dapper;
using Sanadi.Api.Controllers;
using Sanadi.Api.Survey;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Notifications;

public interface ITicketSurveyLinks
{
    Task<string> CreateAsync(TicketEmailEvent ticket, string appUrl, CancellationToken ct);
}

public sealed class TicketSurveyLinks(ISqlConnectionFactory sql, IConfiguration configuration,
    SurveyLinkCodec codec) : ITicketSurveyLinks
{
    private sealed record Ticket(Guid Id, Guid StudentId, string CaseNumber);
    private sealed class Setting
    {
        public string ScriptUrl { get; init; } = "";
        public string FullSequenceCode { get; init; } = "";
        public string WebLinkingId { get; init; } = "";
    }
    public async Task<string> CreateAsync(TicketEmailEvent ticket, string appUrl, CancellationToken ct)
    {
        var (category, databaseType) = SurveyController.Types(ticket.Category);
        await using var db = sql.Create();
        var row = await db.QuerySingleOrDefaultAsync<Ticket>(DbProc.Call("usp_CustomerPulse_GetSurveyCase",
            new { CaseNumber = ticket.ReferenceNumber, CaseType = databaseType }, ct));
        if (row is null || row.Id != ticket.TicketId) throw new SanadiException("Survey ticket lookup failed.", 503, "survey_ticket_missing");
        var setting = await db.QuerySingleOrDefaultAsync<Setting>(DbProc.Call("usp_CustomerPulse_GetSetting",
            new { ServiceType = category, IsProduction = configuration.GetValue<bool>("SsoRouting:IsProductionEntry") }, ct));
        if (setting is null || string.IsNullOrWhiteSpace(setting.FullSequenceCode) || string.IsNullOrWhiteSpace(setting.WebLinkingId))
            throw new SanadiException("Survey settings are incomplete.", 503, "survey_not_configured");
        SurveyController.TrustedScriptUrl(setting.ScriptUrl);
        var token = codec.Create(row.CaseNumber, category, DateTimeOffset.UtcNow.AddDays(30));
        return TicketEmailDispatcher.AppLink(appUrl, "/survey?data=" + Uri.EscapeDataString(token));
    }
}
