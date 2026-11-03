using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Sanadi.Application.Services;
using Sanadi.Domain;

namespace Sanadi.Application.Agent;

/// <summary>
/// Port of the TypeScript orchestrator: classify -> retrieve/tool loop -> grounded answer,
/// with deterministic fast paths that skip model calls entirely.
/// </summary>
public class AgentOrchestrator(
    ISanadiDbContext db,
    ToolRegistry tools,
    StudentContextService students,
    IChatModel model,
    ILogger<AgentOrchestrator> logger)
{
    private const int MaxToolSteps = 3;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<AgentResponse> RunAsync(AskRequest request, CancellationToken ct = default)
    {
        var traceId = Guid.NewGuid().ToString("n");
        var conversation = await EnsureConversationAsync(request, ct);
        await AppendMessageAsync(conversation.Id, "user", request.Message, ct);

        var snapshot = await students.LoadAsync(request.UserId, ct);

        // ---- Fast path: small talk, zero model calls -------------------------
        if (ConversationalDetector.IsSmallTalk(request.Message))
        {
            var firstName = snapshot.FullName?.Split(' ').FirstOrDefault();
            var reply = ConversationalDetector.Reply(request.Message, request.Language, firstName);
            await AppendMessageAsync(conversation.Id, "assistant", reply, ct);
            return new AgentResponse
            {
                Classification = new Classification("smalltalk", "conversational", request.Language, "low",
                    null, false, false, false, 1),
                Answer = reply,
                Verified = true,
                Conversational = true,
                ConversationId = conversation.Id,
                ResponseType = "answer",
                TraceId = traceId,
            };
        }

        var classification = await ClassifyAsync(request, ct);
        var ctx = new ToolContext(request.UserId, request.Roles, request.Language, conversation.Id, traceId);

        var messages = new List<ModelMessage>
        {
            new("system", Prompts.System(tools.DescribeForModel(request.Roles),
                JsonSerializer.Serialize(snapshot, Json), request.Language)),
        };
        messages.AddRange(await HistoryAsync(conversation.Id, ct));
        messages.Add(new ModelMessage("user", request.Message));

        var used = new List<string>();
        var citations = new List<Citation>();
        ProposedAction? proposed = null;
        string answer = "";
        var escalate = false;

        for (var step = 0; step < MaxToolSteps; step++)
        {
            var raw = await model.CompleteAsync(messages, new ModelOptions(Temperature: 0.1), ct);
            var turn = ParseTurn(raw);
            escalate |= turn.RequiresHumanEscalation;

            if (turn.ProposedAction is not null)
            {
                var def = tools.Get(turn.ProposedAction.ToolName);
                proposed = new ProposedAction(
                    turn.ProposedAction.ToolName,
                    turn.ProposedAction.LabelEn,
                    turn.ProposedAction.LabelAr,
                    def?.Risk ?? "level_1",
                    turn.ProposedAction.AffectedService,
                    turn.ProposedAction.DataShared,
                    turn.ProposedAction.ExpectedOutcome,
                    turn.ProposedAction.ToolName,
                    turn.ProposedAction.Args);
            }

            if (!string.IsNullOrWhiteSpace(turn.Tool))
            {
                var def = tools.Get(turn.Tool!);
                if (def is null)
                {
                    messages.Add(new ModelMessage("user", $"Tool {turn.Tool} does not exist. Choose another."));
                    continue;
                }
                if (!def.AllowedRoles.Any(request.Roles.Contains))
                    return Deny(classification, conversation.Id, traceId, request.Language);

                if (def.ConfirmationRequired && !def.ReadOnly)
                {
                    // Write tools are never executed inside the reasoning loop:
                    // they are proposed and executed only after explicit confirmation.
                    proposed ??= new ProposedAction(def.Name, def.Description, def.Description, def.Risk,
                        def.Name, "Your verified record details", def.Description, def.Name, turn.Args);
                    answer = string.IsNullOrWhiteSpace(turn.Answer) ? def.Description : turn.Answer!;
                    break;
                }

                var result = await def.Run(ctx, turn.Args ?? new Dictionary<string, object?>(), ct);
                used.Add(def.Name);
                if (result.Citations is not null) citations.AddRange(result.Citations);
                messages.Add(new ModelMessage("user",
                    $"TOOL_RESULT {def.Name}: {JsonSerializer.Serialize(result, Json)}"));
                continue;
            }

            answer = turn.Answer ?? "";
            break;
        }

        if (string.IsNullOrWhiteSpace(answer))
            answer = request.Language == Lang.Ar
                ? "لم أتمكن من إكمال هذا الطلب الآن. يمكنني فتح حالة ليراجعها موظف مختص."
                : "I could not complete this request right now. I can open a case so a staff member reviews it.";

        answer = OutputSafety.Clean(answer);
        var verified = citations.Count > 0 || used.Any(u => u.StartsWith("get_") || u.StartsWith("check_"));

        await AppendMessageAsync(conversation.Id, "assistant", answer, ct);
        logger.LogInformation("Sanadi turn {Trace} tools={Tools} verified={Verified}", traceId,
            string.Join(",", used), verified);

        return new AgentResponse
        {
            Classification = classification,
            Answer = answer,
            Verified = verified,
            Citations = citations,
            ProposedActions = proposed is null ? Array.Empty<ProposedAction>() : new[] { proposed },
            ConversationId = conversation.Id,
            ResponseType = proposed is not null ? "action_proposal" : "answer",
            ToolsUsed = used,
            HumanHandoff = escalate,
            TraceId = traceId,
        };
    }

    /// <summary>Executes a student-confirmed write action and records the receipt.</summary>
    public async Task<AgentResponse> ExecuteConfirmedAsync(ExecuteActionRequest request, CancellationToken ct = default)
    {
        var def = tools.Get(request.ToolName) ?? throw new InvalidOperationException("Unknown action.");
        if (!def.AllowedRoles.Any(request.Roles.Contains))
            throw new UnauthorizedAccessException("You are not allowed to perform this action.");

        var ctx = new ToolContext(request.UserId, request.Roles, request.Language, request.ConversationId, null);
        var result = await def.Run(ctx, request.Args, ct);

        var text = result.Ok
            ? (request.Language == Lang.Ar ? "تم تنفيذ طلبك." : "Your request has been completed.")
            : result.Error ?? "The action could not be completed.";

        if (request.ConversationId is Guid cid) await AppendMessageAsync(cid, "assistant", text, ct);

        return new AgentResponse
        {
            Classification = new Classification("query", "action", request.Language, "medium", null, true, true, false, 1),
            Answer = text,
            Verified = result.Ok,
            ConversationId = request.ConversationId,
            ResponseType = result.Ok ? "receipt" : "error",
            ToolsUsed = new[] { def.Name },
            Receipt = result.Receipt,
        };
    }

    // ------------------------------------------------------------------ helpers

    private AgentResponse Deny(Classification c, Guid conversationId, string traceId, Lang lang) => new()
    {
        Classification = c,
        Answer = lang == Lang.Ar
            ? "هذا الإجراء غير متاح لحسابك."
            : "That action is not available for your account.",
        ConversationId = conversationId,
        ResponseType = "error",
        TraceId = traceId,
    };

    private async Task<Classification> ClassifyAsync(AskRequest request, CancellationToken ct)
    {
        // Deterministic shortcut: letters are document requests, never complaints.
        var text = request.Message.ToLowerInvariant();
        if (text.Contains("enrol") || text.Contains("enroll") || text.Contains("to whom it may concern")
            || text.Contains("twimc") || text.Contains("إفادة") || text.Contains("لمن يهمه الأمر"))
        {
            return new Classification("query", "document_request", request.Language, "medium", "SAS", true, true, false, 0.95);
        }

        try
        {
            var raw = await model.CompleteAsync(new[]
            {
                new ModelMessage("system", Prompts.ClassifierSystem),
                new ModelMessage("user", request.Message),
            }, new ModelOptions(Temperature: 0, MaxTokens: 300), ct);

            using var doc = JsonDocument.Parse(OutputSafety.ExtractJson(raw));
            var r = doc.RootElement;
            return new Classification(
                r.GetPropertyOrDefault("intent", "query"),
                r.GetPropertyOrDefault("category", "general"),
                request.Language,
                r.GetPropertyOrDefault("urgency", "medium"),
                r.TryGetProperty("unitCode", out var u) && u.ValueKind == JsonValueKind.String ? u.GetString() : null,
                r.GetBoolOrDefault("requiresStudentData"),
                r.GetBoolOrDefault("actionRequested"),
                r.GetBoolOrDefault("requiresHumanEscalation"),
                r.TryGetProperty("confidence", out var cf) && cf.ValueKind == JsonValueKind.Number ? cf.GetDouble() : 0.6);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Classification fell back to defaults");
            return new Classification("query", "general", request.Language, "medium", null, true, false, false, 0.4);
        }
    }

    private sealed record ProposedActionDto(string ToolName, string LabelEn, string LabelAr, string AffectedService,
        string DataShared, string ExpectedOutcome, Dictionary<string, object?>? Args);

    private sealed record TurnDto(string? Thought, string? Tool, Dictionary<string, object?>? Args, string? Answer,
        ProposedActionDto? ProposedAction, bool RequiresHumanEscalation);

    private TurnDto ParseTurn(string raw)
    {
        try
        {
            return JsonSerializer.Deserialize<TurnDto>(OutputSafety.ExtractJson(raw), Json)
                   ?? new TurnDto(null, null, null, OutputSafety.Clean(raw), null, false);
        }
        catch
        {
            return new TurnDto(null, null, null, OutputSafety.Clean(raw), null, false);
        }
    }

    private async Task<Conversation> EnsureConversationAsync(AskRequest request, CancellationToken ct)
    {
        if (request.ConversationId is Guid id)
        {
            var existing = await db.Conversations.FirstOrDefaultAsync(
                c => c.Id == id && c.StudentId == request.UserId, ct);
            if (existing is not null) return existing;
        }
        var created = new Conversation
        {
            StudentId = request.UserId,
            Language = request.Language == Lang.Ar ? "ar" : "en",
            Title = request.Message.Length > 60 ? request.Message[..60] : request.Message,
        };
        db.Conversations.Add(created);
        await db.SaveChangesAsync(ct);
        return created;
    }

    private async Task AppendMessageAsync(Guid conversationId, string role, string content, CancellationToken ct)
    {
        db.ChatMessages.Add(new ChatMessage { ConversationId = conversationId, Role = role, Content = content });
        await db.SaveChangesAsync(ct);
    }

    private async Task<List<ModelMessage>> HistoryAsync(Guid conversationId, CancellationToken ct)
    {
        var rows = await db.ChatMessages.AsNoTracking()
            .Where(m => m.ConversationId == conversationId)
            .OrderByDescending(m => m.CreatedAt).Take(10).ToListAsync(ct);
        rows.Reverse();
        return rows.Select(m => new ModelMessage(m.Role == "assistant" ? "assistant" : "user", m.Content)).ToList();
    }
}

internal static class JsonExtensions
{
    public static string GetPropertyOrDefault(this JsonElement el, string name, string fallback) =>
        el.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? fallback : fallback;

    public static bool GetBoolOrDefault(this JsonElement el, string name) =>
        el.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;
}
