using Microsoft.EntityFrameworkCore;
using Sanadi.Application;
using Sanadi.Domain;

namespace Sanadi.Infrastructure.Persistence;

public class SanadiDbContext(DbContextOptions<SanadiDbContext> options) : DbContext(options), ISanadiDbContext
{
    public DbSet<Profile> Profiles => Set<Profile>();
    public DbSet<UserRole> UserRoles => Set<UserRole>();
    public DbSet<ServiceUnit> ServiceUnits => Set<ServiceUnit>();
    public DbSet<ServiceCatalogItem> ServiceCatalog => Set<ServiceCatalogItem>();
    public DbSet<StudentHold> StudentHolds => Set<StudentHold>();
    public DbSet<Conversation> Conversations => Set<Conversation>();
    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();
    public DbSet<ServiceCase> Cases => Set<ServiceCase>();
    public DbSet<CaseMessage> CaseMessages => Set<CaseMessage>();
    public DbSet<IssuedDocument> IssuedDocuments => Set<IssuedDocument>();
    public DbSet<KnowledgeSource> KnowledgeSources => Set<KnowledgeSource>();
    public DbSet<KnowledgeChunk> KnowledgeChunks => Set<KnowledgeChunk>();
    public DbSet<AuditEntry> AuditLog => Set<AuditEntry>();

    public Task<int> SaveChangesAsync(CancellationToken ct = default) => base.SaveChangesAsync(ct);

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema("public");

        b.Entity<Profile>(e =>
        {
            e.ToTable("profiles");
            e.HasKey(x => x.Id);
            e.Property(x => x.Gpa).HasPrecision(4, 2);
            e.HasIndex(x => x.StudentNumber).IsUnique();
        });

        b.Entity<UserRole>(e =>
        {
            e.ToTable("user_roles");
            e.HasIndex(x => new { x.UserId, x.Role }).IsUnique();
        });

        b.Entity<ServiceUnit>(e =>
        {
            e.ToTable("service_units");
            e.HasIndex(x => x.Code).IsUnique();
        });

        b.Entity<ServiceCatalogItem>(e =>
        {
            e.ToTable("service_catalog");
            e.HasIndex(x => x.Code).IsUnique();
            e.HasOne(x => x.Unit).WithMany().HasForeignKey(x => x.UnitId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<StudentHold>(e =>
        {
            e.ToTable("student_holds");
            e.HasIndex(x => x.StudentId);
        });

        b.Entity<Conversation>(e =>
        {
            e.ToTable("conversations");
            e.HasIndex(x => x.StudentId);
            e.HasMany(x => x.Messages).WithOne(x => x.Conversation!)
                .HasForeignKey(x => x.ConversationId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ChatMessage>(e =>
        {
            e.ToTable("chat_messages");
            e.HasIndex(x => new { x.ConversationId, x.CreatedAt });
            e.Property(x => x.MetadataJson).HasColumnType("jsonb");
        });

        b.Entity<ServiceCase>(e =>
        {
            e.ToTable("cases");
            e.HasIndex(x => x.ReferenceNumber).IsUnique();
            e.HasIndex(x => new { x.UnitId, x.Status });
            e.HasIndex(x => new { x.StudentId, x.Status });
            e.HasOne(x => x.Unit).WithMany().HasForeignKey(x => x.UnitId).OnDelete(DeleteBehavior.SetNull);
            e.HasMany(x => x.Messages).WithOne(x => x.Case!)
                .HasForeignKey(x => x.CaseId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<CaseMessage>().ToTable("case_messages");

        b.Entity<IssuedDocument>(e =>
        {
            e.ToTable("issued_documents");
            e.HasIndex(x => x.VerificationToken).IsUnique();
            e.HasIndex(x => x.StudentId);
        });

        b.Entity<KnowledgeSource>(e =>
        {
            e.ToTable("knowledge_sources");
            e.HasMany(x => x.Chunks).WithOne(x => x.Source!)
                .HasForeignKey(x => x.SourceId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.SourceType, x.Status });
        });

        b.Entity<KnowledgeChunk>(e =>
        {
            e.ToTable("knowledge_chunks");
            e.HasIndex(x => x.SourceId);
            e.HasIndex(x => x.SectionTitle);
            // Full-text search index for the lexical half of hybrid retrieval.
            e.HasIndex(x => x.Content).HasMethod("gin")
                .IsTsVectorExpressionIndex("simple");
        });

        b.Entity<AuditEntry>(e =>
        {
            e.ToTable("knowledge_audit_log");
            e.Property(x => x.DetailsJson).HasColumnType("jsonb");
            e.HasIndex(x => x.CreatedAt);
        });

        base.OnModelCreating(b);
    }
}
