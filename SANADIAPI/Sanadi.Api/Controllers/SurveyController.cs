using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Sanadi.Api.Security;
using Sanadi.Api.Survey;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

[ApiController, Route("api/survey")]
public sealed class SurveyController(ISqlConnectionFactory sql, IConfiguration configuration, SurveyLinkCodec links) : ControllerBase
{
    public sealed record LinkRequest(string? CaseNumber, string? ServiceType);
    private sealed class CaseRow
    {
        public Guid Id { get; init; }
        public Guid StudentId { get; init; }
        public string CaseNumber { get; init; } = "";
    }
    private sealed class SettingRow
    {
        public string ScriptUrl { get; init; } = "";
        public string FullSequenceCode { get; init; } = "";
        public string WebLinkingId { get; init; } = "";
        public string DefaultLang { get; init; } = "en";
    }

    internal static (string ServiceType, string DatabaseType) Types(string? value) => value?.Trim().ToLowerInvariant() switch
    {
        "alert" => ("Alert", "alert"),
        "inquiry" => ("Inquiry", "query"),
        "suggestion" => ("Suggestion", "suggestion"),
        "complaint" => ("Complaint", "complaint"),
        _ => throw new SanadiException("Invalid survey service type.")
    };

    [Authorize, HttpPost("link")]
    public async Task<object> CreateLink([FromBody] LinkRequest request, CancellationToken ct)
    {
        var user = HttpContext.GetSanadiUser();
        if (!user.IsAuthenticated || user.UserId is not Guid userId) throw new UnauthorizedException();
        var (serviceType, databaseType) = Types(request.ServiceType);
        var caseNumber = request.CaseNumber?.Trim();
        if (string.IsNullOrWhiteSpace(caseNumber) || caseNumber.Length > 100)
            throw new SanadiException("Invalid ticket/reference number.");
        await using var db = sql.Create();
        var ticket = await db.QuerySingleOrDefaultAsync<CaseRow>(DbProc.Call("usp_CustomerPulse_GetSurveyCase", new { CaseNumber = caseNumber, CaseType = databaseType }, ct));
        if (ticket is null) throw new NotFoundException("Ticket not found.");
        if (ticket.StudentId != userId) throw new NotFoundException("Ticket not found.");
        var token = links.Create(ticket.CaseNumber, serviceType, DateTimeOffset.UtcNow.AddDays(30));
        var path = "/survey?data=" + Uri.EscapeDataString(token);
        var appUrl = configuration["Documents:PublicAppUrl"]?.TrimEnd('/');
        return new { url = string.IsNullOrWhiteSpace(appUrl) ? path : appUrl + path, path };
    }

    [AllowAnonymous, EnableRateLimiting("survey"), HttpGet("open")]
    public async Task<object> Open([FromQuery] string? data, CancellationToken ct)
    {
        if (!links.TryRead(data, out var caseNumber, out var serviceType))
            throw new NotFoundException("Survey link is invalid or expired.");
        var (settingServiceType, databaseType) = Types(serviceType);
        await using var db = sql.Create();
        var ticket = await db.QuerySingleOrDefaultAsync<CaseRow>(DbProc.Call("usp_CustomerPulse_GetSurveyCase", new { CaseNumber = caseNumber, CaseType = databaseType }, ct));
        if (ticket is null) throw new NotFoundException("Survey link is invalid or expired.");
        var isProduction = configuration.GetValue<bool>("SsoRouting:IsProductionEntry");
        var setting = await db.QuerySingleOrDefaultAsync<SettingRow>(DbProc.Call("usp_CustomerPulse_GetSetting", new { ServiceType = settingServiceType, IsProduction = isProduction }, ct));
        if (setting is null) throw new NotFoundException("Survey is not available for this service.");
        if (string.IsNullOrWhiteSpace(setting.FullSequenceCode) || string.IsNullOrWhiteSpace(setting.WebLinkingId))
            throw new SanadiException("Customer Pulse survey configuration is incomplete.", 503);
        // The page executes this URL. Accept only the trusted script already configured for Customer Pulse.
        var scriptUrl = TrustedScriptUrl(setting.ScriptUrl);
        return new
        {
            caseNumber = ticket.CaseNumber,
            serviceType,
            scriptUrl,
            fullSequenceCode = setting.FullSequenceCode,
            webLinkingId = setting.WebLinkingId,
            language = setting.DefaultLang
        };
    }

    internal static string TrustedScriptUrl(string value)
    {
        var scriptUrl = value.StartsWith("//", StringComparison.Ordinal) ? "https:" + value : value;
        if (!Uri.TryCreate(scriptUrl, UriKind.Absolute, out var script) || script.Scheme != Uri.UriSchemeHttps ||
            !script.Host.Equals("www.uaeu.ac.ae", StringComparison.OrdinalIgnoreCase) ||
            !script.AbsolutePath.Equals("/en/vc/doit/cp2/js/pulse-portal.js", StringComparison.OrdinalIgnoreCase) ||
            script.Query.Length != 0 || script.Fragment.Length != 0)
            throw new SanadiException("Customer Pulse script configuration is invalid.", 503);
        return scriptUrl;
    }
}
