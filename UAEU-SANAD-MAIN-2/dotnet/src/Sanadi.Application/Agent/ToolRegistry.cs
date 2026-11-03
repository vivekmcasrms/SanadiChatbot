using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Sanadi.Application.Services;
using Sanadi.Domain;

namespace Sanadi.Application.Agent;

public sealed record ToolContext(Guid UserId, IReadOnlyList<string> Roles, Lang Lang, Guid? ConversationId, string? TraceId);

public sealed record ToolResult(bool Ok, object? Data = null, string? Error = null,
    IReadOnlyList<Citation>? Citations = null, ActionReceipt? Receipt = null);

public sealed record ToolDefinition
{
    public required string Name { get; init; }
    public required string Description { get; init; }
    public required object ParametersSchema { get; init; }
    public string Risk { get; init; } = "level_0";
    public bool ReadOnly { get; init; } = true;
    public bool ConfirmationRequired { get; init; }
    public bool HumanApprovalRequired { get; init; }
    public string[] AllowedRoles { get; init; } = { Roles.Student };
    public required Func<ToolContext, IDictionary<string, object?>, CancellationToken, Task<ToolResult>> Run { get; init; }
}

/// <summary>
/// Server-side tool catalogue. Identity always comes from the authenticated
/// session — never from a value produced by the model.
/// </summary>
public class ToolRegistry
{
    private readonly Dictionary<string, ToolDefinition> _tools = new(StringComparer.OrdinalIgnoreCase);

    public ToolRegistry(ISanadiDbContext db, StudentContextService students, IKnowledgeRetriever retriever,
        CaseService cases, DocumentService documents)
    {
        static object Obj(object props, string[]? required = null) => new
        {
            type = "object",
            properties = props,
            required = required ?? Array.Empty<string>(),
            additionalProperties = false,
        };

        Add(new ToolDefinition
        {
            Name = "get_student_academic_status",
            Description = "Returns the signed-in student's verified academic record: programme, level, GPA, standing, credits, expected graduation, open cases.",
            ParametersSchema = Obj(new { }),
            Run = async (ctx, _, ct) =>
            {
                var s = await students.LoadAsync(ctx.UserId, ct);
                if (!s.HasProfile) return new ToolResult(false, Error: "No academic record is linked to this account.");
                return new ToolResult(true, s, Citations: new[]
                {
                    new Citation("Your student record in the university system", "Student Academic Services", null, null, null, 1),
                });
            },
        });

        Add(new ToolDefinition
        {
            Name = "get_student_holds",
            Description = "Lists the active holds on the student's record and what clears each one.",
            ParametersSchema = Obj(new { }),
            Run = async (ctx, _, ct) =>
            {
                var s = await students.LoadAsync(ctx.UserId, ct);
                return new ToolResult(true, new
                {
                    holdCount = s.Holds.Count,
                    holds = s.Holds.Select(h => new
                    {
                        title = ctx.Lang == Lang.Ar ? h.TitleAr : h.TitleEn,
                        resolution = ctx.Lang == Lang.Ar ? h.ResolutionAr : h.ResolutionEn,
                        h.BlocksRegistration,
                        h.BlocksGraduation,
                    }),
                });
            },
        });

        Add(new ToolDefinition
        {
            Name = "check_registration_eligibility",
            Description = "Checks whether the student can register next term (blocking holds and registered credits).",
            ParametersSchema = Obj(new { }),
            Run = async (ctx, _, ct) =>
            {
                var s = await students.LoadAsync(ctx.UserId, ct);
                var blocking = s.Holds.Where(h => h.BlocksRegistration).ToList();
                return new ToolResult(true, new
                {
                    canRegister = blocking.Count == 0,
                    blockingHolds = blocking.Select(h => ctx.Lang == Lang.Ar ? h.TitleAr : h.TitleEn),
                    s.RegisteredCredits,
                });
            },
        });

        Add(new ToolDefinition
        {
            Name = "get_graduation_progress",
            Description = "Returns completed vs required credit hours, percentage complete and graduation holds.",
            ParametersSchema = Obj(new { }),
            Run = async (ctx, _, ct) =>
            {
                var s = await students.LoadAsync(ctx.UserId, ct);
                var total = s.TotalCredits;
                return new ToolResult(true, new
                {
                    s.CompletedCredits,
                    requiredCredits = total,
                    remainingCredits = Math.Max(0, total - s.CompletedCredits),
                    percentComplete = (int)Math.Round(s.CompletedCredits * 100.0 / Math.Max(1, total)),
                    s.ExpectedGraduation,
                    graduationHolds = s.Holds.Where(h => h.BlocksGraduation)
                        .Select(h => ctx.Lang == Lang.Ar ? h.TitleAr : h.TitleEn),
                });
            },
        });

        Add(new ToolDefinition
        {
            Name = "check_transfer_eligibility",
            Description = "Deterministic inter-college transfer eligibility decision. The model must report this verdict verbatim and may never override it.",
            ParametersSchema = Obj(new { capacityAvailable = new { type = "boolean" } }),
            Run = async (ctx, args, ct) =>
            {
                var s = await students.LoadAsync(ctx.UserId, ct);
                var service = await db.ServiceCatalog.AsNoTracking()
                    .FirstOrDefaultAsync(x => x.Code == "SVC-TRANSFER", ct);
                var capacity = args.TryGetValue("capacityAvailable", out var c) && c is bool b ? b : true;
                var verdict = TransferEligibility.Evaluate(
                    s.CompletedCredits, s.Gpa ?? 0m, s.PreviousTransfers, capacity, service?.IsActive ?? false);
                return new ToolResult(true, new
                {
                    decision = verdict.Eligible ? "eligible" : "not_eligible",
                    reasons = verdict.Reasons,
                    rules = new
                    {
                        minCredits = TransferEligibility.MinCredits,
                        maxCredits = TransferEligibility.MaxCredits,
                        minGpa = TransferEligibility.MinGpa,
                    },
                    yourRecord = new { s.CompletedCredits, s.Gpa, s.PreviousTransfers },
                });
            },
        });

        Add(new ToolDefinition
        {
            Name = "search_knowledge_base",
            Description = "Searches approved university documents, web pages and structured sources for grounded evidence.",
            ParametersSchema = Obj(new { query = new { type = "string" } }, new[] { "query" }),
            Run = async (ctx, args, ct) =>
            {
                var query = args.TryGetValue("query", out var q) ? q?.ToString() ?? "" : "";
                if (string.IsNullOrWhiteSpace(query)) return new ToolResult(false, Error: "A query is required.");
                var clearance = ctx.Roles.Any(r => Roles.Staff.Contains(r)) ? 3 : 1;
                var passages = await retriever.SearchAsync(query, ctx.Lang, clearance, 6, ct);
                return new ToolResult(true,
                    passages.Select(p => new { p.SourceTitle, p.SectionTitle, p.PageNumber, p.Content, p.Score }),
                    Citations: passages
                        .Select(p => new Citation(p.SourceTitle, null, p.SectionTitle, p.PageNumber, p.Url, p.Score))
                        .ToList());
            },
        });

        Add(new ToolDefinition
        {
            Name = "issue_enrollment_letter",
            Description = "Issues the official To Whom It May Concern enrolment letter instantly as a verifiable PDF. Fully automated, no waiting time and no case is created.",
            ParametersSchema = Obj(new
            {
                language = new { type = "string", @enum = new[] { "en", "ar" } },
                purpose = new { type = "string" },
                includeGraduationDate = new { type = "boolean" },
            }, new[] { "language", "purpose" }),
            Risk = "level_1",
            ReadOnly = false,
            ConfirmationRequired = true,
            Run = async (ctx, args, ct) =>
            {
                var lang = (args.GetValueOrDefault("language")?.ToString() ?? "en") == "ar" ? Lang.Ar : Lang.En;
                var purpose = args.GetValueOrDefault("purpose")?.ToString() ?? "general";
                var include = args.GetValueOrDefault("includeGraduationDate") is bool g && g;
                var doc = await documents.IssueEnrolmentLetterAsync(ctx.UserId, lang, purpose, include, ct);
                return new ToolResult(true, doc, Receipt: new ActionReceipt(
                    doc.VerificationToken, null, "twimc_letter", "Student Academic Services",
                    doc.IssuedAt, "Download your letter — it is already issued.",
                    $"/verify/{doc.VerificationToken}"));
            },
        });

        Add(new ToolDefinition
        {
            Name = "create_service_request",
            Description = "Creates a service request case routed to the responsible unit when a human must act.",
            ParametersSchema = Obj(new
            {
                subject = new { type = "string" },
                description = new { type = "string" },
                unitCode = new { type = "string" },
                category = new { type = "string" },
            }, new[] { "subject", "description" }),
            Risk = "level_2",
            ReadOnly = false,
            ConfirmationRequired = true,
            Run = async (ctx, args, ct) =>
            {
                var receipt = await cases.CreateAsync(ctx.UserId, "request",
                    args.GetValueOrDefault("category")?.ToString() ?? "general",
                    args.GetValueOrDefault("subject")?.ToString() ?? "Service request",
                    args.GetValueOrDefault("description")?.ToString() ?? "",
                    args.GetValueOrDefault("unitCode")?.ToString(), ct);
                return new ToolResult(true, receipt, Receipt: receipt);
            },
        });

        Add(new ToolDefinition
        {
            Name = "create_complaint",
            Description = "Files a formal complaint for human review with SLA tracking.",
            ParametersSchema = Obj(new
            {
                subject = new { type = "string" },
                description = new { type = "string" },
                unitCode = new { type = "string" },
            }, new[] { "subject", "description" }),
            Risk = "level_2",
            ReadOnly = false,
            ConfirmationRequired = true,
            Run = async (ctx, args, ct) =>
            {
                var receipt = await cases.CreateAsync(ctx.UserId, "complaint", "complaint",
                    args.GetValueOrDefault("subject")?.ToString() ?? "Complaint",
                    args.GetValueOrDefault("description")?.ToString() ?? "",
                    args.GetValueOrDefault("unitCode")?.ToString(), ct);
                return new ToolResult(true, receipt, Receipt: receipt);
            },
        });

        Add(new ToolDefinition
        {
            Name = "submit_suggestion",
            Description = "Records a student suggestion. Human-required suggestions also create a companion case for the responsible owner.",
            ParametersSchema = Obj(new
            {
                subject = new { type = "string" },
                description = new { type = "string" },
                unitCode = new { type = "string" },
            }, new[] { "subject", "description" }),
            Risk = "level_1",
            ReadOnly = false,
            ConfirmationRequired = true,
            Run = async (ctx, args, ct) =>
            {
                var receipt = await cases.CreateAsync(ctx.UserId, "suggestion", "suggestion",
                    args.GetValueOrDefault("subject")?.ToString() ?? "Suggestion",
                    args.GetValueOrDefault("description")?.ToString() ?? "",
                    args.GetValueOrDefault("unitCode")?.ToString(), ct);
                return new ToolResult(true, receipt, Receipt: receipt);
            },
        });
    }

    private void Add(ToolDefinition tool) => _tools[tool.Name] = tool;

    public IReadOnlyCollection<ToolDefinition> All => _tools.Values;

    public IReadOnlyCollection<ToolDefinition> ForRoles(IReadOnlyList<string> roles) =>
        _tools.Values.Where(t => t.AllowedRoles.Length == 0 || t.AllowedRoles.Any(roles.Contains)).ToList();

    public ToolDefinition? Get(string name) => _tools.GetValueOrDefault(name);

    public string DescribeForModel(IReadOnlyList<string> roles) =>
        JsonSerializer.Serialize(ForRoles(roles).Select(t => new
        {
            t.Name,
            t.Description,
            parameters = t.ParametersSchema,
            t.ConfirmationRequired,
        }), new JsonSerializerOptions { WriteIndented = false });
}

internal static class ToolArgs
{
    public static object? GetValueOrDefault(this IDictionary<string, object?> args, string key) =>
        args.TryGetValue(key, out var value) ? value : null;
}
