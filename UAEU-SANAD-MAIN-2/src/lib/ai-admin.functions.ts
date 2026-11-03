import { apiFetch } from "@/lib/auth-token";

type Call<T> = { data: T };
type Any = Record<string, any>;

const get = <T>(path: string) => apiFetch<T>(`/api/ai-admin/${path}`);
const post = <T>(path: string, data?: unknown) =>
  apiFetch<T>(`/api/ai-admin/${path}`, { method: "POST", body: JSON.stringify(data ?? {}) });

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

export const getAiConfig = (_?: Call<never>) => get<Any>("config");

export const updateAiConfig = ({
  data,
}: Call<{
  provider: string;
  modelName: string;
  fallbackProvider?: string | null;
  fallbackModel?: string | null;
  reasoningEffort?: "none" | "low" | "medium" | "high";
  temperature: number;
  maxOutputTokens: number;
  confidenceThreshold: number;
  handoffThreshold: number;
  retrievalTopK: number;
  maxToolCalls: number;
  aiEnabled: boolean;
}>) => post<{ ok: boolean }>("config", data);

export const toggleAgentTool = ({ data }: Call<{ toolId: string; enabled: boolean }>) =>
  post<{ ok: boolean }>("tools/toggle", data);

export const savePromptVersion = ({
  data,
}: Call<{
  agentType: string;
  language: "en" | "ar";
  systemPrompt: string;
  notes?: string;
  approve?: boolean;
}>) => post<{ version: number }>("prompts", data);

export const getDefaultPrompt = ({
  data,
}: Call<{ agentType: string; language: "en" | "ar" }>) =>
  post<{ prompt: string }>("prompts/default", data);

export const getAiOps = (_?: Call<never>) => get<Any>("ops");

export const listEvaluationScenarios = (_?: Call<never>) => get<Any[]>("evaluation/scenarios");

export const runEvaluationBatch = ({
  data,
}: Call<{ language?: "en" | "ar" | "all"; limit?: number }>) =>
  post<{
    batchId: string;
    total: number;
    passed: number;
    averageScore: number;
    results: { code: string; passed: boolean; score: number }[];
  }>("evaluation/run", data);

export const getAgentActivity = ({
  data,
}: Call<{ limit?: number; onlyWithTools?: boolean }>) =>
  post<{ runs: AgentActivityRun[] }>("activity", data ?? {});

export type VoiceMetricsSummary = {
  windowDays: number;
  voiceInteractions: number;
  arabicVoiceInteractions: number;
  englishVoiceInteractions: number;
  successfulTranscriptionRate: number;
  clarificationRate: number;
  voiceToActionCompletionRate: number;
  speechServiceFailureRate: number;
  totals: { ok: number; fail: number; clarify: number; actions: number };
};

/** Admin voice operational snapshot from /api/voice/metrics (no raw audio). */
export const getVoiceMetrics = (days = 14) =>
  apiFetch<VoiceMetricsSummary>(`/api/voice/metrics?days=${days}`);
