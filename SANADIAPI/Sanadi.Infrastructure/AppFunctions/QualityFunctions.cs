using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Sanadi.Domain.Exceptions;
using Sanadi.Domain.Security;
using static Sanadi.Infrastructure.AppFunctions.FunctionData;
using static Sanadi.Infrastructure.AppFunctions.FunctionJson;

namespace Sanadi.Infrastructure.AppFunctions;

public sealed class QualityFunctions(FunctionData db)
{
    private static readonly string[] ScoreKeys = ["intent_score", "factual_score", "student_data_score", "citation_score", "completeness_score", "conciseness_score", "action_relevance_score", "tool_selection_score", "safety_score", "privacy_score", "language_score", "tone_score", "task_completion_score"];
    private static readonly (string Phase, string Column)[] Phases = [("authentication", "authentication_duration_ms"), ("intent", "intent_duration_ms"), ("retrieval", "retrieval_duration_ms"), ("tool", "tool_duration_ms"), ("generation", "generation_duration_ms"), ("supervisor", "supervisor_duration_ms"), ("database", "database_duration_ms")];

    public async Task<object> Dashboard(ICurrentUser user, CancellationToken ct)
    {
        RequireUser(user);
        var since = Filter("created_at", "gte", DateTimeOffset.UtcNow.AddDays(-30).ToString("O"));
        var reads = new[]
        {
            db.Rows("quality_targets", "*", user, ct, order: [Order("metric_key")]),
            db.Rows("performance_budgets", "response_category,budget_ms", user, ct, [Eq("is_active", true)]),
            db.Rows("response_performance_logs", "response_category,total_duration_ms,first_visible_feedback_ms,budget_exceeded,partial_failure", user, ct, [since], limit: 2000),
            db.Rows("grounding_checks", "passed,grounding_score,unsupported_claim_count", user, ct, [since], limit: 2000),
            db.Rows("agent_runs", "fallback_used,human_handoff", user, ct, [since], limit: 2000),
            db.Rows("release_readiness", "gate_key,label_en,label_ar,status,is_blocking,notes", user, ct, order: [Order("gate_key")]),
            db.Rows("service_degradation_state", "component,state,message_en,message_ar", user, ct),
            db.Rows("response_quality_reviews", "*", user, ct, [since], limit: 1000)
        };
        var rows = await Task.WhenAll(reads);
        var perf = rows[2]; var checks = rows[3]; var runs = rows[4]; var reviews = rows[7];
        var feedback = perf.Where(r => r["first_visible_feedback_ms"] is not null).Select(r => r.N("first_visible_feedback_ms")).ToArray();
        var budgets = new Dictionary<string, double>();
        foreach (var b in rows[1]) budgets[b.S("response_category") ?? ""] = b.N("budget_ms");
        double Rate(JsonObject[] input, string flag) => input.Length == 0 ? 0 : Round(input.Count(r => r.B(flag)) * 100.0 / input.Length);
        var passRate = Rate(checks, "passed");
        var avgScore = checks.Length == 0 ? 0 : Round(checks.Average(r => r.N("grounding_score")));
        var fallbackRate = Rate(runs, "fallback_used");
        var averages = new Dictionary<string, double>();
        foreach (var key in ScoreKeys)
        {
            var vals = reviews.Where(r => r[key] is not null).Select(r => r.N(key, double.NaN)).Where(n => !double.IsNaN(n)).ToArray();
            if (vals.Length > 0) averages[key] = Round(vals.Average(), 1);
        }
        (double? Value, int Sample) Measured(string key) => key switch
        {
            "grounding_pass_rate" => (passRate, checks.Length), "citation_accuracy" => (avgScore, checks.Length),
            "fallback_rate" => (fallbackRate, runs.Length), "first_feedback_ms" => (Percentile(feedback, 95), feedback.Length),
            "p95_total_ms" => (Percentile(perf.Select(r => r.N("total_duration_ms")), 95), perf.Length),
            _ => (averages.TryGetValue(key == "task_completion" ? "task_completion_score" : key + "_score", out var n) ? n : null, reviews.Length)
        };
        return new
        {
            targets = rows[0].Select(t =>
            {
                var live = Measured(t.S("metric_key") ?? "");
                var measured = live.Value ?? (t["measured_value"] is null ? (double?)null : t.N("measured_value"));
                var target = t.N("target_value");
                return new { metricKey = t.S("metric_key"), labelEn = t.S("label_en"), labelAr = t.S("label_ar"), target, measured,
                    unit = t.S("unit"), comparator = t.S("comparator"), isCritical = t["is_critical"],
                    meets = measured is null ? (bool?)null : t.S("comparator") == "lte" ? measured <= target : measured >= target,
                    sampleSize = live.Sample != 0 ? live.Sample : t.N("sample_size") };
            }),
            latency = perf.GroupBy(r => r.S("response_category")).Select(g => new
            {
                category = g.Key, budgetMs = budgets.TryGetValue(g.Key ?? "", out var budget) ? (double?)budget : null,
                p50 = Percentile(g.Select(r => r.N("total_duration_ms")), 50), p90 = Percentile(g.Select(r => r.N("total_duration_ms")), 90),
                p95 = Percentile(g.Select(r => r.N("total_duration_ms")), 95), p99 = Percentile(g.Select(r => r.N("total_duration_ms")), 99),
                samples = g.Count(), breaches = g.Count(r => r.B("budget_exceeded"))
            }),
            firstFeedbackP95 = Percentile(feedback, 95),
            grounding = new { checks = checks.Length, passRate, avgScore, unsupportedClaims = checks.Sum(r => r.N("unsupported_claim_count")) },
            reliability = new { runs = runs.Length, fallbackRate, handoffRate = Rate(runs, "human_handoff"), partialFailureRate = Rate(perf, "partial_failure") },
            readiness = rows[5].Select(r => new { gateKey = r.S("gate_key"), labelEn = r.S("label_en"), labelAr = r.S("label_ar"), status = r.S("status"), isBlocking = r["is_blocking"], notes = r.S("notes") }),
            health = rows[6].Select(r => new { component = r.S("component"), state = r.S("state"), messageEn = r.S("message_en"), messageAr = r.S("message_ar") }),
            reviews = new { total = reviews.Length, averages }
        };
    }

    public async Task<object> Performance(FunctionInput input, ICurrentUser user, CancellationToken ct)
    {
        var hours = input.Number("windowHours", 1, 720, 24);
        var category = input.OptionalString("category"); var model = input.OptionalString("model"); var path = input.OptionalString("path");
        await db.RequireRoles(user, ct, "Not permitted.", "system_admin", "service_manager", "auditor");
        var filters = new List<Sanadi.Application.Data.FilterOp> { Filter("created_at", "gte", DateTimeOffset.UtcNow.AddHours(-hours).ToString("O")) };
        if (!string.IsNullOrEmpty(category)) filters.Add(Eq("response_category", category));
        if (!string.IsNullOrEmpty(model)) filters.Add(Eq("model_name", model));
        if (!string.IsNullOrEmpty(path)) filters.Add(Eq("execution_path", path));
        var logs = await db.Rows("response_performance_logs", "trace_id,response_category,execution_path,model_name,total_duration_ms,first_visible_feedback_ms,first_token_ms,authentication_duration_ms,intent_duration_ms,retrieval_duration_ms,tool_duration_ms,generation_duration_ms,supervisor_duration_ms,database_duration_ms,model_call_count,tool_count,input_tokens,output_tokens,success,error_kind,rate_limited,budget_exceeded,conversation_id,created_at", user, ct, filters, [Order("created_at", true)], 5000);
        double P(IEnumerable<JsonObject> rs, int p) => Percentile(rs.Select(r => r.N("total_duration_ms")), p);
        string Key(JsonObject r, string key, string fallback) => string.IsNullOrEmpty(r.S(key) ?? fallback) ? "unknown" : r.S(key) ?? fallback;
        double Rate(Func<JsonObject, bool> predicate) => logs.Length == 0 ? 0 : Round(logs.Count(predicate) * 100.0 / logs.Length, 1);
        return new
        {
            windowHours = hours,
            totals = new { requests = logs.Length, requestsPerMinute = Round(logs.Length / Math.Max(1, hours * 60), 2),
                activeUsers = logs.Select(r => r.S("conversation_id")).Where(s => !string.IsNullOrEmpty(s)).Distinct().Count(),
                errorRate = Rate(r => !r.B("success")), timeoutRate = Rate(r => (r.S("error_kind") ?? "").Contains("timeout", StringComparison.Ordinal)),
                rateLimitEvents = logs.Count(r => r.B("rate_limited")), avgModelCalls = logs.Length == 0 ? 0 : Round(logs.Average(r => r.N("model_call_count")), 1),
                avgTokens = logs.Length == 0 ? 0 : Round(logs.Average(r => r.N("input_tokens") + r.N("output_tokens"))) },
            overall = new { p50 = P(logs, 50), p90 = P(logs, 90), p95 = P(logs, 95), p99 = P(logs, 99),
                firstFeedbackP95 = Percentile(logs.Select(r => r.N("first_visible_feedback_ms")).Where(n => n > 0), 95),
                firstTokenP95 = Percentile(logs.Select(r => r.N("first_token_ms")).Where(n => n > 0), 95) },
            byPath = logs.GroupBy(r => Key(r, "execution_path", "agentic")).Select(g => new { path = g.Key, samples = g.Count(), p50 = P(g, 50), p95 = P(g, 95), share = logs.Length == 0 ? 0 : Round(g.Count() * 100.0 / logs.Length) }).OrderByDescending(g => g.samples),
            byCategory = logs.GroupBy(r => Key(r, "response_category", "unknown")).Select(g => new { category = g.Key, samples = g.Count(), p50 = P(g, 50), p95 = P(g, 95), p99 = P(g, 99), breaches = g.Count(r => r.B("budget_exceeded")) }).OrderByDescending(g => g.samples),
            byModel = logs.GroupBy(r => Key(r, "model_name", "unknown")).Select(g => new { model = g.Key, samples = g.Count(), p50 = P(g, 50), p95 = P(g, 95) }).OrderByDescending(g => g.samples),
            phases = Phases.Select(p => new { phase = p.Phase, p50 = Percentile(logs.Select(r => r.N(p.Column)), 50), p95 = Percentile(logs.Select(r => r.N(p.Column)), 95) }),
            slowest = logs.OrderByDescending(r => r.N("total_duration_ms")).Take(12).Select(r => new
            {
                traceId = r.S("trace_id"), category = r.S("response_category"), path = r.S("execution_path") ?? "agentic", model = r.S("model_name"), totalMs = r.N("total_duration_ms"), createdAt = r.S("created_at"),
                breakdown = Phases.Select(p => new { label = p.Phase, ms = r.N(p.Column) }).Where(p => p.ms > 0),
                modelCalls = r.N("model_call_count"), toolCount = r.N("tool_count"), tokens = r.N("input_tokens") + r.N("output_tokens"), success = r["success"], errorKind = r.S("error_kind")
            })
        };
    }

    public async Task<object> Review(FunctionInput input, ICurrentUser user, CancellationToken ct)
    {
        var id = input.Uuid("agentRunId");
        if (!input.Value.TryGetProperty("scores", out var scores) || scores.ValueKind != JsonValueKind.Object) throw new SanadiException("scores: Expected object");
        var row = new Dictionary<string, object?> { ["agent_run_id"] = id, ["reviewer_type"] = "human", ["reviewer_profile_id"] = user.UserId,
            ["issue_tags"] = input.Strings("issueTags", optional: true), ["proposed_correction"] = input.OptionalString("proposedCorrection", 4000), ["comments"] = input.OptionalString("comments", 2000) };
        foreach (var score in scores.EnumerateObject()) row[score.Name.EndsWith("_score", StringComparison.Ordinal) ? score.Name : score.Name + "_score"] = new FunctionInput(scores).Number(score.Name, 1, 5);
        await db.RequireRoles(user, ct, "Not permitted.", "system_admin", "service_manager", "knowledge_manager", "auditor");
        await db.Write("response_quality_reviews", "POST", row, user, ct);
        return new { ok = true };
    }

    public async Task<object> Gate(FunctionInput input, ICurrentUser user, CancellationToken ct)
    {
        var key = input.String("gateKey"); var status = input.Enum("status", ["not_started", "in_progress", "passed", "failed", "waived"]); var notes = input.OptionalString("notes", 2000);
        await db.RequireRoles(user, ct, "Administrator access required.", "system_admin");
        await db.Write("release_readiness", "PATCH", new { status, notes, evaluated_at = DateTimeOffset.UtcNow.ToString("O"), evaluated_by = user.UserId }, user, ct, [Eq("gate_key", key)]);
        return new { ok = true };
    }

    public async Task<object> State(FunctionInput input, ICurrentUser user, CancellationToken ct)
    {
        var component = input.Enum("component", ["ai_provider", "knowledge_retrieval", "student_information", "case_management", "maintenance"]);
        var state = input.Enum("state", ["operational", "degraded", "outage", "maintenance"]);
        var en = input.OptionalString("messageEn", 500); var ar = input.OptionalString("messageAr", 500);
        await db.RequireRoles(user, ct, "Administrator access required.", "system_admin");
        await db.Write("service_degradation_state", "POST", new { component, state, message_en = en, message_ar = ar, since = DateTimeOffset.UtcNow.ToString("O"), updated_at = DateTimeOffset.UtcNow.ToString("O") }, user, ct, conflict: ["component"]);
        await db.Write("response_cache_metadata", "PATCH", new { invalidated_at = DateTimeOffset.UtcNow.ToString("O"), invalidation_reason = "state change" }, Trusted, ct,
            tolerateError: true, orFilters: [new() { Filters = [Filter("cache_key", "ilike", "service_health%"), Eq("data_category", "service_health")] }]);
        return new { ok = true };
    }

    // This deliberately retains the original ordered substring rules, including finance-question precedence.
    public static string ClassifyIntent(string text)
    {
        var lower = text.ToLowerInvariant();
        var rules = new (string Intent, string[] Words)[]
        {
            ("complaint", ["fee", "tuition", "payment", "refund", "invoice", "رسوم", "دفع", "استرداد", "فاتورة"]),
            ("query", ["register", "registration", "course", "grade", "transcript", "enrol", "letter", "تسجيل", "مقرر", "درجة", "كشف", "إثبات قيد", "شهادة"]),
            ("suggestion", ["suggest", "idea", "improve", "propose", "اقتراح", "فكرة", "تحسين"]),
            ("alert", ["alert", "deadline", "reminder", "تنبيه", "موعد", "تذكير"])
        };
        var match = rules.FirstOrDefault(r => r.Words.Any(w => lower.Contains(w, StringComparison.Ordinal))).Intent;
        var question = Regex.IsMatch(lower, @"\?|^(how|what|when|where|can|do|is)\b|كيف|ما هي|متى|أين|هل", RegexOptions.ECMAScript);
        return match == "complaint" && question ? "query" : match ?? (question ? "query" : "unknown");
    }

    public async Task<object> Consistency(ICurrentUser user, CancellationToken ct)
    {
        await db.RequireRoles(user, ct, "Not permitted.", "system_admin", "service_manager", "auditor");
        var groups = await db.Rows("evaluation_equivalence_groups", "id,group_code,description", user, ct,
            embeds: [new() { Alias = "evaluation_equivalence_items", Columns = ["language", "input_message", "expected_intent"] }]);
        return groups.Select(g =>
        {
            var results = (g["evaluation_equivalence_items"] as JsonArray ?? []).OfType<JsonObject>().Select(i =>
            {
                var intent = ClassifyIntent(i.S("input_message") ?? ""); var expected = i.S("expected_intent");
                return new { language = i.S("language"), message = i.S("input_message"), expectedIntent = expected, detectedIntent = intent, matches = string.IsNullOrEmpty(expected) || expected == intent };
            }).ToArray();
            return new { groupCode = g.S("group_code"), description = g.S("description"), itemCount = results.Length, consistent = results.Select(r => r.detectedIntent).Distinct().Count() == 1,
                matchRate = results.Length == 0 ? 0 : Round(results.Count(r => r.matches) * 100.0 / results.Length), results };
        });
    }
}
