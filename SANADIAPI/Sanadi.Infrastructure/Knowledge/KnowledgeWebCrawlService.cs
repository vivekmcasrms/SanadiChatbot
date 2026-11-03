using System.Data.Common;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Knowledge;

public sealed class KnowledgeWebCrawlService(IHttpClientFactory httpClientFactory, KnowledgeEmbeddingsService embeddings)
{
    private static readonly HashSet<string> BlockedHosts = new(StringComparer.OrdinalIgnoreCase)
        { "localhost", "127.0.0.1", "0.0.0.0", "::1", "metadata.google.internal", "169.254.169.254" };

    private static readonly Regex SkipExtension = new(@"\.(pdf|docx?|xlsx?|pptx?|zip|rar|jpe?g|png|gif|svg|webp|mp4|mp3|ics|css|js|json|xml)$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex Boilerplate = new(@"^(skip to main content|close modal|search|popular searches|learn more|read more|enter|home|menu|share|print|back to top|english|عربي|الرئيسية)$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex CollegeLabel = new(@">\s*(College of [^<>]{3,60}?)\s*<", RegexOptions.Compiled);

    public static (bool Ok, Uri? Url, string? Error) ValidateSourceUrl(string raw)
    {
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var url)) return (false, null, "The URL is not valid.");
        if (url.Scheme != Uri.UriSchemeHttps) return (false, null, "Only HTTPS sources are allowed.");
        var host = url.Host.ToLowerInvariant();
        if (BlockedHosts.Contains(host)) return (false, null, "This host is not permitted.");
        if (Regex.IsMatch(host, @"^(10|127)\.") || host.StartsWith("192.168.") || Regex.IsMatch(host, @"^172\.(1[6-9]|2\d|3[01])\.") || host.StartsWith("169.254."))
            return (false, null, "Private network addresses are not permitted.");
        if (host.EndsWith(".internal")) return (false, null, "Internal hosts are not permitted.");
        if (!string.IsNullOrEmpty(url.UserInfo)) return (false, null, "Credentials must not be embedded in the URL.");
        if (Regex.IsMatch(url.AbsolutePath, @"/(login|signin|portal|account|my)(/|$)", RegexOptions.IgnoreCase))
            return (false, null, "Login or personal portal pages cannot be ingested.");
        return (true, url, null);
    }

    public static bool IsDemoHost(string url)
    {
        try
        {
            var host = new Uri(url).Host.ToLowerInvariant();
            return host.EndsWith(".local") || host.EndsWith(".example");
        }
        catch { return false; }
    }

    public static WebChangeClassification ClassifyChange(string previous, string next)
    {
        if (string.IsNullOrEmpty(previous)) return new WebChangeClassification("minor", 0.0, "First successful ingestion.");
        var a = previous.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var b = next.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var setA = a.ToHashSet();
        var common = b.Count(w => setA.Contains(w));
        var percentage = Math.Round((1 - common / (double)Math.Max(Math.Max(a.Length, b.Length), 1)) * 1000) / 10;
        var changeType = percentage >= 40 ? "major" : percentage >= 10 ? "moderate" : "minor";
        return new WebChangeClassification(changeType, percentage,
            $"{percentage}% of the page content differs from the previously approved version ({a.Length} → {b.Length} words).");
    }

    public async Task<WebCrawlReport> CrawlAndIndexAsync(
        DbConnection db,
        Guid sourceId,
        string url,
        string title,
        string? knowledgeDomain,
        string scope,
        int maxDepth,
        int maxPages,
        IReadOnlyList<string> seedUrls,
        IReadOnlyList<string> allowedPaths,
        IReadOnlyList<string> excludedPaths,
        CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        var started = Environment.TickCount64;
        const int budget = 55_000;
        var report = new CrawlReport();
        var root = ValidateSourceUrl(url);
        if (!root.Ok) { report.Error = root.Error; return report.ToReport(); }
        if (IsDemoHost(url)) { report.Error = "Demo hosts cannot be crawled."; return report.ToReport(); }

        var origin = root.Url!.GetLeftPart(UriPartial.Authority);
        var robots = await LoadRobotsAsync(origin, ct);
        var queue = new Queue<(string Url, int Depth)>();
        var queued = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { root.Url.ToString() };
        queue.Enqueue((root.Url.ToString(), 0));
        foreach (var seed in seedUrls)
        {
            try
            {
                var abs = new Uri(root.Url, seed).ToString();
                if (queued.Add(abs)) queue.Enqueue((abs, 0));
            }
            catch { /* ignore */ }
        }

        maxPages = scope == "single_page" ? 1 : Math.Clamp(maxPages, 1, 300);
        maxDepth = scope == "same_domain" ? Math.Clamp(maxDepth, 0, 3) : 0;
        var visited = new List<string>();

        while (queue.Count > 0 && visited.Count < maxPages)
        {
            ct.ThrowIfCancellationRequested();
            if (Environment.TickCount64 - started > budget) { report.Truncated = true; break; }
            var next = queue.Dequeue();
            visited.Add(next.Url);
            report.Discovered++;

            var fetched = await FetchPageAsync(next.Url, ct);
            if (!fetched.Ok)
            {
                report.Failed++;
                report.Pages.Add(new WebCrawlPageOutcome(next.Url, next.Depth, false, fetched.Status!, null, "en", 0, 0, null, fetched.Error));
                await UpsertPageAsync(db, sourceId, next.Url, next.Depth, null, "en", fetched.Status!, fetched.Error, null, 0, [], ct);
                continue;
            }

            report.Fetched++;
            foreach (var name in ExtractCollegeNames(fetched.Html!))
                if (!report.CollegeNames.Contains(name)) report.CollegeNames.Add(name);

            var uri = new Uri(next.Url);
            var language = Regex.IsMatch(uri.AbsolutePath, @"^/ar(/|$)") ? "ar"
                : Regex.IsMatch(uri.AbsolutePath, @"^/en(/|$)") ? "en" : fetched.Language!;
            var chunks = KnowledgeProcessing.ChunkText(fetched.Text!).Where(c => c.Content.Trim().Length >= 80).ToList();

            if (chunks.Count == 0)
            {
                report.Pages.Add(new WebCrawlPageOutcome(next.Url, next.Depth, false, "empty", fetched.Title, language, 0, fetched.Text!.Length, fetched.Hash, "No meaningful text could be extracted from this page"));
                await UpsertPageAsync(db, sourceId, next.Url, next.Depth, fetched.Title, language, "empty", "No meaningful text could be extracted from this page", fetched.Hash, fetched.Text.Length, [], ct);
            }
            else
            {
                await UpsertPageAsync(db, sourceId, next.Url, next.Depth, fetched.Title, language, "indexed", null, fetched.Hash, fetched.Text!.Length, chunks, ct);
                report.Indexed++;
                report.Chunks += chunks.Count;
                report.Pages.Add(new WebCrawlPageOutcome(next.Url, next.Depth, true, "indexed", fetched.Title, language, chunks.Count, fetched.Text.Length, fetched.Hash, null));
            }

            if (scope == "same_domain" && next.Depth < maxDepth)
            {
                foreach (var link in ExtractLinks(fetched.Html!, next.Url))
                {
                    if (queued.Count >= maxPages * 4) break;
                    if (!Uri.TryCreate(link, UriKind.Absolute, out var candidate)) continue;
                    if (!string.Equals(candidate.GetLeftPart(UriPartial.Authority), origin, StringComparison.OrdinalIgnoreCase)) continue;
                    if (SkipExtension.IsMatch(candidate.AbsolutePath)) continue;
                    if (!PathAllowed(candidate.AbsolutePath, allowedPaths, excludedPaths)) continue;
                    if (!RobotsAllows(robots, candidate.AbsolutePath)) continue;
                    if (queued.Add(candidate.ToString())) queue.Enqueue((candidate.ToString(), next.Depth + 1));
                }
            }
        }

        if (!report.Truncated && scope != "selected_pages")
        {
            var stale = await db.QueryAsync<(Guid id, string url)>(
                DbProc.Call("usp_Knowledge_WebCrawl_ListActivePages", new { sourceId }, ct));
            var gone = stale.Where(p => !visited.Contains(p.url)).ToList();
            if (gone.Count > 0)
            {
                var ids = string.Join(",", gone.Select(g => g.id.ToString("D")));
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_WebCrawl_DeleteChunksByPageIds", new { ids }, ct));
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_WebCrawl_MarkPagesRemoved", new { ids }, ct));
                report.Removed = gone.Count;
            }
        }

        return report.ToReport();
    }

    public async Task<CollegeRefreshResult> RefreshUniversityCollegesAsync(DbConnection db, Guid sourceId, IReadOnlyList<string> names)
    {
        var unique = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var name in names) unique.TryAdd(name, name);
        var list = unique.Values.OrderBy(n => n).ToList();
        if (list.Count == 0) return new CollegeRefreshResult(0, 0, Array.Empty<string>());
        var now = DateTime.UtcNow;
        foreach (var name in list)
        {
            var existing = await db.ExecuteScalarAsync<Guid?>(DbProc.Call("usp_Knowledge_WebCrawl_FindCollege", new { name }));
            if (existing is Guid id)
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_WebCrawl_UpdateCollege",
                    new { id, url = "https://www.uaeu.ac.ae/en/colleges/", sourceId, now }));
            else
                await db.ExecuteAsync(DbProc.Call("usp_Knowledge_WebCrawl_InsertCollege",
                    new { name, url = "https://www.uaeu.ac.ae/en/colleges/", sourceId, now }));
        }
        await db.ExecuteAsync(DbProc.Call("usp_Knowledge_WebCrawl_DeactivateStaleColleges", new { sourceId, now }));
        return new CollegeRefreshResult(list.Count, list.Count, list);
    }

    private async Task UpsertPageAsync(
        DbConnection db, Guid sourceId, string url, int depth, string? title, string language,
        string status, string? error, string? hash, int textLength, List<KnowledgeChunk> chunks, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var existing = await db.ExecuteScalarAsync<Guid?>(
            DbProc.Call("usp_Knowledge_WebCrawl_FindPage", new { sourceId, url }, ct));
        Guid pageId;
        if (existing is Guid id)
        {
            pageId = id;
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_WebCrawl_UpdatePage",
                new { pageId, title, language, depth, status, error, hash, textLength, chunkCount = chunks.Count, now, indexedAt = chunks.Count > 0 ? now : (DateTime?)null, active = status == "indexed" }, ct));
        }
        else
        {
            pageId = Guid.NewGuid();
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_WebCrawl_InsertPage",
                new { pageId, sourceId, url, title, language, depth, status, error, hash, textLength, chunkCount = chunks.Count, now, indexedAt = chunks.Count > 0 ? now : (DateTime?)null, active = status == "indexed" }, ct));
        }

        await db.ExecuteAsync(DbProc.Call("usp_Knowledge_WebCrawl_DeletePageChunks", new { pageId }, ct));
        if (chunks.Count == 0) return;
        var inserted = new List<(Guid Id, string Content, string? SectionTitle)>();
        foreach (var c in chunks)
        {
            var chunkId = Guid.NewGuid();
            var content = c.Content.Length > 6000 ? c.Content[..6000] : c.Content;
            await db.ExecuteAsync(DbProc.Call("usp_Knowledge_WebCrawl_InsertPageChunk",
                new { chunkId, sourceId, pageId, c.ChunkNumber, c.SectionTitle, c.SectionPath, title, url, content, c.TokenCount, language, hash, now }, ct));
            inserted.Add((chunkId, content, c.SectionTitle));
        }
        try { await embeddings.EmbedChunkRowsAsync(db, "web_page_chunks", inserted.Select(r => (r.Id, r.Content, r.SectionTitle, title)).ToList(), ct); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch { /* best-effort */ }
    }

    private async Task<FetchResult> FetchPageAsync(string url, CancellationToken ct)
    {
        var validation = ValidateSourceUrl(url);
        if (!validation.Ok) return FetchResult.Fail("fetch_failed", validation.Error!);
        try
        {
            var client = httpClientFactory.CreateClient("KnowledgeCrawl");
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.TryAddWithoutValidation("User-Agent", "Sanadi-KnowledgeBot/1.0");
            req.Headers.TryAddWithoutValidation("Accept", "text/html,application/xhtml+xml");
            using var res = await client.SendAsync(req, ct);
            if (res.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone)
                return FetchResult.Fail("removed", $"Page no longer exists (HTTP {(int)res.StatusCode})");
            if (res.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                return FetchResult.Fail("fetch_failed", "Authentication required or access blocked by the site");
            if ((int)res.StatusCode == 429) return FetchResult.Fail("fetch_failed", "The site is rate-limiting requests");
            if (!res.IsSuccessStatusCode) return FetchResult.Fail("fetch_failed", $"The site returned HTTP {(int)res.StatusCode}");
            var contentType = res.Content.Headers.ContentType?.MediaType ?? "";
            if (!Regex.IsMatch(contentType, @"text/html|text/plain|application/xhtml", RegexOptions.IgnoreCase))
                return FetchResult.Fail("fetch_failed", $"Unsupported content type: {contentType.Split(';')[0]}");
            var html = (await res.Content.ReadAsStringAsync(ct));
            if (html.Length > 1_500_000) html = html[..1_500_000];
            var (title, text) = ExtractPageText(html);
            var detected = KnowledgeProcessing.DetectLanguage(text);
            return FetchResult.Success(title, text, html, detected == "ar" ? "ar" : "en", KnowledgeProcessing.Checksum(text));
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            var message = ex.Message;
            return FetchResult.Fail("fetch_failed", Regex.IsMatch(message, "timeout|abort|canceled", RegexOptions.IgnoreCase)
                ? "The page did not respond in time (timeout)" : message[..Math.Min(200, message.Length)]);
        }
    }

    private async Task<List<string>> LoadRobotsAsync(string origin, CancellationToken ct)
    {
        try
        {
            var client = httpClientFactory.CreateClient("KnowledgeCrawl");
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(6));
            using var res = await client.GetAsync($"{origin}/robots.txt", cts.Token);
            if (!res.IsSuccessStatusCode) return [];
            var body = (await res.Content.ReadAsStringAsync(cts.Token));
            if (body.Length > 100_000) body = body[..100_000];
            var disallow = new List<string>();
            var applies = false;
            foreach (var line in body.Split('\n'))
            {
                var clean = line.Split('#')[0].Trim();
                if (string.IsNullOrEmpty(clean)) continue;
                var parts = clean.Split(':', 2);
                if (parts.Length < 2) continue;
                var key = parts[0].Trim().ToLowerInvariant();
                var value = parts[1].Trim();
                if (key == "user-agent") applies = value == "*" || Regex.IsMatch(value, "sanadi", RegexOptions.IgnoreCase);
                else if (key == "disallow" && applies && value.Length > 0) disallow.Add(value);
            }
            return disallow;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch { return []; }
    }

    private static bool RobotsAllows(List<string> rules, string pathname) =>
        !rules.Any(rule =>
        {
            var prefix = Regex.Replace(rule, @"\*+$", "");
            return prefix == "/" || pathname.StartsWith(prefix, StringComparison.Ordinal);
        });

    private static bool PathAllowed(string pathname, IReadOnlyList<string> allowed, IReadOnlyList<string> excluded)
    {
        if (excluded.Any(p => !string.IsNullOrEmpty(p) && pathname.StartsWith(p, StringComparison.Ordinal))) return false;
        if (allowed.Count > 0) return allowed.Any(p => !string.IsNullOrEmpty(p) && pathname.StartsWith(p, StringComparison.Ordinal));
        return true;
    }

    public static (string? Title, string Text) ExtractPageText(string html)
    {
        var titleMatch = Regex.Match(html, @"<title[^>]*>([\s\S]*?)</title>", RegexOptions.IgnoreCase);
        var body = Regex.Replace(html, @"<script[\s\S]*?</script>", " ", RegexOptions.IgnoreCase);
        body = Regex.Replace(body, @"<style[\s\S]*?</style>", " ", RegexOptions.IgnoreCase);
        body = Regex.Replace(body, @"<noscript[\s\S]*?</noscript>", " ", RegexOptions.IgnoreCase);
        body = Regex.Replace(body, @"<svg[\s\S]*?</svg>", " ", RegexOptions.IgnoreCase);
        body = Regex.Replace(body, @"<nav[\s\S]*?</nav>", " ", RegexOptions.IgnoreCase);
        body = Regex.Replace(body, @"<header[\s\S]*?</header>", " ", RegexOptions.IgnoreCase);
        body = Regex.Replace(body, @"<footer[\s\S]*?</footer>", " ", RegexOptions.IgnoreCase);
        body = Regex.Replace(body, @"<!--[\s\S]*?-->", " ");
        body = Regex.Replace(body, @"<h([1-6])[^>]*>([\s\S]*?)</h\1>", m =>
        {
            var heading = DecodeEntities(Regex.Replace(m.Groups[2].Value, "<[^>]+>", " ")).Replace("  ", " ").Trim();
            return string.IsNullOrEmpty(heading) ? "\n\n" : $"\n\n## {heading}\n\n";
        }, RegexOptions.IgnoreCase);
        body = Regex.Replace(body, @"<br\s*/?>", "\n", RegexOptions.IgnoreCase);
        body = Regex.Replace(body, @"</(p|div|li|tr|section|article|td|h[1-6])>", "\n", RegexOptions.IgnoreCase);
        body = Regex.Replace(body, "<[^>]+>", " ");
        var lines = DecodeEntities(body).Replace("\r", "").Split('\n')
            .Select(l => Regex.Replace(l, @"[ \t\u00a0]+", " ").Trim())
            .Where(l => l.Length > 0 && !Boilerplate.IsMatch(l)).ToList();
        var seen = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var kept = new List<string>();
        foreach (var line in lines)
        {
            if (line.StartsWith("## ")) { kept.Add(""); kept.Add(line); kept.Add(""); continue; }
            var count = seen.TryGetValue(line, out var n) ? n + 1 : 1;
            seen[line] = count;
            if (count > 2) continue;
            kept.Add(line);
        }
        var text = Regex.Replace(string.Join("\n", kept), @"\n{3,}", "\n\n").Trim();
        var title = titleMatch.Success ? DecodeEntities(Regex.Replace(titleMatch.Groups[1].Value, "<[^>]+>", "")).Trim() : null;
        return (title, text);
    }

    public static List<string> ExtractLinks(string html, string pageUrl)
    {
        var outSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match m in Regex.Matches(html, @"href\s*=\s*[""']([^""'#]+)[""']", RegexOptions.IgnoreCase))
        {
            var raw = m.Groups[1].Value.Trim();
            if (string.IsNullOrEmpty(raw) || raw.StartsWith("mailto:", StringComparison.OrdinalIgnoreCase)
                || raw.StartsWith("tel:", StringComparison.OrdinalIgnoreCase)
                || raw.StartsWith("javascript:", StringComparison.OrdinalIgnoreCase)) continue;
            try
            {
                var abs = new Uri(new Uri(pageUrl), raw);
                var builder = new UriBuilder(abs) { Fragment = "" };
                outSet.Add(builder.Uri.ToString());
            }
            catch { /* ignore */ }
        }
        return outSet.ToList();
    }

    public static List<string> ExtractCollegeNames(string html)
    {
        var names = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match match in CollegeLabel.Matches(html))
        {
            var name = DecodeEntities(match.Groups[1].Value);
            name = Regex.Replace(name, @"\s+", " ");
            name = Regex.Replace(name, @"[,;:].*$", "").Trim();
            if (!Regex.IsMatch(name, @"^College of [A-Z]")) continue;
            if (name.Length is < 12 or > 70) continue;
            names.TryAdd(name, name);
        }
        return names.Values.OrderBy(n => n).ToList();
    }

    private static string DecodeEntities(string text) =>
        text.Replace("&nbsp;", " ").Replace("&amp;", "&").Replace("&lt;", "<").Replace("&gt;", ">")
            .Replace("&quot;", "\"").Replace("&#39;", "'").Replace("&apos;", "'");

    private sealed record FetchResult(bool Ok, string? Status, string? Title, string? Text, string? Html, string? Language, string? Hash, string? Error)
    {
        public static FetchResult Fail(string status, string error) => new(false, status, null, null, null, null, null, error);
        public static FetchResult Success(string? title, string text, string html, string language, string hash) =>
            new(true, "fetched", title, text, html, language, hash, null);
    }

    private sealed class CrawlReport
    {
        public int Discovered, Fetched, Indexed, Failed, Chunks, Removed;
        public List<WebCrawlPageOutcome> Pages { get; } = [];
        public List<string> CollegeNames { get; } = [];
        public string? Error;
        public bool Truncated;
        public WebCrawlReport ToReport() => new(
            Discovered, Fetched, Indexed, Failed, Chunks, Removed,
            Pages, CollegeNames, Error, Truncated);
    }
}
