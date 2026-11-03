import { auditInsert } from "@/lib/exceptions/handle.server";
import { getActiveRoles } from "@/lib/authz/roles.server";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Db } from "./agent/tools.server";
import { runAgentTurn } from "./agent/orchestrator.server";
import { defaultPrompt } from "./agent/prompts.server";

async function rolesOf(db: Db, userId: string): Promise<string[]> {
  return getActiveRoles(db, userId);
}

async function requireAdmin(db: Db, userId: string) {
  const roles = await rolesOf(db, userId);
  if (!roles.includes("system_admin")) throw new Error("Administrator access is required.");
  return roles;
}

/* ---------------- Settings ---------------- */

export const getAiConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as Db;
    const [{ data: settings }, { data: prompts }, { data: tools }] = await Promise.all([
      db.from("ai_settings").select("*").limit(1).maybeSingle(),
      db
        .from("agent_prompt_versions")
        .select("id, agent_type, language, version, status, notes, system_prompt, updated_at")
        .order("agent_type")
        .order("version", { ascending: false }),
      db.from("agent_tools").select("id, tool_name, agent_type, risk_level, allowed_roles, enabled, confirmation_required, human_approval_required").order("tool_name"),
    ]);
    return { settings, prompts: prompts ?? [], tools: tools ?? [] };
  });

const SettingsInput = z.object({
  provider: z.string().min(1),
  modelName: z.string().min(1),
  // Empty means "no backup engine"; API keys are never part of this form.
  fallbackProvider: z.string().nullable().optional(),
  fallbackModel: z.string().nullable().optional(),
  reasoningEffort: z.enum(["none", "low", "medium", "high"]).optional(),
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().min(128).max(8000),
  confidenceThreshold: z.number().min(0).max(1),
  handoffThreshold: z.number().min(0).max(1),
  retrievalTopK: z.number().int().min(1).max(20),
  maxToolCalls: z.number().int().min(1).max(20),
  aiEnabled: z.boolean(),
});

export const updateAiConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SettingsInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as Db;
    await requireAdmin(db, context.userId);
    const { data: existing } = await db.from("ai_settings").select("id").limit(1).maybeSingle();
    if (!existing) throw new Error("AI settings row is missing.");
    const { error } = await db
      .from("ai_settings")
      .update({
        provider: data.provider,
        model_name: data.modelName,
        fallback_provider: data.fallbackProvider?.trim() ? data.fallbackProvider.trim() : null,
        fallback_model: data.fallbackModel?.trim() ? data.fallbackModel.trim() : null,
        reasoning_effort: data.reasoningEffort ?? "none",
        temperature: data.temperature,
        max_output_tokens: data.maxOutputTokens,
        confidence_threshold: data.confidenceThreshold,
        handoff_threshold: data.handoffThreshold,
        retrieval_top_k: data.retrievalTopK,
        max_tool_calls: data.maxToolCalls,
        ai_enabled: data.aiEnabled,
        updated_by: context.userId,
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    await auditInsert(db, {
      actor_id: context.userId,
      action: "ai.settings_updated",
      entity_type: "ai_settings",
      entity_id: existing.id,
      metadata: { provider: data.provider, model: data.modelName, enabled: data.aiEnabled },
    });
    return { ok: true };
  });

export const toggleAgentTool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ toolId: z.string().uuid(), enabled: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as Db;
    await requireAdmin(db, context.userId);
    const { error } = await db.from("agent_tools").update({ enabled: data.enabled }).eq("id", data.toolId);
    if (error) throw new Error(error.message);
    await auditInsert(db, {
      actor_id: context.userId,
      action: data.enabled ? "ai.tool_enabled" : "ai.tool_disabled",
      entity_type: "agent_tool",
      entity_id: data.toolId,
      metadata: {},
    });
    return { ok: true };
  });

/* ---------------- Prompts ---------------- */

const PromptInput = z.object({
  agentType: z.string().min(1),
  language: z.enum(["en", "ar"]),
  systemPrompt: z.string().min(20).max(20000),
  notes: z.string().max(500).optional(),
  approve: z.boolean().default(false),
});

export const savePromptVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PromptInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as Db;
    await requireAdmin(db, context.userId);
    const { data: latest } = await db
      .from("agent_prompt_versions")
      .select("version")
      .eq("agent_type", data.agentType)
      .eq("language", data.language)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = (latest?.version ?? 0) + 1;

    if (data.approve) {
      await db
        .from("agent_prompt_versions")
        .update({ status: "archived" })
        .eq("agent_type", data.agentType)
        .eq("language", data.language)
        .eq("status", "approved");
    }

    const { error } = await db.from("agent_prompt_versions").insert({
      agent_type: data.agentType,
      language: data.language,
      version,
      system_prompt: data.systemPrompt,
      notes: data.notes ?? null,
      status: data.approve ? "approved" : "draft",
      created_by: context.userId,
      approved_by: data.approve ? context.userId : null,
      approved_at: data.approve ? new Date().toISOString() : null,
      effective_from: data.approve ? new Date().toISOString() : null,
    });
    if (error) throw new Error(error.message);

    await auditInsert(db, {
      actor_id: context.userId,
      action: data.approve ? "ai.prompt_approved" : "ai.prompt_drafted",
      entity_type: "agent_prompt_version",
      entity_id: null,
      metadata: { agent: data.agentType, language: data.language, version },
    });
    return { version };
  });

export const getDefaultPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ agentType: z.string(), language: z.enum(["en", "ar"]) }).parse(input),
  )
  .handler(async ({ data }) => ({ prompt: defaultPrompt(data.agentType, data.language) }));

/* ---------------- Observability ---------------- */

export const getAiOps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as Db;
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

    const [{ data: runs }, { data: execs }, { data: batches }] = await Promise.all([
      db
        .from("agent_runs")
        .select("id, created_at, latency_ms, response_type, confidence, tool_call_count, failed_tool_count, fallback_used, human_handoff, language, model_name, provider, error_message, status")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500),
      db
        .from("agent_tool_executions")
        .select("tool_name, execution_status, authorization_result, duration_ms, started_at")
        .gte("started_at", since)
        .limit(1000),
      db
        .from("evaluation_runs")
        .select("batch_id, overall_score, passed, created_at, model_name")
        .order("created_at", { ascending: false })
        .limit(300),
    ]);

    const list = runs ?? [];
    const n = list.length || 1;
    const latencies = list.map((r) => r.latency_ms ?? 0).sort((a, b) => a - b);
    const p = (q: number) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))] ?? 0;

    const toolCounts = new Map<string, { total: number; failed: number; denied: number; avgMs: number }>();
    for (const e of execs ?? []) {
      const cur = toolCounts.get(e.tool_name) ?? { total: 0, failed: 0, denied: 0, avgMs: 0 };
      cur.total += 1;
      if (e.execution_status === "failed") cur.failed += 1;
      if (e.authorization_result !== "allowed") cur.denied += 1;
      cur.avgMs = Math.round((cur.avgMs * (cur.total - 1) + (e.duration_ms ?? 0)) / cur.total);
      toolCounts.set(e.tool_name, cur);
    }

    const batchMap = new Map<string, { total: number; passed: number; score: number; at: string }>();
    for (const b of batches ?? []) {
      if (!b.batch_id) continue;
      const cur = batchMap.get(b.batch_id) ?? { total: 0, passed: 0, score: 0, at: b.created_at };
      cur.total += 1;
      if (b.passed) cur.passed += 1;
      cur.score += Number(b.overall_score ?? 0);
      batchMap.set(b.batch_id, cur);
    }

    return {
      totalRuns: list.length,
      avgLatencyMs: Math.round(list.reduce((s, r) => s + (r.latency_ms ?? 0), 0) / n),
      p95LatencyMs: p(0.95),
      fallbackRate: Math.round((list.filter((r) => r.fallback_used).length / n) * 100),
      handoffRate: Math.round((list.filter((r) => r.human_handoff).length / n) * 100),
      lowConfidenceRate: Math.round((list.filter((r) => Number(r.confidence ?? 1) < 0.55).length / n) * 100),
      toolFailureRate: Math.round(
        ((execs ?? []).filter((e) => e.execution_status === "failed").length / ((execs ?? []).length || 1)) * 100,
      ),
      arabicShare: Math.round((list.filter((r) => r.language === "ar").length / n) * 100),
      byResponseType: Object.entries(
        list.reduce<Record<string, number>>((acc, r) => {
          const k = r.response_type ?? "unknown";
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        }, {}),
      ).map(([type, count]) => ({ type, count })),
      tools: [...toolCounts.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total),
      recentRuns: list.slice(0, 25),
      evaluationBatches: [...batchMap.entries()]
        .map(([id, v]) => ({
          batchId: id,
          total: v.total,
          passed: v.passed,
          averageScore: Math.round((v.score / v.total) * 100) / 100,
          at: v.at,
        }))
        .slice(0, 10),
    };
  });

/* ---------------- Evaluation ---------------- */

export const listEvaluationScenarios = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as Db;
    const { data } = await db
      .from("evaluation_scenarios")
      .select("id, scenario_code, language, category, input_message, expected_intents, expected_tools, expected_outcome_type, expected_human_handoff, is_active")
      .eq("is_active", true)
      .order("scenario_code");
    return data ?? [];
  });

const RunEvalInput = z.object({
  language: z.enum(["en", "ar", "all"]).default("all"),
  limit: z.number().int().min(1).max(60).default(10),
});

export const runEvaluationBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RunEvalInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as Db;
    const roles = await requireAdmin(db, context.userId);
    const batchId = crypto.randomUUID();

    let q = db
      .from("evaluation_scenarios")
      .select("id, scenario_code, language, input_message, expected_tools, expected_outcome_type, expected_human_handoff")
      .eq("is_active", true)
      .order("scenario_code")
      .limit(data.limit);
    if (data.language !== "all") q = q.eq("language", data.language);
    const { data: scenarios } = await q;

    const results: { code: string; passed: boolean; score: number }[] = [];

    for (const s of scenarios ?? []) {
      const started = Date.now();
      try {
        const turn = await runAgentTurn({
          db,
          userId: context.userId,
          roles,
          message: s.input_message,
          conversationId: null,
          uiLang: s.language,
        });
        const expectedTools = Array.isArray(s.expected_tools) ? (s.expected_tools as string[]) : [];
        const used = [...turn.toolsUsed, ...turn.proposedActions.map((a) => a.toolName ?? a.key)];
        const toolScore = expectedTools.length
          ? expectedTools.filter((t) => used.includes(t)).length / expectedTools.length
          : 1;
        const outcomeMatch = turn.responseType === s.expected_outcome_type ? 1 : 0.5;
        const handoffScore = s.expected_human_handoff ? (turn.humanHandoff ? 1 : 0) : 1;
        const citationScore = turn.responseType === "answer" ? (turn.citations.length ? 1 : 0.4) : 1;
        const langScore = /[\u0600-\u06FF]/.test(turn.answer) === (s.language === "ar") ? 1 : 0;
        const overall = Number(
          ((toolScore + outcomeMatch + handoffScore + citationScore + langScore) / 5).toFixed(2),
        );
        const passed = overall >= 0.7;

        await db.from("evaluation_runs").insert({
          scenario_id: s.id,
          batch_id: batchId,
          model_name: null,
          detected_intents: turn.intents as never,
          tools_used: used as never,
          actual_outcome_type: turn.responseType,
          answer_text: turn.answer.slice(0, 2000),
          citation_accuracy_score: citationScore,
          tool_selection_score: toolScore,
          factual_accuracy_score: turn.verified ? 1 : 0.5,
          action_safety_score: handoffScore,
          language_quality_score: langScore,
          overall_score: overall,
          passed,
          latency_ms: Date.now() - started,
          run_by: context.userId,
        });
        results.push({ code: s.scenario_code, passed, score: overall });
      } catch (error) {
        await db.from("evaluation_runs").insert({
          scenario_id: s.id,
          batch_id: batchId,
          actual_outcome_type: "error",
          answer_text: error instanceof Error ? error.message.slice(0, 500) : "error",
          overall_score: 0,
          passed: false,
          latency_ms: Date.now() - started,
          run_by: context.userId,
        });
        results.push({ code: s.scenario_code, passed: false, score: 0 });
      }
    }

    return {
      batchId,
      total: results.length,
      passed: results.filter((r) => r.passed).length,
      averageScore:
        results.length ? Number((results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(2)) : 0,
      results,
    };
  });

/* ---------------- Agent activity (operational trace) ---------------- */

export type AgentActivityEvent = {
  kind: "tool" | "model";
  name: string;
  status: string;
  authorization: string | null;
  durationMs: number | null;
  at: string;
};

export type AgentActivityRun = {
  id: string;
  at: string;
  agent: string;
  request: string;
  language: string | null;
  responseType: string | null;
  status: string;
  latencyMs: number | null;
  modelName: string | null;
  modelCalls: number;
  fallbackUsed: boolean;
  humanHandoff: boolean;
  error: string | null;
  events: AgentActivityEvent[];
};

/**
 * Concise operational trace per assistant turn: which agent ran, which tools
 * and actions actually executed, the outcome and duration. Never exposes model
 * reasoning — only recorded operational events.
 */
export const getAgentActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        limit: z.number().int().min(10).max(200).default(50),
        onlyWithTools: z.boolean().default(false),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<{ runs: AgentActivityRun[] }> => {
    await requireAdmin(context.supabase as Db, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: runs } = await supabaseAdmin
      .from("agent_runs")
      .select(
        "id, created_at, agent, input, language, response_type, status, latency_ms, model_name, fallback_used, human_handoff, error_message",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);

    const ids = (runs ?? []).map((r) => r.id);
    if (!ids.length) return { runs: [] };

    const [{ data: execs }, { data: calls }] = await Promise.all([
      supabaseAdmin
        .from("agent_tool_executions")
        .select("agent_run_id, tool_name, execution_status, authorization_result, duration_ms, started_at")
        .in("agent_run_id", ids)
        .order("started_at", { ascending: true }),
      supabaseAdmin
        .from("agent_model_invocations")
        .select("agent_run_id, purpose, status, total_duration_ms, created_at")
        .in("agent_run_id", ids)
        .order("created_at", { ascending: true }),
    ]);

    const byRun = new Map<string, AgentActivityEvent[]>();
    for (const e of execs ?? []) {
      if (!e.agent_run_id) continue;
      const list = byRun.get(e.agent_run_id) ?? [];
      list.push({
        kind: "tool",
        name: e.tool_name,
        status: e.execution_status,
        authorization: e.authorization_result,
        durationMs: e.duration_ms,
        at: e.started_at,
      });
      byRun.set(e.agent_run_id, list);
    }
    const modelCalls = new Map<string, number>();
    for (const c of calls ?? []) {
      if (!c.agent_run_id) continue;
      modelCalls.set(c.agent_run_id, (modelCalls.get(c.agent_run_id) ?? 0) + 1);
    }

    const readRequest = (input: unknown): string => {
      if (input && typeof input === "object" && "message" in input) {
        const m = (input as { message?: unknown }).message;
        if (typeof m === "string") return m.slice(0, 160);
      }
      return "";
    };

    const list: AgentActivityRun[] = (runs ?? [])
      .map((r) => ({
        id: r.id,
        at: r.created_at,
        agent: r.agent,
        request: readRequest(r.input),
        language: r.language,
        responseType: r.response_type,
        status: r.status,
        latencyMs: r.latency_ms,
        modelName: r.model_name,
        modelCalls: modelCalls.get(r.id) ?? 0,
        fallbackUsed: r.fallback_used,
        humanHandoff: r.human_handoff,
        error: r.error_message,
        events: byRun.get(r.id) ?? [],
      }))
      .filter((r) => (data.onlyWithTools ? r.events.length > 0 : true));

    return { runs: list };
  });
