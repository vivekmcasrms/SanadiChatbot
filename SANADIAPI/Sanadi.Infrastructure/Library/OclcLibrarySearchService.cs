using System.Diagnostics;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Dapper;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Library;

public sealed record LibrarySearchRequest(string? Query, int Limit = 12, string Lang = "en");

public sealed class LibrarySearchResultDto
{
    public string status { get; set; } = "unavailable";
    public string? provider { get; set; }
    public string retrievedAt { get; set; } = DateTime.UtcNow.ToString("o");
    public int total { get; set; }
    public List<LibraryResourceDto> results { get; set; } = [];
    public int latencyMs { get; set; }
    public string? error { get; set; }
}

public sealed class LibraryResourceDto
{
    public string id { get; set; } = "";
    public string title { get; set; } = "";
    public string? subtitle { get; set; }
    public List<string> authors { get; set; } = [];
    public int? year { get; set; }
    public string type { get; set; } = "other";
    public string? providerType { get; set; }
    public string? publisher { get; set; }
    public string? isbn { get; set; }
    public string? issn { get; set; }
    public string? doi { get; set; }
    public string? journalTitle { get; set; }
    public string? volume { get; set; }
    public string? issue { get; set; }
    public string? pages { get; set; }
    public string? language { get; set; }
    public List<string> subjects { get; set; } = [];
    public string? summary { get; set; }
    public string? onlineUrl { get; set; }
    public bool requiresSignIn { get; set; }
    public string? catalogueUrl { get; set; }
    public string availability { get; set; } = "unknown";
    public List<object> holdings { get; set; } = [];
    public int copies { get; set; }
    public double relevance { get; set; }
    public string? provider { get; set; } = "OCLC";
    public string? oclcNumber { get; set; }
    public string? edition { get; set; }
    public bool? heldByInstitution { get; set; }
    public bool? isElectronic { get; set; }
    public string? sourceCheckedAt { get; set; }
}

/// <summary>
/// OCLC WorldCat Discovery search using credentials from library_provider_settings.
/// When multiple enabled credential rows exist, every catalogue is queried in
/// parallel and results are merged for Ask the Librarian.
/// </summary>
public sealed class OclcLibrarySearchService(ISqlConnectionFactory db, IHttpClientFactory httpClientFactory, IMemoryCache cache, ILogger<OclcLibrarySearchService> logger)
{
    private static readonly TimeSpan TokenTtlSafety = TimeSpan.FromSeconds(60);

    public async Task<LibrarySearchResultDto> SearchAsync(LibrarySearchRequest request, CancellationToken cancellationToken)
    {
        var traceId = Activity.Current?.TraceId.ToString() ?? Guid.NewGuid().ToString("N");
        return await SearchCoreAsync(request, traceId, cancellationToken);
    }

    private async Task<LibrarySearchResultDto> SearchCoreAsync(LibrarySearchRequest request, string traceId, CancellationToken cancellationToken)
    {
        var started = DateTime.UtcNow;
        // Propagated database failures are logged once by the API exception handler.
        var settingsList = await LoadSettingsAsync(cancellationToken);
        if (settingsList.Count == 0)
        {
            return Fail("disabled", "The library catalogue connector has not been configured yet.", started);
        }

        var q = (request.Query ?? "").Trim();
        if (q.Length < 2)
        {
            return new LibrarySearchResultDto
            {
                status = "empty",
                provider = settingsList[0].ProviderName,
                retrievedAt = DateTime.UtcNow.ToString("o"),
                latencyMs = (int)(DateTime.UtcNow - started).TotalMilliseconds,
                error = null,
            };
        }

        var limit = Math.Clamp(request.Limit <= 0 ? 12 : request.Limit, 1, 25);

        // Single credential — same path as before.
        if (settingsList.Count == 1)
            return await SearchOneAsync(settingsList[0], q, limit, started, traceId, cancellationToken);

        // Multiple credentials — hit every Library API concurrently.
        var parts = await Task.WhenAll(
            settingsList.Select(s => SearchOneAsync(s, q, limit, started, traceId, cancellationToken)));
        return Merge(parts, limit, started);
    }

    private async Task<LibrarySearchResultDto> SearchOneAsync(
        SettingsRow settings, string q, int limit, DateTime started, string traceId, CancellationToken cancellationToken)
    {
        var clientId = settings.ClientId;
        var clientSecret = settings.ClientSecret;
        if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(clientSecret))
        {
            return Fail("disabled", "Library catalogue credentials are missing.", started, settings.ProviderName);
        }

        var stage = "configuration";
        var timer = Stopwatch.StartNew();
        try
        {
            if (string.IsNullOrWhiteSpace(settings.BaseUrl))
            {
                logger.LogError("LIBRARY_CONFIGURATION_MISSING TraceId={TraceId} Field=BaseUrl", traceId);
                return Fail("disabled", "Library catalogue base URL is missing.", started, settings.ProviderName);
            }
            stage = "oauth";
            var token = await GetAccessTokenAsync(clientId, clientSecret, traceId, cancellationToken);
            stage = "catalogue";
            var baseUrl = settings.BaseUrl.Trim().TrimEnd('/');
            var url = $"{baseUrl}/brief-bibs?q={Uri.EscapeDataString("kw:" + q)}&limit={limit}&orderBy=bestMatch";

            var client = httpClientFactory.CreateClient("OclcLibrary");
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

            using var res = await client.SendAsync(req, cancellationToken);
            if (!res.IsSuccessStatusCode)
            {
                logger.LogError("LIBRARY_FAILURE TraceId={TraceId} Stage=catalogue StatusCode={StatusCode}",
                    traceId, (int)res.StatusCode);
                return Fail("unavailable", $"Catalogue responded with status {(int)res.StatusCode}", started, settings.ProviderName);
            }

            await using var stream = await res.Content.ReadAsStreamAsync(cancellationToken);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
            var root = doc.RootElement;
            var total = root.TryGetProperty("numberOfRecords", out var n) && n.TryGetInt32(out var tn) ? tn : 0;
            var results = new List<LibraryResourceDto>();
            if (root.TryGetProperty("briefRecords", out var records) && records.ValueKind == JsonValueKind.Array)
            {
                var i = 0;
                foreach (var rec in records.EnumerateArray())
                {
                    results.Add(MapBrief(rec, i++, settings.ProviderName, settings.CatalogueUrlTemplate));
                }
            }

            return new LibrarySearchResultDto
            {
                status = results.Count > 0 ? "ok" : "empty",
                provider = settings.ProviderName,
                retrievedAt = DateTime.UtcNow.ToString("o"),
                total = total > 0 ? total : results.Count,
                results = results,
                latencyMs = (int)(DateTime.UtcNow - started).TotalMilliseconds,
                error = null,
            };
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (OperationCanceledException ex) when (!cancellationToken.IsCancellationRequested)
        {
            LogFailure(traceId, stage, ex, timer.ElapsedMilliseconds, cancellationToken);
            return Fail("unavailable", "The library catalogue timed out.", started, settings.ProviderName);
        }
        catch (Exception ex)
        {
            LogFailure(traceId, stage, ex, timer.ElapsedMilliseconds, cancellationToken);
            return Fail("unavailable", "The live library catalogue is temporarily unavailable.", started, settings.ProviderName);
        }
    }

    private static LibrarySearchResultDto Merge(LibrarySearchResultDto[] parts, int limit, DateTime started)
    {
        var ok = parts.Where(p => p.status is "ok" or "empty").ToArray();
        if (ok.Length == 0)
        {
            var first = parts[0];
            return Fail(first.status, first.error ?? "The live library catalogue is temporarily unavailable.", started, first.provider);
        }

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var merged = new List<LibraryResourceDto>();
        foreach (var part in ok.OrderByDescending(p => p.status == "ok").ThenBy(p => p.latencyMs))
        {
            foreach (var item in part.results)
            {
                var key = !string.IsNullOrWhiteSpace(item.oclcNumber) ? item.oclcNumber!
                    : !string.IsNullOrWhiteSpace(item.id) ? item.id
                    : $"{item.title}|{item.year}|{string.Join(",", item.authors)}";
                if (!seen.Add(key)) continue;
                merged.Add(item);
            }
        }

        merged = merged
            .OrderByDescending(r => r.relevance)
            .ThenByDescending(r => r.year ?? 0)
            .Take(limit)
            .ToList();

        var providers = ok.Select(p => p.provider).Where(p => !string.IsNullOrWhiteSpace(p)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        return new LibrarySearchResultDto
        {
            status = merged.Count > 0 ? "ok" : "empty",
            provider = providers.Length <= 1 ? providers.FirstOrDefault() : string.Join(" · ", providers),
            retrievedAt = DateTime.UtcNow.ToString("o"),
            total = Math.Max(ok.Sum(p => p.total), merged.Count),
            results = merged,
            latencyMs = (int)(DateTime.UtcNow - started).TotalMilliseconds,
            error = null,
        };
    }

    private async Task<List<SettingsRow>> LoadSettingsAsync(CancellationToken cancellationToken)
    {
        await using var conn = db.Create();
        await conn.OpenAsync(cancellationToken);
        var rows = (await conn.QueryAsync<SettingsRow>(
            DbProc.Call("usp_Library_GetOclcSettings", null, cancellationToken))).ToList();
        return rows
            .Where(r => r.Enabled
                        && !string.IsNullOrWhiteSpace(r.ClientId)
                        && !string.IsNullOrWhiteSpace(r.ClientSecret))
            .ToList();
    }

    private async Task<string> GetAccessTokenAsync(string clientId, string clientSecret, string traceId, CancellationToken cancellationToken)
    {
        var cacheKey = "oclc:token:" + clientId;
        if (cache.TryGetValue(cacheKey, out string? cached) && !string.IsNullOrEmpty(cached))
        {
            return cached;
        }

        var client = httpClientFactory.CreateClient("OclcLibrary");
        var basic = Convert.ToBase64String(Encoding.ASCII.GetBytes($"{clientId}:{clientSecret}"));
        using var req = new HttpRequestMessage(HttpMethod.Post, "https://oauth.oclc.org/token");
        req.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "client_credentials",
            ["scope"] = "wcapi",
        });

        using var res = await client.SendAsync(req, cancellationToken);
        res.EnsureSuccessStatusCode();
        await using var stream = await res.Content.ReadAsStreamAsync(cancellationToken);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        var token = doc.RootElement.GetProperty("access_token").GetString()
                    ?? throw new InvalidOperationException("OCLC token missing");
        var expiresIn = doc.RootElement.TryGetProperty("expires_in", out var exp) && exp.TryGetInt32(out var seconds)
            ? seconds
            : 1199;
        cache.Set(cacheKey, token, TimeSpan.FromSeconds(Math.Max(60, expiresIn)) - TokenTtlSafety);
        return token;
    }

    private void LogFailure(string traceId, string stage, Exception exception, long durationMs, CancellationToken cancellationToken)
    {
        if (exception is OperationCanceledException && cancellationToken.IsCancellationRequested) return;
        // Exception messages can contain URLs or provider response bodies. Record
        // only types and diagnostic codes, preserving credentials and query privacy.
        var cause = exception.GetBaseException();
        logger.LogError("LIBRARY_FAILURE TraceId={TraceId} Stage={Stage} DurationMs={DurationMs} Reason={Reason} ExceptionType={ExceptionType} CauseType={CauseType} HttpError={HttpError} StatusCode={StatusCode} SocketError={SocketError}",
            traceId, stage, durationMs,
            exception is OperationCanceledException ? (cancellationToken.IsCancellationRequested ? "cancelled" : "timeout") : "error",
            exception.GetType().Name, cause.GetType().Name,
            (exception as HttpRequestException)?.HttpRequestError.ToString(),
            (int?)(exception as HttpRequestException)?.StatusCode,
            (cause as SocketException)?.SocketErrorCode.ToString());
    }

    private static LibraryResourceDto MapBrief(JsonElement rec, int index, string? providerName, string? catalogueUrlTemplate)
    {
        var oclc = Str(rec, "oclcNumber") ?? $"row-{index}";
        var general = Str(rec, "generalFormat");
        var specific = Str(rec, "specificFormat");
        var isDigital = string.Equals(specific, "Digital", StringComparison.OrdinalIgnoreCase)
                        || string.Equals(specific, "digital", StringComparison.OrdinalIgnoreCase);
        var type = MapType(general, specific);
        var yearText = Str(rec, "date") ?? Str(rec, "machineReadableDate");
        int? year = null;
        if (!string.IsNullOrEmpty(yearText) && int.TryParse(new string(yearText.Take(4).ToArray()), out var y))
            year = y;

        var authors = new List<string>();
        if (rec.TryGetProperty("creator", out var creator))
        {
            if (creator.ValueKind == JsonValueKind.String && creator.GetString() is { Length: > 0 } one)
                authors.Add(one);
            else if (creator.ValueKind == JsonValueKind.Array)
            {
                foreach (var c in creator.EnumerateArray())
                    if (c.ValueKind == JsonValueKind.String && c.GetString() is { Length: > 0 } a)
                        authors.Add(a);
            }
        }

        string? isbn = null;
        if (rec.TryGetProperty("isbns", out var isbns) && isbns.ValueKind == JsonValueKind.Array)
        {
            foreach (var x in isbns.EnumerateArray())
            {
                if (x.ValueKind == JsonValueKind.String && x.GetString() is { Length: > 0 } v)
                {
                    isbn = v;
                    break;
                }
            }
        }

        return new LibraryResourceDto
        {
            id = oclc,
            oclcNumber = oclc,
            title = Str(rec, "title") ?? "Untitled",
            authors = authors,
            year = year,
            type = type,
            providerType = general,
            publisher = Str(rec, "publisher"),
            isbn = isbn,
            language = Str(rec, "language"),
            availability = isDigital ? "electronic" : "unknown",
            isElectronic = isDigital,
            provider = providerName ?? "OCLC WorldCat",
            relevance = 1 - index * 0.01,
            sourceCheckedAt = DateTime.UtcNow.ToString("o"),
            catalogueUrl = string.IsNullOrWhiteSpace(catalogueUrlTemplate)
                ? null
                : catalogueUrlTemplate.Trim().Replace("{id}", Uri.EscapeDataString(oclc)),
        };
    }

    private static string MapType(string? general, string? specific)
    {
        var g = (general ?? "").ToLowerInvariant();
        var s = (specific ?? "").ToLowerInvariant();
        if (s.Contains("thsis") || s.Contains("thesis")) return "thesis";
        if (g is "artchap") return "article";
        if (g is "jrnl") return "journal";
        if (g is "book") return s.Contains("digital") ? "ebook" : "book";
        return "other";
    }

    private static string? Str(JsonElement rec, string name) =>
        rec.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static LibrarySearchResultDto Fail(string status, string error, DateTime started, string? provider = null) => new()
    {
        status = status,
        provider = provider,
        retrievedAt = DateTime.UtcNow.ToString("o"),
        latencyMs = (int)(DateTime.UtcNow - started).TotalMilliseconds,
        error = error,
    };

    private sealed class SettingsRow
    {
        public string? ProviderName { get; init; }
        public bool Enabled { get; init; }
        public string? BaseUrl { get; init; }
        public string? CatalogueUrlTemplate { get; init; }
        public string? ClientId { get; init; }
        public string? ClientSecret { get; init; }
    }
}
