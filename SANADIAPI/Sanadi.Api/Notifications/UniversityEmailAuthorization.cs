using System.Net.Http.Json;
using System.Net.Mail;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Notifications;

public interface IUniversityEmailAuthorization
{
    Task<string> GetAsync(Guid actorId, CancellationToken ct);
}

public interface IUniversityEmailAuthorizationRepository
{
    Task<UniversityEmailAuthorizationContext?> GetAsync(bool production, Guid actorId, CancellationToken ct);
}

// Deliberately not a record: its generated ToString must not expose credentials.
public sealed class UniversityEmailAuthorizationContext
{
    public string? ApiUrl { get; init; }
    public string? ClientId { get; init; }
    public string? ClientSecret { get; init; }
    public string? AccountEmail { get; init; }
    public string? EmailDomain { get; init; }
}

public sealed class UniversityEmailAuthorizationRepository(ISqlConnectionFactory sql)
    : IUniversityEmailAuthorizationRepository
{
    public async Task<UniversityEmailAuthorizationContext?> GetAsync(bool production, Guid actorId, CancellationToken ct)
    {
        await using var db = sql.Create();
        return await db.QuerySingleOrDefaultAsync<UniversityEmailAuthorizationContext>(DbProc.Call(
            "usp_TicketEmail_GetAuthorization", new { IsProduction = production, ActorId = actorId }, ct));
    }
}

public sealed class UniversityEmailAuthorization(IUniversityEmailAuthorizationRepository repository,
    IHttpClientFactory clients, IConfiguration configuration) : IUniversityEmailAuthorization
{
    public async Task<string> GetAsync(Guid actorId, CancellationToken ct)
    {
        var settings = await repository.GetAsync(configuration.GetValue<bool>("SsoRouting:IsProductionEntry"), actorId, ct);
        if (settings is null) throw Unavailable("email_authorization_account_unavailable");
        if (!Uri.TryCreate(settings.ApiUrl, UriKind.Absolute, out var endpoint) || endpoint.Scheme != "https" ||
            endpoint.UserInfo.Length != 0 || endpoint.Query.Length != 0 || endpoint.Fragment.Length != 0 ||
            string.IsNullOrWhiteSpace(settings.ClientId) || string.IsNullOrWhiteSpace(settings.ClientSecret))
            throw Unavailable("email_authorization_not_configured");
        var account = UserAccount(settings.AccountEmail, settings.EmailDomain);
        // This is the gateway's JSON contract, not OAuth/SSO code exchange or refresh.
        // Request authorization for each send; never reuse a different user's token.
        using var message = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = JsonContent.Create(new
            {
                clientId = settings.ClientId,
                clientSecret = settings.ClientSecret,
                userAccount = account
            })
        };
        using var response = await clients.CreateClient("UniversityEmailAuthorization").SendAsync(message, ct);
        if (!response.IsSuccessStatusCode) throw Unavailable("email_authorization_http_" + (int)response.StatusCode);
        try
        {
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            var root = json.RootElement;
            if (root.ValueKind != JsonValueKind.Object) throw Unavailable("email_authorization_response_invalid");
            string? access = null;
            foreach (var field in new[] { "token", "access_token", "accessToken", "jwt" })
                if (root.TryGetProperty(field, out var value) && value.ValueKind == JsonValueKind.String &&
                    !string.IsNullOrWhiteSpace(value.GetString())) { access = value.GetString(); break; }
            var type = "Bearer";
            foreach (var field in new[] { "tokenType", "token_type" })
                if (root.TryGetProperty(field, out var value) && value.ValueKind != JsonValueKind.Null)
                {
                    if (value.ValueKind != JsonValueKind.String) throw Unavailable("email_authorization_response_invalid");
                    if (!string.IsNullOrWhiteSpace(value.GetString())) type = value.GetString()!;
                    break;
                }
            if (string.IsNullOrEmpty(access) || !Regex.IsMatch(access, @"\A[\x21-\x7E]+\z") ||
                !type.Equals("Bearer", StringComparison.OrdinalIgnoreCase))
                throw Unavailable("email_authorization_response_invalid");
            return access;
        }
        catch (JsonException) { throw Unavailable("email_authorization_response_invalid"); }
    }

    internal static string UserAccount(string? email, string? configuredDomain)
    {
        // HeaderDomain must still be present in settings; account identity comes from the
        // protected auth.users login local-part (university staff and student hosts alike).
        if (string.IsNullOrWhiteSpace(configuredDomain?.Trim().TrimStart('@')))
            throw Unavailable("email_authorization_not_configured");
        if (!MailAddress.TryCreate(email, out var address) ||
            !address.Address.Equals(email?.Trim(), StringComparison.OrdinalIgnoreCase) ||
            !Regex.IsMatch(address.User, @"\A[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?\z") ||
            address.User.Contains("..", StringComparison.Ordinal))
            throw Unavailable("email_authorization_account_invalid");
        return address.User;
    }

    private static SanadiException Unavailable(string code) => new("University email authorization is unavailable.", 503, code);
}
