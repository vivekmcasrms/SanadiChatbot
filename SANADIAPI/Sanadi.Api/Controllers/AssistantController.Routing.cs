using System.Data.Common;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Sanadi.Api.AI;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Appointments;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

public sealed partial class AssistantController
{
    private sealed record RoutingContext(
        string? Intent,
        JsonObject Metadata,
        object? Prompt,
        AssistantConversationStateStore.State? State);

    private async Task<RoutingContext> LoadRoutingContext(
        DbConnection db, Guid conversationId, Guid userId, CancellationToken ct)
    {
        var state = await AssistantConversationStateStore.LoadAsync(db, conversationId, userId, ct);
        var raw = await db.ExecuteScalarAsync<string?>(new CommandDefinition("""
            SELECT TOP (1) metadata FROM dbo.messages
            WHERE conversation_id=@conversationId AND user_id=@userId AND role=N'assistant'
              AND created_at>=DATEADD(minute,-30,SYSDATETIMEOFFSET())
            ORDER BY created_at DESC,id DESC;
            """, new { conversationId, userId }, cancellationToken: ct));
        JsonObject meta;
        try { meta = JsonNode.Parse(raw ?? "{}") as JsonObject ?? new(); }
        catch (JsonException) { meta = new(); }
        // Structured state is authoritative. Last-message metadata remains a
        // compatibility fallback for conversations created before this runtime.
        if (state is not null)
            foreach (var key in new[] { "concernContext", "appointmentContext", "alertContext", "textbookContext", "activeCaseReference" })
                meta.Remove(key);
        foreach (var pair in AssistantConversationStateStore.RoutingMetadata(state))
            meta[pair.Key] = pair.Value?.DeepClone();
        // Only owned server-persisted workflow state goes into classification, never client route hints.
        var prompt = new JsonObject();
        foreach (var key in new[] { "concernContext", "appointmentContext", "alertContext", "textbookContext" })
            if (meta[key] is JsonObject workflowState) prompt[key] = workflowState.DeepClone();
        if (state is not null && DateTimeOffset.UtcNow - state.UpdatedAt < TimeSpan.FromMinutes(30))
        {
            prompt["lastAnswer"] = state.Entities["lastAnswer"]?.DeepClone();
            prompt["lastUserQuestion"] = state.Entities["lastUserQuestion"]?.DeepClone();
            prompt["lastQuestion"] = state.Entities["lastQuestion"]?.DeepClone();
            prompt["activeCategory"] = state.Entities["activeCategory"]?.DeepClone();
        }
        string? intent = meta["alertContext"]?["awaitingLocation"]?.GetValue<bool>() == true ? "alert"
            : meta["appointmentContext"] is not null ? "appointment"
            : meta["textbookContext"] is not null ? "textbook"
            : meta["concernContext"] is not null && (string?)meta["concernContext"]?["mode"] != "closed" ? "inquiry" : null;
        return new(intent, meta, prompt.Count == 0 ? null : new { intent, state = prompt }, state);
    }

    // Compatibility evidence for configured models that do not yet return routingIntents.
    // These are candidates only, not execution branches; semantic understanding wins when available.
    internal static AssistantRouting.Candidate[] RoutingCandidates(AssistantRouting.Input input,
        StudentProfileScopePolicy.Decision scope, string? pendingIntent = null, bool configuredIncident = false)
    {
        var texts = new[] { input.Original, input.Normalized }.Distinct().ToArray();
        bool Any(Func<string, bool> predicate) => texts.Any(predicate);
        var result = new List<AssistantRouting.Candidate>();
        void Add(string intent) => result.Add(new(intent, "compatibility_evidence"));
        var library = Any(t => LibraryChatFlow.Query(t) is not null);
        var similar = Any(t => LibraryChatFlow.SimilarQuery(t) is not null);
        if (similar) return [new("library", "catalogue_card_command")];
        var classifications = texts.Select(t => Classify(t, "en")).ToArray(); // Output language never selects a route.
        if (classifications.Any(c => c.Intent == "alert")) Add("alert");
        else if (configuredIncident) Add("campus_incident");
        if (classifications.Any(c => c.Intent == "complaint")) Add("complaint");
        if (classifications.Any(c => c.Intent == "suggestion") && !library && !Any(t => CareerChatFlow.Topic(t) == "cv_review")) Add("suggestion");
        if (library) Add("library");
        else if (Any(CourseTextbookFlow.IsQuestion)) Add("textbook");
        if (Any(CurrentCoursesFlow.IsQuestion)) Add("current_courses");
        if (Any(t => CurrentCoursesFlow.ChosenCode(t) is not null)) Add(pendingIntent == "textbook" ? "textbook" : "course_detail");
        foreach (var text in texts)
        {
            if (DetectStudentDataIntent(text) is { } personal && personal != "current_courses" &&
                !classifications.Any(c => c.ActionRequested) && !library && !Any(CourseTextbookFlow.IsQuestion)) Add(personal);
            if (ProactiveServiceFlow.Resolve(text, "en") is { } proactive)
                Add(proactive.Category == "campus_entry_problem" ? "campus_entry_problem" : "campus_entry");
            if (CareerChatFlow.Topic(text) is { } career) Add("career_" + career);
        }
        if (!library && !Any(CourseTextbookFlow.IsQuestion) &&
            Any(t => new AppointmentChatService().LooksLikeAppointment(t, null))) Add("appointment");
        if (!library && !result.Any(c => c.Intent is "textbook" or "course_detail" or "current_courses") &&
            (Any(IsLetterRequest) || scope.DirectTool == "issue_enrollment_letter" && result.Count == 0)) Add("document");
        if (result.Count == 0 && pendingIntent is not null && Any(t => ChatConcernPlanner.IsAcceptance(t) || ChatConcernPlanner.IsCancel(t)))
            Add(pendingIntent);
        if (result.Count == 0 && (scope.GreetingOnly || Any(t => ConversationalTurn.GreetingReply(t, "en") is not null || IsPersonalGreeting(t)))) Add("greeting");
        return result.DistinctBy(c => c.Intent).ToArray();
    }

    private static string RouteAgent(AssistantRouting.Decision route) => route.Handler switch
    {
        "profile" or "current_courses" or "course_detail" => "academic",
        "textbook" => "library", "concern" => route.Intent == "inquiry" ? "query" : route.Intent,
        "privacy" or "clarify" or "proactive" or "greeting" => "query", _ => route.Handler
    };

    private static Classification RoutedClassification(Classification previous, AssistantRouting.Decision route) => previous with
    {
        Intent = route.Intent is "alert" or "complaint" or "suggestion" ? route.Intent : "query",
        Category = route.Handler is "profile" or "current_courses" or "course_detail" ? "academic" : route.Handler,
        ActionRequested = route.Handler is "document" or "appointment" or "concern",
        RequiresHumanEscalation = route.Handler == "alert",
        RequiresStudentData = route.Handler is "profile" or "current_courses" or "course_detail" or "document" or "career" or "textbook",
        RequiredUnitCode = route.Handler == "document" ? "ADM-REG" : null,
        RequiredUnitName = route.Handler == "document" ? "Admission & Registration" : null,
        Urgency = route.Handler == "alert" ? "critical" : route.Intent == "complaint" ? "medium" : "low",
        Sentiment = route.Intent is "alert" or "complaint" ? "negative" : "neutral"
    };

    private async Task<JsonObject> DispatchRoutedTurn(AssistantRouting.Decision route, StudentProfileScopePolicy.Decision scope,
        RoutingContext context, DbConnection conn, Guid userId, Guid conversationId, string text, string lang,
        Classification classification, Guid traceId, Stopwatch sw, string? supportAgent, CancellationToken ct,
        Func<string, Task>? onVoiceText)
    {
        var continuing = AssistantRouting.ContinuesWorkflow(route,scope.Routing,context.Intent);
        // The original message is used for all record queries, catalogue arguments and business actions.
        switch (route.Handler)
        {
            case "privacy":
                return await PersistAssistantTurn(conn,userId,conversationId,StudentProfileScopePolicy.Refusal(lang),lang,
                    classification with { RequiresStudentData = true, ActionRequested = false },traceId,sw,
                    "query","answer",true,new JsonArray("authenticated_profile_scope"),new JsonArray(),null,null,ct,loggedMessage:text);
            case "clarify":
                var question = AssistantRouting.Clarification(lang);
                return await FinishConcernMessage(conn,userId,conversationId,text,lang,
                    classification with { ActionRequested = false, RequiresHumanEscalation = false },traceId,sw,
                    question,new(text,question,"clarify"),new JsonArray(),question,ct);
            case "alert":
                var incident = await MatchCampusIncident(conn,text,ct)
                    ?? await MatchCampusIncident(conn,AssistantRouting.Normalize(text).Normalized,ct);
                if (incident is not null)
                    return await FinishCampusIncidentTurn(conn,userId,conversationId,text,lang,classification,traceId,sw,incident,ct);
                if (route.Intent == "campus_incident") break;
                var alert = continuing ? await LoadAlertContext(conn,conversationId,ct) : null;
                return await FinishAlertTurn(conn,userId,conversationId,text,lang,
                    classification with { Intent = "alert", RequiresHumanEscalation = true },traceId,sw,alert,ct);
            case "document":
                // Intent confirmation is required even for a lexical match. Eligibility is still checked by the issuer.
                if (scope.DirectTool != "issue_enrollment_letter") throw new InvalidOperationException("Unconfirmed document route.");
                var policy = await conn.QueryFirstOrDefaultAsync<ToolPolicy>(DbProc.Call("usp_Assistant_GetToolPolicy",new { name = "issue_enrollment_letter" },ct));
                var roles = (await conn.QueryAsync<string>(DbProc.Call("usp_Assistant_GetUserRoles",new { userId },ct))).ToHashSet(StringComparer.OrdinalIgnoreCase);
                if (roles.Count == 0) roles.Add("student");
                if (policy is not null && (!policy.Enabled || !Allowed(policy.Roles,roles)))
                    throw new ForbiddenException("You are not permitted to perform this action.");
                if (policy is { Confirmation: true } or { HumanApproval: true } or { Risk: "level_3" })
                {
                    logger.LogInformation("Assistant route rejected {SelectedRoute} {Reason}",route.Handler,"tool_requires_approval");
                    throw new ForbiddenException(lang == "ar" ? "يتطلب هذا الإجراء موافقة قبل تنفيذه." : "This action requires approval before it can be performed.");
                }
                return await RunLetterTurn(conn,userId,conversationId,text,lang,classification,traceId,sw,ct);
            case "greeting":
                return await RunGreetingTurn(conn,userId,conversationId,text,lang,classification with { Intent = "query", ActionRequested = false },traceId,sw,supportAgent,ct,onVoiceText);
            case "library":
                var query = LibraryChatFlow.Query(text) ?? LibraryChatFlow.Query(AssistantRouting.Normalize(text).Normalized) ?? text;
                return await FinishLibraryTurn(conn,userId,conversationId,text,query,lang,classification,traceId,sw,ct);
            case "textbook":
                return (await TryTextbookTurn(conn,userId,conversationId,text,lang,classification,traceId,sw,ct,confirmedIntent:true))!;
            case "current_courses":
                return await FinishCurrentCoursesTurn(conn,userId,conversationId,text,lang,classification,traceId,sw,ct);
            case "course_detail":
                if (CurrentCoursesFlow.ChosenCode(text) is { } code &&
                    await TryCourseInquiryTurn(conn,userId,conversationId,text,code,lang,classification,traceId,sw,ct) is { } course) return course;
                break;
            case "profile":
                if (await TryAnswerPersonalRecord(conn,userId,route.Intent,lang,ct) is { HasProfile: true } personal)
                    return await FinishPersonalTurn(conn,userId,conversationId,text,lang,classification,traceId,sw,personal,ct);
                break;
            case "proactive":
                return await FinishProactiveTurn(conn,userId,conversationId,text,lang,classification,traceId,sw,
                    ProactiveServiceFlow.Build(route.Intent == "campus_entry_problem",lang),ct);
            case "career":
                return await FinishCareerTurn(conn,userId,conversationId,text,lang,route.Intent["career_".Length..],classification,traceId,sw,ct);
            case "appointment":
                var prior = continuing ? AppointmentChatService.ParseContext(context.Metadata) : null;
                var appointment = await appointments.HandleAsync(conn,userId,text,lang,prior,ct);
                return await FinishAppointmentTurn(conn,userId,conversationId,text,lang,classification,traceId,sw,appointment,ct);
            case "concern":
                var concern = continuing || scope.Routing is null ? context.Metadata["concernContext"]?.Deserialize<ChatConcernPlanner.Context>(Json) : null;
                return await RunKnowledgeTurn(conn,userId,conversationId,text,lang,classification,traceId,sw,supportAgent,ct,
                    concern,route.Intent,onVoiceText,context.Prompt);
            case "knowledge": break;
            default: throw new InvalidOperationException("Unreachable assistant handler.");
        }
        // A missing verified record uses the established knowledge/intake fallback; it never runs another action.
        var previousConcern = continuing || scope.Routing is null ? context.Metadata["concernContext"]?.Deserialize<ChatConcernPlanner.Context>(Json) : null;
        return await RunKnowledgeTurn(conn,userId,conversationId,text,lang,classification,traceId,sw,supportAgent,ct,
            previous:previousConcern,onVoiceText:onVoiceText,conversationContext:context.Prompt);
    }
}
