/** AI runtime settings loader. Server only. */
import type { Db } from "./tools.server";

export type AiSettings = {
  provider: string;
  modelName: string;
  apiKey: string | null;
  apiUrl: string | null;
  /** Used only when the primary engine is unavailable. */
  fallbackProvider: string | null;
  fallbackModel: string | null;
  /** Default thinking level; per-task rules may raise it. */
  reasoningEffort: "none" | "low" | "medium" | "high";
  temperature: number;
  maxOutputTokens: number;
  confidenceThreshold: number;
  handoffThreshold: number;
  retrievalTopK: number;
  maxToolCalls: number;
  requestTimeoutMs: number;
  aiEnabled: boolean;
};

export const DEFAULT_SETTINGS: AiSettings = {
  provider: "openai",
  modelName: "gpt-4o-mini",
  apiKey: null,
  apiUrl: null,
  fallbackProvider: null,
  fallbackModel: null,
  reasoningEffort: "none",
  temperature: 0.2,
  maxOutputTokens: 1200,
  confidenceThreshold: 0.55,
  handoffThreshold: 0.4,
  retrievalTopK: 6,
  maxToolCalls: 8,
  requestTimeoutMs: 45000,
  aiEnabled: true,
};

/** Cached: admin-controlled configuration, identical for every student. */
export async function loadAiSettings(db: Db): Promise<AiSettings> {
  const { getCached } = await import("../quality/cache.server");
  return getCached(db, {
    key: "ai_settings:v1",
    category: "ai_settings",
    ttlSeconds: 60,
    load: () => loadAiSettingsUncached(db),
  });
}

async function loadAiSettingsUncached(_db: Db): Promise<AiSettings> {
  // Internal AI configuration is staff-restricted at the RLS level, so it is
  // read with the trusted server client rather than the caller's session.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // The generated Supabase schema type predates the server-only provider
  // columns added by the SQL migration, so keep this compatibility boundary
  // isolated to the trusted settings loader.
  const settingsDb = supabaseAdmin as unknown as {
    from: (table: string) => any;
  };
  const { data } = await settingsDb
    .from("ai_settings")
    .select(
      "provider, model_name, api_key, api_url, fallback_provider, fallback_model, reasoning_effort, temperature, max_output_tokens, confidence_threshold, handoff_threshold, retrieval_top_k, max_tool_calls, request_timeout_ms, ai_enabled, is_enabled",
    )
    .eq("is_enabled", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return DEFAULT_SETTINGS;
  const effort = String(data.reasoning_effort ?? "none");
  return {
    provider: data.provider,
    modelName: data.model_name,
    apiKey: data.api_key ?? null,
    apiUrl: data.api_url ?? null,
    fallbackProvider: data.fallback_provider ?? null,
    fallbackModel: data.fallback_model ?? null,
    reasoningEffort: (["none", "low", "medium", "high"].includes(effort)
      ? effort
      : "none") as AiSettings["reasoningEffort"],
    temperature: Number(data.temperature),
    maxOutputTokens: data.max_output_tokens,
    confidenceThreshold: Number(data.confidence_threshold),
    handoffThreshold: Number(data.handoff_threshold),
    retrievalTopK: data.retrieval_top_k,
    maxToolCalls: data.max_tool_calls,
    requestTimeoutMs: data.request_timeout_ms,
    aiEnabled: data.is_enabled ?? data.ai_enabled,
  };
}
