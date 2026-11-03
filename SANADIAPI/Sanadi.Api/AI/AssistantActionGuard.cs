using System.Data.Common;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.AI;

/// <summary>Server-owned proposal validation and atomic use of existing idempotency storage.</summary>
internal static class AssistantActionGuard
{
    internal sealed record Claim(bool Acquired, string? Status, string? ResponseSnapshot);

    internal static async Task<JsonObject> ResolveStoredArgsAsync(
        DbConnection db,
        Guid userId,
        Guid? conversationId,
        Guid? messageId,
        string? actionKey,
        string toolName,
        JsonObject browserArgs,
        CancellationToken ct)
    {
        // Compatibility for non-chat callers. Chat buttons always include the
        // assistant message id and are validated against the persisted proposal.
        if (messageId is null) return browserArgs;
        const string sql = """
            SELECT TOP (1) metadata
            FROM dbo.messages
            WHERE id=@messageId AND user_id=@userId AND role=N'assistant'
              AND (@conversationId IS NULL OR conversation_id=@conversationId);
            """;
        var raw = await db.ExecuteScalarAsync<string?>(new CommandDefinition(
            sql, new { messageId, userId, conversationId }, cancellationToken: ct));
        JsonArray? proposals;
        try { proposals = JsonNode.Parse(raw ?? "{}")?["proposedActions"] as JsonArray; }
        catch (JsonException) { proposals = null; }
        var stored = proposals?.OfType<JsonObject>().FirstOrDefault(p =>
            string.Equals(p["toolName"]?.GetValue<string>() ?? p["key"]?.GetValue<string>(), toolName,
                StringComparison.Ordinal) &&
            (string.IsNullOrWhiteSpace(actionKey) ||
             string.Equals(p["key"]?.GetValue<string>(), actionKey, StringComparison.Ordinal)));
        if (stored is null) throw new ForbiddenException("The confirmed action no longer matches the saved chat proposal.");

        var args = stored["args"] is JsonObject saved ? (JsonObject)saved.DeepClone() : new JsonObject();
        // The confirmation dialog deliberately permits the student to edit the
        // human-readable draft. Routing, unit, identity, risk and record ids stay
        // server-owned and cannot be replaced by browser arguments.
        foreach (var key in new[] { "title", "subject", "description", "message" })
            if (browserArgs[key] is JsonValue value && value.TryGetValue<string>(out var text))
                args[key] = text;
        return args;
    }

    internal static async Task<Claim> TryClaimAsync(
        DbConnection db, Guid userId, string key, string operationType, CancellationToken ct)
    {
        const string insert = """
            INSERT dbo.operation_idempotency
                (id,idempotency_key,operation_type,user_profile_id,request_hash,status,created_at,expires_at)
            VALUES
                (NEWID(),@key,@operationType,@userId,@key,N'in_progress',SYSDATETIMEOFFSET(),DATEADD(day,7,SYSDATETIMEOFFSET()));
            """;
        try
        {
            await db.ExecuteAsync(new CommandDefinition(insert, new { key, operationType, userId }, cancellationToken: ct));
            return new(true, "in_progress", null);
        }
        catch (SqlException ex) when (ex.Number is 2601 or 2627)
        {
            // A failed attempt is safe to retry. Claim it with a conditional
            // update so only one concurrent retry can become the executor.
            const string retry = """
                UPDATE dbo.operation_idempotency
                SET status=N'in_progress', response_snapshot=NULL,
                    created_at=SYSDATETIMEOFFSET(), expires_at=DATEADD(day,7,SYSDATETIMEOFFSET())
                WHERE idempotency_key=@key AND user_profile_id=@userId AND status=N'failed';
                """;
            var reclaimed = await db.ExecuteAsync(new CommandDefinition(
                retry, new { key, userId }, cancellationToken: ct));
            if (reclaimed == 1) return new(true, "in_progress", null);

            const string read = """
                SELECT status, response_snapshot
                FROM dbo.operation_idempotency
                WHERE idempotency_key=@key AND user_profile_id=@userId;
                """;
            var row = await db.QueryFirstOrDefaultAsync(new CommandDefinition(read, new { key, userId }, cancellationToken: ct));
            return new(false, row is null ? null : (string?)row.status,
                row is null ? null : (string?)row.response_snapshot);
        }
    }

    internal static Task CompleteAsync(
        DbConnection db, Guid userId, string key, object response, CancellationToken ct) =>
        db.ExecuteAsync(new CommandDefinition("""
            UPDATE dbo.operation_idempotency
            SET status=N'completed', response_snapshot=@snapshot
            WHERE idempotency_key=@key AND user_profile_id=@userId;
            """, new { key, userId, snapshot = JsonSerializer.Serialize(response) }, cancellationToken: ct));

    internal static Task FailAsync(DbConnection db, Guid userId, string key, CancellationToken ct, bool uncertain = false) =>
        db.ExecuteAsync(new CommandDefinition("""
            UPDATE dbo.operation_idempotency
            SET status=@status
            WHERE idempotency_key=@key AND user_profile_id=@userId AND status=N'in_progress';
            """, new { key, userId, status = uncertain ? "needs_reconciliation" : "failed" }, cancellationToken: ct));
}
