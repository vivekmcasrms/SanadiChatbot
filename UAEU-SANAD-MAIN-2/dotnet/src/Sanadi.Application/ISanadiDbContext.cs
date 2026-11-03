using Microsoft.EntityFrameworkCore;
using Sanadi.Domain;

namespace Sanadi.Application;

/// <summary>Data port. Row-level security is enforced in the application layer
/// (every query is scoped by the authenticated user id / role) exactly like the
/// original Supabase RLS policies.</summary>
public interface ISanadiDbContext
{
    DbSet<Profile> Profiles { get; }
    DbSet<UserRole> UserRoles { get; }
    DbSet<ServiceUnit> ServiceUnits { get; }
    DbSet<ServiceCatalogItem> ServiceCatalog { get; }
    DbSet<StudentHold> StudentHolds { get; }
    DbSet<Conversation> Conversations { get; }
    DbSet<ChatMessage> ChatMessages { get; }
    DbSet<ServiceCase> Cases { get; }
    DbSet<CaseMessage> CaseMessages { get; }
    DbSet<IssuedDocument> IssuedDocuments { get; }
    DbSet<KnowledgeSource> KnowledgeSources { get; }
    DbSet<KnowledgeChunk> KnowledgeChunks { get; }
    DbSet<AuditEntry> AuditLog { get; }

    Task<int> SaveChangesAsync(CancellationToken ct = default);
}
