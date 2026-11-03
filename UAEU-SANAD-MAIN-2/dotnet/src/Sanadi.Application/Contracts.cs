using Sanadi.Domain;

namespace Sanadi.Application;

public enum Lang { En, Ar }

public sealed record Citation(
    string SourceTitle,
    string? OwningUnit,
    string? SectionTitle,
    int? PageNumber,
    string? Url,
    double Score);

public sealed record ProposedAction(
    string Key,
    string LabelEn,
    string LabelAr,
    string Risk,
    string AffectedService,
    string DataShared,
    string ExpectedOutcome,
    string? ToolName = null,
    IDictionary<string, object?>? Args = null);

public sealed record ActionReceipt(
    string ReceiptNumber,
    string? ReferenceNumber,
    string ActionType,
    string? ResponsibleUnit,
    DateTimeOffset SubmittedAt,
    string? NextStep,
    string? TrackingUrl);

public sealed record Classification(
    string Intent,           // query | suggestion | complaint | alert | smalltalk | unknown
    string Category,
    Lang Language,
    string Urgency,
    string? RequiredUnitCode,
    bool RequiresStudentData,
    bool ActionRequested,
    bool RequiresHumanEscalation,
    double Confidence);

public sealed record AgentResponse
{
    public required Classification Classification { get; init; }
    public required string Answer { get; init; }
    public bool Verified { get; init; }
    public bool Conversational { get; init; }
    public IReadOnlyList<Citation> Citations { get; init; } = Array.Empty<Citation>();
    public IReadOnlyList<ProposedAction> ProposedActions { get; init; } = Array.Empty<ProposedAction>();
    public Guid? ConversationId { get; init; }
    public string ResponseType { get; init; } = "answer";
    public IReadOnlyList<string> ToolsUsed { get; init; } = Array.Empty<string>();
    public ActionReceipt? Receipt { get; init; }
    public bool HumanHandoff { get; init; }
    public string? TraceId { get; init; }
}

public sealed record AskRequest(
    string Message,
    Guid? ConversationId,
    Lang Language,
    Guid UserId,
    IReadOnlyList<string> Roles);

public sealed record ExecuteActionRequest(
    string ToolName,
    IDictionary<string, object?> Args,
    Guid? ConversationId,
    Lang Language,
    Guid UserId,
    IReadOnlyList<string> Roles);

public sealed record StudentSnapshot
{
    public bool HasProfile { get; init; }
    public string? FullName { get; init; }
    public string? StudentNumber { get; init; }
    public string? Programme { get; init; }
    public string? College { get; init; }
    public string? Level { get; init; }
    public decimal? Gpa { get; init; }
    public string? Standing { get; init; }
    public int CompletedCredits { get; init; }
    public int RegisteredCredits { get; init; }
    public int TotalCredits { get; init; }
    public int PreviousTransfers { get; init; }
    public DateOnly? ExpectedGraduation { get; init; }
    public IReadOnlyList<StudentHold> Holds { get; init; } = Array.Empty<StudentHold>();
    public int OpenCases { get; init; }
}

public sealed record RetrievedPassage(
    Guid SourceId,
    string SourceTitle,
    string SourceType,
    string? SectionTitle,
    int? PageNumber,
    string? Url,
    string Content,
    double Score);

// ---------------------------------------------------------------- ports

public interface IChatModel
{
    Task<string> CompleteAsync(IReadOnlyList<ModelMessage> messages, ModelOptions? options = null,
        CancellationToken ct = default);

    IAsyncEnumerable<string> StreamAsync(IReadOnlyList<ModelMessage> messages, ModelOptions? options = null,
        CancellationToken ct = default);
}

public sealed record ModelMessage(string Role, string Content);
public sealed record ModelOptions(string? Model = null, double Temperature = 0.2, int MaxTokens = 1600);

public interface IEmbeddingModel
{
    Task<float[]> EmbedAsync(string text, CancellationToken ct = default);
}

public interface IKnowledgeRetriever
{
    Task<IReadOnlyList<RetrievedPassage>> SearchAsync(string query, Lang lang, int clearance, int limit = 6,
        CancellationToken ct = default);
}

public interface IFileStorage
{
    Task<string> UploadAsync(string bucket, string path, Stream content, string contentType, CancellationToken ct = default);
    Task<Stream> DownloadAsync(string bucket, string path, CancellationToken ct = default);
    Task DeleteAsync(string bucket, string path, CancellationToken ct = default);
}

public interface IEmailSender
{
    Task SendAsync(string to, string subject, string html, CancellationToken ct = default);
}

public interface IPdfLetterService
{
    Task<(byte[] Pdf, string VerificationToken)> BuildEnrolmentLetterAsync(StudentSnapshot student, Lang lang,
        string purpose, bool includeGraduationDate, CancellationToken ct = default);
}
