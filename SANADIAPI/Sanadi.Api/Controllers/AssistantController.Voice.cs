using System.Data.Common;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.AI;

namespace Sanadi.Api.Controllers;

public sealed partial class AssistantController
{
    private async Task<JsonObject?> HandleVoiceConfirmation(DbConnection db, Guid userId, Guid conversationId,
        string text, string lang, Classification classification, Guid trace, Stopwatch timer, CancellationToken ct)
    {
        if (!VoiceConversationPolicy.Confirms(text) && !VoiceConversationPolicy.Declines(text)) return null;
        // Only the latest assistant message can be confirmed. Never search backwards
        // for an old proposal after a topic switch, cancellation, or completed action.
        var row = await db.QueryFirstOrDefaultAsync(new CommandDefinition("""
            SELECT TOP (1) id, metadata, created_at FROM dbo.messages
            WHERE conversation_id=@conversationId AND user_id=@userId AND role=N'assistant'
            ORDER BY created_at DESC, id DESC;
            """, new { conversationId, userId }, cancellationToken: ct));
        if (row is null) return null;
        JsonObject metadata;
        try { metadata = JsonNode.Parse((string?)row.metadata ?? "{}") as JsonObject ?? new(); }
        catch (JsonException) { return null; }
        var proposals = metadata["proposedActions"] as JsonArray;
        if (proposals is not { Count: > 0 }) return null; // A yes to a clarification is not authorization.
        var created = row.created_at is DateTimeOffset date ? date : new DateTimeOffset((DateTime)row.created_at, TimeSpan.Zero);
        string answer;
        JsonObject? receipt = null, document = null;
        if (VoiceConversationPolicy.Declines(text))
            answer = lang == "ar" ? "تم إلغاء التأكيد الصوتي. لم أنفذ الإجراء." : "Voice confirmation cancelled. I have not executed the action.";
        else if (DateTimeOffset.UtcNow - created > TimeSpan.FromMinutes(5) || proposals.Count != 1)
            answer = lang == "ar" ? "يرجى مراجعة الإجراء المطلوب وتأكيده من البطاقة. لا أستطيع تحديد موافقة واحدة حديثة." :
                "Please review and confirm the specific action on its card. I cannot identify one recent proposal to approve.";
        else
        {
            var proposal = proposals[0]!.AsObject();
            var tool = (string?)proposal["toolName"];
            if (string.IsNullOrWhiteSpace(tool) || proposal["args"] is not JsonObject args) return null;
            // Same persisted proposal, policy checks, handler revalidation, and unique
            // idempotency key as the on-screen confirmation button.
            var result = await Execute(new ActionRequest(tool, (JsonObject)args.DeepClone(), conversationId,
                lang, (Guid)row.id, (string?)proposal["key"]), ct);
            if (result is not JsonResult json) throw new InvalidOperationException("Unexpected action response.");
            var payload = JsonSerializer.SerializeToNode(json.Value, Json)!.AsObject();
            answer = (string?)payload["message"] ?? "Please review the action in the conversation.";
            receipt = payload["receipt"]?.DeepClone() as JsonObject;
            document = payload["document"]?.DeepClone() as JsonObject;
        }
        return await PersistAssistantTurn(db,userId,conversationId,answer,lang,classification,trace,timer,
            "action",receipt is null ? "answer" : "receipt",true,new("voice_confirmation"),new(),document,receipt,ct,loggedMessage:text);
    }
}
