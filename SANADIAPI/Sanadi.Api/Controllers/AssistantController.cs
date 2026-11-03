using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.AI;
using Sanadi.Api.Middleware;
using Sanadi.Api.Notifications;
using Sanadi.Api.Routing;
using Sanadi.Api.Security;
using Sanadi.Application.Documents;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

/// <summary>
/// Native C# assistant runtime. Semantic intents enter one deterministic route
/// resolver; existing handlers enforce authorization, verified evidence and writes.
/// This replaces the React Start server functions and /_serverFn chat proxy.
/// </summary>
[ApiController]
[Route("api/chat")]
public sealed partial class AssistantController(
    ISqlConnectionFactory sql,
    IHttpClientFactory clients,
    IConfiguration configuration,
    IEnrolmentLetterIssuer letters,
    Sanadi.Infrastructure.Appointments.AppointmentChatService appointments,
    ILogger<AssistantController> logger,
    Sanadi.Infrastructure.Library.OclcLibrarySearchService? library = null) : ControllerBase
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly Regex LetterIntent = new(
        @"enrol?l?ment\s+letter|proof\s+of\s+(?:enrol?l?ment|registration|study)|to\s+whom\s+it\s+may\s+concern|\btwimc\b|official\s+letter|registration\s+letter|شهادة\s*(?:قيد|تسجيل|التحاق)|خطاب\s*(قيد|تسجيل)|رسالة\s*قيد|إفادة\s*(?:قيد|تسجيل|التحاق)|الى من يهمه|إلى من يهمه",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly string[] Danger = ["suicide", "kill myself", "weapon", "fire", "medical emergency", "emergency", "campus security", "urgent alert", "اعتداء", "حريق", "انتحار", "طوارئ", "أمن الحرم"];
    private static readonly string[] Suggestion = ["suggest", "idea", "improve", "proposal", "اقتراح", "فكرة", "تحسين"];
    private static readonly string[] Action = ["submit", "create", "book", "cancel", "issue", "request", "قدم", "احجز", "أنشئ", "اصدر"];
    private static readonly Regex CampusLocation = new(
        @"\b(?:Building\s+[A-Za-z0-9-]+|Room\s+[A-Za-z0-9-]+|(?:CIT|CITA)\s*[A-Z]?\d{1,3}(?:-\d{1,3})?|[A-Z]\d{1,2}(?:-\d{1,3})?|[A-Z]{2,4}\s+[A-Z]?\d{1,3}(?:-\d{1,3})?)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public sealed record AskRequest(string Message, Guid? ConversationId, string? Lang, JsonArray? Attachments, string? SupportAgent = null, bool VoicePresentation = false);
    public sealed record TimingRequest(string TraceId, int FirstVisibleMs, int StreamChunkCount, int StreamDurationMs, int FinalizationMs);
    public sealed record ActionRequest(string ToolName, JsonObject? Args, Guid? ConversationId, string? Lang, Guid? MessageId, string? ActionKey);
    private sealed record Classification(string Intent, string Category, string Language, string Urgency, string Sentiment,
        string? RequiredUnitCode, string? RequiredUnitName, bool RequiresAuth, bool RequiresStudentData,
        bool ActionRequested, bool RequiresHumanEscalation, decimal Confidence);
    private sealed record Evidence(Guid DocumentId, string Title, string? Unit, string? Version, DateTime? EffectiveDate,
        string? Url, string Content, decimal Score, string SourceType);
    private sealed record ToolPolicy(Guid? Id, bool Enabled, string Risk, bool Confirmation, bool HumanApproval, string Roles);
    internal sealed record WorkingAgent(string Key, string DisplayName, string StatusText, string Domain);

    private Guid RequireUserId()
    {
        var user = HttpContext.GetSanadiUser();
        if (!user.IsAuthenticated || user.UserId is not Guid id) throw new UnauthorizedException();
        return id;
    }

    [HttpPost("ask")]
    public async Task<IActionResult> Ask([FromBody] AskRequest request, CancellationToken ct)
        => new JsonResult(await Run(request, RequireUserId(), ct), Json);

    /// <summary>
    /// Shared assistant engine entry for other channels (voice). Every channel
    /// enters the exact same normalized turn pipeline used by text chat.
    /// The caller must assign <see cref="ControllerBase.ControllerContext"/> for the current request first.
    /// </summary>
    internal Task<JsonObject> RunTurn(AskRequest request, Guid userId, CancellationToken ct, string? trace = null,
        Func<WorkingAgent, Task>? onStage = null, bool voiceSignOff = false)
        => Run(request, userId, ct, trace, onStage: onStage, voiceSignOff: voiceSignOff, voiceChannel: true);

    [HttpPost("stream")]
    public async Task Stream([FromBody] AskRequest request, CancellationToken ct)
    {
        var userId = RequireUserId();
        Response.StatusCode = 200;
        Response.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Append("X-Accel-Buffering", "no");
        var trace = Guid.NewGuid().ToString();
        var studentText = ConversationalTurn.StudentText(request.Message ?? "");
        var lang = ReplyLanguage(studentText, request.Lang);
        await Send(new { type = "accepted", traceId = trace }, ct);
        var routed = ResolveWorkingAgent("query", lang);
        await Send(new
        {
            type = "stage",
            stage = routed.Key,
            agent = new { key = routed.Key, displayName = routed.DisplayName, statusText = routed.StatusText, domain = routed.Domain }
        }, ct);
        try
        {
            var streamed = false;
            async Task ForwardToken(string delta)
            {
                if (string.IsNullOrEmpty(delta)) return;
                streamed = true;
                await Send(new { type = "token", delta }, ct);
            }
            var result = await Run(request, userId, ct, trace, onStage: agent =>
                Send(new { type = "stage", stage = agent.Key, agent }, ct),
                onVoiceText: ForwardToken);
            var working = ResolveWorkingAgent((string?)result["agent"] ?? "knowledge", lang);
            await Send(new
            {
                type = "stage",
                stage = working.Key,
                agent = new { key = working.Key, displayName = working.DisplayName, statusText = working.StatusText, domain = working.Domain }
            }, ct);
            // Model text is forwarded as Qwen produces it. Deterministic fast
            // paths send only the final structured response—never fake chunks.
            if (streamed) await Send(new { type = "reset" }, ct);
            await Send(new { type = "final", response = result }, ct);
        }
        catch (Exception ex) when (ApiErrorPolicy.IsClientCancellation(ex, ct))
        {
            // A cancelled stream has no further events to deliver.
        }
        catch (Exception ex)
        {
            ApiErrorPolicy.LogOnce(logger, ex, HttpContext, ApiFunctionErrorLoggingFilter.Describe(ex, "Stream"), trace);
            await Send(new { type = "error", message = ex is SanadiException ? ex.Message : "assistant_api_unavailable" }, ct);
        }
    }

    [HttpPatch("stream")]
    public async Task<IActionResult> Timing([FromBody] TimingRequest request)
    {
        var userId = RequireUserId();
        if (!Guid.TryParse(request.TraceId, out var runId)) return BadRequest(new { error = "invalid_trace" });
        await using var conn = sql.Create();
        var output = JsonSerializer.Serialize(new { stream = new { request.FirstVisibleMs, request.StreamChunkCount, request.StreamDurationMs, request.FinalizationMs } }, Json);
        await conn.ExecuteAsync(DbProc.Call("usp_Assistant_UpdateRunTiming", new { duration=request.StreamDurationMs, output, runId, userId }));
        return Ok(new { ok=true });
    }

    [HttpPost("actions")]
    public async Task<IActionResult> Execute([FromBody] ActionRequest request, CancellationToken ct)
    {
        var userId = RequireUserId();
        var lang = request.Lang == "ar" ? "ar" : "en";
        var args = request.Args ?? [];
        await using var conn = sql.Create();
        if (request.ConversationId is Guid ownedConversation &&
            await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_Assistant_OwnsConversation",new { existing=ownedConversation,userId },ct)) == 0)
            throw new ForbiddenException("Chat not found.");
        args = await AssistantActionGuard.ResolveStoredArgsAsync(
            conn, userId, request.ConversationId, request.MessageId, request.ActionKey,
            request.ToolName, args, ct);
        if (request.ToolName == "create_complaint")
            args = await LoadComplaintProposal(conn, userId, request, ct);
        if (request.ToolName == "create_suggestion")
            args = await LoadSuggestionProposal(conn, userId, request, ct);
        if (request.ToolName == "create_enquiry")
            args = await LoadEnquiryProposal(conn, userId, request, ct);
        var roles = (await conn.QueryAsync<string>(DbProc.Call("usp_Assistant_GetUserRoles", new { userId }, ct))).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (roles.Count == 0) roles.Add("student");
        var policy = await conn.QueryFirstOrDefaultAsync<ToolPolicy>(DbProc.Call("usp_Assistant_GetToolPolicy", new { name=request.ToolName }, ct));
        if (policy is not null && (!policy.Enabled || !Allowed(policy.Roles, roles))) throw new ForbiddenException("You are not permitted to perform this action.");
        // Restore the original confirmation-gated contact alert, without overriding
        // an administrator's configured tool policy or trusting a browser-supplied unit.
        var incident = request.ToolName == "report_alert"
            ? await MatchCampusIncident(conn, args["description"]?.GetValue<string>() ?? "", ct) : null;
        var risk = policy?.Risk ?? (incident is not null ? "level_2" : RiskFor(request.ToolName));
        var approval = policy?.HumanApproval == true || risk == "level_3";
        var payload = args.ToJsonString(Json);
        var duplicateKey = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{userId}|{request.ConversationId}|{request.MessageId}|{request.ActionKey}|{request.ToolName}")));
        var previous = await conn.QueryFirstOrDefaultAsync<(string Receipt, string Result)>(DbProc.Call("usp_Assistant_FindDuplicateAction", new { userId, tool=request.ToolName, duplicateKey }, ct));
        if (!string.IsNullOrEmpty(previous.Receipt))
            return new JsonResult(new { receipt=Receipt(previous.Receipt, request.ToolName, null, lang), message=lang=="ar"?$"تم تقديم هذا الطلب مسبقاً بالرقم {previous.Receipt}. لم يتم تكراره.":$"This was already submitted as {previous.Receipt}; it was not created again." }, Json);

        var claim = await AssistantActionGuard.TryClaimAsync(conn, userId, duplicateKey,
            $"assistant:{request.ToolName}", ct);
        if (!claim.Acquired)
        {
            if (!string.IsNullOrWhiteSpace(claim.ResponseSnapshot))
                return new JsonResult(JsonNode.Parse(claim.ResponseSnapshot), Json);
            return new JsonResult(new
            {
                receipt = (object?)null,
                message = claim.Status == "needs_reconciliation"
                    ? (lang == "ar" ? "تعذر التحقق من نتيجة المحاولة السابقة. راجع طلباتك أو تواصل مع الدعم قبل المحاولة مجدداً."
                        : "The previous attempt's outcome needs review. Check your requests or contact support before trying again.")
                    : lang == "ar"
                    ? "هذا الإجراء قيد التنفيذ بالفعل. انتظر لحظات ثم افتح المحادثة من جديد."
                    : "This action is already being processed. Wait a moment, then reopen the conversation."
            }, Json) { StatusCode = StatusCodes.Status409Conflict };
        }

        args["idempotencyKey"] = duplicateKey;
        payload = args.ToJsonString(Json);
        var executionStarted = false;
        try
        {
            var actionId = Guid.NewGuid();
            executionStarted = true;
            await conn.ExecuteAsync(DbProc.Call("usp_Assistant_InsertActionRequest", new { actionId, userId, conversationId=request.ConversationId, tool=request.ToolName, risk, payload, approval, status=approval?"awaiting_approval":"executing" }, ct));
            if (approval)
            {
                await Audit(conn, userId, "action.awaiting_approval", actionId, new { request.ToolName, risk });
                var awaiting = new { receipt=(object?)null, message=lang=="ar"?"تم تسجيل طلبك وهو بانتظار موافقة الموظف المختص قبل التنفيذ.":"Your request has been recorded and is awaiting staff approval before it is carried out." };
                await AssistantActionGuard.CompleteAsync(conn, userId, duplicateKey, awaiting, ct);
                return new JsonResult(awaiting, Json);
            }

            var executed = await ExecuteTool(conn, userId, request.ToolName, args, request.ConversationId, lang, ct);
            var receiptNo = $"ACT-{DateTime.UtcNow:yyyyMMdd}-{Random.Shared.Next(100000,999999)}";
            var resultJson = JsonSerializer.Serialize(executed.Data, Json);
            await conn.ExecuteAsync(DbProc.Call("usp_Assistant_CompleteAction", new { actionId, resultJson, receiptNo, conversationId=request.ConversationId, toolId=policy?.Id, tool=request.ToolName, userId, payload, risk }, ct));
            await Audit(conn, userId, "action.executed", actionId, new { request.ToolName, risk, receipt=receiptNo, reference=executed.Reference });
            var receipt = Receipt(receiptNo, request.ToolName, executed.Reference, lang, executed.Unit, executed.Tracking);
            await conn.ExecuteAsync(DbProc.Call("usp_Assistant_InsertReceipt", new { receiptNo, userId, actionId, reference=executed.Reference, tool=request.ToolName, unit=executed.Unit, nextEn=executed.NextEn, nextAr=executed.NextAr, tracking=executed.Tracking, lang, resultJson }, ct));
            var message = lang=="ar"?$"تم التنفيذ. رقمك المرجعي هو {executed.Reference ?? receiptNo}. {executed.NextAr}":$"Done. Your reference number is {executed.Reference ?? receiptNo}. {executed.NextEn}";
            if (request.ConversationId is Guid conversationId)
                await conn.ExecuteAsync(DbProc.Call("usp_Assistant_InsertAssistantMessage", new { conversationId,userId,message,lang,meta=JsonSerializer.Serialize(new{receipt,actionType=request.ToolName},Json) }, ct));
            var completed = new { receipt, message, document=executed.Document, recovery=(object?)null };
            await AssistantActionGuard.CompleteAsync(conn, userId, duplicateKey, completed, ct);
            return new JsonResult(completed, Json);
        }
        catch
        {
            // Once execution starts, a timeout may follow a committed write. Never
            // automatically reclaim that operation and create a second record.
            await AssistantActionGuard.FailAsync(conn, userId, duplicateKey, CancellationToken.None, executionStarted);
            throw;
        }
    }

    /// <summary>
    /// The reply follows the script the student typed in: Arabic text is answered in Arabic and
    /// Latin text in English, whatever the interface language is. The interface language is only
    /// used when the message has no letters at all (numbers, emoji, attachments).
    /// </summary>
    internal static string ReplyLanguage(string text, string? requestLang)
    {
        // Words, not characters: an Arabic sentence that quotes an English course title is still Arabic.
        var arabic = Regex.Matches(text, @"[\u0600-\u06ff\u0750-\u077f\ufb50-\ufdff\ufe70-\ufeff]+").Count;
        var latin = Regex.Matches(text, @"[A-Za-z]+").Count;
        if (arabic == 0 && latin == 0) return requestLang == "ar" ? "ar" : "en";
        return arabic >= latin ? "ar" : "en";
    }

    internal static string VoiceReplyLanguage(string text, string? selectedLanguage) =>
        selectedLanguage is "en" or "ar" ? selectedLanguage : ReplyLanguage(text, null);

    /// <summary>
    /// Removes channel presentation flags before any intent, profile, retrieval or
    /// workflow decision is made. Voice can select STT/TTS settings, but it cannot
    /// select a different business workflow. Voice applies an explicit reply-language preference.
    /// </summary>
    internal static AskRequest NormalizeTurn(AskRequest request)
    {
        var text = ConversationalTurn.StudentText(request.Message ?? "");
        return request with
        {
            Message = text,
            Lang = ReplyLanguage(text, request.Lang),
            VoicePresentation = false
        };
    }

    private async Task<JsonObject> Run(AskRequest request, Guid userId, CancellationToken ct, string? suppliedTrace=null,
        Func<string, Task>? onVoiceText=null, Func<WorkingAgent, Task>? onStage=null, bool voiceSignOff=false, bool voiceChannel=false)
    {
        var sw = Stopwatch.StartNew();
        var selectedLanguage = request.Lang;
        request = NormalizeTurn(request);
        var text = request.Message;
        if (text.Length == 0) throw new SanadiException("message_required");
        if (text.Length > 8000) text = text[..8000];
        var closing = voiceSignOff && VoiceConversationPolicy.EndsCall(text);
        var lang = voiceChannel && selectedLanguage is "en" or "ar" ? selectedLanguage : request.Lang!;
        var classification = Classify(text, lang);
        var traceId = Guid.TryParse(suppliedTrace, out var supplied) ? supplied : Guid.NewGuid();
        await using var conn = sql.Create();
        var conversationId = request.ConversationId;
        if (conversationId is Guid existing)
        {
            var owns = await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_Assistant_OwnsConversation", new { existing,userId }, ct));
            if (owns == 0) throw new ForbiddenException("Chat not found.");
        }
        else
        {
            conversationId = Guid.NewGuid();
            var title = text.Length > 80 ? text[..80] : text;
            await conn.ExecuteAsync(DbProc.Call("usp_Assistant_InsertConversation", new { conversationId,userId,title,lang }, ct));
        }
        var userMessageId = Guid.NewGuid();
        await conn.ExecuteAsync(DbProc.Call("usp_Assistant_InsertUserMessage", new { userMessageId,conversationId,userId,text,lang }, ct));

        // A call sign-off is presentation only, after ownership validation and normal persistence.
        // It must not continue or approve a pending business action. Text turns never opt in.
        if (closing)
            return await PersistAssistantTurn(conn,userId,conversationId!.Value,VoiceFarewell.Reply(lang),lang,
                classification with { Intent="query", Category="greeting", ActionRequested=false, RequiresHumanEscalation=false },
                traceId,sw,"query","answer",true,new JsonArray("greeting"),new JsonArray(),null,null,ct,loggedMessage:text);

        var routingInput = AssistantRouting.Normalize(text);
        var context = await LoadRoutingContext(conn, conversationId!.Value, userId, ct);
        if (voiceChannel)
        {
            var confirmation = await HandleVoiceConfirmation(conn, userId, conversationId.Value, text, lang, classification, traceId, sw, ct);
            if (confirmation is not null)
            {
                await AssistantConversationStateStore.SaveTurnAsync(conn, context.State, conversationId.Value, userId, confirmation, ct, request.Message);
                return confirmation;
            }
            var selection = VoiceConversationPolicy.ResolveSelection(text, context.Metadata);
            if (selection == "")
                return await PersistAssistantTurn(conn,userId,conversationId.Value,
                    lang == "ar" ? "أي خيار تقصد؟ قل الاسم أو رمز المساق." : "Which option do you mean? Please say its name or course code.",
                    lang,classification,traceId,sw,"query","clarification",false,new(),new(),null,null,ct,loggedMessage:text,
                    clarifyingQuestion: lang == "ar" ? "أي خيار تقصد؟" : "Which option do you mean?");
            if (selection is not null) text = selection;
            routingInput = AssistantRouting.Normalize(text);
        }
        var initialEvidence = RoutingCandidates(routingInput, new(StudentProfileScopePolicy.Scope.Unavailable), context.Intent);
        var scope = await new StudentProfileScopePolicy(clients, configuration, logger)
            .Evaluate(conn, userId, routingInput.Original, ct, context.Prompt, initialEvidence);
        var configuredIncident = scope.Scope != StudentProfileScopePolicy.Scope.AnotherPerson &&
            scope.Routing is null && await MatchCampusIncident(conn, text, ct) is not null;
        var candidates = RoutingCandidates(routingInput, scope, context.Intent, configuredIncident);
        var route = AssistantRouting.Resolve(scope, candidates, context.Intent);
        classification = RoutedClassification(classification, route);
        var rejected = route.Rejected.Concat(candidates.Where(c => c.Intent != route.Intent &&
            route.Rejected.All(r => r.Intent != c.Intent)).Select(c => new AssistantRouting.Rejection(c.Intent,
                scope.Routing is null ? route.Reason : "semantic_outcome_selected"))).ToArray();
        logger.LogInformation("Assistant routing {DetectedLanguage} {NormalizedIntent} {CandidateRoutes} {RejectedRoutes} {SelectedRoute} {Resolution}",
            routingInput.DetectedLanguage, route.Intent, JsonSerializer.Serialize(new { evidence = candidates, classified = route.Candidates }),
            JsonSerializer.Serialize(rejected), route.Handler, route.Reason);
        if (onStage is not null) await onStage(ResolveWorkingAgent(RouteAgent(route), lang));
        // This is the only business dispatch. Candidate assessment never executes a handler.
        var result = await DispatchRoutedTurn(route, scope, context, conn, userId, conversationId.Value,
            text, lang, classification, traceId, sw, request.SupportAgent, ct, onVoiceText);
        try
        {
            await AssistantConversationStateStore.SaveTurnAsync(
                conn, context.State, conversationId.Value, userId, result, ct, request.Message);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Conversation state could not be saved for {ConversationId}", conversationId);
        }
        return result;
    }

    private async Task<JsonObject> RunKnowledgeTurn(System.Data.Common.DbConnection conn, Guid userId,
        Guid conversationId, string text, string lang, Classification classification, Guid traceId, Stopwatch sw,
        string? supportAgent, CancellationToken ct, ChatConcernPlanner.Context? previous = null,
        string? concernType = null, Func<string, Task>? onVoiceText = null, object? conversationContext = null)
    {
        var originalText = text;
        if (previous?.Mode == "closed") previous = null;
        if (previous is not null && ChatConcernPlanner.IsCancel(text))
            return await FinishConcernMessage(conn,userId,conversationId,text,lang,classification,traceId,sw,
                lang=="ar"?"تم إلغاء المسودة. لم يتم تقديم أي طلب.":"The draft is cancelled. Nothing has been submitted.",null,new JsonArray(),null,ct);
        if (previous?.Mode == "proposal" && ChatConcernPlanner.IsAcceptance(text))
            return await FinishConcernMessage(conn,userId,conversationId,text,lang,classification,traceId,sw,
                lang=="ar"?"استخدم زر التقديم في الرسالة السابقة وراجع نافذة الموافقة. لم يتم تقديم أي شيء بعد.":
                "Please use the submission button on the proposal above and review the approval popup. Nothing has been submitted yet.",previous,new JsonArray(),null,ct);
        var planner = new ChatConcernPlanner(clients, logger);
        var intake = await planner.Assess(conn, userId, text, lang, previous, ct, conversationContext: conversationContext);
        originalText = ConcernDetails(text, previous, intake);
        if (concernType is "complaint" or "suggestion") intake = intake with { Type = concernType };
        if (intake.NeedsClarification && concernType == "complaint" && ComplaintChatFlow.IsServiceComplaint(originalText))
            intake = (await planner.Assess(conn,userId,originalText,lang,previous,ct,
                "The student has described the failing service and what went wrong. Do not ask for already supplied details; return the factual complaint title and best matching active unit.")) with { Type = "complaint" };
        if (intake.NeedsClarification || intake.Type != "query" || concernType == "inquiry" ||
            previous?.Mode == "offer" && ChatConcernPlanner.IsAcceptance(text))
            return await FinishConcern(conn,userId,conversationId,originalText,lang,classification,traceId,sw,intake,
                previous?.Mode == "offer",ct);
        text = intake.SearchQuery;
        var evidence = await Retrieve(conn, text, lang, ct);
        if(evidence.Count==0 || !await new ChatConcernPlanner(clients,logger).SupportsAnswer(conn,userId,text,evidence,ct))
        {
            var concern=await FinishConcern(conn,userId,conversationId,originalText,lang,classification,traceId,sw,intake,true,ct);
            if(!classification.RequiresHumanEscalation)
                await RecordException(conn,"missing_knowledge",userId,conversationId,traceId,
                    "safe_no_answer_with_human_handoff_offer",recovered:true,escalated:false,
                    detail:$"No approved passage covering: {text[..Math.Min(text.Length,200)]}",
                    studentMessage:concern["answer"]?.GetValue<string>()??"",ct);
            return concern;
        }
        var provider = "deterministic"; var model = (string?)null; var fallback = false;
        var promptVersion = "knowledge.deterministic";
        AssistantEvidenceSafety.GroundingResult? grounding = null;
        var generated = await Phrase(conn, userId, text, lang, classification, evidence, supportAgent, ct, onVoiceText: onVoiceText);
        promptVersion = generated.PromptVersion;
        var answerText = generated.Text;
        if (!string.IsNullOrWhiteSpace(answerText))
        {
            provider=generated.Provider; model=generated.Model;
            grounding = AssistantEvidenceSafety.Validate(answerText, evidence.Select(e => $"{e.Title}\n{e.Content}"));
            if (!grounding.Passed)
            {
                fallback = true;
                var partial = grounding.Score >= .5m ? grounding.CleanedAnswer : "";
                answerText = string.IsNullOrWhiteSpace(partial)
                    ? Fallback(text, lang, classification, evidence)
                    : partial + (lang == "ar"
                        ? "\n\nما قدرت أتحقق من بعض التفاصيل الإضافية، فحذفتها من الرد."
                        : "\n\nI could not verify some additional details, so they were omitted.");
                if (string.IsNullOrWhiteSpace(partial)) provider = "deterministic";
                await RecordException(conn, "grounding_failure", userId, conversationId, traceId,
                    "unsupported_claims_removed", recovered: true, escalated: false,
                    detail: string.Join(" | ", grounding.UnsupportedClaims.Take(4)),
                    studentMessage: answerText, ct);
            }
        }
        else { fallback=true; answerText=Fallback(text,lang,classification,evidence); provider="deterministic"; model=null; }
        var actions = Proposals(text, lang, classification);
        var verified = evidence.Count > 0 && (grounding is null || grounding.Score >= .5m);
        // Record recoverable gaps so Monitoring → Recovery log stays populated
        // (same codes/actions the Node orchestrator wrote into exception_events).
        if (fallback && evidence.Count > 0)
        {
            await RecordException(conn, "api_failure", userId, conversationId, traceId,
                "verified_fallback_used", recovered: true, escalated: false,
                detail: "Model phrasing unavailable; served verified source excerpt.",
                studentMessage: answerText, ct);
        }
        var citations = new JsonArray(evidence.Select(e => (JsonNode)new JsonObject {
            ["documentId"]=e.DocumentId.ToString(), ["sourceTitle"]=e.Title, ["owningUnit"]=e.Unit,
            ["documentVersion"]=e.Version, ["effectiveDate"]=e.EffectiveDate?.ToString("yyyy-MM-dd"),
            ["citationUrl"]=e.Url, ["sourceType"]=e.SourceType, ["confidence"]=e.Score>=.6m?"high":"medium" }).ToArray());
        var responseType = actions.Count>0 ? "action_proposal" : classification.RequiresHumanEscalation ? "handoff" : "answer";
        var agent = classification.Intent switch { "complaint"=>"complaint", "suggestion"=>"suggestion", "alert"=>"alert", _=>verified?"knowledge":"query" };
        var assistantId = Guid.NewGuid();
        var response = new JsonObject {
            ["agent"]=agent, ["classification"]=JsonSerializer.SerializeToNode(classification,Json), ["answer"]=answerText,
            ["verified"]=verified, ["citations"]=citations, ["proposedActions"]=actions, ["messageId"]=assistantId.ToString(),
            ["conversationId"]=conversationId.ToString(), ["responseType"]=responseType,
            ["intents"]=new JsonArray(new JsonObject{{"intent",classification.Intent},{"category",classification.Category},{"confidence",classification.Confidence},{"handled",true}}),
            ["clarifyingQuestion"]=null, ["nextSteps"]=new JsonArray(), ["toolsUsed"]=new JsonArray(evidence.Count>0?"search_knowledge_base":"none"),
            ["activity"]=new JsonArray(evidence.Count>0?(lang=="ar"?"راجعت المصادر الرسمية للجامعة":"Checked official university sources"):(lang=="ar"?"صنّف الطلب بأمان":"Classified the request safely")),
            ["confidence"]=classification.Confidence, ["fallbackUsed"]=fallback, ["humanHandoff"]=classification.RequiresHumanEscalation,
            ["receipt"]=null, ["issuedDocument"]=null, ["careerInsight"]=null, ["libraryResults"]=null, ["caseResult"]=null,
            ["followUp"]=null, ["traceId"]=TraceRef(traceId)
        };
        response["promptVersion"] = promptVersion;
        response["grounding"] = grounding is null ? null : JsonSerializer.SerializeToNode(new
        {
            grounding.Passed,
            grounding.Score,
            grounding.ClaimCount,
            grounding.SupportedClaimCount,
            unsupportedClaimCount = grounding.UnsupportedClaims.Count
        }, Json);
        var metadata = response.DeepClone().AsObject(); metadata.Remove("answer");
        await conn.ExecuteAsync(DbProc.Call("usp_Assistant_InsertRunAndMessage", new { assistantId,conversationId,userId,content=answerText,lang,metadata=metadata.ToJsonString(Json),traceId,agent,input=JsonSerializer.Serialize(new{message=text},Json),output=response.ToJsonString(Json),latency=(int)sw.ElapsedMilliseconds,model,provider,responseType,confidence=classification.Confidence,tools=evidence.Count>0?1:0,fallback,handoff=classification.RequiresHumanEscalation }, ct));
        return response;
    }

    private static Classification Classify(string text, string lang, bool letterRequest = false)
    {
        if (LibraryChatFlow.SimilarQuery(text) is not null)
            return new("query","library",lang,"low","neutral","LIB",lang=="ar"?"خدمات المكتبة":"Library Services",true,false,false,false,.98m);
        var lower=text.ToLowerInvariant();
        var danger=Danger.Any(lower.Contains); var complaint=ComplaintChatFlow.IsComplaintIntent(text); var suggestion=Suggestion.Any(lower.Contains) || SuggestionChatFlow.IsSuggestion(text);
        var letter=letterRequest || IsLetterRequest(text);
        var personal=DetectStudentDataIntent(text) is not null;
        var intent=danger?"alert":complaint?"complaint":suggestion?"suggestion":letter?"query":"query";
        var category=letter?"document":Regex.IsMatch(lower,"career|cv|internship|وظيف|سيرة")?"career":Regex.IsMatch(lower,"library|book|مكتب|كتاب")?"library":personal||Regex.IsMatch(lower,"course|grade|registration|academic|مقرر|تسجيل|درجة")?"academic":intent;
        string? unitCode=letter?"ADM-REG":null;
        string? unitName=letter?"Admission & Registration":null;
        return new(intent,category,lang,danger?"critical":complaint?"medium":"low",complaint||danger?"negative":"neutral",unitCode,unitName,true,category is "academic" or "document",Action.Any(lower.Contains)||letter,danger,danger?.98m:.86m);
    }

    internal static bool IsLetterRequest(string text) => LetterIntent.IsMatch(text);

    internal static string? DirectConversationRoute(string text, string lang, StudentProfileScopePolicy.Decision decision)
    {
        var route = AssistantRouting.Resolve(decision,RoutingCandidates(AssistantRouting.Normalize(text),decision));
        return route.Handler is "document" or "library" or "greeting" ? route.Handler : null;
    }

    /// <summary>
    /// Friendly social / small-talk turns (greetings, name intro, wellbeing, weather)
    /// — not real university service questions.
    /// </summary>
    internal static bool IsPersonalGreeting(string text)
    {
        var t = text.Trim();
        if (t.Length is 0 or > 500) return false;
        var normalized = Regex.Replace(t.ToLowerInvariant(), @"[^\p{L}\p{N}\s']+", " ");
        normalized = Regex.Replace(normalized, @"\s+", " ").Trim();

        // Real service intents must not be treated as chit-chat.
        if (DetectStudentDataIntent(text) is not null) return false;
        if (IsLetterRequest(text)) return false;
        if (Danger.Any(normalized.Contains) || ComplaintChatFlow.IsComplaintIntent(text) || Suggestion.Any(normalized.Contains))
            return false;
        if (Regex.IsMatch(normalized,
                @"\b(gpa|grade|register|registration|enrol|enroll|appointment|book|library|transcript|hold|fees?|tuition|scholarship|visa|housing|hostel|dorm|internship|cv\b|career|complaint|suggest|policy|deadline|course|credit|graduat|وثيق|تسجيل|موعد|مكتبة|رسوم|سكن|تدريب)\b"))
            return false;

        if (Regex.IsMatch(normalized,
                @"^(hi|hii+|hello|hey|heya|yo|hiya|howdy|good\s+(morning|afternoon|evening|day))(\s+(there|sanadi|friend|everyone|all))?$"))
            return true;
        if (Regex.IsMatch(normalized,
                @"^(how are you|how're you|how are you doing|how's it going|how is it going|how do you do|what's up|whats up|wassup)(\s+(today|doing|bro|man))?$"))
            return true;
        if (Regex.IsMatch(normalized,
                @"^(مرحبا|مرحباً|اهلا|أهلا|أهلاً|اهلا وسهلا|أهلاً وسهلاً|السلام عليكم|سلام|هلا|صباح الخير|مساء الخير|كيف حالك|كيف الحال|كيفك)(\s+.*)?$"))
            return true;

        // Longer friendly small-talk: greeting / name / how are you / weather, etc.
        var social =
            Regex.IsMatch(normalized, @"\b(hi|hello|hey|good morning|good afternoon|good evening|how are you|how're you|how is everything|how's everything|how is it going|how's it going|what's up|my name is|i am|i'm|weather|alright|how do you do)\b")
            || Regex.IsMatch(normalized, @"مرحبا|أهلا|السلام عليكم|كيف حالك|كيف الحال|اسمي|الطقس|الجو");
        if (!social) return false;
        // Mostly conversational — few “service” words already excluded above.
        return true;
    }

    private async Task<JsonObject> RunGreetingTurn(System.Data.Common.DbConnection conn, Guid userId,
        Guid conversationId, string text, string lang, Classification classification, Guid traceId,
        Stopwatch sw, string? supportAgent, CancellationToken ct, Func<string, Task>? onVoiceText)
    {
        var fixedGreeting = ConversationalTurn.GreetingReply(text, lang)
            ?? ConversationalTurn.ImmediateGreetingReply(text, lang, supportAgent);
        if (fixedGreeting is not null)
            return await PersistAssistantTurn(conn, userId, conversationId, fixedGreeting,
                lang, classification, traceId, sw, agent: "query", responseType: "answer", verified: true,
                tools: new JsonArray("greeting"),
                activity: new JsonArray(lang == "ar" ? "ردّ بتحية سندي المعتادة" : "Replied with the standard Sanadi greeting"),
                issuedDocument: null, receipt: null, ct, loggedMessage: text);

        var greeting = await PhraseGreeting(conn, userId, text, lang, supportAgent, ct, onVoiceText);
        if (string.IsNullOrWhiteSpace(greeting.Text))
            throw new SanadiException(lang == "ar"
                ? "ما قدرت أسوي رد التحية الحين. جرب مرة ثانية."
                : "The greeting reply could not be generated right now. Please try again.");
        return await PersistAssistantTurn(conn, userId, conversationId, greeting.Text, lang, classification, traceId, sw,
            agent: "query", responseType: "answer", verified: false, tools: new JsonArray("greeting"),
            activity: new JsonArray(lang == "ar" ? "ردّ تحية ودّي من النموذج" : "Replied with a model-generated friendly greeting"),
            issuedDocument: null, receipt: null, ct);
    }

    /// <summary>Ask the configured model for a smart, warm social reply; null if AI is off or fails.</summary>
    private async Task<(string? Text, string Provider, string? Model)> PhraseGreeting(
        System.Data.Common.DbConnection conn, Guid userId, string question, string lang, string? supportAgent, CancellationToken ct,
        Func<string, Task>? onVoiceText = null)
    {
        var cfg = await conn.QueryFirstOrDefaultAsync<dynamic>(DbProc.Call("usp_Assistant_GetAiSettings", null, ct));
        if (cfg is null || !(bool)cfg.ai_enabled) return (null, "deterministic", null);
        string provider = (string)cfg.provider, model = (string)cfg.model_name, key = ((string?)cfg.api_key)?.Trim() ?? "", url = ((string?)cfg.api_url)?.Trim() ?? "";
        var providerKind = AiProviderChat.Resolve(provider);
        if (providerKind is null) return (null, provider, model);
        bool? enableThinking = cfg.enable_thinking is null ? null : Convert.ToBoolean(cfg.enable_thinking);
        var isOllama = providerKind == AiProviderKind.Ollama;
        key = ResolveProviderKey(provider, key);
        if (string.IsNullOrEmpty(key) || string.IsNullOrEmpty(url) || (isOllama && enableThinking is null))
            return (null, provider, model);

        var prompt = SupportAgentPersona.GreetingPrompt(question, lang, supportAgent);

        // Enough room for a full social reply; never inherit a tiny max_output_tokens setting.
        var configuredTokenBudget = Convert.ToInt32(cfg.max_output_tokens);
        var tokenBudget = isOllama
            ? configuredTokenBudget
            : Math.Max(512, Math.Min(1024, configuredTokenBudget));
        try
        {
            var text = await CallConfiguredModel(providerKind.Value, model, key, url, userId, prompt, (decimal)cfg.temperature, tokenBudget, enableThinking, ct, onVoiceText);
            if (string.IsNullOrWhiteSpace(text)) return (null, provider, model);

            // If the model still cut off mid-sentence, ask once for a complete rewrite.
            if (onVoiceText is null && IsIncompleteModelReply(text))
            {
                var repair = SupportAgentPersona.RepairPrompt(question, lang, supportAgent, text);
                var repaired = await CallConfiguredModel(providerKind.Value, model, key, url, userId, repair, (decimal)cfg.temperature, tokenBudget, enableThinking, ct);
                if (!string.IsNullOrWhiteSpace(repaired) && !IsIncompleteModelReply(repaired))
                    text = repaired;
                else if (!string.IsNullOrWhiteSpace(repaired) && repaired.Trim().Length > text.Trim().Length)
                    text = repaired;
            }

            return (text.Trim(), provider, model);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex) { LogFunctionError(ex, nameof(PhraseGreeting)); return (null, provider, model); }
    }

    private async Task<string?> CallConfiguredModel(
        AiProviderKind provider, string model, string key, string url, Guid userId, string prompt, decimal temperature,
        int tokenBudget, bool? enableThinking, CancellationToken ct, Func<string, Task>? onVoiceText = null)
    {
        var client = clients.CreateClient("AssistantModel");
        if (onVoiceText is not null && provider is AiProviderKind.Ollama or AiProviderKind.OpenAiCompatible or AiProviderKind.AzureOpenAi)
        {
            // All connection values originate in ai_settings. No external
            // endpoint, model, or credential fallback is consulted.
            using var streamedRequest = AiProviderChat.CreateRequest(
                provider, url, key, userId, model, prompt, temperature, tokenBudget, enableThinking, stream: true);
            using var streamedResponse = await client.SendAsync(streamedRequest, HttpCompletionOption.ResponseHeadersRead, ct);
            streamedResponse.EnsureSuccessStatusCode();
            await using var body = await streamedResponse.Content.ReadAsStreamAsync(ct);
            return await VoiceModelStream.Read(body, onVoiceText, ct);
        }
        using var request = AiProviderChat.CreateRequest(
            provider, url, key, userId, model, prompt, temperature, tokenBudget, enableThinking);
        using var response = await client.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            logger.LogError("AI provider {Provider} rejected model {Model} with HTTP {StatusCode}",
                provider, model, (int)response.StatusCode);
            return null;
        }
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        return AiProviderChat.ReadText(provider, document.RootElement);
    }

    // Chat model credentials and endpoints come only from ai_settings. There is
    // intentionally no environment/provider fallback to an external model.
    private static string ResolveProviderKey(string provider, string configuredKey) => configuredKey;

    private static bool IsIncompleteModelReply(string text)
    {
        var t = text.Trim();
        if (t.Length < 40) return true;
        return !Regex.IsMatch(t, @"[.!?؟…」』”’""']\s*$");
    }

    /// <summary>Mirrors core detectStudentDataIntent — personal record questions only.</summary>
    private static string? DetectStudentDataIntent(string text)
    {
        var l = text.ToLowerInvariant();
        bool Has(params string[] words) => words.Any(l.Contains);
        if (Has("who am i", "what is my name", "who i am", "my student id", "my student number",
                "my profile", "my details", "my information",
                "من أنا", "منو أنا", "ما اسمي", "اسمي", "رقمي الجامعي", "بياناتي", "ملفي"))
            return "identity";
        var coursey = Has("course", "subject", "class", "مادة", "مواد", "مقرر", "مقررات");
        if (coursey)
        {
            if (Has("remain", "left", "still need", "yet to", "haven't taken", "متبق", "باقي", "لم أدرس"))
                return "remaining_courses";
            if (Has("complete", "passed", "finished", "taken", "مكتمل", "أكملت", "اجتزت", "درست"))
                return "completed_courses";
            if (Has("current", "this semester", "this term", "registered", "enrolled", "now", "الحالي", "هذا الفصل", "مسجل"))
                return "current_courses";
        }
        if (Has("gpa", "standing", "معدل", "المعدل", "وضعي الأكاديمي", "credits", "ساعات", "academic status", "my status"))
            return "academic_status";
        if (Has("graduat", "تخرج", "التخرج", "remaining credit", "ساعات متبقية"))
            return "graduation";
        return null;
    }

    private async Task<(string Answer, bool HasProfile)?> TryAnswerPersonalRecord(
        System.Data.Common.DbConnection conn, Guid userId, string intent, string lang, CancellationToken ct)
    {
        if (intent is not ("identity" or "academic_status" or "graduation" or "completed_courses"))
            return null;

        var ctx = await conn.QuerySingleOrDefaultAsync(DbProc.Call("usp_Documents_GetStudentContext", new { id = userId }, ct));
        var career = await conn.QuerySingleOrDefaultAsync(DbProc.Call("usp_Career_GetStudentProfile", new { id = userId }, ct));
        var hasProfile = ctx?.student_number is not null || career?.student_number is not null;
        var ar = lang == "ar";
        if (!hasProfile)
        {
            return (
                ar
                    ? "لم أجد سجلاً أكاديمياً مرتبطاً بحسابك، لذلك لا يمكنني التحقق من بياناتك الشخصية."
                    : "I could not find an academic record linked to your account, so I cannot verify your personal data.",
                false);
        }

        if (intent == "completed_courses")
        {
            var courses = (await conn.QueryAsync(DbProc.Call(
                "usp_Career_ListCompletedCourses", new { id = userId }, ct))).ToArray();
            var lines = courses.Select((course, index) =>
            {
                var code = (string?)course.code ?? "";
                var title = (string?)course.title ?? "";
                var grade = (string?)course.grade;
                var result = string.Join(" — ", new[] { code, title }.Where(value => !string.IsNullOrWhiteSpace(value)));
                return $"{index + 1}. {result}{(string.IsNullOrWhiteSpace(grade) ? "" : $" · {grade}")}";
            });
            var completedAnswer = courses.Length == 0
                ? (ar ? "لا توجد مقررات مكتملة مرتبطة بسجلك الأكاديمي." : "No completed courses are linked to your academic record.")
                : (ar ? $"**المقررات المكتملة**\n{string.Join("\n", lines)}" : $"**Completed courses**\n{string.Join("\n", lines)}");
            return (completedAnswer, true);
        }

        var fullName = (string?)ctx?.full_name;
        var studentNumber = (string?)ctx?.student_number ?? (string?)career?.student_number;
        var programme = ar
            ? ((string?)ctx?.programme_ar ?? (string?)career?.programme_ar ?? (string?)ctx?.programme_en ?? (string?)career?.programme_en)
            : ((string?)ctx?.programme_en ?? (string?)career?.programme_en);
        var college = ar ? (string?)ctx?.college_ar : (string?)ctx?.college_en;
        var term = ar ? (string?)ctx?.term_ar : (string?)ctx?.term_en;
        var level = (string?)ctx?.academic_level ?? (string?)career?.academic_level;
        var enrollment = HumanizeStatus((string?)ctx?.account_status, ar);
        var standing = HumanizeStatus((string?)ctx?.academic_standing, ar);
        var gpa = (decimal?)career?.cumulative_gpa;
        var completed = (int?)career?.completed_credit_hours ?? 0;
        var registered = (int?)ctx?.registered_credit_hours ?? 0;
        var total = (int?)career?.total_credit_hours ?? 120;
        var expected = ctx?.expected_graduation_date ?? career?.expected_graduation_date;
        string? expectedText = null;
        if (expected is DateTime dt) expectedText = dt.ToString(ar ? "d MMMM yyyy" : "d MMMM yyyy", ar ? new System.Globalization.CultureInfo("ar") : System.Globalization.CultureInfo.GetCultureInfo("en-GB"));
        else if (expected is DateTimeOffset dto) expectedText = dto.ToString(ar ? "d MMMM yyyy" : "d MMMM yyyy", ar ? new System.Globalization.CultureInfo("ar") : System.Globalization.CultureInfo.GetCultureInfo("en-GB"));
        else if (expected is not null) expectedText = expected.ToString();

        var header = string.Join("\n", new[]
        {
            $"**{fullName ?? (ar ? "الطالب" : "Student")}**",
            programme ?? "",
            college ?? "",
            studentNumber is null ? "" : (ar ? $"الرقم الجامعي {studentNumber}" : $"Student ID {studentNumber}"),
        }.Where(s => !string.IsNullOrWhiteSpace(s)));

        var facts = new List<string>();
        if (!string.IsNullOrWhiteSpace(level)) facts.Add(ar ? $"المستوى: {level}" : level!);
        if (!string.IsNullOrWhiteSpace(enrollment)) facts.Add(ar ? $"القيد: {enrollment}" : $"Enrollment: {enrollment}");
        if (!string.IsNullOrWhiteSpace(term)) facts.Add(ar ? $"الفصل الحالي: {term}" : $"Current semester: {term}");
        if (gpa is not null) facts.Add(ar ? $"المعدل التراكمي: {gpa}" : $"GPA: {gpa}");
        if (!string.IsNullOrWhiteSpace(standing)) facts.Add(ar ? $"الحالة الأكاديمية: {standing}" : $"Academic standing: {standing}");
        facts.Add(ar ? $"المكتملة: {completed} ساعة" : $"Completed: {completed} credits");
        facts.Add(ar ? $"المسجلة حالياً: {registered} ساعة" : $"Currently registered: {registered} credits");
        facts.Add(ar ? $"متطلب التخرج: {total} ساعة" : $"Degree requirement: {total} credits");
        if (!string.IsNullOrWhiteSpace(expectedText))
            facts.Add(ar ? $"التخرج المتوقع: {expectedText}" : $"Expected graduation: {expectedText}");

        var percent = total > 0 ? Math.Round(completed * 1000d / total) / 10d : (double?)null;
        var summary = ar
            ? $"أكملت {completed} من {total} ساعة معتمدة{(registered > 0 ? $"، وأنت مسجل حالياً في {registered} ساعة إضافية" : "")}{(!string.IsNullOrWhiteSpace(standing) ? $"، وحالتك الأكاديمية: {standing}" : "")}."
            : $"You have completed {completed} of {total} credit hours{(registered > 0 ? $", and you are currently registered for another {registered} credits" : "")}{(!string.IsNullOrWhiteSpace(standing) ? $", with an academic standing of {standing}" : "")}.";

        var progress = percent is null
            ? ""
            : $"**{(ar ? "تقدم التخرج" : "Degree progress")}**\n{completed} / {total} {(ar ? "مكتملة" : "completed")}\n{percent}% {(ar ? "مكتمل" : "complete")}";

        var link = ar ? "\n\n[عرض سجلي الأكاديمي الكامل](/academic#profile)" : "\n\n[View full academic record](/academic#profile)";
        var answer = string.Join("\n\n", new[]
        {
            header,
            $"**{(ar ? "ملخصك الأكاديمي" : "Your academic snapshot")}**\n" + string.Join("\n", facts.Select(f => $"- {f}")),
            summary,
            progress,
        }.Where(s => !string.IsNullOrWhiteSpace(s))) + link;

        return (answer, true);
    }

    private static string? HumanizeStatus(string? raw, bool ar)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var key = raw.Trim().ToLowerInvariant().Replace(' ', '_');
        return key switch
        {
            "active" or "enrolled" => ar ? "نشط" : "Active",
            "good_standing" or "good" => ar ? "وضع أكاديمي جيد" : "Good Standing",
            "probation" or "academic_probation" => ar ? "إنذار أكاديمي" : "Academic Probation",
            "inactive" or "withdrawn" => ar ? "غير نشط" : "Inactive",
            _ => raw.Replace('_', ' '),
        };
    }

    private async Task<JsonObject> FinishPersonalTurn(
        System.Data.Common.DbConnection conn, Guid userId, Guid conversationId, string text, string lang,
        Classification classification, Guid traceId, Stopwatch sw, (string Answer, bool HasProfile) personal, CancellationToken ct)
    {
        var assistantId = Guid.NewGuid();
        var citations = new JsonArray(new JsonObject
        {
            ["documentId"] = null,
            ["sourceTitle"] = lang == "ar" ? "سجلك الطلابي في النظام" : "Your student record in the university system",
            ["owningUnit"] = lang == "ar" ? "خدمات الطلبة الأكاديمية" : "Student Academic Services",
            ["documentVersion"] = null,
            ["effectiveDate"] = DateTime.UtcNow.ToString("yyyy-MM-dd"),
            ["citationUrl"] = null,
            ["confidence"] = "high",
        });
        var response = new JsonObject
        {
            ["agent"] = "academic",
            ["classification"] = JsonSerializer.SerializeToNode(classification with { Category = "academic", RequiresStudentData = true }, Json),
            ["answer"] = personal.Answer,
            ["verified"] = personal.HasProfile,
            ["citations"] = citations,
            ["proposedActions"] = new JsonArray(),
            ["messageId"] = assistantId.ToString(),
            ["conversationId"] = conversationId.ToString(),
            ["responseType"] = "answer",
            ["intents"] = new JsonArray(new JsonObject { ["intent"] = "query", ["category"] = "academic", ["confidence"] = classification.Confidence, ["handled"] = true }),
            ["clarifyingQuestion"] = null,
            ["nextSteps"] = new JsonArray(),
            ["toolsUsed"] = new JsonArray("get_my_identity"),
            ["activity"] = new JsonArray(
                lang == "ar" ? "راجعت سجلك الجامعي الرسمي" : "Checked against your official university records.",
                lang == "ar" ? "أُجيب من السجل الجامعي دون نموذج ذكاء اصطناعي" : "Answered from university records without the AI model."),
            ["confidence"] = classification.Confidence,
            ["fallbackUsed"] = false,
            ["humanHandoff"] = false,
            ["receipt"] = null,
            ["issuedDocument"] = null,
            ["careerInsight"] = null,
            ["libraryResults"] = null,
            ["caseResult"] = null,
            ["followUp"] = null,
            ["traceId"] = traceId.ToString(),
        };
        var metadata = response.DeepClone().AsObject(); metadata.Remove("answer");
        await conn.ExecuteAsync(DbProc.Call("usp_Assistant_InsertRunAndMessage", new
        {
            assistantId, conversationId, userId, content = personal.Answer, lang,
            metadata = metadata.ToJsonString(Json), traceId, agent = "academic",
            input = JsonSerializer.Serialize(new { message = text }, Json),
            output = response.ToJsonString(Json),
            latency = (int)sw.ElapsedMilliseconds, model = (string?)null, provider = "deterministic",
            responseType = "answer", confidence = classification.Confidence, tools = 1, fallback = false, handoff = false
        }, ct));
        return response;
    }

    private async Task<Sanadi.Infrastructure.Appointments.AppointmentChatService.AppointmentContext?> LoadAppointmentContext(
        System.Data.Common.DbConnection conn, Guid conversationId, CancellationToken ct)
    {
        var meta = await conn.ExecuteScalarAsync<string?>(DbProc.Call("usp_Assistant_GetLastAssistantMetadata", new { conversationId }, ct));
        if (string.IsNullOrWhiteSpace(meta)) return null;
        try
        {
            using var doc = JsonDocument.Parse(meta);
            return Sanadi.Infrastructure.Appointments.AppointmentChatService.ParseContext(JsonNode.Parse(meta));
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex) { LogFunctionError(ex, nameof(LoadAppointmentContext)); return null; }
    }

    private sealed record AlertContext(bool AwaitingLocation, string? OriginalMessage, string? Location);

    private async Task<AlertContext?> LoadAlertContext(
        System.Data.Common.DbConnection conn, Guid conversationId, CancellationToken ct)
    {
        var meta = await conn.ExecuteScalarAsync<string?>(DbProc.Call("usp_Assistant_GetLastAssistantMetadata", new { conversationId }, ct));
        if (string.IsNullOrWhiteSpace(meta)) return null;
        try
        {
            var node = JsonNode.Parse(meta)?.AsObject();
            var ctx = node?["alertContext"]?.AsObject();
            if (ctx is null) return null;
            return new AlertContext(
                ctx["awaitingLocation"]?.GetValue<bool>() == true,
                ctx["originalMessage"]?.GetValue<string>(),
                ctx["location"]?.GetValue<string>());
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex) { LogFunctionError(ex, nameof(LoadAlertContext)); return null; }
    }

    private static bool IsAlertFlow(string text, Classification classification, AlertContext? prior)
    {
        if (classification.Intent == "alert" || classification.RequiresHumanEscalation) return true;
        if (prior?.AwaitingLocation != true) return false;
        // Follow-up after we asked for campus location (e.g. "CIT E1").
        if (ExtractCampusLocation(text) is not null) return true;
        var t = text.Trim();
        if (t.Length is > 0 and <= 80
            && !IsPersonalGreeting(t)
            && DetectStudentDataIntent(t) is null
            && !IsLetterRequest(t)
            && !Regex.IsMatch(t, @"\b(appointment|book|library|gpa|grade|complaint|suggest|موعد|مكتبة|شكوى)\b", RegexOptions.IgnoreCase))
            return true;
        return false;
    }

    private static string? ExtractCampusLocation(string text)
    {
        var m = CampusLocation.Match(text.Trim());
        if (m.Success) return Regex.Replace(m.Value.Trim(), @"\s+", " ");
        // Short reply after we asked for location — treat the whole message as the place.
        var t = text.Trim();
        if (t.Length is >= 2 and <= 60
            && !Regex.IsMatch(t, @"\b(yes|no|ok|okay|confirm|submit|please|thanks|thank you|نعم|لا|حسنا|تأكيد)\b", RegexOptions.IgnoreCase)
            && !Danger.Any(d => t.Contains(d, StringComparison.OrdinalIgnoreCase)))
            return t;
        return null;
    }

    private async Task<JsonObject> FinishAlertTurn(
        System.Data.Common.DbConnection conn, Guid userId, Guid conversationId, string text, string lang,
        Classification classification, Guid traceId, Stopwatch sw, AlertContext? prior, CancellationToken ct)
    {
        var ar = lang == "ar";
        var original = prior?.OriginalMessage ?? text;
        var location = ExtractCampusLocation(text)
            ?? (prior?.AwaitingLocation == true && text.Trim().Length is >= 2 and <= 80 ? text.Trim() : null)
            ?? prior?.Location;

        string answer;
        string? clarifying = null;
        var nextSteps = new JsonArray();
        var actions = new JsonArray();
        AlertContext alertCtx;
        string responseType;

        if (string.IsNullOrWhiteSpace(location))
        {
            answer = ar
                ? "يرجى الحفاظ على سلامتك. يرجى ملاحظة أن سندي مساعد ذكاء اصطناعي وليس بديلاً عن خدمات الطوارئ. لتقديم بلاغ طوارئ رسمي لدى جامعة الإمارات، أكّد إن كنت تريد مني إرسال تقرير التنبيه. وهل يمكنك أيضاً مشاركة موقعك الحالي في الحرم الجامعي ليُوجَّه فوراً إلى أمن الحرم؟"
                : "Please stay safe. Please note that Sanadi is an AI assistant and is not a substitute for emergency services. To file an official emergency alert with UAEU, please confirm if you would like me to submit an alert report. Could you also share your current location on campus so it can be routed immediately to Campus Security?";
            clarifying = ar
                ? "هل يمكنك مشاركة موقعك الحالي في الحرم الجامعي وتفاصيل عن الطوارئ؟"
                : "Could you please share your current location on campus and details about the emergency?";
            nextSteps.Add(ar
                ? "قدّم موقعك في الحرم الجامعي وتفاصيل عن الطوارئ."
                : "Provide your campus location and details about the emergency.");
            nextSteps.Add(ar
                ? "أكّد الإرسال لفتح تنبيه لدى أمن الحرم الجامعي."
                : "Confirm submission so an alert can be opened with Campus Security.");
            alertCtx = new AlertContext(true, original, null);
            responseType = "clarification";
        }
        else
        {
            var loc = location.Trim();
            answer = ar
                ? $"سندي ليس بديلاً عن خدمات الطوارئ. إذا كنت في خطر مباشر، اتصل بخدمات الطوارئ المحلية أو بأمن الحرم مباشرة.\n\n**تفاصيل الإجراء**\n\n- **الخدمة:** بلاغ تنبيه طوارئ\n- **الوحدة المسؤولة:** خدمات الأمن\n- **الموقع:** {loc}\n- **البيانات المشتركة:** الرقم الجامعي، تفاصيل الجلسة الحالية، والموقع المقدَّم.\n\nهل تريد مني إرسال بلاغ تنبيه الطوارئ الآن؟ ملاحظة: تعذر تأكيد تفصيل ثانوي من مصدر رسمي، لذلك لم أُدرجه."
                : $"Sanadi is not a substitute for emergency services. If you are in immediate danger, please contact local emergency services or campus security directly.\n\n**Action details**\n\n- **SERVICE:** Emergency Alert Report\n- **RESPONSIBLE UNIT:** Security Services\n- **LOCATION:** {loc}\n- **SHARED DATA:** Student ID, current session details, and provided location.\n\nWould you like me to submit this emergency alert report now? Note: one secondary detail could not be confirmed from an official source, so I left it out.";
            nextSteps.Add(ar
                ? "أكّد لإرسال بلاغ تنبيه الطوارئ"
                : "Confirm to submit the emergency alert report");
            nextSteps.Add(ar
                ? "اتصل بخدمات الطوارئ المحلية مباشرة إذا احتجت مساعدة طبية أو بدنية فورية"
                : "Contact local emergency services directly if immediate medical or physical assistance is required");
            actions.Add(new JsonObject
            {
                ["key"] = "report_alert",
                ["labelEn"] = "Notify Security Services now",
                ["labelAr"] = "إبلاغ خدمات الأمن الآن",
                ["risk"] = "level_3",
                ["affectedService"] = "Emergency Alert Report",
                ["dataShared"] = ar
                    ? "الرقم الجامعي وتفاصيل الجلسة الحالية والموقع المقدَّم"
                    : "Student ID, current session details, and provided location",
                ["expectedOutcome"] = ar
                    ? "يصل بلاغ عاجل إلى خدمات الأمن ويُتابع كحالة"
                    : "An urgent alert reaches Security Services and is tracked as a case",
                ["consequence"] = ar
                    ? "يُفتح بلاغ رسمي باسمك لدى خدمات الأمن"
                    : "An official alert is opened in your name with Security Services",
                ["fee"] = ar ? "بدون رسوم" : "No fee",
                ["responsibleUnit"] = ar ? "خدمات الأمن" : "Security Services",
                ["route"] = "/requests",
                ["toolName"] = "report_alert",
                ["args"] = new JsonObject
                {
                    ["title"] = original.Length > 120 ? original[..120] : original,
                    ["description"] = $"{original}\n\nLocation: {loc}",
                    ["location"] = loc,
                    ["unitCode"] = "Security Services",
                },
                ["humanApprovalRequired"] = true,
                ["reversible"] = "conditional",
            });
            alertCtx = new AlertContext(false, original, loc);
            responseType = "action_proposal";
        }

        var alertClassification = classification with
        {
            Intent = "alert",
            Category = "emergency",
            Urgency = "critical",
            RequiredUnitCode = "SEC",
            RequiredUnitName = ar ? "خدمات الأمن" : "Security Services",
            RequiresHumanEscalation = true,
            Confidence = 0.95m,
        };

        var assistantId = Guid.NewGuid();
        var response = new JsonObject
        {
            ["agent"] = "alert",
            ["classification"] = JsonSerializer.SerializeToNode(alertClassification, Json),
            ["answer"] = answer,
            ["verified"] = true,
            ["citations"] = new JsonArray(new JsonObject
            {
                ["documentId"] = null,
                ["sourceTitle"] = ar ? "سجل جهات الطوارئ المعتمد في الجامعة" : "Official university emergency contact register",
                ["owningUnit"] = ar ? "خدمات الأمن" : "Security Services",
                ["documentVersion"] = null,
                ["effectiveDate"] = DateTime.UtcNow.ToString("yyyy-MM-dd"),
                ["citationUrl"] = null,
                ["confidence"] = "high",
            }),
            ["proposedActions"] = actions,
            ["messageId"] = assistantId.ToString(),
            ["conversationId"] = conversationId.ToString(),
            ["responseType"] = responseType,
            ["intents"] = new JsonArray(new JsonObject { ["intent"] = "alert", ["category"] = "emergency", ["confidence"] = 0.95m, ["handled"] = true }),
            ["clarifyingQuestion"] = clarifying,
            ["nextSteps"] = nextSteps,
            ["toolsUsed"] = new JsonArray("report_alert"),
            ["activity"] = new JsonArray(
                ar ? "صنّفت الطلب كتنبيه طوارئ" : "Classified the request as an emergency alert",
                string.IsNullOrWhiteSpace(location)
                    ? (ar ? "طلبت موقع الحرم لتوجيه البلاغ" : "Asked for the campus location to route the alert")
                    : (ar ? "جهّزت تفاصيل بلاغ التنبيه للتأكيد" : "Prepared the emergency alert details for confirmation")),
            ["confidence"] = 0.95m,
            ["fallbackUsed"] = false,
            ["humanHandoff"] = false,
            ["receipt"] = null,
            ["issuedDocument"] = null,
            ["careerInsight"] = null,
            ["libraryResults"] = null,
            ["caseResult"] = null,
            ["followUp"] = null,
            ["traceId"] = traceId.ToString(),
            ["alertContext"] = new JsonObject
            {
                ["awaitingLocation"] = alertCtx.AwaitingLocation,
                ["originalMessage"] = alertCtx.OriginalMessage,
                ["location"] = alertCtx.Location,
            },
        };
        var metadata = response.DeepClone().AsObject(); metadata.Remove("answer");
        await conn.ExecuteAsync(DbProc.Call("usp_Assistant_InsertRunAndMessage", new
        {
            assistantId, conversationId, userId, content = answer, lang,
            metadata = metadata.ToJsonString(Json), traceId, agent = "alert",
            input = JsonSerializer.Serialize(new { message = text }, Json),
            output = response.ToJsonString(Json),
            latency = (int)sw.ElapsedMilliseconds, model = (string?)null, provider = "deterministic",
            responseType, confidence = 0.95m, tools = 1, fallback = false, handoff = true
        }, ct));
        return response;
    }

    private async Task<JsonObject> FinishAppointmentTurn(
        System.Data.Common.DbConnection conn, Guid userId, Guid conversationId, string text, string lang,
        Classification classification, Guid traceId, Stopwatch sw,
        Sanadi.Infrastructure.Appointments.AppointmentChatService.AppointmentTurnResult appt, CancellationToken ct)
    {
        var assistantId = Guid.NewGuid();
        var citations = new JsonArray(new JsonObject
        {
            ["documentId"] = null,
            ["sourceTitle"] = lang == "ar" ? "جدول المواعيد الجامعي" : "University appointment schedule",
            ["owningUnit"] = appt.Context.UnitLabel ?? (lang == "ar" ? "الخدمات الطلابية" : "Student Services"),
            ["documentVersion"] = null,
            ["effectiveDate"] = DateTime.UtcNow.ToString("yyyy-MM-dd"),
            ["citationUrl"] = null,
            ["confidence"] = "high",
        });
        var responseType = appt.ProposedActions.Count > 0 ? "action_proposal" : "answer";
        var response = new JsonObject
        {
            ["agent"] = "appointment",
            ["classification"] = JsonSerializer.SerializeToNode(classification with { Category = "appointment", RequiresStudentData = true }, Json),
            ["answer"] = appt.Answer,
            ["verified"] = appt.Verified,
            ["citations"] = citations,
            ["proposedActions"] = appt.ProposedActions,
            ["messageId"] = assistantId.ToString(),
            ["conversationId"] = conversationId.ToString(),
            ["responseType"] = responseType,
            ["intents"] = new JsonArray(new JsonObject { ["intent"] = "query", ["category"] = "appointment", ["confidence"] = classification.Confidence, ["handled"] = true }),
            ["clarifyingQuestion"] = null,
            ["nextSteps"] = new JsonArray(),
            ["toolsUsed"] = new JsonArray(appt.ToolUsed),
            ["activity"] = new JsonArray(
                lang == "ar" ? "راجعت المواعيد المتاحة فعلياً" : "Checked real appointment availability"),
            ["confidence"] = classification.Confidence,
            ["fallbackUsed"] = false,
            ["humanHandoff"] = false,
            ["receipt"] = null,
            ["issuedDocument"] = null,
            ["careerInsight"] = null,
            ["libraryResults"] = null,
            ["caseResult"] = null,
            ["followUp"] = null,
            ["traceId"] = traceId.ToString(),
            ["appointmentContext"] = JsonSerializer.SerializeToNode(appt.Context, Json),
        };
        var metadata = response.DeepClone().AsObject(); metadata.Remove("answer");
        await conn.ExecuteAsync(DbProc.Call("usp_Assistant_InsertRunAndMessage", new
        {
            assistantId, conversationId, userId, content = appt.Answer, lang,
            metadata = metadata.ToJsonString(Json), traceId, agent = "appointment",
            input = JsonSerializer.Serialize(new { message = text }, Json),
            output = response.ToJsonString(Json),
            latency = (int)sw.ElapsedMilliseconds, model = (string?)null, provider = "deterministic",
            responseType, confidence = classification.Confidence, tools = 1, fallback = false, handoff = false
        }, ct));
        return response;
    }

    internal static WorkingAgent InitialWorkingAgent(string text, string lang)
    {
        var initial = Classify(ConversationalTurn.StudentText(text), lang);
        return ResolveWorkingAgent(initial.Intent == "query" ? initial.Category : initial.Intent, lang);
    }

    internal static WorkingAgent ResolveWorkingAgent(string agent, string lang)
    {
        var ar = lang == "ar";
        return agent.Trim().ToLowerInvariant() switch
        {
            "complaint" => ar
                ? new("complaint", "وكيل الشكاوى", "وكيل الشكاوى يجهّز شكواك…", "complaint")
                : new("complaint", "Complaint Agent", "Complaint Agent is preparing your complaint…", "complaint"),
            "suggestion" => ar
                ? new("suggestion", "وكيل الاقتراحات", "وكيل الاقتراحات يسجّل اقتراحك…", "suggestion")
                : new("suggestion", "Suggestion Agent", "Suggestion Agent is recording your suggestion…", "suggestion"),
            "alert" or "emergency" => ar
                ? new("emergency", "وكيل الطوارئ والسلامة", "وكيل الطوارئ والسلامة يجلب جهات الطوارئ الرسمية…", "emergency")
                : new("emergency", "Emergency & Safety Agent", "Emergency & Safety Agent is retrieving the official emergency contacts…", "emergency"),
            "appointment" => ar
                ? new("appointment", "وكيل المواعيد", "وكيل المواعيد يراجع الأوقات المتاحة…", "appointment")
                : new("appointment", "Appointment Agent", "Appointment Agent is checking real availability…", "appointment"),
            "career" => ar
                ? new("career", "وكيل الإرشاد المهني", "وكيل الإرشاد المهني يراجع ملفك المهني…", "career")
                : new("career", "Career Counselling Agent", "Career Counselling Agent is reviewing your career profile…", "career"),
            "library" => ar
                ? new("library", "وكيل المكتبة", "وكيل المكتبة يبحث في الفهرس…", "library")
                : new("library", "Library Agent", "Library Agent is searching the catalogue…", "library"),
            "holds" => ar
                ? new("holds", "وكيل معالجة الإيقافات", "وكيل معالجة الإيقافات يراجع الإيقافات على سجلك…", "holds")
                : new("holds", "Hold Resolution Agent", "Hold Resolution Agent is checking the holds on your record…", "holds"),
            "registration" => ar
                ? new("registration", "وكيل جاهزية التسجيل", "وكيل جاهزية التسجيل يراجع سجلك الأكاديمي وأي عوائق للتسجيل…", "registration")
                : new("registration", "Registration Readiness Agent", "Registration Readiness Agent is checking your academic record and registration blockers…", "registration"),
            "academic" => ar
                ? new("academic", "وكيل التقدم الأكاديمي", "وكيل التقدم الأكاديمي يراجع سجلك الأكاديمي…", "academic")
                : new("academic", "Academic Progress Agent", "Academic Progress Agent is checking your academic record…", "academic"),
            "document" => ar
                ? new("document", "وكيل إنشاء الوثائق", "وكيل إنشاء الوثائق يجهّز خطابك…", "document")
                : new("document", "Document Generation Agent", "Document Generation Agent is preparing your letter…", "document"),
            _ => ar
                ? new("knowledge", "وكيل المعرفة", "وكيل المعرفة يراجع المصادر الرسمية للجامعة…", "knowledge")
                : new("knowledge", "Knowledge Agent", "Knowledge Agent is checking the official university sources…", "knowledge"),
        };
    }

    private async Task<JsonObject> RunLetterTurn(
        System.Data.Common.DbConnection conn, Guid userId, Guid conversationId, string text, string lang,
        Classification classification, Guid traceId, Stopwatch sw, CancellationToken ct)
    {
        var letterLang = lang == "ar" || Regex.IsMatch(text, @"\b(arabic|عربي)\b", RegexOptions.IgnoreCase) ? "ar" : "en";
        IssuedEnrolmentLetter issued;
        try
        {
            var requestOrigin = $"{Request.Scheme}://{Request.Host}";
            var fwdHost = Request.Headers["X-Forwarded-Host"].FirstOrDefault()?.Split(',')[0]?.Trim();
            var fwdProto = Request.Headers["X-Forwarded-Proto"].FirstOrDefault()?.Split(',')[0]?.Trim();
            if (!string.IsNullOrWhiteSpace(fwdHost))
                requestOrigin = $"{(fwdProto is "http" or "https" ? fwdProto : "https")}://{fwdHost}";

            issued = await letters.IssueAsync(
                userId,
                letterLang,
                "general",
                new LetterFieldFlags(),
                conversationId,
                requestOrigin,
                ct);
        }
        catch (SanadiException ex)
        {
            LogFunctionError(ex, nameof(RunLetterTurn));
            var failAnswer = lang == "ar"
                ? $"تعذر إصدار الخطاب الآن: {ex.Message}"
                : $"The letter could not be issued yet: {ex.Message}";
            return await PersistAssistantTurn(conn, userId, conversationId, failAnswer, lang, classification, traceId, sw,
                agent: "document", responseType: "answer", verified: false,
                tools: new JsonArray("check_enrollment_letter_readiness"),
                activity: new JsonArray(lang == "ar" ? "راجعت أهليتك للخطاب" : "Checked your letter eligibility"),
                issuedDocument: null, receipt: null, ct);
        }

        var reference = issued.ReferenceNumber;
        var ctx = await LetterStudentContext(conn, userId);
        var programme = lang == "ar"
            ? ((string?)ctx.programmeAr ?? (string?)ctx.programmeEn ?? "")
            : ((string?)ctx.programmeEn ?? "");
        var college = lang == "ar"
            ? ((string?)ctx.collegeAr ?? (string?)ctx.collegeEn ?? "")
            : ((string?)ctx.collegeEn ?? "");

        // Fact lines use "- **LABEL:** value" so the chat UI renders a FactsCard
        // (label/value rows) instead of plain prose. The layout mirrors the live
        // Sanadi assistant: one-line confirmation, document details, policy line, delivery line.
        var answer = lang == "ar"
            ? $"تم إنشاء إفادة التسجيل الخاصة بك فوراً.\n\n**تفاصيل المستند**\n- **الرقم المرجعي:** {reference}\n- **نوع المستند:** شهادة لمن يهمه الأمر (إفادة قيد)\n- **اللغة:** {(letterLang == "ar" ? "العربية" : "الإنجليزية")}\n- **حالة القيد:** فعّال\n\nوفقاً لإرشادات الجامعة، تُصدر إفادات التسجيل الرسمية تلقائياً من سجلك المعتمد في برنامج {programme} في {college}.\n\nمستندك جاهز هنا في المحادثة مع خيارَي **التنزيل** و**المشاركة**، وسيبقى متاحاً أيضاً في «وثائقي» للرجوع إليه لاحقاً."
            : $"Your enrolment letter has been generated instantly.\n\n**Document details**\n- **Reference number:** {reference}\n- **Document type:** To Whom It May Concern (Enrolment Certificate)\n- **Language:** {(letterLang == "ar" ? "Arabic" : "English")}\n- **Enrolment status:** Active\n\nUnder university guidelines, official enrolment letters are issued automatically from your verified record in {programme} at {college}.\n\nYour document is ready right here in the chat with options to **Download** and **Share**. It will also remain accessible under \"My Documents\" for future reference.";

        var issuedDocument = new JsonObject
        {
            ["documentId"] = issued.Id.ToString(),
            ["referenceNumber"] = reference,
            ["titleEn"] = "To Whom It May Concern letter",
            ["titleAr"] = "شهادة إلى من يهمه الأمر",
            ["language"] = letterLang,
            ["issuedAt"] = issued.IssuedAt.ToString("o"),
            ["verifyUrl"] = issued.VerifyUrl,
            ["verifyToken"] = issued.VerifyToken,
            ["fileName"] = issued.FileName,
            ["documentHash"] = issued.DocumentHash,
            ["status"] = issued.Status,
        };
        var receipt = new JsonObject
        {
            ["receiptNumber"] = reference,
            ["referenceNumber"] = reference,
            ["actionType"] = "issue_enrollment_letter",
            ["responsibleUnit"] = "Admission & Registration",
            ["submittedAt"] = DateTimeOffset.UtcNow,
            ["expectedFirstResponseAt"] = null,
            ["expectedResolutionAt"] = null,
            ["nextStep"] = lang == "ar"
                ? "الخطاب جاهز للتنزيل من وثائقي."
                : "Your letter is ready to download from My Documents.",
            ["trackingUrl"] = "/documents",
        };

        return await PersistAssistantTurn(conn, userId, conversationId, answer, lang, classification, traceId, sw,
            agent: "document", responseType: "receipt", verified: true,
            tools: new JsonArray("check_enrollment_letter_readiness", "issue_enrollment_letter"),
            activity: new JsonArray(
                lang == "ar" ? "راجعت أهليتك للخطاب" : "Checked your letter eligibility",
                lang == "ar" ? "أصدرت خطابك الرسمي" : "Issued your official letter"),
            issuedDocument: issuedDocument, receipt: receipt, ct);
    }

    private async Task<JsonObject> PersistAssistantTurn(
        System.Data.Common.DbConnection conn, Guid userId, Guid conversationId, string answer, string lang,
        Classification classification, Guid traceId, Stopwatch sw, string agent, string responseType, bool verified,
        JsonArray tools, JsonArray activity, JsonObject? issuedDocument, JsonObject? receipt, CancellationToken ct,
        string? loggedMessage = null, string? clarifyingQuestion = null)
    {
        var assistantId = Guid.NewGuid();
        var nextSteps = new JsonArray();
        if (issuedDocument is not null)
        {
            nextSteps.Add(lang == "ar"
                ? "نزّل الخطاب من البطاقة أدناه أو من وثائقي."
                : "Download the letter from the card below or from My Documents.");
        }
        var response = new JsonObject
        {
            ["agent"] = agent,
            ["classification"] = JsonSerializer.SerializeToNode(classification, Json),
            ["answer"] = answer,
            ["verified"] = verified,
            ["citations"] = new JsonArray(),
            ["proposedActions"] = new JsonArray(),
            ["messageId"] = assistantId.ToString(),
            ["conversationId"] = conversationId.ToString(),
            ["responseType"] = responseType,
            ["intents"] = new JsonArray(new JsonObject { ["intent"] = classification.Intent, ["category"] = classification.Category, ["confidence"] = classification.Confidence, ["handled"] = true }),
            ["clarifyingQuestion"] = clarifyingQuestion,
            ["nextSteps"] = nextSteps,
            ["toolsUsed"] = tools,
            ["activity"] = activity,
            ["confidence"] = classification.Confidence,
            ["fallbackUsed"] = false,
            ["humanHandoff"] = false,
            ["receipt"] = receipt,
            ["issuedDocument"] = issuedDocument,
            ["careerInsight"] = null,
            ["libraryResults"] = null,
            ["caseResult"] = null,
            ["followUp"] = null,
            ["traceId"] = traceId.ToString()
        };
        var metadata = response.DeepClone().AsObject(); metadata.Remove("answer");
        await conn.ExecuteAsync(DbProc.Call("usp_Assistant_InsertRunAndMessage", new
        {
            assistantId, conversationId, userId, content = answer, lang,
            metadata = metadata.ToJsonString(Json), traceId, agent,
            input = JsonSerializer.Serialize(new { message = loggedMessage ?? "letter" }, Json),
            output = response.ToJsonString(Json),
            latency = (int)sw.ElapsedMilliseconds, model = (string?)null, provider = "deterministic",
            responseType, confidence = classification.Confidence, tools = tools.Count, fallback = false, handoff = false
        }, ct));
        return response;
    }

    private static async Task<dynamic> LetterStudentContext(System.Data.Common.DbConnection db, Guid id)
    {
        var r = await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Documents_GetStudentContext", new { id }, CancellationToken.None));
        var exists = r is not null && r.student_number is not null;
        var status = (string?)r?.account_status ?? "unknown";
        var reason = !exists
            ? "No academic record is linked to this account, so an enrollment letter cannot be issued."
            : status != "active"
                ? $"Your enrollment status is recorded as \"{status}\", so a letter confirming active enrollment cannot be issued."
                : r?.programme_en is null
                    ? "Your academic programme is missing from the student record, so the letter cannot state your programme."
                    : null;
        return new
        {
            eligible = reason is null,
            blockingReason = reason,
            studentName = (string?)r?.full_name ?? (string?)r?.email ?? "UAEU student",
            studentNumber = (string?)r?.student_number,
            programmeEn = (string?)r?.programme_en,
            programmeAr = (string?)r?.programme_ar,
            collegeEn = (string?)r?.college_en,
            collegeAr = (string?)r?.college_ar,
            termEn = (string?)r?.term_en,
            termAr = (string?)r?.term_ar,
            enrollmentStatus = status
        };
    }

    private static async Task<List<Evidence>> Retrieve(System.Data.Common.DbConnection conn, string query, string lang, CancellationToken ct)
    {
        var terms = AssistantEvidenceQuery.Terms(query);
        if (terms.Length == 0) return [];
        var rows = (await conn.QueryAsync<Evidence>(DbProc.Call("usp_Assistant_RetrieveEvidence",
            new { terms = JsonSerializer.Serialize(terms), lang, overview = AssistantEvidenceQuery.IsNamedPolicyOverview(query) }, ct))).ToList();
        return rows
            .DistinctBy(e => new { e.DocumentId, e.Title, e.Content })
            .OrderByDescending(e => AssistantEvidenceSafety.Rank(query, e.Title, e.Content, e.Score))
            .ThenByDescending(e => e.EffectiveDate)
            .Take(8)
            .ToList();
    }

    private async Task<(string? Text,string Provider,string? Model,string PromptVersion)> Phrase(System.Data.Common.DbConnection conn,Guid userId,string question,string lang,Classification classification,List<Evidence> evidence,string? supportAgent,CancellationToken ct,
        Func<string, Task>? onVoiceText = null)
    {
        var cfg=await conn.QueryFirstOrDefaultAsync<dynamic>(DbProc.Call("usp_Assistant_GetAiSettings", null, ct));
        if (cfg is null || !(bool)cfg.ai_enabled || evidence.Count==0) return (null,"deterministic",null,"knowledge.deterministic");
        string provider=(string)cfg.provider, model=(string)cfg.model_name, key=((string?)cfg.api_key)?.Trim() ?? "", url=((string?)cfg.api_url)?.Trim() ?? "";
        var providerKind=AiProviderChat.Resolve(provider);
        if(providerKind is null)return(null,provider,model,"knowledge.unavailable");
        bool? enableThinking=cfg.enable_thinking is null?null:Convert.ToBoolean(cfg.enable_thinking);
        key=ResolveProviderKey(provider,key);
        if(string.IsNullOrEmpty(key)||string.IsNullOrEmpty(url)||(providerKind==AiProviderKind.Ollama&&enableThinking is null))return(null,provider,model,"knowledge.unavailable");
        var sources=AssistantPromptJson.Serialize(evidence.Select((e,i)=>new {
            source=$"S{i+1}", type=e.SourceType, title=e.Title,
            content=e.Content[..Math.Min(e.Content.Length,3000)] }));
        var taskPrompt=AssistantEvidenceQuery.Prompt(question,lang,sources) + SupportAgentInstruction(supportAgent, lang);
        var prompt=await AssistantPromptProvider.BuildAsync(conn,"knowledge",lang,taskPrompt,ct);
        try
        {
            var text=await CallConfiguredModel(providerKind.Value,model,key,url,userId,prompt.Text,(decimal)cfg.temperature,(int)cfg.max_output_tokens,enableThinking,ct,onVoiceText);
            return(text,provider,model,prompt.Version);
        } catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex) { LogFunctionError(ex, nameof(Phrase)); return(null,provider,model,prompt.Version); }
    }

    private static string SupportAgentInstruction(string? supportAgent, string lang)
        => "\n\n" + SupportAgentPersona.Instruction(supportAgent, lang);

    private static string Fallback(string question,string lang,Classification c,List<Evidence> evidence)
    {
        if(c.RequiresHumanEscalation)return lang=="ar"?"يبدو إن الوضع طارئ. إذا في خطر مباشر اتصل بالطوارئ الحين، وأقدر أساعدك تسجّل تنبيه للجهة المختصة.":"This appears urgent. Contact local emergency services immediately if anyone is in immediate danger; I can also help record an alert for the responsible university team.";
        if(evidence.Count==0)return lang=="ar"?"ما لقيت مصدر جامعي معتمد يجاوب على هالسؤال، فما راح أخمن. أقدر أساعدك ترفع طلب للجهة المختصة.":"I could not find an approved university source that answers this, so I will not guess. I can help route a request to the responsible unit.";
        var excerpt=Regex.Replace(evidence[0].Content,@"\s+"," ").Trim(); excerpt=excerpt[..Math.Min(excerpt.Length,700)];
        return lang=="ar"?$"حسب المصدر الجامعي المعتمد «{evidence[0].Title}»: {excerpt}":$"According to the approved university source “{evidence[0].Title}”: {excerpt}";
    }

    private static JsonArray Proposals(string text,string lang,Classification c)
    {
        var a=new JsonArray(); string? tool=c.Intent switch{"complaint"=>"create_complaint","suggestion"=>"create_suggestion","alert"=>"report_alert",_=>null}; if(tool is null)return a;
        var label=tool=="create_complaint"?("Submit complaint","تقديم شكوى"):tool=="create_suggestion"?("Submit suggestion","تقديم اقتراح"):("Report alert","إرسال تنبيه");
        a.Add(new JsonObject{{"key",tool},{"labelEn",label.Item1},{"labelAr",label.Item2},{"risk",c.Intent=="alert"?"level_3":"level_2"},{"affectedService",c.Category},{"dataShared","Your message and account identity"},{"expectedOutcome","An official tracked record"},{"consequence","Creates an official university record"},{"fee","No fee"},{"responsibleUnit","Student Services"},{"route","/requests"},{"toolName",tool},{"args",new JsonObject{{"title",text[..Math.Min(text.Length,120)]},{"description",text}}},{"humanApprovalRequired",c.Intent=="alert"},{"reversible","conditional"}}); return a;
    }

    private async Task<(object Data,string? Reference,string? Unit,string? Tracking,string NextEn,string NextAr,object? Document)> ExecuteTool(System.Data.Common.DbConnection conn,Guid userId,string tool,JsonObject args,Guid? conversationId,string lang,CancellationToken ct)
    {
        if(tool is "create_complaint" or "create_suggestion" or "create_enquiry" && args["smartConcern"]?.GetValue<bool>()==true)
            return await ExecuteSmartConcern(conn,userId,tool,args,conversationId,lang,ct);
        var title=(args["title"]?.GetValue<string>()??args["subject"]?.GetValue<string>()??"Student request").Trim(); var description=(args["description"]?.GetValue<string>()??args["message"]?.GetValue<string>()??title).Trim();
        if (tool == "create_complaint")
            return await ExecuteComplaint(conn,userId,args,conversationId,lang,ct);
        if (tool == "report_alert")
        {
            var incident = await MatchCampusIncident(conn, description, ct);
            if (incident is not null)
                return await ExecuteCampusIncident(conn, userId, title, description, conversationId, lang, incident, ct);
        }
        if(tool is "create_complaint" or "report_alert" or "escalate_to_human" or "open_hold_resolution_case" or "request_career_counsellor" or "ask_a_librarian")
        {
            var id=Guid.NewGuid(); var reference=$"CASE-{DateTime.UtcNow:yyyyMMdd}-{Random.Shared.Next(10000,99999)}"; var type=tool=="report_alert"?"alert":tool=="create_complaint"?"complaint":"service_request"; var urgent=tool=="report_alert"?"critical":"medium";
            var route=await new InteractionUnitRouting(clients,logger).Resolve(conn,userId,title,description,type,null,null,ct);
            var assignment=await TicketAssignment.ResolveAsync(conn,route.UnitId,userId,ct:ct);
            await conn.ExecuteAsync(DbProc.Call("usp_Assistant_InsertCase",
                new{id,reference,userId,type,title,description,urgent,lang,conversationId,unit=assignment.UnitId,owner=assignment.Owner}, ct));
            await InAppNotify.PushCaseOpenedAsync(conn, id, reference, userId, assignment.UnitId, assignment.Owner, urgent, userId, assignment.En, ct);
            if (tool == "report_alert")
                await InAppNotify.PushAdminsAsync(conn, "case_escalated", id, reference, $"Alert {reference} needs attention.", null, userId, "alert", ct: ct);
            return(new{id,reference},reference,lang=="ar"?assignment.Ar:assignment.En,$"/requests/{id}","The responsible team will review it and update you in My Requests.","سيراجع الفريق المختص الطلب ويحدّثك عبر صفحة طلباتي.",null);
        }
        if (tool=="create_suggestion")
            return await ExecuteSuggestion(conn,userId,args,conversationId,lang,ct);
        if (tool == "book_appointment")
        {
            var slotRaw = args["slotId"]?.GetValue<string>() ?? args["slot_id"]?.GetValue<string>();
            if (!Guid.TryParse(slotRaw, out var slotId)) throw new SanadiException("A valid appointment slot is required.");
            if (conn.State != System.Data.ConnectionState.Open) await conn.OpenAsync(ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            var slot = await conn.QuerySingleOrDefaultAsync(DbProc.Call("usp_GetAppointmentSlotForUpdate", new { slotId }, ct, tx));
            if (slot is null) throw new SanadiException(lang == "ar" ? "هذا الموعد لم يعد متاحاً." : "That slot is no longer available.");
            var booked = (int)slot.booked_count; var capacity = (int)slot.capacity;
            var status = (string?)slot.status;
            if (!string.Equals(status, "open", StringComparison.OrdinalIgnoreCase) || booked >= capacity)
                throw new SanadiException(lang == "ar" ? "هذا الموعد لم يعد متاحاً." : "That slot is no longer available.");
            var id = Guid.NewGuid();
            var caseId = Guid.NewGuid();
            // Same confirmation format as core book_appointment_slot: APT- + 6 hex.
            var code = "APT-" + Guid.NewGuid().ToString("N")[..6].ToUpperInvariant();
            var purpose = (args["purpose"]?.GetValue<string>() ?? "Appointment booked through Sanadi").Trim();
            DateTimeOffset start = slot.start_time is DateTimeOffset dto ? dto
                : slot.start_time is DateTime dt ? new DateTimeOffset(dt, TimeSpan.Zero) : DateTimeOffset.UtcNow;
            var meta = await conn.QueryFirstOrDefaultAsync(DbProc.Call("usp_Assistant_AppointmentMetadata", new { slotId }, ct, tx));
            var unitName = lang == "ar"
                ? ((string?)meta?.UnitAr ?? (string?)meta?.UnitEn ?? "Appointments")
                : ((string?)meta?.UnitEn ?? (string?)meta?.UnitAr ?? "Appointments");
            var typeName = lang == "ar" ? ((string?)meta?.TypeAr ?? (string?)meta?.TypeEn) : ((string?)meta?.TypeEn ?? (string?)meta?.TypeAr);
            var location = lang == "ar" ? ((string?)meta?.LocAr ?? (string?)meta?.LocEn) : ((string?)meta?.LocEn ?? (string?)meta?.LocAr);
            var caseTitle = lang == "ar"
                ? $"موعد — {typeName ?? unitName}"
                : $"Appointment — {typeName ?? unitName}";
            var caseDescription = string.Join("\n", new[]
            {
                lang == "ar" ? $"الرمز التأكيدي: {code}" : $"Confirmation code: {code}",
                lang == "ar" ? $"الوقت: {start:yyyy-MM-dd HH:mm}" : $"When: {start:yyyy-MM-dd HH:mm} UTC",
                string.IsNullOrWhiteSpace(location) ? null : (lang == "ar" ? $"المكان: {location}" : $"Location: {location}"),
                string.IsNullOrWhiteSpace(purpose) ? null : purpose,
            }.Where(x => !string.IsNullOrWhiteSpace(x)));
            var appointmentAssignment=await TicketAssignment.ResolveAsync(conn,(Guid?)meta?.UnitId,userId,
                preferredOwner:(Guid?)meta?.StaffId,ct:ct,tx:tx);
            await conn.ExecuteAsync(DbProc.Call("usp_Assistant_InsertCase",
                new { id = caseId, reference = code, userId, type = "service_request", title = caseTitle, description = caseDescription, urgent = "medium", lang, conversationId,unit=appointmentAssignment.UnitId,owner=appointmentAssignment.Owner }, ct, tx));
            await conn.ExecuteAsync(DbProc.Call("usp_Assistant_UpdateAppointmentCase", new { caseId, unitId = (Guid?)meta?.UnitId, staffId = (Guid?)meta?.StaffId, start, location }, ct, tx));
            await conn.ExecuteAsync(DbProc.Call("usp_BookAppointment", new { id, uid = userId, slotId, purpose, code, caseId }, ct, tx));
            await tx.CommitAsync(ct);
            await InAppNotify.PushCaseOpenedAsync(
                conn, caseId, code, userId, appointmentAssignment.UnitId, appointmentAssignment.Owner, "medium", userId, unitName, ct);
            await InAppNotify.PushAsync(
                conn, "appointment_booked", userId, caseId,
                lang == "ar" ? $"تم تأكيد الموعد — {code}" : $"Appointment confirmed — {code}",
                $"/requests/{caseId}", caseId, (Guid?)meta?.UnitId, userId, "Appointment confirmed",
                $"appt-booked:{caseId}", ct: ct);
            return (new { id, confirmationCode = code, slotId, caseId }, code, unitName, $"/requests/{caseId}",
                "Your appointment is confirmed. You can track it in My Requests.",
                "تم تأكيد موعدك. يمكنك متابعته من صفحة طلباتي.", null);
        }
        throw new SanadiException("This action is not available through the C# assistant yet.");
    }

    private static string RiskFor(string tool)=>tool switch{"report_alert" or "escalate_to_human"=>"level_3","create_complaint" or "create_enquiry" or "book_appointment" or "issue_enrollment_letter"=>"level_2",_=>"level_1"};
    internal static bool Allowed(string? json,HashSet<string> roles)
    {
        if(string.IsNullOrWhiteSpace(json))return false;
        try
        {
            using var policy=JsonDocument.Parse(json);
            if(policy.RootElement.ValueKind!=JsonValueKind.Array)return false;
            var entries=policy.RootElement.EnumerateArray().ToArray();
            return entries.All(x=>x.ValueKind==JsonValueKind.String&&!string.IsNullOrWhiteSpace(x.GetString())) &&
                entries.Any(x=>roles.Contains(x.GetString()!));
        }
        catch(JsonException){return false;}
    }
    private static object Receipt(string receipt,string tool,string? reference,string lang,string? unit=null,string? tracking=null)=>new{receiptNumber=receipt,referenceNumber=reference,actionType=tool,responsibleUnit=unit,submittedAt=DateTimeOffset.UtcNow,expectedFirstResponseAt=(DateTimeOffset?)null,expectedResolutionAt=(DateTimeOffset?)null,nextStep=lang=="ar"?"تابع الحالة من صفحة طلباتي.":"Track the status in My Requests.",trackingUrl=tracking};
    private static async Task Audit(System.Data.Common.DbConnection conn,Guid userId,string action,Guid entityId,object data)=>await conn.ExecuteAsync(DbProc.Call("usp_Assistant_InsertAudit",new{userId,action,entityId,metadata=JsonSerializer.Serialize(data,Json)}));
    /// <summary>Student-facing recovery reference (matches Node TR-… format).</summary>
    private static string TraceRef(Guid traceId) =>
        "TR-" + Convert.ToHexString(traceId.ToByteArray())[..8] + "-" + Convert.ToHexString(traceId.ToByteArray())[8..14];
    private async Task RecordException(
        System.Data.Common.DbConnection conn, string code, Guid userId, Guid conversationId, Guid traceId,
        string action, bool recovered, bool escalated, string? detail, string? studentMessage, CancellationToken ct)
    {
        if (ct.IsCancellationRequested) return;
        try
        {
            await conn.ExecuteAsync(DbProc.Call("usp_Exceptions_Insert", new
            {
                code,
                userId,
                conversationId,
                detail = (detail ?? "").Length > 2000 ? detail![..2000] : detail,
                action,
                recovered,
                escalated,
                trace = TraceRef(traceId),
                message = studentMessage,
                severity = "warning",
            }, ct));
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // This best-effort diagnostic must not change the completed business operation.
        }
        catch (Exception ex)
        {
            LogFunctionError(ex, nameof(RecordException));
            // Never fail the student turn because the recovery log insert failed.
        }
    }
    private void LogFunctionError(Exception ex, string function)
    {
        ApiErrorPolicy.LogOnce(logger, ex, HttpContext, function);
    }

    private async Task Send(object value,CancellationToken ct){await Response.WriteAsync($"data: {JsonSerializer.Serialize(value,Json)}\n\n",ct);await Response.Body.FlushAsync(ct);}
    private static IEnumerable<string> Chunk(string text,int width){for(var i=0;i<text.Length;i+=width)yield return text.Substring(i,Math.Min(width,text.Length-i));}
}
