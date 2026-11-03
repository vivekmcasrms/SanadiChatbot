using Microsoft.EntityFrameworkCore;
using Sanadi.Domain;

namespace Sanadi.Application.Services;

public class CaseService(ISanadiDbContext db, IEmailSender email)
{
    private static readonly Dictionary<string, int> FirstResponseHours = new()
    {
        ["complaint"] = 24, ["request"] = 48, ["suggestion"] = 72, ["alert"] = 4,
    };

    public async Task<ActionReceipt> CreateAsync(Guid studentId, string caseType, string category, string subject,
        string description, string? unitCode, CancellationToken ct = default)
    {
        var unit = unitCode is null
            ? null
            : await db.ServiceUnits.FirstOrDefaultAsync(u => u.Code == unitCode, ct);

        var reference = $"{caseType[..3].ToUpperInvariant()}-{DateTime.UtcNow:yyyyMMdd}-{Random.Shared.Next(1000, 9999)}";
        var hours = FirstResponseHours.GetValueOrDefault(caseType, 48);

        var entity = new ServiceCase
        {
            ReferenceNumber = reference,
            StudentId = studentId,
            UnitId = unit?.Id,
            CaseType = caseType,
            Category = category,
            Subject = subject,
            Description = description,
            Status = CaseStatus.New,
            SlaDueAt = DateTimeOffset.UtcNow.AddHours(hours),
        };
        db.Cases.Add(entity);
        db.AuditLog.Add(new AuditEntry
        {
            ActorId = studentId,
            Action = "case.create",
            EntityType = "case",
            EntityId = entity.Id.ToString(),
            Summary = $"{caseType} {reference} created",
        });
        await db.SaveChangesAsync(ct);

        if (!string.IsNullOrWhiteSpace(unit?.ContactEmail))
        {
            await email.SendAsync(unit!.ContactEmail!, $"[Sanadi] New {caseType}: {reference}",
                $"<p>A new {caseType} needs your attention.</p><p><b>{subject}</b></p><p>{description}</p>", ct);
        }

        return new ActionReceipt(reference, reference, caseType, unit?.NameEn, entity.CreatedAt,
            $"A response is expected within {hours} hours.", $"/requests/{entity.Id}");
    }

    public Task<List<ServiceCase>> ListForStudentAsync(Guid studentId, CancellationToken ct = default) =>
        db.Cases.AsNoTracking().Where(c => c.StudentId == studentId)
            .OrderByDescending(c => c.CreatedAt).ToListAsync(ct);

    /// <summary>Owner queues. Count and list always go through this one builder so
    /// the badge and the table can never disagree.</summary>
    public IQueryable<ServiceCase> OwnerQuery(Guid ownerId, IReadOnlyList<Guid> unitIds, string bucket)
    {
        var q = db.Cases.AsNoTracking().Where(c => unitIds.Contains(c.UnitId!.Value) || c.AssignedTo == ownerId);
        return bucket switch
        {
            "attention" => q.Where(c => c.RequiresHuman && CaseStatus.Open.Contains(c.Status)),
            "assigned" => q.Where(c => c.AssignedTo == ownerId && CaseStatus.Open.Contains(c.Status)),
            "completed" => q.Where(c => CaseStatus.Completed.Contains(c.Status)),
            _ => q,
        };
    }

    /// <summary>Ownership gate: a staff member may only touch a case in one of their
    /// units or a case assigned to them. Same predicate as <see cref="OwnerQuery"/>.</summary>
    public Task<ServiceCase?> FindForOwnerAsync(Guid caseId, Guid ownerId, IReadOnlyList<Guid> unitIds,
        CancellationToken ct = default) =>
        db.Cases.FirstOrDefaultAsync(
            c => c.Id == caseId && ((c.UnitId != null && unitIds.Contains(c.UnitId.Value)) || c.AssignedTo == ownerId),
            ct)!;

    public async Task<bool> AddMessageAsync(Guid caseId, Guid authorId, IReadOnlyList<Guid> unitIds, string authorRole,
        string body, bool internalOnly, CancellationToken ct = default)
    {
        var c = await FindForOwnerAsync(caseId, authorId, unitIds, ct);
        if (c is null) return false; // not this staff member's case

        db.CaseMessages.Add(new CaseMessage
        {
            CaseId = caseId, AuthorId = authorId, AuthorRole = authorRole, Body = body, InternalOnly = internalOnly,
        });
        if (c.FirstResponseAt is null && authorRole != "student")
            c.FirstResponseAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<bool> SetStatusAsync(Guid caseId, string status, Guid actorId, IReadOnlyList<Guid> unitIds,
        CancellationToken ct = default)
    {
        var c = await FindForOwnerAsync(caseId, actorId, unitIds, ct);
        if (c is null) return false; // not this staff member's case

        c.Status = status;
        if (CaseStatus.Completed.Contains(status)) c.ResolvedAt = DateTimeOffset.UtcNow;
        db.AuditLog.Add(new AuditEntry
        {
            ActorId = actorId, Action = "case.status", EntityType = "case", EntityId = caseId.ToString(),
            Summary = $"Status set to {status}",
        });
        await db.SaveChangesAsync(ct);
        return true;
    }
}
