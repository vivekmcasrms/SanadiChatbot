using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.Mail;
using System.Text.Json;
using System.Text.RegularExpressions;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.Notifications;

public sealed class TicketEmailDispatcher(ITicketEmailRepository repository, IUniversityEmailAuthorization tokens,
    ITicketSurveyLinks surveys, IHttpClientFactory clients, IConfiguration configuration)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // Accepted by the university Email API; authentication stays in the bearer header.
    public sealed record EmailRequest(string recipient, string? cc, string? bcc, string subject,
        string bodyEn, string? bodyAr, string? template, string app);

    public async Task<int> RunAsync(CancellationToken ct)
    {
        var settings = await repository.SettingsAsync(configuration.GetValue<bool>("SsoRouting:IsProductionEntry"), ct);
        // Demo mode is respected. Never redirect a student's mail to a hardcoded test address.
        if (settings is null || !settings.Enabled || settings.DemoMode) return 0;
        ValidateSettings(settings);
        await repository.DiscoverAsync(ct);
        var sent = 0;
        for (var i = 0; i < 20 && !ct.IsCancellationRequested; i++)
        {
            var delivery = await repository.ClaimAsync(ct);
            if (delivery is null) break;
            var attempted = false;
            try
            {
                if (!delivery.RecipientCurrent)
                {
                    await repository.CompleteAsync(delivery.Id, "failed", "email_assignment_superseded", ct);
                    continue;
                }
                var item = JsonSerializer.Deserialize<TicketEmailEvent>(delivery.Variables, Json)
                    ?? throw new SanadiException("Invalid email event.", 503, "email_event_invalid");
                if (!MailAddress.TryCreate(delivery.RecipientEmail, out var address) ||
                    !address.Address.Equals(delivery.RecipientEmail?.Trim(), StringComparison.OrdinalIgnoreCase))
                    throw new SanadiException("No valid recipient address.", 503, "email_recipient_invalid");
                if (string.IsNullOrWhiteSpace(delivery.SubjectEn) || string.IsNullOrWhiteSpace(delivery.BodyEn))
                    throw new SanadiException("Email template is disabled or missing.", 503, "email_template_missing");
                var surveyUrl = item.Event == "survey" ? await surveys.CreateAsync(item, settings.AppUrl!, ct) : "";
                var vars = new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["RecipientName"] = delivery.RecipientName ?? "",
                    ["ReferenceNumber"] = item.ReferenceNumber, ["Category"] = item.Category,
                    ["Subject"] = item.Title, ["Status"] = item.Status.Replace('_', ' '),
                    ["Comment"] = item.Comment ?? "", ["Action"] = item.Event,
                    ["TicketUrl"] = AppLink(settings.AppUrl!, item.Kind == "case" ? $"/requests/{item.TicketId}" : "/requests"),
                    ["SurveyUrl"] = surveyUrl
                };
                var request = new EmailRequest(address.Address, settings.Cc, settings.Bcc,
                    Render(delivery.SubjectEn, vars, false), Render(delivery.BodyEn, vars, true),
                    delivery.BodyAr is null ? "" : Render(delivery.BodyAr, vars, true), settings.Template, settings.App!);
                // The gateway issues its own token for the authenticated event actor.
                var access = await tokens.GetAsync(item.ActorId, ct);
                using var message = new HttpRequestMessage(HttpMethod.Post, EmailEndpoint(settings.ApiUrl!))
                { Content = JsonContent.Create(request) };
                message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", access);
                attempted = true;
                using var response = await clients.CreateClient("UniversityEmail").SendAsync(message, ct);
                if (!response.IsSuccessStatusCode)
                {
                    var retry = response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.TooManyRequests;
                    await repository.CompleteAsync(delivery.Id, retry ? "retrying" : (int)response.StatusCode >= 500 ? "uncertain" : "failed",
                        "email_api_" + (int)response.StatusCode, ct);
                    continue;
                }
                // A successful HTTP response means API acceptance, not confirmed inbox delivery.
                var body = await response.Content.ReadAsStringAsync(ct);
                if (ExplicitFailure(body))
                {
                    await repository.CompleteAsync(delivery.Id, "failed", "email_api_rejected", ct);
                    continue;
                }
                await repository.CompleteAsync(delivery.Id, "sent", null, ct);
                sent++;
            }
            catch (SanadiException ex)
            {
                await repository.CompleteAsync(delivery.Id, attempted ? "uncertain" : "retrying", ex.Code, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                // An in-flight send has an unknown outcome and must not be replayed automatically.
                await repository.CompleteAsync(delivery.Id, attempted ? "uncertain" : "retrying", "email_cancelled", CancellationToken.None);
                throw;
            }
            catch
            {
                await repository.CompleteAsync(delivery.Id, attempted ? "uncertain" : "retrying", "email_dispatch_failed", ct);
            }
        }
        return sent;
    }

    public static Uri EmailEndpoint(string configured)
    {
        if (!Uri.TryCreate(configured, UriKind.Absolute, out var uri) || uri.Scheme != "https" ||
            uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0)
            throw new SanadiException("Email API URL is invalid.", 503, "email_configuration_invalid");
        return uri.AbsolutePath.TrimEnd('/').EndsWith("/Common/send-email", StringComparison.OrdinalIgnoreCase)
            ? uri : new Uri(uri.ToString().TrimEnd('/') + "/Common/send-email");
    }
    public static string AppLink(string configured, string path)
    {
        if (!Uri.TryCreate(configured, UriKind.Absolute, out var uri) || (uri.Scheme != "https" && !uri.IsLoopback) ||
            uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0)
            throw new SanadiException("Application URL is invalid.", 503, "email_configuration_invalid");
        return configured.TrimEnd('/') + path;
    }
    public static string Render(string template, IReadOnlyDictionary<string, string> values, bool html)
    {
        var rendered = Regex.Replace(template, @"\{([A-Za-z0-9_]+)\}", m => values.TryGetValue(m.Groups[1].Value, out var value)
            ? html ? WebUtility.HtmlEncode(value) : value.Replace("\r", " ").Replace("\n", " ")
            : throw new SanadiException("Unknown email template placeholder.", 503, "email_template_invalid"));
        return html ? rendered : rendered.Replace("\r", " ").Replace("\n", " ");
    }
    private static bool ExplicitFailure(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return false;
        if (body.Trim().Equals("false", StringComparison.OrdinalIgnoreCase)) return true;
        try
        {
            using var json = JsonDocument.Parse(body);
            if (json.RootElement.ValueKind != JsonValueKind.Object) return false;
            return json.RootElement.EnumerateObject().Any(p =>
                ((p.Name.Equals("success", StringComparison.OrdinalIgnoreCase) || p.Name.Equals("isSuccess", StringComparison.OrdinalIgnoreCase)) && p.Value.ValueKind == JsonValueKind.False)
                || (p.Name.Equals("code", StringComparison.OrdinalIgnoreCase) &&
                    !(int.TryParse(p.Value.ToString(), out var code) && code is >= 200 and < 300)));
        }
        catch (JsonException) { return false; }
    }
    private static void ValidateSettings(TicketEmailSettings settings)
    {
        EmailEndpoint(settings.ApiUrl ?? ""); AppLink(settings.AppUrl ?? "", "/requests");
        if (string.IsNullOrWhiteSpace(settings.App) || string.IsNullOrWhiteSpace(settings.Template))
            throw new SanadiException("Email app or template setting is missing.", 503, "email_configuration_invalid");
    }
}
