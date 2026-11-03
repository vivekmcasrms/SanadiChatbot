import { useMemo, useState } from "react";
import { toastError } from "@/lib/errors/toast";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MetricCard } from "@/components/MetricCard";
import { QualityPanel } from "@/components/QualityReadinessPanel";
import { PerformancePanel } from "@/components/PerformancePanel";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import {
  getAgentActivity,
  getAiConfig,
  getAiOps,
  getDefaultPrompt,
  getVoiceMetrics,
  listEvaluationScenarios,
  runEvaluationBatch,
  savePromptVersion,
  toggleAgentTool,
  updateAiConfig,
} from "@/lib/ai-admin.functions";

const VOICE_PRD_SCENARIOS = [
  {
    code: "VOICE-EN-COMPLAINT-BUS",
    en: "English complaint about the evening bus — same complaint path as typing.",
    ar: "شكوى إنجليزية عن الحافلة المسائية — نفس مسار الشكوى المكتوبة.",
  },
  {
    code: "VOICE-AR-SUGGESTION-TECH",
    en: "Arabic tech-partnership suggestion — Suggestion agent, not Career.",
    ar: "اقتراح عربي عن شركات تقنية — وكيل الاقتراح لا الإرشاد المهني.",
  },
  {
    code: "VOICE-EN-CASE-FOLLOWUP",
    en: "Case follow-up UAEU-2026-01063 — existing case, not a new booking.",
    ar: "متابعة طلب UAEU-2026-01063 — حالة موجودة لا حجز جديد.",
  },
  {
    code: "VOICE-EN-REG-CSBP220",
    en: "Registration readiness for CSBP220 from verified student data.",
    ar: "جاهزية التسجيل في CSBP220 من بيانات موثّقة.",
  },
  {
    code: "VOICE-EN-AMBIGUOUS",
    en: "Ambiguous request — one clarification, no silent action.",
    ar: "طلب غامض — سؤال توضيح واحد دون إجراء صامت.",
  },
  {
    code: "VOICE-EN-CONTINUITY",
    en: "Voice↔type continuity in the same conversationId.",
    ar: "استمرارية الصوت والكتابة في المحادثة نفسها.",
  },
] as const;

export const Route = createFileRoute("/_authenticated/ai-ops")({
  head: () => ({
    meta: [
      { title: "AI operations — Sanadi | UAEU" },
      {
        name: "description",
        content:
          "Govern the agentic assistant: model settings, versioned prompts, tool permissions, live telemetry and the bilingual evaluation bank.",
      },
      { property: "og:title", content: "AI operations — Sanadi | UAEU" },
      { property: "og:description", content: "Model settings, prompt versions, telemetry and evaluations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AiOpsPage,
});

const AGENTS = [
  "orchestrator",
  "query",
  "complaint",
  "suggestion",
  "alert",
  "action",
  "knowledge",
  "case_management",
  "supervisor",
] as const;

function AiOpsPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { roles } = useAuth();
  const isAdmin = roles.includes("system_admin");
  const qc = useQueryClient();

  const configFn = getAiConfig;
  const opsFn = getAiOps;
  const scenariosFn = listEvaluationScenarios;
  const updateFn = updateAiConfig;
  const toggleFn = toggleAgentTool;
  const saveFn = savePromptVersion;
  const defaultFn = getDefaultPrompt;
  const evalFn = runEvaluationBatch;

  const config = useQuery({ queryKey: ["ai-config"], queryFn: () => configFn({}) });
  const ops = useQuery({ queryKey: ["ai-ops"], queryFn: () => opsFn({}) });
  const scenarios = useQuery({ queryKey: ["eval-scenarios"], queryFn: () => scenariosFn({}) });
  const activityFn = getAgentActivity;
  const [onlyTools, setOnlyTools] = useState(false);
  const activity = useQuery({
    queryKey: ["agent-activity", onlyTools],
    queryFn: () => activityFn({ data: { limit: 50, onlyWithTools: onlyTools } }),
    enabled: isAdmin,
  });
  const voiceMetrics = useQuery({
    queryKey: ["voice-metrics"],
    queryFn: () => getVoiceMetrics(14),
    enabled: isAdmin || roles.includes("service_manager") || roles.includes("auditor"),
  });

  type SettingsForm = {
    provider: string;
    modelName: string;
    fallbackProvider: string;
    fallbackModel: string;
    reasoningEffort: string;
    temperature: string;
    maxOutputTokens: string;
    confidenceThreshold: string;
    handoffThreshold: string;
    retrievalTopK: string;
    maxToolCalls: string;
    aiEnabled: boolean;
  };
  type NumericKey = Exclude<
    keyof SettingsForm,
    "provider" | "modelName" | "fallbackProvider" | "fallbackModel" | "reasoningEffort" | "aiEnabled"
  >;
  const [form, setForm] = useState<SettingsForm | null>(null);
  const settings = config.data?.settings;
  const value = useMemo(() => {
    if (form) return form;
    if (!settings) return null;
    return {
      provider: settings.provider ?? "openai",
      modelName: settings.model_name ?? "google/gemini-3.6-flash",
      fallbackProvider: settings.fallback_provider ?? "none",
      fallbackModel: settings.fallback_model ?? "",
      reasoningEffort: settings.reasoning_effort ?? "none",
      temperature: String(settings.temperature ?? 0.2),
      maxOutputTokens: String(settings.max_output_tokens ?? 1200),
      confidenceThreshold: String(settings.confidence_threshold ?? 0.55),
      handoffThreshold: String(settings.handoff_threshold ?? 0.4),
      retrievalTopK: String(settings.retrieval_top_k ?? 5),
      maxToolCalls: String(settings.max_tool_calls ?? 6),
      aiEnabled: settings.ai_enabled ?? true,
    } satisfies SettingsForm;
  }, [form, settings]);

  const set = <K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) => {
    if (!value) return;
    setForm({ ...value, [k]: v });
  };

  const saveSettings = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          provider: String(value?.provider),
          modelName: String(value?.modelName),
          fallbackProvider:
            !value?.fallbackProvider || value.fallbackProvider === "none" ? null : value.fallbackProvider,
          fallbackModel: value?.fallbackModel?.trim() ? value.fallbackModel.trim() : null,
          reasoningEffort: (value?.reasoningEffort ?? "none") as "none" | "low" | "medium" | "high",
          temperature: Number(value?.temperature),
          maxOutputTokens: Number(value?.maxOutputTokens),
          confidenceThreshold: Number(value?.confidenceThreshold),
          handoffThreshold: Number(value?.handoffThreshold),
          retrievalTopK: Number(value?.retrievalTopK),
          maxToolCalls: Number(value?.maxToolCalls),
          aiEnabled: Boolean(value?.aiEnabled),
        },
      }),
    onSuccess: () => {
      toast.success(ar ? "تم حفظ إعدادات الذكاء الاصطناعي" : "AI settings saved");
      setForm(null);
      void qc.invalidateQueries({ queryKey: ["ai-config"] });
    },
    onError: (e: Error) => toastError(e, lang),
  });

  // Prompt editor state
  const [agentType, setAgentType] = useState<string>("orchestrator");
  const [promptLang, setPromptLang] = useState<"en" | "ar">("en");
  const [promptText, setPromptText] = useState("");
  const [promptNotes, setPromptNotes] = useState("");

  const versions = (config.data?.prompts ?? []).filter(
    (p) => p.agent_type === agentType && p.language === promptLang,
  );

  const loadDefault = useMutation({
    mutationFn: () => defaultFn({ data: { agentType, language: promptLang } }),
    onSuccess: (r) => setPromptText(r.prompt),
  });

  const savePrompt = useMutation({
    mutationFn: (approve: boolean) =>
      saveFn({ data: { agentType, language: promptLang, systemPrompt: promptText, notes: promptNotes, approve } }),
    onSuccess: (r) => {
      toast.success(ar ? `تم حفظ الإصدار ${r.version}` : `Saved version ${r.version}`);
      setPromptNotes("");
      void qc.invalidateQueries({ queryKey: ["ai-config"] });
    },
    onError: (e: Error) => toastError(e, lang),
  });

  // Evaluation state
  const [evalLang, setEvalLang] = useState<"all" | "en" | "ar">("all");
  const [evalLimit, setEvalLimit] = useState("10");
  const runEval = useMutation({
    mutationFn: () => evalFn({ data: { language: evalLang, limit: Number(evalLimit) } }),
    onSuccess: (r) => {
      toast.success(
        ar
          ? `اكتملت التقييمات: ${r.passed}/${r.total} ناجحة`
          : `Evaluation finished: ${r.passed}/${r.total} passed`,
      );
      void qc.invalidateQueries({ queryKey: ["ai-ops"] });
    },
    onError: (e: Error) => toastError(e, lang),
  });

  if (!isAdmin) {
    return (
      <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        {ar ? "هذه الصفحة متاحة لمسؤولي النظام فقط." : "This page is restricted to system administrators."}
      </p>
    );
  }

  const o = ops.data;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{ar ? "عمليات الذكاء الاصطناعي" : "AI operations"}</h1>
        <p className="text-sm text-muted-foreground">
          {ar
            ? "إدارة النموذج والتعليمات والأدوات ومراقبة الأداء وتشغيل بنك التقييم."
            : "Govern the model, prompts and tools, monitor live behaviour and run the evaluation bank."}
        </p>
      </header>

      <Tabs defaultValue="observability">
        <TabsList>
          <TabsTrigger value="observability">{ar ? "المراقبة" : "Observability"}</TabsTrigger>
          <TabsTrigger value="activity">{ar ? "نشاط الوكلاء" : "Agent activity"}</TabsTrigger>
          <TabsTrigger value="settings">{ar ? "الإعدادات" : "Settings"}</TabsTrigger>
          <TabsTrigger value="prompts">{ar ? "التعليمات" : "Prompts"}</TabsTrigger>
          <TabsTrigger value="tools">{ar ? "الأدوات" : "Tools"}</TabsTrigger>
          <TabsTrigger value="evaluation">{ar ? "التقييم" : "Evaluation"}</TabsTrigger>
          <TabsTrigger value="quality">{ar ? "الجودة والجاهزية" : "Quality & readiness"}</TabsTrigger>
          <TabsTrigger value="performance">{ar ? "الأداء" : "Performance"}</TabsTrigger>
        </TabsList>

        <TabsContent value="performance" className="space-y-4 pt-4">
          <PerformancePanel />
        </TabsContent>

        <TabsContent value="observability" className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard label={ar ? "المحادثات (30 يوماً)" : "Agent runs (30d)"} value={o?.totalRuns ?? 0} />
            <MetricCard label={ar ? "متوسط الاستجابة" : "Avg latency"} value={`${o?.avgLatencyMs ?? 0} ms`} />
            <MetricCard label={ar ? "الاستجابة (95%)" : "P95 latency"} value={`${o?.p95LatencyMs ?? 0} ms`} />
            <MetricCard label={ar ? "نسبة العربية" : "Arabic share"} value={`${o?.arabicShare ?? 0}%`} />
            <MetricCard label={ar ? "الوضع الاحتياطي" : "Fallback rate"} value={`${o?.fallbackRate ?? 0}%`} />
            <MetricCard label={ar ? "التحويل لموظف" : "Human handoff"} value={`${o?.handoffRate ?? 0}%`} />
            <MetricCard label={ar ? "ثقة منخفضة" : "Low confidence"} value={`${o?.lowConfidenceRate ?? 0}%`} />
            <MetricCard label={ar ? "فشل الأدوات" : "Tool failures"} value={`${o?.toolFailureRate ?? 0}%`} />
          </div>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">{ar ? "استخدام الأدوات" : "Tool usage"}</h2>
            <div className="space-y-2 text-sm">
              {(o?.tools ?? []).map((tl) => (
                <div key={tl.name} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                  <span className="font-mono text-xs">{tl.name}</span>
                  <span className="text-muted-foreground">
                    {tl.total} · {ar ? "فشل" : "failed"} {tl.failed} · {ar ? "مرفوض" : "denied"} {tl.denied} ·{" "}
                    {tl.avgMs} ms
                  </span>
                </div>
              ))}
              {(o?.tools ?? []).length === 0 ? (
                <p className="text-muted-foreground">{ar ? "لا توجد بيانات بعد." : "No tool activity yet."}</p>
              ) : null}
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">{ar ? "أحدث الجلسات" : "Recent runs"}</h2>
            <div className="space-y-2 text-sm">
              {(o?.recentRuns ?? []).map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2 border-b pb-2">
                  <Badge variant="secondary">{r.response_type ?? "answer"}</Badge>
                  <span className="text-muted-foreground">{r.language}</span>
                  <span className="text-muted-foreground">{r.latency_ms ?? 0} ms</span>
                  <span className="text-muted-foreground">
                    {ar ? "ثقة" : "conf"} {Number(r.confidence ?? 0).toFixed(2)}
                  </span>
                  {r.fallback_used ? <Badge variant="outline">{ar ? "احتياطي" : "fallback"}</Badge> : null}
                  {r.human_handoff ? <Badge variant="outline">{ar ? "تحويل" : "handoff"}</Badge> : null}
                  <span className="ms-auto text-xs text-muted-foreground">
                    {new Date(r.created_at as string).toLocaleString(ar ? "ar-AE" : "en-AE")}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">{ar ? "مقاييس الصوت (14 يوماً)" : "Voice metrics (14d)"}</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              {ar
                ? "أحداث تشغيلية من قناة الصوت فقط — لا يُخزَّن صوت خام."
                : "Operational events from the voice channel only — no raw audio is stored."}
            </p>
            {voiceMetrics.isError ? (
              <p className="text-sm text-muted-foreground">
                {ar ? "تعذّر تحميل مقاييس الصوت." : "Voice metrics could not be loaded."}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <MetricCard
                  label={ar ? "تفاعلات صوتية" : "Voice interactions"}
                  value={voiceMetrics.data?.voiceInteractions ?? 0}
                />
                <MetricCard
                  label={ar ? "عربي" : "Arabic"}
                  value={voiceMetrics.data?.arabicVoiceInteractions ?? 0}
                />
                <MetricCard
                  label={ar ? "إنجليزي" : "English"}
                  value={voiceMetrics.data?.englishVoiceInteractions ?? 0}
                />
                <MetricCard
                  label={ar ? "نجاح التحويل" : "STT success"}
                  value={`${voiceMetrics.data?.successfulTranscriptionRate ?? 0}%`}
                />
                <MetricCard
                  label={ar ? "معدل التوضيح" : "Clarification rate"}
                  value={`${voiceMetrics.data?.clarificationRate ?? 0}%`}
                />
                <MetricCard
                  label={ar ? "صوت → إجراء" : "Voice→action"}
                  value={`${voiceMetrics.data?.voiceToActionCompletionRate ?? 0}%`}
                />
                <MetricCard
                  label={ar ? "فشل خدمة الكلام" : "Speech failures"}
                  value={`${voiceMetrics.data?.speechServiceFailureRate ?? 0}%`}
                />
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="activity" className="space-y-4 pt-4">
          <div className="flex items-center gap-2">
            <Switch checked={onlyTools} onCheckedChange={setOnlyTools} id="only-tools" />
            <Label htmlFor="only-tools">
              {ar ? "عرض الجلسات التي نفّذت أدوات فقط" : "Only turns that executed tools"}
            </Label>
          </div>
          {!isAdmin ? (
            <p className="text-sm text-muted-foreground">
              {ar ? "متاح لمسؤول النظام فقط." : "Available to system administrators only."}
            </p>
          ) : null}
          <div className="space-y-3">
            {(activity.data?.runs ?? []).map((r) => (
              <section key={r.id} className="rounded-lg border bg-card p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{r.agent}</Badge>
                  <Badge variant="outline">{r.responseType ?? "answer"}</Badge>
                  <span className="text-muted-foreground">{r.language}</span>
                  <span className="text-muted-foreground">{r.latencyMs ?? 0} ms</span>
                  <span className="text-muted-foreground">
                    {r.modelCalls} {ar ? "استدعاء نموذج" : "model calls"}
                  </span>
                  {r.fallbackUsed ? <Badge variant="outline">{ar ? "احتياطي" : "fallback"}</Badge> : null}
                  {r.humanHandoff ? <Badge variant="outline">{ar ? "تحويل" : "handoff"}</Badge> : null}
                  <span className="ms-auto text-xs text-muted-foreground">
                    {new Date(r.at).toLocaleString(ar ? "ar-AE" : "en-AE")}
                  </span>
                </div>
                {r.request ? <p className="mt-2 text-muted-foreground">“{r.request}”</p> : null}
                <ul className="mt-2 space-y-1">
                  {r.events.map((e, i) => (
                    <li key={`${r.id}-${i}`} className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{e.name}</span>
                      <Badge variant={e.status === "succeeded" ? "secondary" : "destructive"}>{e.status}</Badge>
                      {e.authorization && e.authorization !== "allowed" ? (
                        <Badge variant="outline">{e.authorization}</Badge>
                      ) : null}
                      <span className="text-xs text-muted-foreground">{e.durationMs ?? 0} ms</span>
                    </li>
                  ))}
                  {r.events.length === 0 ? (
                    <li className="text-muted-foreground">
                      {ar ? "لم تُنفَّذ أدوات في هذه الجلسة." : "No tools executed in this turn."}
                    </li>
                  ) : null}
                </ul>
                {r.error ? <p className="mt-2 text-destructive">{r.error}</p> : null}
              </section>
            ))}
            {activity.isLoading ? (
              <p className="text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>
            ) : null}
            {!activity.isLoading && (activity.data?.runs ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{ar ? "لا يوجد نشاط بعد." : "No activity yet."}</p>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4 pt-4">
          <section className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{ar ? "المزود" : "Provider"}</Label>
              <Select value={String(value?.provider ?? "openai")} onValueChange={(v) => set("provider", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="azure_openai">Azure OpenAI</SelectItem>
                  <SelectItem value="gemini">Google Gemini</SelectItem>
                  <SelectItem value="custom">Custom OpenAI-compatible</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{ar ? "النموذج" : "Model"}</Label>
              <Input value={String(value?.modelName ?? "")} onChange={(e) => set("modelName", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{ar ? "مستوى التفكير" : "Thinking level"}</Label>
              <Select
                value={String(value?.reasoningEffort ?? "none")}
                onValueChange={(v) => set("reasoningEffort", v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{ar ? "بدون (الأسرع)" : "None (fastest)"}</SelectItem>
                  <SelectItem value="low">{ar ? "منخفض" : "Low"}</SelectItem>
                  <SelectItem value="medium">{ar ? "متوسط" : "Medium"}</SelectItem>
                  <SelectItem value="high">{ar ? "مرتفع" : "High"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{ar ? "المزود الاحتياطي" : "Backup provider"}</Label>
              <Select
                value={String(value?.fallbackProvider ?? "none")}
                onValueChange={(v) => set("fallbackProvider", v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{ar ? "بدون" : "None"}</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="azure_openai">Azure OpenAI</SelectItem>
                  <SelectItem value="gemini">Google Gemini</SelectItem>
                  <SelectItem value="custom">Custom OpenAI-compatible</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {ar
                  ? "يُستخدم فقط عند تعذّر الوصول إلى المزود الأساسي."
                  : "Used only when the main provider is unreachable."}
              </p>
            </div>
            <div className="space-y-2">
              <Label>{ar ? "نموذج المزود الاحتياطي" : "Backup model"}</Label>
              <Input
                value={String(value?.fallbackModel ?? "")}
                onChange={(e) => set("fallbackModel", e.target.value)}
                placeholder="google/gemini-3.8-flash"
              />
            </div>
            {([
              ["temperature", ar ? "درجة الإبداع" : "Temperature"],
              ["maxOutputTokens", ar ? "أقصى مخرجات" : "Max output tokens"],
              ["confidenceThreshold", ar ? "حد الثقة" : "Confidence threshold"],
              ["handoffThreshold", ar ? "حد التحويل" : "Handoff threshold"],
              ["retrievalTopK", ar ? "عدد نتائج الاسترجاع" : "Retrieval top-K"],
              ["maxToolCalls", ar ? "أقصى استدعاءات أدوات" : "Max tool calls"],
            ] as [NumericKey, string][]).map(([key, label]) => (
              <div key={key} className="space-y-2">
                <Label>{label}</Label>
                <Input
                  type="number"
                  step="0.05"
                  value={value ? value[key] : ""}
                  onChange={(e) => set(key, e.target.value)}
                />
              </div>
            ))}
            <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2">
              <div>
                <p className="text-sm font-medium">{ar ? "تفعيل الذكاء الاصطناعي" : "AI enabled"}</p>
                <p className="text-xs text-muted-foreground">
                  {ar
                    ? "عند الإيقاف يعمل المساعد بالمنطق الحتمي المدعوم بالسجلات فقط."
                    : "When off, the assistant falls back to deterministic, record-backed answers only."}
                </p>
              </div>
              <Switch checked={Boolean(value?.aiEnabled)} onCheckedChange={(v) => set("aiEnabled", v)} />
            </div>
            <div className="sm:col-span-2">
              <Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending || !value}>
                {ar ? "حفظ" : "Save settings"}
              </Button>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="prompts" className="space-y-4 pt-4">
          <section className="space-y-4 rounded-lg border bg-card p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{ar ? "الوكيل" : "Agent"}</Label>
                <Select value={agentType} onValueChange={setAgentType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AGENTS.map((a) => (
                      <SelectItem key={a} value={a}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{ar ? "اللغة" : "Language"}</Label>
                <Select value={promptLang} onValueChange={(v) => setPromptLang(v as "en" | "ar")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="ar">العربية</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{ar ? "نص التعليمات" : "System prompt"}</Label>
              <Textarea rows={12} value={promptText} onChange={(e) => setPromptText(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{ar ? "ملاحظات الإصدار" : "Version notes"}</Label>
              <Input value={promptNotes} onChange={(e) => setPromptNotes(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => loadDefault.mutate()}>
                {ar ? "تحميل الافتراضي" : "Load default"}
              </Button>
              <Button
                variant="outline"
                onClick={() => savePrompt.mutate(false)}
                disabled={savePrompt.isPending || promptText.trim().length < 20}
              >
                {ar ? "حفظ كمسودة" : "Save draft"}
              </Button>
              <Button
                onClick={() => savePrompt.mutate(true)}
                disabled={savePrompt.isPending || promptText.trim().length < 20}
              >
                {ar ? "حفظ واعتماد" : "Save & approve"}
              </Button>
            </div>

            <div className="space-y-2 border-t pt-3 text-sm">
              <h3 className="font-semibold">{ar ? "الإصدارات" : "Versions"}</h3>
              {versions.map((v) => (
                <div key={v.id} className="flex flex-wrap items-center gap-2 border-b pb-2">
                  <Badge variant={v.status === "approved" ? "default" : "secondary"}>v{v.version}</Badge>
                  <span className="text-muted-foreground">{v.status}</span>
                  <span className="truncate text-xs text-muted-foreground">{v.notes ?? ""}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ms-auto"
                    onClick={() => setPromptText(v.system_prompt ?? "")}
                  >
                    {ar ? "تحرير" : "Load"}
                  </Button>
                </div>
              ))}
              {versions.length === 0 ? (
                <p className="text-muted-foreground">
                  {ar ? "لا توجد إصدارات محفوظة، يعمل الوكيل بالتعليمات الافتراضية." : "No stored versions — the agent runs on the built-in default prompt."}
                </p>
              ) : null}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="tools" className="space-y-3 pt-4">
          <section className="rounded-lg border bg-card p-4">
            <div className="space-y-2 text-sm">
              {(config.data?.tools ?? []).map((tl) => (
                <div key={tl.id} className="flex flex-wrap items-center gap-3 border-b pb-2">
                  <span className="font-mono text-xs">{tl.tool_name}</span>
                  <Badge variant="secondary">{tl.agent_type}</Badge>
                  <Badge variant="outline">{tl.risk_level}</Badge>
                  {tl.confirmation_required ? (
                    <span className="text-xs text-muted-foreground">{ar ? "يتطلب تأكيداً" : "confirmation"}</span>
                  ) : null}
                  {tl.human_approval_required ? (
                    <span className="text-xs text-muted-foreground">{ar ? "موافقة بشرية" : "human approval"}</span>
                  ) : null}
                  <div className="ms-auto">
                    <Switch
                      checked={Boolean(tl.enabled)}
                      onCheckedChange={(v) =>
                        toggleFn({ data: { toolId: tl.id, enabled: v } })
                          .then(() => qc.invalidateQueries({ queryKey: ["ai-config"] }))
                          .catch((e: Error) => toastError(e, lang))
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="evaluation" className="space-y-4 pt-4">
          <section className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
            <div className="space-y-2">
              <Label>{ar ? "اللغة" : "Language"}</Label>
              <Select value={evalLang} onValueChange={(v) => setEvalLang(v as typeof evalLang)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{ar ? "الكل" : "All"}</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{ar ? "عدد السيناريوهات" : "Scenarios"}</Label>
              <Input className="w-28" type="number" min={1} max={60} value={evalLimit} onChange={(e) => setEvalLimit(e.target.value)} />
            </div>
            <Button onClick={() => runEval.mutate()} disabled={runEval.isPending}>
              {runEval.isPending ? (ar ? "جارٍ التشغيل…" : "Running…") : ar ? "تشغيل التقييم" : "Run evaluation"}
            </Button>
            <p className="text-xs text-muted-foreground">
              {ar
                ? `بنك التقييم يحتوي ${scenarios.data?.length ?? 0} سيناريو ثنائي اللغة.`
                : `Bank contains ${scenarios.data?.length ?? 0} bilingual scenarios.`}
            </p>
          </section>

          {(o?.evaluationBatches ?? []).length ? (
            <section className="rounded-lg border bg-card p-4 text-sm">
              <h2 className="mb-3 font-semibold">{ar ? "آخر الدفعات" : "Recent batches"}</h2>
              {(o?.evaluationBatches ?? []).map((b) => (
                <div key={b.batchId} className="flex flex-wrap items-center gap-3 border-b pb-2">
                  <span className="font-mono text-xs">{b.batchId.slice(0, 8)}</span>
                  <span>{ar ? "ناجحة" : "passed"} {b.passed}/{b.total}</span>
                  <span className="text-muted-foreground">{ar ? "المتوسط" : "avg"} {b.averageScore}</span>
                  <span className="ms-auto text-xs text-muted-foreground">
                    {new Date(b.at).toLocaleString(ar ? "ar-AE" : "en-AE")}
                  </span>
                </div>
              ))}
            </section>
          ) : null}

          <section className="rounded-lg border bg-card p-4 text-sm">
            <h2 className="mb-3 font-semibold">
              {ar ? "دليل قبول قناة الصوت (ستة اختبارات)" : "Voice channel acceptance (six PRD tests)"}
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              {ar
                ? "نصوص مكافئة للصوت تُشغَّل عبر مسار التقييم نفسه (/api/chat/ask). طبّق سكربت SQL الخاص بقناة الصوت إن لم تظهر أكواد VOICE-*."
                : "Text-equivalent transcripts run on the same evaluation path (/api/chat/ask). Apply the voice-channel SQL seed if VOICE-* codes are missing."}
            </p>
            <div className="space-y-2">
              {VOICE_PRD_SCENARIOS.map((s) => {
                const inBank = (scenarios.data ?? []).some((row) => row.scenario_code === s.code);
                return (
                  <div key={s.code} className="flex flex-wrap items-center gap-2 border-b pb-2">
                    <Badge variant="outline">{s.code}</Badge>
                    <Badge variant={inBank ? "secondary" : "outline"}>
                      {inBank ? (ar ? "في البنك" : "in bank") : ar ? "بانتظار البذرة" : "seed pending"}
                    </Badge>
                    <span className="text-muted-foreground">{ar ? s.ar : s.en}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4 text-sm">
            <h2 className="mb-3 font-semibold">{ar ? "بنك السيناريوهات" : "Scenario bank"}</h2>
            <div className="space-y-2">
              {(scenarios.data ?? []).map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-2 border-b pb-2">
                  <Badge variant="outline">{s.scenario_code}</Badge>
                  <Badge variant="secondary">{s.category}</Badge>
                  <span className="text-muted-foreground">{s.input_message}</span>
                  <span className="ms-auto text-xs text-muted-foreground">{s.expected_outcome_type}</span>
                </div>
              ))}
            </div>
          </section>
        </TabsContent>
        <TabsContent value="quality" className="pt-4">
          <QualityPanel isAdmin={isAdmin} />
        </TabsContent>

      </Tabs>
    </div>
  );
}
