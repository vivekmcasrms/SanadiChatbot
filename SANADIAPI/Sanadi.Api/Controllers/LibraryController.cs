using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Application.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Library;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

/// <summary>
/// Student library catalogue search. Credentials come from library_provider_settings;
/// OCLC is called from SanadiAPI (not the Node App Server).
/// </summary>
[ApiController]
[Route("api/library")]
public sealed class LibraryController(OclcLibrarySearchService search, ISqlConnectionFactory sql, IPermissionService permissions) : ControllerBase
{
    private static readonly JsonSerializerOptions CamelJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.Never,
    };

    public sealed class SearchBody
    {
        public string? query { get; set; }
        public int? limit { get; set; }
        public string? lang { get; set; }
    }

    public sealed class IntegrationBody
    {
        public string providerName { get; set; } = "UAEU Library Catalogue";
        public string? baseUrl { get; set; }
        public string authMethod { get; set; } = "header_api_key";
        public string authHeaderName { get; set; } = "X-API-Key";
        public string? authQueryParam { get; set; }
        public string? searchPath { get; set; }
        public string? itemPath { get; set; }
        public string? catalogueUrlTemplate { get; set; }
        public int timeoutMs { get; set; } = 6000;
        public int maxRetries { get; set; } = 1;
        public bool enabled { get; set; }
    }

    [HttpGet("integration")]
    public async Task<IActionResult> Integration(CancellationToken ct)
    {
        await RequireLibraryAdmin(ct); await using var conn = sql.Create();
        var row = await conn.QuerySingleOrDefaultAsync(DbProc.Call("usp_Library_GetIntegration", null, ct));
        return new JsonResult(row, CamelJson);
    }

    [HttpPut("integration")]
    public async Task<object> UpdateIntegration([FromBody] IntegrationBody body, CancellationToken ct)
    {
        await RequireLibraryAdmin(ct);
        if (body.providerName.Trim().Length is < 2 or > 120 || body.timeoutMs is < 1000 or > 20000 || body.maxRetries is < 0 or > 3) throw new SanadiException("Invalid library integration settings.");
        var methods = new[] { "header_api_key", "query_api_key", "bearer", "basic_client_credentials", "client_id_secret_headers" };
        if (!methods.Contains(body.authMethod)) throw new SanadiException("Invalid authentication method.");
        await using var conn = sql.Create();
        await conn.ExecuteAsync(DbProc.Call("usp_Library_UpdateIntegration", body, ct));
        return new { saved = true };
    }

    [HttpPost("integration/test")]
    public async Task<object> TestIntegration(CancellationToken ct)
    {
        await RequireLibraryAdmin(ct); var result = await search.SearchAsync(new("machine learning", 3, "en"), ct);
        return new { ok = result.status is "ok" or "empty", sampleCount = result.results.Count, latencyMs = result.latencyMs, error = result.error };
    }

    [HttpGet("oclc/diagnostics")]
    public async Task<object> Diagnostics(CancellationToken ct)
    {
        await RequireLibraryAdmin(ct); var result = await search.SearchAsync(new("machine learning", 1, "en"), ct);
        var status = result.status is "ok" or "empty" ? "healthy" : result.status == "disabled" ? "not_configured" : "failed";
        return new { institutionId = (string?)null, scopes = "wcapi", tokenCached = false, tokenExpiresAt = (string?)null,
            services = new[] { new { key = "worldcat_search", label = "WorldCat Search API", status, detail = result.error } },
            health = Array.Empty<object>() };
    }

    [HttpPost("oclc/test-search")]
    public async Task<object> TestSearch([FromBody] SearchBody body, CancellationToken ct)
    {
        await RequireLibraryAdmin(ct); var result = await search.SearchAsync(new(body.query, 5, "en"), ct);
        return new { result.status, result.latencyMs, resultsReturned = result.results.Count,
            localHoldings = result.results.Count(x => x.heldByInstitution == true), availabilityResolved = result.results.Count(x => x.availability != "unknown"),
            electronicAccess = result.results.Count(x => x.isElectronic == true), result.error,
            sample = result.results.Take(5).Select(x => new { x.title, x.year, x.type, scope = x.heldByInstitution == true ? "UAEU" : "WorldCat" }) };
    }

    private async Task RequireLibraryAdmin(CancellationToken ct)
    {
        var user = HttpContext.GetSanadiUser(); if (!user.IsAuthenticated || user.UserId is not Guid id) throw new UnauthorizedException();
        foreach (var role in new[] { "system_admin", "integration_admin", "knowledge_manager", "service_manager" })
            if (await permissions.HasRoleAsync(id, role, ct)) return;
        throw new ForbiddenException();
    }

    [HttpGet("overview")]
    public async Task<IActionResult> Overview(CancellationToken cancellationToken)
    {
        var user = HttpContext.GetSanadiUser();
        if (!user.IsAuthenticated) throw new UnauthorizedException();

        await using var conn = sql.Create();
        await conn.OpenAsync(cancellationToken);

        var locations = (await conn.QueryAsync<LibraryLocationRow>(DbProc.Call("usp_Library_ListLocations", null, cancellationToken))).ToList();

        if (locations.Count == 0)
            return new JsonResult(new { branches = Array.Empty<object>(), services = Array.Empty<object>() }, CamelJson);

        var ids = locations.Select(l => l.Id).ToArray();
        var hours = (await conn.QueryAsync<LibraryHoursRow>(DbProc.Call("usp_Library_ListHours", new { Ids = DbProc.Csv(ids) }, cancellationToken))).ToList();

        var exceptions = (await conn.QueryAsync<LibraryExceptionRow>(DbProc.Call("usp_Library_ListExceptions",
            new
            {
                Ids = DbProc.Csv(ids),
                FromDate = DateTime.UtcNow.Date.AddDays(-1),
                ToDate = DateTime.UtcNow.Date.AddDays(8),
            }, cancellationToken))).ToList();

        var services = (await conn.QueryAsync<LibraryServiceRow>(DbProc.Call("usp_Library_ListServices", null, cancellationToken))).ToList();

        var timeZone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Dubai");
        var nowLocal = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, timeZone);
        var branches = BuildBranches(locations, hours, exceptions, nowLocal);

        var overview = new { branches, services = services.Select(s => new { key = s.ServiceKey, nameEn = s.NameEn, nameAr = s.NameAr, descriptionEn = s.DescriptionEn, descriptionAr = s.DescriptionAr, eligibilityEn = s.EligibilityEn, eligibilityAr = s.EligibilityAr, instructionsEn = s.InstructionsEn, instructionsAr = s.InstructionsAr, availabilityEn = s.AvailabilityEn, availabilityAr = s.AvailabilityAr, category = s.Category, url = s.Url, contact = s.Contact }).ToArray() };
        return new JsonResult(overview, CamelJson);
    }

    internal static object[] BuildBranches(
        IReadOnlyList<LibraryLocationRow> locations,
        IReadOnlyList<LibraryHoursRow> hours,
        IReadOnlyList<LibraryExceptionRow> exceptions,
        DateTimeOffset nowLocal)
    {
        var nowDate = nowLocal.ToString("yyyy-MM-dd");
        var nowMinutes = nowLocal.Hour * 60 + nowLocal.Minute;
        var dayOfWeek = ((int)nowLocal.DayOfWeek + 6) % 7;

        return locations.Select(location =>
        {
            var week = Enumerable.Range(0, 7).Select(day =>
            {
                var row = hours.FirstOrDefault(h => h.LibraryLocationId == location.Id && h.DayOfWeek == day);
                return new
                {
                    dayOfWeek = day,
                    closed = row?.Closed ?? true,
                    opensAt = FormatTime(row?.OpensAt),
                    closesAt = FormatTime(row?.ClosesAt),
                };
            }).ToArray();

            var todayException = exceptions.FirstOrDefault(e => e.LibraryLocationId == location.Id && e.ExceptionDate.Date == nowLocal.Date);
            var baseToday = week[dayOfWeek];
            var today = todayException is null
                ? baseToday
                : new { dayOfWeek = dayOfWeek, closed = todayException.Closed, opensAt = FormatTime(todayException.OpensAt), closesAt = FormatTime(todayException.ClosesAt) };

            var opensMin = ToMinutes(today.opensAt);
            var closesMin = ToMinutes(today.closesAt);
            var isOpenNow = !today.closed && opensMin is not null && closesMin is not null && nowMinutes >= opensMin && nowMinutes < closesMin;

            var nextOpenDay = (int?)null;
            var nextOpenAt = (string?)null;
            if (!isOpenNow)
            {
                for (var step = 0; step < 8; step++)
                {
                    var candidateDay = (dayOfWeek + step) % 7;
                    var candidateDate = nowLocal.Date.AddDays(step);
                    var exc = exceptions.FirstOrDefault(e => e.LibraryLocationId == location.Id && e.ExceptionDate.Date == candidateDate);
                    var candidate = exc is null
                        ? week[candidateDay]
                        : new { dayOfWeek = candidateDay, closed = exc.Closed, opensAt = FormatTime(exc.OpensAt), closesAt = FormatTime(exc.ClosesAt) };
                    if (candidate.closed || string.IsNullOrWhiteSpace(candidate.opensAt)) continue;
                    if (step == 0 && ToMinutes(candidate.opensAt) <= nowMinutes) continue;
                    nextOpenDay = candidateDay;
                    nextOpenAt = candidate.opensAt;
                    break;
                }
            }

            return new
            {
                location = new
                {
                    id = location.Id,
                    code = location.Code,
                    nameEn = location.NameEn,
                    nameAr = location.NameAr,
                    campusEn = location.CampusEn,
                    campusAr = location.CampusAr,
                    buildingEn = location.BuildingEn,
                    buildingAr = location.BuildingAr,
                    contactEmail = location.ContactEmail,
                    contactPhone = location.ContactPhone,
                    mapUrl = location.MapUrl,
                },
                timezone = location.Timezone ?? "Asia/Dubai",
                localDate = nowDate,
                localTime = nowLocal.ToString("HH:mm", System.Globalization.CultureInfo.InvariantCulture),
                dayOfWeek,
                isOpenNow,
                todayOpensAt = today.closed ? null : today.opensAt,
                todayClosesAt = today.closed ? null : today.closesAt,
                closesInMinutes = isOpenNow && closesMin is not null ? closesMin - nowMinutes : null,
                exceptionReasonEn = todayException?.ReasonEn,
                exceptionReasonAr = todayException?.ReasonAr,
                nextOpenDay,
                nextOpenAt,
                week,
            };
        }).ToArray();

    }

    [HttpPost("search")]
    public async Task<IActionResult> Search([FromBody] SearchBody body, CancellationToken cancellationToken)
    {
        var user = HttpContext.GetSanadiUser();
        if (!user.IsAuthenticated) throw new UnauthorizedException();

        var result = await search.SearchAsync(
            new LibrarySearchRequest(body.query, body.limit ?? 15, body.lang ?? "en"),
            cancellationToken);

        return new JsonResult(result, CamelJson);
    }

    internal static string? FormatTime(TimeSpan? value) =>
        value?.ToString(@"hh\:mm", System.Globalization.CultureInfo.InvariantCulture);

    private static int? ToMinutes(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null :
        value.Split(':') is var pieces && pieces.Length == 2 && int.TryParse(pieces[0], out var h) && int.TryParse(pieces[1], out var m)
            ? h * 60 + m
            : null;

    internal sealed class LibraryLocationRow
    {
        public Guid Id { get; init; }
        public required string Code { get; init; }
        public string? NameEn { get; init; }
        public string? NameAr { get; init; }
        public string? CampusEn { get; init; }
        public string? CampusAr { get; init; }
        public string? BuildingEn { get; init; }
        public string? BuildingAr { get; init; }
        public string? ContactEmail { get; init; }
        public string? ContactPhone { get; init; }
        public string? MapUrl { get; init; }
        public string? Timezone { get; init; }
    }

    internal sealed class LibraryHoursRow
    {
        public Guid LibraryLocationId { get; init; }
        public int DayOfWeek { get; init; }
        public TimeSpan? OpensAt { get; init; }
        public TimeSpan? ClosesAt { get; init; }
        public bool Closed { get; init; }
    }

    internal sealed class LibraryExceptionRow
    {
        public Guid LibraryLocationId { get; init; }
        public DateTime ExceptionDate { get; init; }
        public TimeSpan? OpensAt { get; init; }
        public TimeSpan? ClosesAt { get; init; }
        public bool Closed { get; init; }
        public string? ReasonEn { get; init; }
        public string? ReasonAr { get; init; }
    }

    private sealed class LibraryServiceRow
    {
        public string? ServiceKey { get; init; }
        public string? NameEn { get; init; }
        public string? NameAr { get; init; }
        public string? DescriptionEn { get; init; }
        public string? DescriptionAr { get; init; }
        public string? EligibilityEn { get; init; }
        public string? EligibilityAr { get; init; }
        public string? InstructionsEn { get; init; }
        public string? InstructionsAr { get; init; }
        public string? AvailabilityEn { get; init; }
        public string? AvailabilityAr { get; init; }
        public string? Category { get; init; }
        public string? Url { get; init; }
        public string? Contact { get; init; }
    }
}
