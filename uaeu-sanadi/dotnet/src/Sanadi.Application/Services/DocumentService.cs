using Microsoft.EntityFrameworkCore;
using Sanadi.Domain;

namespace Sanadi.Application.Services;

public sealed record IssuedLetter(Guid Id, string VerificationToken, string StoragePath, DateTimeOffset IssuedAt,
    string DownloadUrl);

/// <summary>
/// To Whom It May Concern letters are instant: no case, no approval, no waiting days.
/// </summary>
public class DocumentService(
    ISanadiDbContext db,
    StudentContextService students,
    IPdfLetterService pdf,
    IFileStorage storage)
{
    public const string Bucket = "documents";

    public async Task<IssuedLetter> IssueEnrolmentLetterAsync(Guid studentId, Lang lang, string purpose,
        bool includeGraduationDate, CancellationToken ct = default)
    {
        var snapshot = await students.LoadAsync(studentId, ct);
        if (!snapshot.HasProfile)
            throw new InvalidOperationException("No verified student record is linked to this account.");

        var (bytes, token) = await pdf.BuildEnrolmentLetterAsync(snapshot, lang, purpose, includeGraduationDate, ct);
        var path = $"{studentId}/twimc-{token}.pdf";
        await storage.UploadAsync(Bucket, path, new MemoryStream(bytes), "application/pdf", ct);

        var record = new IssuedDocument
        {
            StudentId = studentId,
            DocumentType = "twimc_letter",
            Language = lang == Lang.Ar ? "ar" : "en",
            Purpose = purpose,
            VerificationToken = token,
            StoragePath = path,
            ExpiresAt = DateTimeOffset.UtcNow.AddMonths(6),
        };
        db.IssuedDocuments.Add(record);
        db.AuditLog.Add(new AuditEntry
        {
            ActorId = studentId, Action = "document.issue", EntityType = "document",
            EntityId = record.Id.ToString(), Summary = $"TWIMC letter issued ({purpose}, {record.Language})",
        });
        await db.SaveChangesAsync(ct);

        return new IssuedLetter(record.Id, token, path, record.IssuedAt, $"/documents/{record.Id}/download");
    }

    public Task<IssuedDocument?> VerifyAsync(string token, CancellationToken ct = default) =>
        db.IssuedDocuments.AsNoTracking()
            .FirstOrDefaultAsync(d => d.VerificationToken == token && !d.Revoked, ct);

    public Task<List<IssuedDocument>> ListAsync(Guid studentId, CancellationToken ct = default) =>
        db.IssuedDocuments.AsNoTracking().Where(d => d.StudentId == studentId)
            .OrderByDescending(d => d.IssuedAt).ToListAsync(ct);

    public Task<Stream> DownloadAsync(IssuedDocument doc, CancellationToken ct = default) =>
        storage.DownloadAsync(Bucket, doc.StoragePath, ct);
}
