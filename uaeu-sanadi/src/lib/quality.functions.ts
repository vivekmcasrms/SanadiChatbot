import { getActiveRoles } from "@/lib/authz/roles.server";
/** Quality, performance and release-readiness reporting. Staff/admin only. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Db } from "./agent/tools.server";

async function rolesOf(db: Db, userId: string): Promise<string[]> {
  return getActiveRoles(db, userId);
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

export type QualityDashboard = {
  targets: {
    metricKey: string;
    labelEn: string;
    labelAr: string;
    target: number;
    measured: number | null;
    unit: string;
    comparator: string;
    isCritical: boolean;
    meets: boolean | null;
    sampleSize: number;
  }[];
  latency: {
    category: string;
    budgetMs: number | null;
    p50: number;
    p90: number;
    p95: number;
    p99: number;
    samples: number;
    breaches: number;
  }[];
  firstFeedbackP95: number;
  grounding: { checks: number; passRate: number; avgScore: number; unsupportedClaims: number };
  reliability: { runs: number; fallbackRate: number; handoffRate: number; partialFailureRate: number };
  readiness: { gateKey: string; labelEn: string; labelAr: string; status: string; isBlocking: boolean; notes: string | null }[];
  health: { component: string; state: string; messageEn: string | null; messageAr: string | null }[];
  reviews: { total: number; averages: Record<string, number> };
};

export const getQualityDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<QualityDashboard> => {
    const db = context.supabase as Db;
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

    const [targetsRes, budgetsRes, perfRes, groundRes, runsRes, readyRes, healthRes, reviewRes] = await Promise.all([
      db.from("quality_targets").select("*").order("metric_key"),
      db.from("performance_budgets").select("response_category, budget_ms").eq("is_active", true),
      db
        .from("response_performance_logs")
        .select("response_category, total_duration_ms, first_visible_feedback_ms, budget_exceeded, partial_failure")
        .gte("created_at", since)
        .limit(2000),
      db.from("grounding_checks").select("passed, grounding_score, unsupported_claim_count").gte("created_at", since).limit(2000),
      db.from("agent_runs").select("fallback_used, human_handoff").gte("created_at", since).limit(2000),
      db.from("release_readiness").select("gate_key, label_en, label_ar, status, is_blocking, notes").order("gate_key"),
      db.from("service_degradation_state").select("component, state, message_en, message_ar"),
      db.from("response_quality_reviews").select("*").gte("created_at", since).limit(1000),
    ]);

    const budgets: Record<string, number> = {};
    for (const b of budgetsRes.data ?? []) budgets[b.response_category] = b.budget_ms;

    const byCategory = new Map<string, { totals: number[]; breaches: number }>();
    const feedback: number[] = [];
    let partialFailures = 0;
    for (const row of perfRes.data ?? []) {
      const entry = byCategory.get(row.response_category) ?? { totals: [], breaches: 0 };
      entry.totals.push(row.total_duration_ms ?? 0);
      if (row.budget_exceeded) entry.breaches += 1;
      byCategory.set(row.response_category, entry);
      if (row.first_visible_feedback_ms != null) feedback.push(row.first_visible_feedback_ms);
      if (row.partial_failure) partialFailures += 1;
    }

    const latency = [...byCategory.entries()].map(([category, e]) => ({
      category,
      budgetMs: budgets[category] ?? null,
      p50: percentile(e.totals, 50),
      p90: percentile(e.totals, 90),
      p95: percentile(e.totals, 95),
      p99: percentile(e.totals, 99),
      samples: e.totals.length,
      breaches: e.breaches,
    }));

    const checks = groundRes.data ?? [];
    const grounding = {
      checks: checks.length,
      passRate: checks.length ? Math.round((checks.filter((c) => c.passed).length / checks.length) * 100) : 0,
      avgScore: checks.length ? Math.round(checks.reduce((a, c) => a + Number(c.grounding_score ?? 0), 0) / checks.length) : 0,
      unsupportedClaims: checks.reduce((a, c) => a + (c.unsupported_claim_count ?? 0), 0),
    };

    const runs = runsRes.data ?? [];
    const reliability = {
      runs: runs.length,
      fallbackRate: runs.length ? Math.round((runs.filter((r) => r.fallback_used).length / runs.length) * 100) : 0,
      handoffRate: runs.length ? Math.round((runs.filter((r) => r.human_handoff).length / runs.length) * 100) : 0,
      partialFailureRate: perfRes.data?.length ? Math.round((partialFailures / perfRes.data.length) * 100) : 0,
    };

    const reviews = reviewRes.data ?? [];
    const scoreKeys = [
      "intent_score", "factual_score", "student_data_score", "citation_score", "completeness_score",
      "conciseness_score", "action_relevance_score", "tool_selection_score", "safety_score",
      "privacy_score", "language_score", "tone_score", "task_completion_score",
    ] as const;
    const averages: Record<string, number> = {};
    for (const key of scoreKeys) {
      const vals = reviews.map((r) => Number((r as Record<string, unknown>)[key] ?? NaN)).filter((n) => !Number.isNaN(n));
      if (vals.length) averages[key] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    }

    const measuredFor = (key: string): { value: number | null; sample: number } => {
      if (key === "grounding_pass_rate") return { value: grounding.passRate, sample: grounding.checks };
      if (key === "citation_accuracy") return { value: grounding.avgScore, sample: grounding.checks };
      if (key === "fallback_rate") return { value: reliability.fallbackRate, sample: reliability.runs };
      if (key === "first_feedback_ms") return { value: percentile(feedback, 95), sample: feedback.length };
      if (key === "p95_total_ms") {
        const all = (perfRes.data ?? []).map((r) => r.total_duration_ms ?? 0);
        return { value: percentile(all, 95), sample: all.length };
      }
      if (key === "task_completion") return { value: averages["task_completion_score"] ?? null, sample: reviews.length };
      const mapped = averages[`${key}_score`];
      return { value: mapped ?? null, sample: reviews.length };
    };

    const targets = (targetsRes.data ?? []).map((t) => {
      const stored = t.measured_value != null ? Number(t.measured_value) : null;
      const live = measuredFor(t.metric_key);
      const measured = live.value ?? stored;
      const target = Number(t.target_value);
      const meets =
        measured == null ? null : t.comparator === "lte" ? measured <= target : measured >= target;
      return {
        metricKey: t.metric_key,
        labelEn: t.label_en,
        labelAr: t.label_ar,
        target,
        measured,
        unit: t.unit,
        comparator: t.comparator,
        isCritical: t.is_critical,
        meets,
        sampleSize: live.sample || (t.sample_size ?? 0),
      };
    });

    return {
      targets,
      latency,
      firstFeedbackP95: percentile(feedback, 95),
      grounding,
      reliability,
      readiness: (readyRes.data ?? []).map((r) => ({
        gateKey: r.gate_key,
        labelEn: r.label_en,
        labelAr: r.label_ar,
        status: r.status,
        isBlocking: r.is_blocking,
        notes: r.notes,
      })),
      health: (healthRes.data ?? []).map((h) => ({
        component: h.component,
        state: h.state,
        messageEn: h.message_en,
        messageAr: h.message_ar,
      })),
      reviews: { total: reviews.length, averages },
    };
  });

/* ------------------------------------------------------------------ */
/* Live performance dashboard (Admin / AI Ops)                         */
/* ------------------------------------------------------------------ */

export type PerformanceDashboard = {
  windowHours: number;
  totals: {
    requests: number;
    requestsPerMinute: number;
    activeUsers: number;
    errorRate: number;
    timeoutRate: number;
    rateLimitEvents: number;
    avgModelCalls: number;
    avgTokens: number;
  };
  overall: { p50: number; p90: number; p95: number; p99: number; firstFeedbackP95: number; firstTokenP95: number };
  byPath: { path: string; samples: number; p50: number; p95: number; share: number }[];
  byCategory: { category: string; samples: number; p50: number; p95: number; p99: number; breaches: number }[];
  byModel: { model: string; samples: number; p50: number; p95: number }[];
  phases: { phase: string; p50: number; p95: number }[];
  slowest: {
    traceId: string | null;
    category: string;
    path: string;
    model: string | null;
    totalMs: number;
    createdAt: string;
    breakdown: { label: string; ms: number }[];
    modelCalls: number;
    toolCount: number;
    tokens: number;
    success: boolean;
    errorKind: string | null;
  }[];
};

const PerfInput = z.object({
  windowHours: z.number().min(1).max(720).default(24),
  category: z.string().optional(),
  model: z.string().optional(),
  path: z.string().optional(),
});

export const getPerformanceDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PerfInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<PerformanceDashboard> => {
    const db = context.supabase as Db;
    const roles = await rolesOf(db, context.userId);
    if (!roles.some((r) => ["system_admin", "service_manager", "auditor"].includes(r))) {
      throw new Error("Not permitted.");
    }
    const since = new Date(Date.now() - data.windowHours * 3_600_000).toISOString();
    let query = db
      .from("response_performance_logs")
      .select(
        "trace_id, response_category, execution_path, model_name, total_duration_ms, first_visible_feedback_ms, first_token_ms, authentication_duration_ms, intent_duration_ms, retrieval_duration_ms, tool_duration_ms, generation_duration_ms, supervisor_duration_ms, database_duration_ms, model_call_count, tool_count, input_tokens, output_tokens, success, error_kind, rate_limited, budget_exceeded, conversation_id, created_at",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (data.category) query = query.eq("response_category", data.category);
    if (data.model) query = query.eq("model_name", data.model);
    if (data.path) query = query.eq("execution_path", data.path);
    const { data: rows } = await query;
    const logs = rows ?? [];

    const totals = logs.map((r) => r.total_duration_ms ?? 0);
    const group = <T>(items: T[], key: (t: T) => string) => {
      const map = new Map<string, T[]>();
      for (const item of items) {
        const k = key(item) || "unknown";
        map.set(k, [...(map.get(k) ?? []), item]);
      }
      return map;
    };
    const dur = (rowsIn: typeof logs) => rowsIn.map((r) => r.total_duration_ms ?? 0);

    const byPath = [...group(logs, (r) => r.execution_path ?? "agentic").entries()].map(([path, rs]) => ({
      path,
      samples: rs.length,
      p50: percentile(dur(rs), 50),
      p95: percentile(dur(rs), 95),
      share: logs.length ? Math.round((rs.length / logs.length) * 100) : 0,
    }));
    const byCategory = [...group(logs, (r) => r.response_category).entries()].map(([category, rs]) => ({
      category,
      samples: rs.length,
      p50: percentile(dur(rs), 50),
      p95: percentile(dur(rs), 95),
      p99: percentile(dur(rs), 99),
      breaches: rs.filter((r) => r.budget_exceeded).length,
    }));
    const byModel = [...group(logs, (r) => r.model_name ?? "unknown").entries()].map(([model, rs]) => ({
      model,
      samples: rs.length,
      p50: percentile(dur(rs), 50),
      p95: percentile(dur(rs), 95),
    }));

    const phaseKeys = [
      ["authentication", "authentication_duration_ms"],
      ["intent", "intent_duration_ms"],
      ["retrieval", "retrieval_duration_ms"],
      ["tool", "tool_duration_ms"],
      ["generation", "generation_duration_ms"],
      ["supervisor", "supervisor_duration_ms"],
      ["database", "database_duration_ms"],
    ] as const;
    const phases = phaseKeys.map(([phase, col]) => {
      const vals = logs.map((r) => Number((r as Record<string, unknown>)[col] ?? 0));
      return { phase, p50: percentile(vals, 50), p95: percentile(vals, 95) };
    });

    const slowest = [...logs]
      .sort((a, b) => (b.total_duration_ms ?? 0) - (a.total_duration_ms ?? 0))
      .slice(0, 12)
      .map((r) => ({
        traceId: r.trace_id,
        category: r.response_category,
        path: r.execution_path ?? "agentic",
        model: r.model_name,
        totalMs: r.total_duration_ms ?? 0,
        createdAt: r.created_at,
        breakdown: phaseKeys
          .map(([phase, col]) => ({ label: phase, ms: Number((r as Record<string, unknown>)[col] ?? 0) }))
          .filter((p) => p.ms > 0),
        modelCalls: r.model_call_count ?? 0,
        toolCount: r.tool_count ?? 0,
        tokens: (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
        success: r.success,
        errorKind: r.error_kind,
      }));

    const minutes = Math.max(1, data.windowHours * 60);
    return {
      windowHours: data.windowHours,
      totals: {
        requests: logs.length,
        requestsPerMinute: Math.round((logs.length / minutes) * 100) / 100,
        activeUsers: new Set(logs.map((r) => r.conversation_id).filter(Boolean)).size,
        errorRate: logs.length ? Math.round((logs.filter((r) => !r.success).length / logs.length) * 1000) / 10 : 0,
        timeoutRate: logs.length
          ? Math.round((logs.filter((r) => (r.error_kind ?? "").includes("timeout")).length / logs.length) * 1000) / 10
          : 0,
        rateLimitEvents: logs.filter((r) => r.rate_limited).length,
        avgModelCalls: logs.length
          ? Math.round((logs.reduce((a, r) => a + (r.model_call_count ?? 0), 0) / logs.length) * 10) / 10
          : 0,
        avgTokens: logs.length
          ? Math.round(logs.reduce((a, r) => a + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0) / logs.length)
          : 0,
      },
      overall: {
        p50: percentile(totals, 50),
        p90: percentile(totals, 90),
        p95: percentile(totals, 95),
        p99: percentile(totals, 99),
        firstFeedbackP95: percentile(
          logs.map((r) => r.first_visible_feedback_ms ?? 0).filter((n) => n > 0),
          95,
        ),
        firstTokenP95: percentile(
          logs.map((r) => r.first_token_ms ?? 0).filter((n) => n > 0),
          95,
        ),
      },
      byPath: byPath.sort((a, b) => b.samples - a.samples),
      byCategory: byCategory.sort((a, b) => b.samples - a.samples),
      byModel: byModel.sort((a, b) => b.samples - a.samples),
      phases,
      slowest,
    };
  });

const ReviewInput = z.object({
  agentRunId: z.string().uuid(),
  scores: z.record(z.number().min(1).max(5)),
  issueTags: z.array(z.string()).default([]),
  proposedCorrection: z.string().max(4000).optional(),
  comments: z.string().max(2000).optional(),
});

export const submitQualityReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ReviewInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as Db;
    const roles = await rolesOf(db, context.userId);
    if (!roles.some((r) => ["system_admin", "service_manager", "knowledge_manager", "auditor"].includes(r))) {
      throw new Error("Not permitted.");
    }
    const row: Record<string, unknown> = {
      agent_run_id: data.agentRunId,
      reviewer_type: "human",
      reviewer_profile_id: context.userId,
      issue_tags: data.issueTags,
      proposed_correction: data.proposedCorrection ?? null,
      comments: data.comments ?? null,
    };
    for (const [k, v] of Object.entries(data.scores)) row[k.endsWith("_score") ? k : `${k}_score`] = v;
    const { error } = await db.from("response_quality_reviews").insert(row as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const GateInput = z.object({
  gateKey: z.string(),
  status: z.enum(["not_started", "in_progress", "passed", "failed", "waived"]),
  notes: z.string().max(2000).optional(),
});

export const updateReadinessGate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => GateInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as Db;
    const roles = await rolesOf(db, context.userId);
    if (!roles.includes("system_admin")) throw new Error("Administrator access required.");
    const { error } = await db
      .from("release_readiness")
      .update({
        status: data.status,
        notes: data.notes ?? null,
        evaluated_at: new Date().toISOString(),
        evaluated_by: context.userId,
      })
      .eq("gate_key", data.gateKey);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const HealthInput = z.object({
  component: z.enum(["ai_provider", "knowledge_retrieval", "student_information", "case_management", "maintenance"]),
  state: z.enum(["operational", "degraded", "outage", "maintenance"]),
  messageEn: z.string().max(500).optional(),
  messageAr: z.string().max(500).optional(),
});

export const setServiceState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => HealthInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as Db;
    const roles = await rolesOf(db, context.userId);
    if (!roles.includes("system_admin")) throw new Error("Administrator access required.");
    const { error } = await db
      .from("service_degradation_state")
      .upsert(
        {
          component: data.component,
          state: data.state,
          message_en: data.messageEn ?? null,
          message_ar: data.messageAr ?? null,
          since: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "component" },
      );
    if (error) throw new Error(error.message);
    const { invalidateCache } = await import("./quality/cache.server");
    await invalidateCache(db, "service_health", "state change");
    return { ok: true };
  });

/** Consistency check: the same question phrased differently must classify the same way. */
export const runConsistencyCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as Db;
    const roles = await rolesOf(db, context.userId);
    if (!roles.some((r) => ["system_admin", "service_manager", "auditor"].includes(r))) {
      throw new Error("Not permitted.");
    }
    const { classify } = await import("./agents.server");
    const { data: groups } = await db
      .from("evaluation_equivalence_groups")
      .select("id, group_code, description, evaluation_equivalence_items(language, input_message, expected_intent)");

    return (groups ?? []).map((g) => {
      const items = (g.evaluation_equivalence_items ?? []) as {
        language: string;
        input_message: string;
        expected_intent: string | null;
      }[];
      const results = items.map((i) => {
        const c = classify(i.input_message);
        return {
          language: i.language,
          message: i.input_message,
          expectedIntent: i.expected_intent,
          detectedIntent: c.intent,
          matches: !i.expected_intent || c.intent === i.expected_intent,
        };
      });
      const intents = new Set(results.map((r) => r.detectedIntent));
      return {
        groupCode: g.group_code,
        description: g.description,
        itemCount: results.length,
        consistent: intents.size === 1,
        matchRate: results.length ? Math.round((results.filter((r) => r.matches).length / results.length) * 100) : 0,
        results,
      };
    });
  });
