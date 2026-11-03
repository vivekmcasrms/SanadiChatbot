using System.Data;
using System.Data.Common;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;

namespace Sanadi.Api.AI;

/// <summary>
/// Uses the existing conversation_state table without schema or procedure changes.
/// Saves are serialized with a SQL application lock, re-read, and three-way merged
/// so simultaneous turns do not silently replace unrelated context.
/// </summary>
internal static class AssistantConversationStateStore
{
    private static readonly string[] ContextKeys =
        ["concernContext", "appointmentContext", "alertContext", "textbookContext", "activeCaseReference"];
    private static readonly TimeSpan ContextTtl = TimeSpan.FromMinutes(30);

    internal sealed record State(
        Guid? Id,
        Guid ConversationId,
        Guid UserId,
        string? Summary,
        JsonObject Entities,
        JsonArray PendingQuestions,
        string? PendingConfirmationType,
        JsonNode? PendingConfirmationPayload,
        string? LastAgentType,
        string Language,
        string HumanHandoffState,
        int TurnCount,
        DateTimeOffset UpdatedAt);

    internal static async Task<State?> LoadAsync(DbConnection db, Guid conversationId, Guid userId, CancellationToken ct)
    {
        const string sql = """
            SELECT id, conversation_id, user_id, summary, extracted_entities, pending_questions,
                   pending_confirmation_type, pending_confirmation_payload, last_agent_type,
                   language, human_handoff_state, turn_count, updated_at
            FROM dbo.conversation_state
            WHERE conversation_id=@conversationId AND user_id=@userId;
            """;
        var row = await db.QueryFirstOrDefaultAsync(new CommandDefinition(sql, new { conversationId, userId }, cancellationToken: ct));
        return row is null ? null : Map(row);
    }

    internal static JsonObject RoutingMetadata(State? state)
    {
        if (state is null || DateTimeOffset.UtcNow - state.UpdatedAt > ContextTtl) return new();
        var result = new JsonObject();
        foreach (var key in ContextKeys)
            if (state.Entities[key] is { } value) result[key] = value.DeepClone();
        return result;
    }

    internal static async Task SaveTurnAsync(
        DbConnection db,
        State? turnBase,
        Guid conversationId,
        Guid userId,
        JsonObject response,
        CancellationToken ct, string? userMessage = null)
    {
        if (db.State != ConnectionState.Open) await db.OpenAsync(ct);
        await using var tx = await db.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        try
        {
            const string lockSql = """
                DECLARE @result int;
                EXEC @result = sys.sp_getapplock
                    @Resource=@resource, @LockMode=N'Exclusive', @LockOwner=N'Transaction', @LockTimeout=5000;
                IF @result < 0 THROW 51000, 'conversation_state_lock_timeout', 1;
                """;
            await db.ExecuteAsync(new CommandDefinition(lockSql,
                new { resource = $"sanadi:conversation:{conversationId:D}" }, tx, cancellationToken: ct));

            var current = await LoadForUpdateAsync(db, tx, conversationId, userId, ct);
            var proposed = BuildProposal(turnBase, conversationId, userId, response, userMessage);
            var merged = Merge(turnBase, current, proposed);

            if (current is null)
            {
                const string insert = """
                    INSERT dbo.conversation_state
                        (id,conversation_id,user_id,summary,active_intents,extracted_entities,pending_questions,
                         pending_confirmation_type,pending_confirmation_payload,last_agent_type,language,
                         human_handoff_state,turn_count,created_at,updated_at)
                    VALUES
                        (@Id,@ConversationId,@UserId,@Summary,@ActiveIntents,@Entities,@PendingQuestions,
                         @PendingType,@PendingPayload,@LastAgent,@Language,@Handoff,@TurnCount,
                         SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
                    """;
                await db.ExecuteAsync(new CommandDefinition(insert, Parameters(merged, response), tx, cancellationToken: ct));
            }
            else
            {
                const string update = """
                    UPDATE dbo.conversation_state
                    SET summary=@Summary, active_intents=@ActiveIntents, extracted_entities=@Entities,
                        pending_questions=@PendingQuestions, pending_confirmation_type=@PendingType,
                        pending_confirmation_payload=@PendingPayload, last_agent_type=@LastAgent,
                        language=@Language, human_handoff_state=@Handoff, turn_count=@TurnCount,
                        updated_at=SYSDATETIMEOFFSET()
                    WHERE id=@Id AND conversation_id=@ConversationId AND user_id=@UserId;
                    """;
                await db.ExecuteAsync(new CommandDefinition(update, Parameters(merged, response), tx, cancellationToken: ct));
            }
            await tx.CommitAsync(ct);
        }
        catch
        {
            await tx.RollbackAsync(CancellationToken.None);
            throw;
        }
    }

    internal static State Merge(State? turnBase, State? current, State proposed)
    {
        if (current is null) return proposed with { TurnCount = 1 };
        var baseEntities = turnBase?.Entities ?? new JsonObject();
        var mergedEntities = (JsonObject)current.Entities.DeepClone();
        var conflicts = new JsonArray();
        foreach (var key in baseEntities.Select(p => p.Key).Union(proposed.Entities.Select(p => p.Key)))
        {
            var pair = new KeyValuePair<string, JsonNode?>(key, proposed.Entities[key]);
            var baseValue = baseEntities[pair.Key];
            if (JsonEqual(pair.Value, baseValue)) continue;
            var currentValue = current.Entities[pair.Key];
            var currentChanged = !JsonEqual(currentValue, baseValue);
            if (currentChanged && !JsonEqual(currentValue, pair.Value))
            {
                conflicts.Add(pair.Key);
                continue;
            }
            if (!proposed.Entities.ContainsKey(pair.Key)) mergedEntities.Remove(pair.Key);
            else mergedEntities[pair.Key] = pair.Value?.DeepClone();
        }
        if (conflicts.Count > 0) mergedEntities["stateConflicts"] = conflicts;

        var pendingType = proposed.PendingConfirmationType;
        var pendingPayload = proposed.PendingConfirmationPayload?.DeepClone();
        if (turnBase is not null && current.PendingConfirmationType != turnBase.PendingConfirmationType &&
            current.PendingConfirmationType is not null)
        {
            pendingType = current.PendingConfirmationType;
            pendingPayload = current.PendingConfirmationPayload?.DeepClone();
        }

        var proposedLine = proposed.Summary?.Split('\n', StringSplitOptions.RemoveEmptyEntries).LastOrDefault();
        var summary = $"{current.Summary}{(string.IsNullOrWhiteSpace(current.Summary) ? "" : "\n")}{proposedLine}";
        if (summary.Length > 450) summary = summary[^450..];
        return proposed with
        {
            Id = current.Id,
            Summary = summary,
            Entities = mergedEntities,
            PendingConfirmationType = pendingType,
            PendingConfirmationPayload = pendingPayload,
            TurnCount = current.TurnCount + 1,
            UpdatedAt = DateTimeOffset.UtcNow
        };
    }

    private static State BuildProposal(State? previous, Guid conversationId, Guid userId, JsonObject response, string? userMessage)
    {
        var entities = previous is null ? new JsonObject() : (JsonObject)previous.Entities.DeepClone();
        var classification = response["classification"] as JsonObject;
        var intent = classification?["intent"]?.GetValue<string>() ?? "query";
        var category = classification?["category"]?.GetValue<string>() ?? intent;
        var oldIntent = entities["activeIntent"]?.GetValue<string>();
        var oldCategory = entities["activeCategory"]?.GetValue<string>();
        if (previous is not null && DateTimeOffset.UtcNow - previous.UpdatedAt > ContextTtl ||
            oldIntent is not null && !string.Equals(oldIntent, intent, StringComparison.OrdinalIgnoreCase) ||
            oldCategory is not null && !string.Equals(oldCategory, category, StringComparison.OrdinalIgnoreCase))
        {
            foreach (var key in ContextKeys) entities.Remove(key);
        }
        entities["activeIntent"] = intent;
        entities["activeCategory"] = category;
        var answer = (string?)response["answer"] ?? "";
        entities["lastAnswer"] = answer[..Math.Min(answer.Length, 1600)];
        entities["lastUserQuestion"] = userMessage?[..Math.Min(userMessage.Length, 1600)];
        entities["lastQuestion"] = response["clarifyingQuestion"]?.DeepClone();
        entities["contextUpdatedAt"] = DateTimeOffset.UtcNow.ToString("O");
        foreach (var key in ContextKeys)
        {
            if (response.TryGetPropertyValue(key, out var value))
                entities[key] = value?.DeepClone();
        }

        var clarification = response["clarifyingQuestion"]?.GetValue<string>();
        var pendingQuestions = string.IsNullOrWhiteSpace(clarification) ? new JsonArray() : new JsonArray(clarification);
        var proposals = response["proposedActions"] as JsonArray;
        var first = proposals?.FirstOrDefault() as JsonObject;
        var pendingType = first?["toolName"]?.GetValue<string>();
        var pendingPayload = first?["args"]?.DeepClone();
        var handoff = response["humanHandoff"]?.GetValue<bool>() == true ? "requested" : "none";
        var agent = response["agent"]?.GetValue<string>() ?? "orchestrator";
        var language = classification?["language"]?.GetValue<string>() ?? previous?.Language ?? "en";
        return new State(previous?.Id, conversationId, userId, $"Turn: {intent} -> {response["responseType"]}",
            entities, pendingQuestions, pendingType, pendingPayload, agent, language, handoff,
            (previous?.TurnCount ?? 0) + 1, DateTimeOffset.UtcNow);
    }

    private static async Task<State?> LoadForUpdateAsync(
        DbConnection db, DbTransaction tx, Guid conversationId, Guid userId, CancellationToken ct)
    {
        const string sql = """
            SELECT id, conversation_id, user_id, summary, extracted_entities, pending_questions,
                   pending_confirmation_type, pending_confirmation_payload, last_agent_type,
                   language, human_handoff_state, turn_count, updated_at
            FROM dbo.conversation_state WITH (UPDLOCK,HOLDLOCK)
            WHERE conversation_id=@conversationId AND user_id=@userId;
            """;
        var row = await db.QueryFirstOrDefaultAsync(new CommandDefinition(sql, new { conversationId, userId }, tx, cancellationToken: ct));
        return row is null ? null : Map(row);
    }

    private static object Parameters(State state, JsonObject response) => new
    {
        Id = state.Id ?? Guid.NewGuid(),
        state.ConversationId,
        state.UserId,
        state.Summary,
        ActiveIntents = response["intents"]?.ToJsonString() ?? "[]",
        Entities = state.Entities.ToJsonString(),
        PendingQuestions = state.PendingQuestions.ToJsonString(),
        PendingType = state.PendingConfirmationType,
        PendingPayload = state.PendingConfirmationPayload?.ToJsonString(),
        LastAgent = state.LastAgentType,
        state.Language,
        Handoff = state.HumanHandoffState,
        state.TurnCount
    };

    private static State Map(dynamic row) => new(
        (Guid?)row.id,
        (Guid)row.conversation_id,
        (Guid)row.user_id,
        (string?)row.summary,
        ParseObject((string?)row.extracted_entities),
        ParseArray((string?)row.pending_questions),
        (string?)row.pending_confirmation_type,
        ParseNode((string?)row.pending_confirmation_payload),
        (string?)row.last_agent_type,
        (string?)row.language ?? "en",
        (string?)row.human_handoff_state ?? "none",
        (int)row.turn_count,
        (DateTimeOffset)row.updated_at);

    private static JsonObject ParseObject(string? json) => ParseNode(json) as JsonObject ?? new();
    private static JsonArray ParseArray(string? json) => ParseNode(json) as JsonArray ?? new();
    private static JsonNode? ParseNode(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonNode.Parse(json); }
        catch (JsonException) { return null; }
    }

    private static bool JsonEqual(JsonNode? left, JsonNode? right) =>
        string.Equals(left?.ToJsonString() ?? "null", right?.ToJsonString() ?? "null", StringComparison.Ordinal);
}
