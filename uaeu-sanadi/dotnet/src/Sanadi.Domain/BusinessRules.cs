namespace Sanadi.Domain;

public static class CaseStatus
{
    public const string New = "new";
    public const string InProgress = "in_progress";
    public const string WaitingForStudent = "waiting_for_student";
    public const string Resolved = "resolved";
    public const string Closed = "closed";

    /// <summary>Single source of truth: "open" always means New + In Progress + Waiting.</summary>
    public static readonly string[] Open = { New, InProgress, WaitingForStudent };
    public static readonly string[] Completed = { Resolved, Closed };
    public static bool IsOpen(string status) => Open.Contains(status);
}

public static class KnowledgeStatus
{
    public const string Processing = "processing";
    public const string Indexed = "indexed";
    public const string Active = "active";
    public const string NeedsReview = "needs_review";
    public const string Failed = "failed";
    public const string Reprocessing = "reprocessing";
    public const string Disabled = "disabled";
}

public static class Roles
{
    public const string Student = "student";
    public const string ServiceOfficer = "service_officer";
    public const string ServiceOwner = "service_owner";
    public const string KnowledgeManager = "knowledge_manager";
    public const string SystemAdmin = "system_admin";

    public static readonly string[] Staff =
    {
        ServiceOfficer, ServiceOwner, "service_manager", KnowledgeManager,
        "knowledge_approver", "integration_admin", SystemAdmin, "auditor", "leadership_viewer"
    };
}

/// <summary>
/// Deterministic Inter-College Transfer eligibility. The language model may only
/// explain this result — it must never decide or override it.
/// Authored rules: 12-36 completed credits (inclusive), GPA >= 2.50,
/// no previous transfer, seat capacity available, service open.
/// </summary>
public static class TransferEligibility
{
    public const int MinCredits = 12;
    public const int MaxCredits = 36;
    public const decimal MinGpa = 2.50m;

    public sealed record Result(bool Eligible, IReadOnlyList<string> Reasons);

    public static Result Evaluate(int completedCredits, decimal gpa, int previousTransfers,
        bool capacityAvailable, bool serviceOpen)
    {
        var reasons = new List<string>();
        if (completedCredits < MinCredits)
            reasons.Add($"Completed credit hours ({completedCredits}) are below the required minimum of {MinCredits}.");
        if (completedCredits > MaxCredits)
            reasons.Add($"Completed credit hours ({completedCredits}) exceed the maximum of {MaxCredits}.");
        if (gpa < MinGpa)
            reasons.Add($"Cumulative GPA ({gpa:0.00}) is below the required {MinGpa:0.00}.");
        if (previousTransfers > 0)
            reasons.Add("A previous inter-college transfer is already recorded.");
        if (!capacityAvailable)
            reasons.Add("No seat capacity is currently available in the requested college.");
        if (!serviceOpen)
            reasons.Add("The inter-college transfer service is not open at this time.");
        return new Result(reasons.Count == 0, reasons);
    }
}
