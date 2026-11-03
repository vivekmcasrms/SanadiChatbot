/** Phase timing, performance budgets and latency logging. Server only. */
import type { Db } from "../agent/tools.server";
import { getCached } from "./cache.server";

export type Phase =
  | "authentication"
  | "intent"
  /** Cheap classification + domain detection, before any context is loaded. */
  | "routing"
  /** Verified student/service record prefetch for the routed domain only. */
  | "student_context"
  | "retrieval"
  | "tool"
  | "generation"
  | "supervisor"
  | "database"
  /** Third-party providers (library catalogue, email, external knowledge). */
  | "external_api"
  /** Persistence + bookkeeping after the answer text is final. */
  | "finalization";

export type ResponseCategory =
  | "simple_factual"
  | "student_data"
  | "policy_interpretation"
  | "multi_step_action"
  | "complaint_intake";

export type ExecutionPath = "FAST_DATA" | "RULE_ENGINE" | "RAG" | "AGENTIC" | "ASYNC_JOB" | "ERROR";

export type ModelInvocation = {
  sequence: number;
  purpose: string;
  necessityReason: string;
  provider: string;
  model: string;
  estimatedInputTokens: number;
  promptTokens: number;
  completionTokens: number;
  lane: string;
  laneQueueMs: number;
  providerFirstTokenMs: number | null;
  providerDurationMs: number;
  totalDurationMs: number;
  resultUsed: boolean;
  status: "succeeded" | "failed" | "discarded";
  errorCategory: string | null;
  promptBreakdown: Record<string, number>;
  toolNames: string[];
};

/** Correlation id so a slow request can be followed end-to-end in the logs. */
function newTraceId(): string {
  return `trc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class PerfTimer {
  private readonly start = Date.now();
  private readonly phases: Partial<Record<Phase, number>> = {};
  readonly traceId = newTraceId();
  firstFeedbackMs: number | null = null;
  firstTokenMs: number | null = null;
  cacheHit = false;
  partialFailure = false;
  parallelToolCount = 0;
  /** Number of LLM round-trips made for this turn. */
  modelCalls = 0;
  /** Number of database round-trips explicitly counted by the orchestrator. */
  dbQueries = 0;
  /** True once any DB work was counted/measured on this path. Distinguishes a
   *  measured zero from "this path never instrumented DB work" (NULL). */
  dbInstrumented = false;
  /** Aggregate DB time, and the single slowest instrumented operation. */
  dbTotalMs = 0;
  dbSlowestOp: string | null = null;
  dbSlowestMs = 0;
  inputTokens = 0;
  outputTokens = 0;
  /** Time model calls spent queued behind the concurrency lane, not generating. */
  modelQueueMs = 0;
  rateLimited = false;
  errorKind: string | null = null;
  executionPath: ExecutionPath = "AGENTIC";
  /** Supervisor telemetry — persisted on every turn, not only when it runs. */
  supervisorInvoked = false;
  supervisorReason: string | null = null;
  /** Every distinct model that produced tokens for this turn, in call order. */
  readonly modelNames: string[] = [];
  /** Static system-prompt tokens (prompt + rules + blocks), first call only. */
  promptTokens = 0;
  /** Tokens contributed by retrieved knowledge/records context. */
  retrievalTokens = 0;
  /** Per-component prompt cost, for prompt-budget analysis. */
  promptBreakdown: Record<string, number> = {};
  /** Service domains detected for this turn. */
  domains: string[] = [];
  readonly modelInvocations: ModelInvocation[] = [];

  countModelCall(inputTokens: number, outputTokens: number, model?: string) {
    this.modelCalls += 1;
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
    if (model && !this.modelNames.includes(model)) this.modelNames.push(model);
  }
  recordModelInvocation(row: Omit<ModelInvocation, "sequence">) {
    this.modelInvocations.push({ sequence: this.modelInvocations.length + 1, ...row });
  }
  countDb(n = 1) {
    this.dbInstrumented = true;
    this.dbQueries += n;
  }
  /** Wraps a DB round-trip so count, aggregate time and the slowest operation
   *  are captured with one timestamp pair — cheap enough for production. */
  async trackDb<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      const ms = Date.now() - t;
      this.dbInstrumented = true;
      this.dbQueries += 1;
      this.dbTotalMs += ms;
      if (ms > this.dbSlowestMs) {
        this.dbSlowestMs = ms;
        this.dbSlowestOp = label;
      }
    }
  }
  /** Records the composed prompt cost so bloat is visible per component. */
  recordPrompt(breakdown: Record<string, number>) {
    this.promptBreakdown = breakdown;
    this.promptTokens = Object.values(breakdown).reduce((a, b) => a + b, 0);
    this.retrievalTokens = (breakdown["context"] ?? 0) + (breakdown["memory"] ?? 0);
  }
  get supervisorLatencyMs(): number | null {
    return this.snapshot().supervisor ?? null;
  }

  markFeedback() {
    if (this.firstFeedbackMs == null) this.firstFeedbackMs = Date.now() - this.start;
  }
  /** First token actually painted in the browser (streamed, not buffered). */
  firstVisibleMs: number | null = null;
  markFirstVisible() {
    if (this.firstVisibleMs == null) this.firstVisibleMs = Date.now() - this.start;
  }
  markFirstToken() {
    if (this.firstTokenMs == null) this.firstTokenMs = Date.now() - this.start;
  }

  async measure<T>(phase: Phase, fn: () => Promise<T>): Promise<T> {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      this.phases[phase] = (this.phases[phase] ?? 0) + (Date.now() - t);
    }
  }
  add(phase: Phase, ms: number) {
    this.phases[phase] = (this.phases[phase] ?? 0) + ms;
  }
  get totalMs() {
    return Date.now() - this.start;
  }
  snapshot() {
    return { ...this.phases };
  }
}

export async function loadBudgets(db: Db): Promise<Record<string, number>> {
  return getCached(db, {
    key: "performance_budgets:v1",
    category: "performance_budgets",
    ttlSeconds: 300,
    load: async () => {
      const { data } = await db
        .from("performance_budgets")
        .select("response_category, budget_ms")
        .eq("is_active", true);
      const map: Record<string, number> = {};
      for (const row of data ?? []) map[row.response_category] = row.budget_ms;
      return map;
    },
  });
}

export async function logPerformance(
  db: Db,
  timer: PerfTimer,
  meta: {
    conversationId: string | null;
    messageId: string | null;
    agentRunId: string | null;
    category: ResponseCategory;
    language: "en" | "ar";
    toolCount: number;
    inputTokens?: number;
    outputTokens?: number;
    modelName: string;
    intent: string | null;
    success: boolean;
    /** Size of the student-facing answer, used to spot oversized responses. */
    responseBytes?: number;
  },
) {
  const budgets = await loadBudgets(db).catch(() => ({}) as Record<string, number>);
  const total = timer.totalMs;
  const p = timer.snapshot();
  const num = (v: number | null | undefined) => (typeof v === "number" ? { value: v } : null);
  const optional: Record<string, number> = {};
  const put = (key: string, v: number | null | undefined) => {
    const n = num(v);
    if (n) optional[key] = n.value;
  };
  put("authentication_duration_ms", p.authentication);
  put("intent_duration_ms", p.intent);
  put("retrieval_duration_ms", p.retrieval);
  put("tool_duration_ms", p.tool);
  put("generation_duration_ms", p.generation);
  put("supervisor_duration_ms", p.supervisor);
  put("database_duration_ms", p.database);
  put("first_visible_feedback_ms", timer.firstFeedbackMs);
  put("first_token_ms", timer.firstTokenMs);
  put("first_visible_ms", timer.firstVisibleMs);
  put("supervisor_latency_ms", timer.supervisorLatencyMs);
  put("routing_ms", p.routing);
  put("student_context_ms", p.student_context);
  put("external_api_ms", p.external_api);
  put("model_queue_ms", timer.modelQueueMs);
  put("prompt_tokens", timer.promptTokens);
  put("retrieval_tokens", timer.retrievalTokens);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const performanceWrite = supabaseAdmin
    .from("response_performance_logs")
    .insert({
      conversation_id: meta.conversationId,
      message_id: meta.messageId,
      agent_run_id: meta.agentRunId,
      response_category: meta.category,
      language: meta.language,
      total_duration_ms: total,
      ...optional,
      tool_count: meta.toolCount,
      parallel_tool_count: timer.parallelToolCount,
      // NULL (not 0) when no model call happened, so dashboards do not read
      // "not measured" as a genuine zero.
      input_tokens: meta.inputTokens ?? (timer.modelCalls ? timer.inputTokens : null),
      output_tokens: meta.outputTokens ?? (timer.modelCalls ? timer.outputTokens : null),
      model_name: meta.modelName,
      intent: meta.intent,
      cache_hit: timer.cacheHit,
      partial_failure: timer.partialFailure,
      budget_exceeded: budgets[meta.category] ? total > budgets[meta.category]! : false,
      success: meta.success,
      trace_id: timer.traceId,
      model_call_count: timer.modelCalls,
      db_query_count: timer.dbInstrumented ? timer.dbQueries : null,
      db_total_ms: timer.dbInstrumented ? timer.dbTotalMs : null,
      db_slowest_operation: timer.dbSlowestOp,
      db_slowest_ms: timer.dbSlowestOp ? timer.dbSlowestMs : null,
      response_bytes: meta.responseBytes ?? 0,
      error_kind: timer.errorKind,
      rate_limited: timer.rateLimited,
       execution_path: timer.executionPath,
      supervisor_invoked: timer.supervisorInvoked,
      supervisor_reason: timer.supervisorReason,
      model_names: timer.modelNames.length ? timer.modelNames : [meta.modelName],
      prompt_breakdown: timer.promptBreakdown as never,
      domains: timer.domains,
    })
    .then(
      () => undefined,
      () => undefined,
    );
  const invocationWrite = timer.modelInvocations.length
    ? supabaseAdmin.from("agent_model_invocations").insert(
        timer.modelInvocations.map((call) => ({
          trace_id: timer.traceId,
          conversation_id: meta.conversationId,
          agent_run_id: meta.agentRunId,
          call_sequence: call.sequence,
          purpose: call.purpose,
          necessity_reason: call.necessityReason,
          provider: call.provider,
          model_name: call.model,
          prompt_tokens: call.promptTokens,
          completion_tokens: call.completionTokens,
          estimated_input_tokens: call.estimatedInputTokens,
          lane: call.lane,
          lane_queue_ms: call.laneQueueMs,
          provider_first_token_ms: call.providerFirstTokenMs,
          provider_duration_ms: call.providerDurationMs,
          total_duration_ms: call.totalDurationMs,
          result_used: call.resultUsed,
          status: call.status,
          error_category: call.errorCategory,
          prompt_breakdown: call.promptBreakdown as never,
          tool_names: call.toolNames,
        })),
      ).then(() => undefined, () => undefined)
    : Promise.resolve();
  await Promise.all([performanceWrite, invocationWrite]);
}
