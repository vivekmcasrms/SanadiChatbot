using Microsoft.EntityFrameworkCore;
using Sanadi.Domain;

namespace Sanadi.Application.Services;

public class StudentContextService(ISanadiDbContext db)
{
    public const int DefaultTotalCreditHours = 120;

    public async Task<StudentSnapshot> LoadAsync(Guid userId, CancellationToken ct = default)
    {
        var profile = await db.Profiles.AsNoTracking().FirstOrDefaultAsync(p => p.Id == userId, ct);
        if (profile is null) return new StudentSnapshot { HasProfile = false };

        var holds = await db.StudentHolds.AsNoTracking()
            .Where(h => h.StudentId == userId && h.IsActive)
            .ToListAsync(ct);

        var openStatuses = CaseStatus.Open;
        var openCases = await db.Cases.AsNoTracking()
            .CountAsync(c => c.StudentId == userId && openStatuses.Contains(c.Status), ct);

        return new StudentSnapshot
        {
            HasProfile = true,
            FullName = profile.FullName,
            StudentNumber = profile.StudentNumber,
            Programme = profile.ProgramNameEn,
            College = profile.CollegeNameEn,
            Level = profile.Level,
            Gpa = profile.Gpa,
            Standing = profile.Standing,
            CompletedCredits = profile.CompletedCredits,
            RegisteredCredits = profile.RegisteredCredits,
            TotalCredits = profile.TotalCredits ?? DefaultTotalCreditHours,
            PreviousTransfers = profile.PreviousTransfers,
            ExpectedGraduation = profile.ExpectedGraduation,
            Holds = holds,
            OpenCases = openCases,
        };
    }
}
