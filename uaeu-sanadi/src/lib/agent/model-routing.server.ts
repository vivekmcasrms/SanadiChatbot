/** Task-based model routing. Simple tasks use a fast model, complex reasoning a stronger one. */
import { getCached } from "../quality/cache.server";
import type { Db } from "./tools.server";
import type { AiSettings } from "./settings.server";

export type TaskType =
  | "classification"
  | "extraction"
  | "simple_answer"
  | "orchestration"
  | "policy_analysis"
  | "supervisor";

export type ModelChoice = {
  provider: string;
  model: string;
  fallbackProvider: string | null;
  fallbackModel: string | null;
  reasoningEffort: "none" | "low" | "medium" | "high" | null;
  maxOutputTokens: number;
  timeoutMs: number;
};

type Rule = {
  task_type: string;
  complexity_level: string | null;
  preferred_provider: string;
  preferred_model: string;
  fallback_provider: string | null;
  fallback_model: string | null;
  reasoning_effort: string | null;
  maximum_output_tokens: number | null;
  timeout_ms: number | null;
};

async function loadRules(db: Db): Promise<Rule[]> {
  return getCached(db, {
    key: "model_routing_rules:v1",
    category: "model_routing",
    ttlSeconds: 300,
    load: async () => {
      const { data } = await db
        .from("model_routing_rules")
        .select(
          "task_type, complexity_level, preferred_provider, preferred_model, fallback_provider, fallback_model, reasoning_effort, maximum_output_tokens, timeout_ms",
        )
        .eq("is_active", true);
      return (data ?? []) as Rule[];
    },
  });
}

export async function chooseModel(
  db: Db,
  settings: AiSettings,
  task: TaskType,
  complexity: "simple" | "complex" = "simple",
): Promise<ModelChoice> {
  const rules = await loadRules(db).catch(() => [] as Rule[]);
  const rule =
    rules.find((r) => r.task_type === task && r.complexity_level === complexity) ??
    rules.find((r) => r.task_type === task) ??
    null;
  const effort = rule?.reasoning_effort ?? null;
  return {
    provider: rule?.preferred_provider ?? settings.provider,
    model: rule?.preferred_model ?? settings.modelName,
    fallbackProvider: rule?.fallback_provider ?? settings.fallbackProvider,
    fallbackModel: rule?.fallback_model ?? settings.fallbackModel,
    reasoningEffort:
      effort && ["none", "low", "medium", "high"].includes(effort)
        ? (effort as ModelChoice["reasoningEffort"])
        : null,
    maxOutputTokens: rule?.maximum_output_tokens ?? settings.maxOutputTokens,
    timeoutMs: rule?.timeout_ms ?? settings.requestTimeoutMs,
  };
}
