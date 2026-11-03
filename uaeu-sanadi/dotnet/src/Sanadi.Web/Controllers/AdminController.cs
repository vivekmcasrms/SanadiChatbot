using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Sanadi.Application;
using Sanadi.Application.Knowledge;
using Sanadi.Domain;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Web.Controllers;

/// <summary>University-wide governance: dashboard, units and performance,
/// requests and cases, services, Knowledge Center and reports.</summary>
[Authorize(Policy = "Admin")]
[Route("admin")]
public class AdminController(SanadiDbContext db, KnowledgeCenterService knowledge) : Controller
{
    [HttpGet("")]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var open = CaseStatus.Open;
        ViewBag.TotalCases = await db.Cases.CountAsync(ct);
        ViewBag.OpenCases = await db.Cases.CountAsync(c => open.Contains(c.Status), ct);
        ViewBag.Documents = await db.IssuedDocuments.CountAsync(ct);
        ViewBag.Knowledge = await knowledge.HealthAsync(ct);
        ViewBag.Units = await db.ServiceUnits.AsNoTracking().ToListAsync(ct);
        return View();
    }

    [HttpGet("performance")]
    public async Task<IActionResult> Performance(CancellationToken ct)
    {
        var rows = await db.Cases.AsNoTracking().Include(c => c.Unit)
            .Where(c => c.UnitId != null)
            .GroupBy(c => c.Unit!.NameEn)
            .Select(g => new
            {
                Unit = g.Key,
                Active = g.Count(c => CaseStatus.Open.Contains(c.Status)),
                Completed = g.Count(c => CaseStatus.Completed.Contains(c.Status)),
                OnTime = g.Count(c => c.ResolvedAt != null && c.SlaDueAt != null && c.ResolvedAt <= c.SlaDueAt),
            })
            .ToListAsync(ct);

        // SLA is a ratio of completed cases only, and it is multiplied by 100 exactly once.
        ViewBag.Rows = rows.Select(r => new
        {
            r.Unit,
            r.Active,
            r.Completed,
            SlaPercent = r.Completed == 0 ? (double?)null : Math.Round(100.0 * r.OnTime / r.Completed, 1),
        }).ToList();
        return View();
    }

    // ------------------------------------------------------------ Knowledge Center

    [HttpGet("knowledge")]
    public async Task<IActionResult> Knowledge(CancellationToken ct)
    {
        ViewBag.Sources = await knowledge.ListAsync(ct);
        ViewBag.Health = await knowledge.HealthAsync(ct);
        return View();
    }

    /// <summary>Multiple documents can be added in one submission.</summary>
    [HttpPost("knowledge/documents")]
    [ValidateAntiForgeryToken]
    [RequestSizeLimit(200_000_000)]
    public async Task<IActionResult> AddDocuments(List<IFormFile> files, string? domain, string language,
        CancellationToken ct)
    {
        foreach (var file in files.Where(f => f.Length > 0))
        {
            await using var stream = file.OpenReadStream();
            await knowledge.AddDocumentAsync(User.Id(), Path.GetFileNameWithoutExtension(file.FileName),
                file.FileName, stream, domain, language ?? "en", ct);
        }
        return Redirect("/admin/knowledge");
    }

    /// <summary>Multiple URLs can be added in one submission.</summary>
    [HttpPost("knowledge/urls")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> AddUrls(List<string> titles, List<string> urls, bool crawlSameDomain,
        int maxPages, string language, CancellationToken ct)
    {
        for (var i = 0; i < urls.Count; i++)
        {
            if (string.IsNullOrWhiteSpace(urls[i])) continue;
            var title = i < titles.Count && !string.IsNullOrWhiteSpace(titles[i]) ? titles[i] : urls[i];
            await knowledge.AddWebSourceAsync(User.Id(), title, urls[i], crawlSameDomain,
                maxPages <= 0 ? 1 : maxPages, language ?? "en", ct);
        }
        return Redirect("/admin/knowledge");
    }

    /// <summary>Multiple API / data connections can be added in one submission.
    /// Only the secret *reference* is stored — never the key itself.</summary>
    [HttpPost("knowledge/apis")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> AddApis(List<string> names, List<string> endpoints,
        List<string> secretReferences, List<bool> liveQuery, string? domain, CancellationToken ct)
    {
        for (var i = 0; i < endpoints.Count; i++)
        {
            if (string.IsNullOrWhiteSpace(endpoints[i])) continue;
            await knowledge.AddApiSourceAsync(User.Id(),
                i < names.Count ? names[i] : endpoints[i],
                endpoints[i],
                i < secretReferences.Count ? secretReferences[i] : "",
                i < liveQuery.Count && liveQuery[i], domain, ct);
        }
        return Redirect("/admin/knowledge");
    }

    [HttpPost("knowledge/{id:guid}/reprocess")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Reprocess(Guid id, CancellationToken ct)
    {
        await knowledge.ReprocessAsync(id, ct);
        return Redirect("/admin/knowledge");
    }

    [HttpPost("knowledge/{id:guid}/enabled")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Enabled(Guid id, bool enabled, CancellationToken ct)
    {
        await knowledge.SetEnabledAsync(id, enabled, ct);
        return Redirect("/admin/knowledge");
    }

    [HttpPost("knowledge/{id:guid}/delete")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await knowledge.DeleteAsync(id, ct);
        return Redirect("/admin/knowledge");
    }

    [HttpGet("knowledge/{id:guid}/chunks")]
    public async Task<IActionResult> Chunks(Guid id, CancellationToken ct)
    {
        ViewBag.Chunks = await knowledge.ChunksAsync(id, ct);
        return View();
    }

    /// <summary>Test Knowledge runs the same retrieval pipeline the student assistant uses.</summary>
    [HttpGet("knowledge/test")]
    public async Task<IActionResult> Test(string? q, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(q))
            ViewBag.Result = await knowledge.TestAsync(q, HttpContext.Language(), ct);
        ViewBag.Query = q;
        return View();
    }
}
