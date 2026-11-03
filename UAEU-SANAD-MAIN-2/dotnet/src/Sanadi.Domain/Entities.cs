namespace Sanadi.Domain;

public class Profile
{
    public Guid Id { get; set; }
    public string? FullName { get; set; }
    public string? FullNameAr { get; set; }
    public string? Email { get; set; }
    public string? StudentNumber { get; set; }
    public string? ProgramNameEn { get; set; }
    public string? ProgramNameAr { get; set; }
    public string? CollegeNameEn { get; set; }
    public string? Level { get; set; }
    public decimal? Gpa { get; set; }
    public string? Standing { get; set; }
    public int CompletedCredits { get; set; }
    public int RegisteredCredits { get; set; }
    public int? TotalCredits { get; set; }
    public int PreviousTransfers { get; set; }
    public DateOnly? ExpectedGraduation { get; set; }
    public string PreferredLanguage { get; set; } = "en";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class UserRole
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string Role { get; set; } = "student";
}

public class ServiceUnit
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Code { get; set; } = string.Empty;
    public string NameEn { get; set; } = string.Empty;
    public string NameAr { get; set; } = string.Empty;
    public string? ContactEmail { get; set; }
    public string? PhoneExtension { get; set; }
    public string? OfficeLocationEn { get; set; }
    public string? OfficeLocationAr { get; set; }
    public string? ServiceHoursEn { get; set; }
    public string? ServiceHoursAr { get; set; }
}

public class ServiceCatalogItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Code { get; set; } = string.Empty;
    public string NameEn { get; set; } = string.Empty;
    public string NameAr { get; set; } = string.Empty;
    public Guid? UnitId { get; set; }
    public ServiceUnit? Unit { get; set; }
    public bool IsActive { get; set; } = true;
    public bool IsInstant { get; set; }
    public int EstimatedDays { get; set; }
}

public class StudentHold
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StudentId { get; set; }
    public string TitleEn { get; set; } = string.Empty;
    public string TitleAr { get; set; } = string.Empty;
    public string? DescriptionEn { get; set; }
    public string? DescriptionAr { get; set; }
    public string? ResolutionEn { get; set; }
    public string? ResolutionAr { get; set; }
    public bool BlocksRegistration { get; set; }
    public bool BlocksGraduation { get; set; }
    public bool IsActive { get; set; } = true;
}

public class Conversation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StudentId { get; set; }
    public string? Title { get; set; }
    public string Language { get; set; } = "en";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public List<ChatMessage> Messages { get; set; } = new();
}

public class ChatMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ConversationId { get; set; }
    public Conversation? Conversation { get; set; }
    public string Role { get; set; } = "user";      // user | assistant | system
    public string Content { get; set; } = string.Empty;
    public string? MetadataJson { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class ServiceCase
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string ReferenceNumber { get; set; } = string.Empty;
    public Guid StudentId { get; set; }
    public Guid? UnitId { get; set; }
    public ServiceUnit? Unit { get; set; }
    public Guid? AssignedTo { get; set; }
    public string CaseType { get; set; } = "request";   // request | complaint | suggestion | alert
    public string Category { get; set; } = "general";
    public string Status { get; set; } = CaseStatus.New;
    public string Urgency { get; set; } = "medium";
    public string Subject { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public bool RequiresHuman { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? FirstResponseAt { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }
    public DateTimeOffset? SlaDueAt { get; set; }
    public List<CaseMessage> Messages { get; set; } = new();
}

public class CaseMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CaseId { get; set; }
    public ServiceCase? Case { get; set; }
    public Guid AuthorId { get; set; }
    public string AuthorRole { get; set; } = "student";
    public string Body { get; set; } = string.Empty;
    public bool InternalOnly { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class IssuedDocument
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StudentId { get; set; }
    public string DocumentType { get; set; } = "twimc_letter";
    public string Language { get; set; } = "en";
    public string Purpose { get; set; } = "general";
    public string VerificationToken { get; set; } = string.Empty;
    public string StoragePath { get; set; } = string.Empty;
    public DateTimeOffset IssuedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ExpiresAt { get; set; }
    public bool Revoked { get; set; }
}

public class KnowledgeSource
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Title { get; set; } = string.Empty;
    public string SourceType { get; set; } = "document";   // document | url | api
    public string Status { get; set; } = KnowledgeStatus.Processing;
    public string Language { get; set; } = "en";
    public string Confidentiality { get; set; } = "student_authenticated";
    public string? Domain { get; set; }
    public Guid? UnitId { get; set; }
    public string? Version { get; set; }
    public string? SourceUrl { get; set; }
    public string? StoragePath { get; set; }
    public Guid? AddedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? LastIndexedAt { get; set; }
    public int IndexedChunks { get; set; }
    public List<KnowledgeChunk> Chunks { get; set; } = new();
}

public class KnowledgeChunk
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SourceId { get; set; }
    public KnowledgeSource? Source { get; set; }
    public int ChunkIndex { get; set; }
    public int? PageNumber { get; set; }
    public string? SectionTitle { get; set; }
    public string Content { get; set; } = string.Empty;
    public string Language { get; set; } = "en";
    /// <summary>Serialized float vector (pgvector column mapped as text when the extension is unavailable).</summary>
    public string? Embedding { get; set; }
}

public class AuditEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? ActorId { get; set; }
    public string Action { get; set; } = string.Empty;
    public string EntityType { get; set; } = string.Empty;
    public string? EntityId { get; set; }
    public string Summary { get; set; } = string.Empty;
    public string? DetailsJson { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
