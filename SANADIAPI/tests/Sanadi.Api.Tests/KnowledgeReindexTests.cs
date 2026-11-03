using System.Data;
using System.Data.Common;
using Microsoft.Data.SqlClient;
using Sanadi.Infrastructure.Knowledge;

namespace Sanadi.Api.Tests;

public sealed class KnowledgeReindexTests
{
    [Theory]
    [InlineData("insert")]
    [InlineData("status")]
    [InlineData("cancel")]
    public async Task Failed_reindex_rolls_back_chunks_and_document_status(string failure)
    {
        await using var db = new ReindexDatabase(failure);
        var service = new KnowledgeDocumentOpsService(new KnowledgeEmbeddingsService(null!, new NoEmbeddings()), null!, null!);
        await Assert.ThrowsAnyAsync<Exception>(() => service.ReprocessAsync(db, Guid.NewGuid()));
        Assert.Equal(new[] { "original-chunk-id" }, db.Chunks);
        Assert.Equal("published", db.Status);
        Assert.True(db.Transaction!.RolledBack);
    }

    [Fact]
    public async Task Successful_reindex_commits_chunks_and_status_together()
    {
        await using var db = new ReindexDatabase(null);
        var service = new KnowledgeDocumentOpsService(new KnowledgeEmbeddingsService(null!, new NoEmbeddings()), null!, null!);
        var result = await service.ReprocessAsync(db, Guid.NewGuid());
        Assert.True(result.Chunks > 0);
        Assert.DoesNotContain("original-chunk-id", db.Chunks);
        Assert.Equal("ready_for_review", db.Status);
        Assert.True(db.Transaction!.Committed);
    }

    private sealed class NoEmbeddings : IEmbeddingSettingsProvider
    {
        public Task<EmbeddingSettings?> LoadAsync(CancellationToken ct = default) => Task.FromResult<EmbeddingSettings?>(null);
    }

    // Transaction-aware procedure double: validates that every destructive command
    // participates in the same transaction, including the final status update.
    private sealed class ReindexDatabase(string? failure) : DbConnection
    {
        private ConnectionState state;
        public List<string> Chunks = ["original-chunk-id"];
        public string Status = "published";
        public ReindexTransaction? Transaction;
        [System.Diagnostics.CodeAnalysis.AllowNull]
        public override string ConnectionString { get; set; } = "";
        public override string Database => "test";
        public override string DataSource => "test";
        public override string ServerVersion => "1";
        public override ConnectionState State => state;
        public override void Open() => state = ConnectionState.Open;
        public override void Close() => state = ConnectionState.Closed;
        public override void ChangeDatabase(string databaseName) => throw new NotSupportedException();
        protected override DbTransaction BeginDbTransaction(IsolationLevel isolationLevel) => Transaction = new(this);
        protected override DbCommand CreateDbCommand() => new ReindexCommand(this);

        public int Execute(string proc, DbTransaction? transaction)
        {
            Assert.Same(Transaction, transaction);
            Assert.NotNull(transaction);
            if (proc.EndsWith("DeleteChunks")) Chunks.Clear();
            else if (proc.EndsWith("InsertChunk"))
            {
                if (failure == "insert") throw new InvalidOperationException("Injected insert failure");
                if (failure == "cancel") throw new OperationCanceledException();
                Chunks.Add(Guid.NewGuid().ToString());
            }
            else if (proc.EndsWith("UpdateAfterReprocess"))
            {
                Status = "ready_for_review";
                if (failure == "status") throw new InvalidOperationException("Injected status failure");
            }
            else throw new NotSupportedException(proc);
            return 1;
        }

        public DbDataReader Read(string proc)
        {
            var table = new DataTable();
            if (proc.EndsWith("GetForReprocess"))
            {
                foreach (var name in new[] { "title", "storage_path", "mime_type", "language", "version", "effective_date", "expiry_date", "approval_status", "is_active", "is_current", "deleted_at", "superseded_by_document_id" })
                    table.Columns.Add(name, typeof(object));
                table.Rows.Add("Research", DBNull.Value, DBNull.Value, "en", "1", new DateTime(2020,1,1), DBNull.Value, "approved", true, true, DBNull.Value, DBNull.Value);
            }
            else if (proc.EndsWith("ListChunkContents"))
            {
                table.Columns.Add("chunk_index", typeof(int));
                table.Columns.Add("content", typeof(string));
                table.Rows.Add(1, "## Research objectives\n" + string.Join(" ", Enumerable.Repeat("Research policy supports scholarly activities and responsible research.", 12)));
            }
            else throw new NotSupportedException(proc);
            return table.CreateDataReader();
        }
    }

    private sealed class ReindexTransaction(ReindexDatabase db) : DbTransaction
    {
        private readonly List<string> original = [.. db.Chunks];
        private readonly string originalStatus = db.Status;
        public bool Committed;
        public bool RolledBack;
        public override IsolationLevel IsolationLevel => IsolationLevel.ReadCommitted;
        protected override DbConnection DbConnection => db;
        public override void Commit() => Committed = true;
        public override void Rollback() { db.Chunks = original; db.Status = originalStatus; RolledBack = true; }
        protected override void Dispose(bool disposing) { if (disposing && !Committed) Rollback(); base.Dispose(disposing); }
    }

    private sealed class ReindexCommand(ReindexDatabase db) : DbCommand
    {
        private readonly SqlCommand parameters = new();
        [System.Diagnostics.CodeAnalysis.AllowNull]
        public override string CommandText { get; set; } = "";
        public override int CommandTimeout { get; set; }
        public override CommandType CommandType { get; set; }
        public override bool DesignTimeVisible { get; set; }
        public override UpdateRowSource UpdatedRowSource { get; set; }
        protected override DbConnection? DbConnection { get; set; } = db;
        protected override DbTransaction? DbTransaction { get; set; }
        protected override DbParameterCollection DbParameterCollection => parameters.Parameters;
        protected override DbParameter CreateDbParameter() => new SqlParameter();
        protected override DbDataReader ExecuteDbDataReader(CommandBehavior behavior) => db.Read(CommandText);
        public override int ExecuteNonQuery() => db.Execute(CommandText, DbTransaction);
        public override object? ExecuteScalar() => throw new NotSupportedException();
        public override void Cancel() { }
        public override void Prepare() { }
        protected override void Dispose(bool disposing) { if (disposing) parameters.Dispose(); base.Dispose(disposing); }
    }
}
