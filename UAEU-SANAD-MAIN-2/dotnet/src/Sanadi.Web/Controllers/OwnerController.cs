using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Sanadi.Application.Services;
using Sanadi.Domain;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Web.Controllers;

/// <summary>
/// Service Owner workspace. Owners only see work that genuinely needs a human:
/// Needs Your Attention, My Assigned Requests, Completed.
/// </summary>
[Authorize(Policy = "Staff")]
[Route("owner")]
public class OwnerController(SanadiDbContext db, CaseService cases) : Controller
{
    private async Task<List<Guid>> UnitsAsync(CancellationToken ct)
    {
        // Owners are scoped to the units they are responsible for.
        var email = User.FindFirst(System.Security.Claims.ClaimTypes.Email)?.Value;
        return await db.ServiceUnits.AsNoTracking()
            .Where(u => u.ContactEmail == email)
            .Select(u => u.Id).ToListAsync(ct);
    }

    [HttpGet("")]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var units = await UnitsAsync(ct);
        var me = User.Id();

        // Counts and lists come from the same query builder, so they can never disagree.
        ViewBag.AttentionCount = await cases.OwnerQuery(me, units, "attention").CountAsync(ct);
        ViewBag.AssignedCount = await cases.OwnerQuery(me, units, "assigned").CountAsync(ct);
        ViewBag.CompletedCount = await cases.OwnerQuery(me, units, "completed").CountAsync(ct);
        ViewBag.Cases = await cases.OwnerQuery(me, units, "attention")
            .OrderBy(c => c.SlaDueAt).Take(50).ToListAsync(ct);
        return View();
    }

    [HttpGet("queue/{bucket}")]
    public async Task<IActionResult> Queue(string bucket, CancellationToken ct)
    {
        var units = await UnitsAsync(ct);
        ViewBag.Bucket = bucket;
        ViewBag.Cases = await cases.OwnerQuery(User.Id(), units, bucket)
            .OrderByDescending(c => c.CreatedAt).Take(100).ToListAsync(ct);
        return View("Index");
    }

    [HttpGet("case/{id:guid}")]
    public async Task<IActionResult> Case(Guid id, CancellationToken ct)
    {
        var units = await UnitsAsync(ct);
        // Only cases in the caller's units, or assigned to them, may be opened.
        if (await cases.FindForOwnerAsync(id, User.Id(), units, ct) is null) return NotFound();

        ViewBag.Case = await db.Cases.AsNoTracking().Include(c => c.Unit).Include(c => c.Messages)
            .FirstOrDefaultAsync(c => c.Id == id, ct);
        return View();
    }

    [HttpPost("case/{id:guid}/reply")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Reply(Guid id, string body, bool internalOnly, CancellationToken ct)
    {
        var units = await UnitsAsync(ct);
        if (!await cases.AddMessageAsync(id, User.Id(), units, Roles.ServiceOwner, body, internalOnly, ct))
            return NotFound();
        return Redirect($"/owner/case/{id}");
    }

    [HttpPost("case/{id:guid}/status")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Status(Guid id, string status, CancellationToken ct)
    {
        var units = await UnitsAsync(ct);
        if (!await cases.SetStatusAsync(id, status, User.Id(), units, ct)) return NotFound();
        return Redirect($"/owner/case/{id}");
    }
}
