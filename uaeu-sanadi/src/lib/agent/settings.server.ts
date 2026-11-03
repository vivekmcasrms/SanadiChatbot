/** AI runtime settings loader. Server only. */
import type { Db } from "./tools.server";
import { asArabicStyle, DEFAULT_TEXT_STYLE, DEFAULT_VOICE_STYLE, type ArabicStyle } from "@/lib/arabic/emirati";

export type AiSettings = {
  provider: string;
  modelName: string;
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
  agentFlags: Record<string, boolean>;
  aiEnabled: boolean;
  arabicStyle: ArabicStyle;
  voiceArabicStyle: ArabicStyle;
};

export const DEFAULT_SETTINGS: AiSettings = {
  provider: "lovable",
  modelName: "google/gemini-3.6-flash",
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
  agentFlags: {},
  aiEnabled: true,
  arabicStyle: DEFAULT_TEXT_STYLE,
  voiceArabicStyle: DEFAULT_VOICE_STYLE,
};

/** Cached: admin-controlled configuration, identical for every student. */
export async function loadAiSettings(db: Db): Promise<AiSettings> {
  const { getCached } = await import("../quality/cache.server");
  return getCached(db, {
    key: "ai_settings:v2",
    category: "ai_settings",
    ttlSeconds: 60,
    load: () => loadAiSettingsUncached(db),
  });
}

async function loadAiSettingsUncached(_db: Db): Promise<AiSettings> {
  // Internal AI configuration is staff-restricted at the RLS level, so it is
  // read with the trusted server client rather than the caller's session.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as unknown as Db)
    .from("ai_settings")
    .select(
      "provider, model_name, fallback_provider, fallback_model, reasoning_effort, temperature, max_output_tokens, confidence_threshold, handoff_threshold, retrieval_top_k, max_tool_calls, request_timeout_ms, agent_flags, ai_enabled, arabic_style, voice_arabic_style",
    )
    .limit(1)
    .maybeSingle();
  if (!data) return DEFAULT_SETTINGS;
  const effort = String(data.reasoning_effort ?? "none");
  return {
    provider: data.provider,
    modelName: data.model_name,
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
    agentFlags: (data.agent_flags as Record<string, boolean>) ?? {},
    aiEnabled: data.ai_enabled,
    arabicStyle: asArabicStyle(data.arabic_style, DEFAULT_TEXT_STYLE),
    voiceArabicStyle: asArabicStyle(data.voice_arabic_style, DEFAULT_VOICE_STYLE),
  };
}

let voiceStyleMemo: { style: ArabicStyle; at: number } | null = null;
/** Last known voice Arabic style; refreshes in the background so calls never wait. */
export function voiceArabicStyleNow(): ArabicStyle {
  if (!voiceStyleMemo || Date.now() - voiceStyleMemo.at > 60_000) {
    const prev = voiceStyleMemo?.style ?? DEFAULT_VOICE_STYLE;
    voiceStyleMemo = { style: prev, at: Date.now() };
    void loadAiSettingsUncached(null as unknown as Db)
      .then((s) => { voiceStyleMemo = { style: s.voiceArabicStyle, at: Date.now() }; })
      .catch(() => undefined);
  }
  return voiceStyleMemo.style;
}
