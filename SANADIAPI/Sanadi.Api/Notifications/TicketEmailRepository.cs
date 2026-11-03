using Dapper;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Notifications;

public sealed record TicketEmailSettings(string? ApiUrl, string? App, string? AppUrl,
    string? Cc, string? Bcc, string? Template, string? ClientId, bool Enabled, bool DemoMode);
public sealed record TicketEmailDelivery(Guid Id, string Variables, Guid RecipientId,
    string? RecipientEmail, string? RecipientName, string? SubjectEn, string? SubjectAr,
    string? BodyEn, string? BodyAr, string TemplateCode, bool RecipientCurrent = true);
public sealed record TicketEmailEvent(Guid TicketId, string Kind, string ReferenceNumber,
    string Category, string Title, string Status, string? Comment, Guid ActorId, string Event, DateTimeOffset OccurredAt);

public interface ITicketEmailRepository
{
    Task<TicketEmailSettings?> SettingsAsync(bool production, CancellationToken ct);
    Task DiscoverAsync(CancellationToken ct);
    Task<TicketEmailDelivery?> ClaimAsync(CancellationToken ct);
    Task CompleteAsync(Guid id, string status, string? code, CancellationToken ct);
}

public sealed class TicketEmailRepository(ISqlConnectionFactory sql) : ITicketEmailRepository
{
    public async Task<TicketEmailSettings?> SettingsAsync(bool production, CancellationToken ct)
    {
        await using var db = sql.Create();
        return await db.QuerySingleOrDefaultAsync<TicketEmailSettings>(DbProc.Call("usp_TicketEmail_GetSettings", new { IsProduction = production }, ct));
    }
    public async Task DiscoverAsync(CancellationToken ct)
    {
        await using var db = sql.Create();
        await db.ExecuteAsync(DbProc.Call("usp_TicketEmail_Discover", null, ct));
    }
    public async Task<TicketEmailDelivery?> ClaimAsync(CancellationToken ct)
    {
        await using var db = sql.Create();
        return await db.QuerySingleOrDefaultAsync<TicketEmailDelivery>(DbProc.Call("usp_TicketEmail_Claim", null, ct));
    }
    public async Task CompleteAsync(Guid id, string status, string? code, CancellationToken ct)
    {
        await using var db = sql.Create();
        await db.ExecuteAsync(DbProc.Call("usp_TicketEmail_Complete", new { Id = id, Status = status, Code = code }, ct));
    }
}
