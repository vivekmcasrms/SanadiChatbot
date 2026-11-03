using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Application.Storage;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.Controllers;

[ApiController]
[Route("storage/v1")]
[Route("api/v1/storage")]
public sealed class StorageController(IObjectStorage storage) : ControllerBase
{
    // bucket:notreserved is an allowlist of real storage buckets so reserved
    // segments (sign / authenticated) never compete — that clash was HTTP 500.
    [HttpPost("object/{bucket:notreserved}/{*path}")]
    public async Task<IActionResult> Upload(string bucket, string path, CancellationToken cancellationToken)
    {
        var user = HttpContext.GetSanadiUser();
        if (user.UserId is null && !user.IsServiceRole) throw new UnauthorizedException();
        var upsert = string.Equals(Request.Query["upsert"], "true", StringComparison.OrdinalIgnoreCase)
                     || Request.Headers["x-upsert"].ToString() == "true";
        // supabase-js sends browser Files as multipart form data. MVC may already
        // have consumed Request.Body while binding route values; use the cached form.
        if (Request.HasFormContentType)
        {
            var form = await Request.ReadFormAsync(cancellationToken);
            if (form.Files.Count != 1 || form.Files[0].Length == 0)
                throw new SanadiException("Upload exactly one non-empty file.");
            var file = form.Files[0];
            await using var content = file.OpenReadStream();
            await storage.UploadAsync(bucket, path, content, file.ContentType,
                user.UserId ?? Guid.Empty, upsert, cancellationToken);
        }
        else
        {
            await storage.UploadAsync(bucket, path, Request.Body, Request.ContentType ?? "application/octet-stream",
                user.UserId ?? Guid.Empty, upsert, cancellationToken);
        }
        return Ok(new { Key = path, Id = path });
    }

    [HttpGet("object/{bucket:notreserved}/{*path}")]
    [HttpGet("object/authenticated/{bucket}/{*path}")]
    public async Task<IActionResult> Download(string bucket, string path, CancellationToken cancellationToken)
    {
        var user = HttpContext.GetSanadiUser();
        var file = await storage.DownloadAsync(bucket, path, user, cancellationToken);
        if (file is null) throw new NotFoundException();
        return File(file.Content, ContentTypeFor(path), Path.GetFileName(path));
    }

    [HttpDelete("object/{bucket:notreserved}")]
    public async Task<IActionResult> Delete(string bucket, [FromBody] string[]? prefixes, CancellationToken cancellationToken)
    {
        var user = HttpContext.GetSanadiUser();
        await storage.DeleteAsync(bucket, prefixes ?? [], user, cancellationToken);
        return Ok(new { });
    }

    private static string ContentTypeFor(string path) =>
        path.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) ? "application/pdf" : "application/octet-stream";
}

/// <summary>
/// Isolated from <see cref="StorageController"/> so <c>object/sign/...</c> cannot
/// AmbiguousMatch with <c>object/{bucket}/...</c> upload/download templates.
/// </summary>
[ApiController]
[Route("storage/v1/object/sign")]
[Route("api/v1/storage/object/sign")]
public sealed class StorageSignController(IObjectStorage storage) : ControllerBase
{
    [HttpGet("{bucket}/{*path}")]
    public async Task<IActionResult> DownloadSigned(string bucket, string path, [FromQuery] string? token, CancellationToken cancellationToken)
    {
        if (!storage.IsValidSignedToken(bucket, path, token)) throw new UnauthorizedException();
        var file = await storage.DownloadAsync(bucket, path, CurrentUser.ServiceRole(), cancellationToken);
        if (file is null) throw new NotFoundException();
        var contentType = path.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)
            ? "application/pdf"
            : "application/octet-stream";
        return File(file.Content, contentType, Path.GetFileName(path));
    }

    [HttpPost("{bucket}/{*path}")]
    public async Task<IActionResult> Sign(string bucket, string path, [FromBody] SignBody? body, CancellationToken cancellationToken)
    {
        var user = HttpContext.GetSanadiUser();
        var url = await storage.CreateSignedUrlAsync(bucket, path, body?.expiresIn ?? 60, user, cancellationToken);
        // supabase-js prefixes this.url (…/storage/v1) onto signedURL, so the value
        // must be the relative /object/sign/… path — never an absolute URL.
        var relative = url.StartsWith("http", StringComparison.OrdinalIgnoreCase)
            ? url[url.IndexOf("/object/sign/", StringComparison.OrdinalIgnoreCase)..]
            : url;
        return Ok(new { signedURL = relative, signedUrl = relative });
    }

    public sealed record SignBody(int expiresIn);
}
