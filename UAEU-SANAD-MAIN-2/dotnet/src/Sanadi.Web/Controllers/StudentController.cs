using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Application.Services;

namespace Sanadi.Web.Controllers;

[Authorize]
public class StudentController(
    StudentContextService students,
    CaseService cases,
    DocumentService documents) : Controller
{
    [HttpGet("/")]
    public async Task<IActionResult> Dashboard(CancellationToken ct)
    {
        if (!User.Identity?.IsAuthenticated ?? true) return Redirect("/auth");
        ViewBag.Student = await students.LoadAsync(User.Id(), ct);
        ViewBag.Cases = await cases.ListForStudentAsync(User.Id(), ct);
        return View();
    }

    [HttpGet("/requests")]
    public async Task<IActionResult> Requests(CancellationToken ct)
    {
        ViewBag.Cases = await cases.ListForStudentAsync(User.Id(), ct);
        return View();
    }

    [HttpGet("/documents")]
    public async Task<IActionResult> Documents(CancellationToken ct)
    {
        ViewBag.Documents = await documents.ListAsync(User.Id(), ct);
        return View();
    }

    /// <summary>Instant To Whom It May Concern letter: issued immediately, no case, no waiting.</summary>
    [HttpPost("/documents/issue")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Issue(string language, string purpose, bool includeGraduationDate,
        CancellationToken ct)
    {
        var letter = await documents.IssueEnrolmentLetterAsync(User.Id(),
            language == "ar" ? Application.Lang.Ar : Application.Lang.En,
            string.IsNullOrWhiteSpace(purpose) ? "general" : purpose, includeGraduationDate, ct);
        return Redirect($"/documents/{letter.Id}/download");
    }

    [HttpGet("/documents/{id:guid}/download")]
    public async Task<IActionResult> Download(Guid id, CancellationToken ct)
    {
        var list = await documents.ListAsync(User.Id(), ct);
        var doc = list.FirstOrDefault(d => d.Id == id);
        if (doc is null) return NotFound();
        var stream = await documents.DownloadAsync(doc, ct);
        return File(stream, "application/pdf", $"sanadi-letter-{doc.VerificationToken}.pdf");
    }
}

[AllowAnonymous]
public class VerifyController(DocumentService documents) : Controller
{
    [HttpGet("/verify/{token}")]
    public async Task<IActionResult> Verify(string token, CancellationToken ct)
    {
        ViewBag.Document = await documents.VerifyAsync(token, ct);
        ViewBag.Token = token;
        return View();
    }
}
