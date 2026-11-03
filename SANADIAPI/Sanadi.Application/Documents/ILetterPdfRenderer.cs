namespace Sanadi.Application.Documents;

public sealed record LetterFact(string Label, string Value);

/// <summary>
/// One printable letter page (English or Arabic). Mirrors the core
/// <c>LetterSection</c> contract used by the institutional PDF renderer.
/// </summary>
public sealed class LetterSection
{
    public required string Language { get; init; } // "en" | "ar"
    public required string Header { get; init; }
    public required string SubHeader { get; init; }
    public required string Title { get; init; }
    public required string Body { get; init; }
    public required string Footer { get; init; }
    public required string Signatory { get; init; }
    public string? Disclaimer { get; init; }
    public required string IssuedLabel { get; init; }
    public required string IssuedValue { get; init; }
    public required string ReferenceLabel { get; init; }
    public required string ReferenceValue { get; init; }
    public required string VerifyLabel { get; init; }
    public required string VerifyHint { get; init; }
    public required string VerifyUrl { get; init; }
    public string? RetentionNote { get; init; }
    public string? DemoBadge { get; init; }
    public required string PageLabel { get; init; }
    public required IReadOnlyList<LetterFact> MetaFacts { get; init; }
    public required string PanelTitle { get; init; }
    public required IReadOnlyList<LetterFact> StudentFacts { get; init; }
    public string? TrustBadge { get; init; }
}

public sealed record LetterFieldFlags(
    bool IncludeProgramme = true,
    bool IncludeCollege = true,
    bool IncludeTerm = true,
    bool IncludeExpectedGraduation = false);

public interface ILetterPdfRenderer
{
    byte[] Render(IReadOnlyList<LetterSection> sections);
}

public interface IEnrolmentLetterIssuer
{
    Task<IssuedEnrolmentLetter> IssueAsync(
        Guid studentId,
        string language,
        string purpose,
        LetterFieldFlags fields,
        Guid? conversationId,
        string? requestOrigin,
        CancellationToken cancellationToken = default);
}

public sealed record IssuedEnrolmentLetter(
    Guid Id,
    string ReferenceNumber,
    string Language,
    string Purpose,
    string Status,
    DateTimeOffset IssuedAt,
    DateTimeOffset? ExpiresAt,
    DateTimeOffset RetentionExpiresAt,
    int RetentionDays,
    string VerifyUrl,
    string VerifyToken,
    string DocumentHash,
    string TemplateVersion,
    bool IsDemoDocument,
    string FileName,
    bool Replayed);
