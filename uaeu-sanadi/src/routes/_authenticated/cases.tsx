import { createFileRoute } from "@tanstack/react-router";
import { toastError } from "@/lib/errors/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  BedDouble,
  Bot,
  Briefcase,
  CheckCircle2,
  Gauge,
  Layers,
  LayoutDashboard,
  LineChart,
  ShieldAlert,
  Sparkles,
  Timer,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { KnowledgeIssueButton, OwnerFollowUpPanel, OwnerSlaPanel } from "@/components/OwnerOpsPanels";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { isServiceOwnerOnly } from "@/lib/nav";
import { useI18n } from "@/lib/i18n";
import { getOwnerConsoleFn, saveOwnerPreferencesFn } from "@/lib/automation.functions";
import { getSuggestionThemes } from "@/lib/proactive.functions";
import {
  OwnerUnitCases,
  OwnerUnitInsights,
  UnitSelector,
  useOwnerWorkspace,
} from "@/components/OwnerUnitWorkspace";
import { Badge } from "@/components/ui/badge";
import { OwnerDashboard } from "@/components/OwnerDashboard";
import { SuggestionsWorkspace } from "@/components/SuggestionsWorkspace";
import { ManagerOpsPanel } from "@/components/ManagerOpsPanel";

type ConsoleSearch = { tab: string; unit?: string | undefined };

export const Route = createFileRoute("/_authenticated/cases")({
  validateSearch: (search: Record<string, unknown>): ConsoleSearch => ({
    tab: typeof search["tab"] === "string" ? (search["tab"] as string) : "dashboard",
    unit: typeof search["unit"] === "string" ? (search["unit"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Staff Case Workspace — Sanadi | UAEU" },
      {
        name: "description",
        content: "Requests that need your action, your assigned requests, student messages and recently completed work.",
      },
      { property: "og:title", content: "Staff Case Workspace — Sanadi | UAEU" },
      {
        property: "og:description",
        content: "Requests that need your action, your assigned requests, student messages and recently completed work.",
      },
    ],
  }),
  component: CasesWorkspacePage,
});

const PREF_FIELDS = [
  { key: "auto_send_routine_updates", en: "Send routine updates automatically", ar: "إرسال التحديثات الروتينية تلقائياً" },
  { key: "auto_request_missing_information", en: "Request missing information automatically", ar: "طلب المعلومات الناقصة تلقائياً" },
  { key: "auto_follow_up", en: "Follow up automatically", ar: "المتابعة تلقائياً" },
  { key: "auto_escalate_by_policy", en: "Escalate by policy automatically", ar: "التصعيد تلقائياً وفق السياسة" },
  { key: "auto_prepare_resolution", en: "Prepare resolutions automatically", ar: "إعداد الحلول تلقائياً" },
  { key: "auto_close_eligible_cases", en: "Close eligible cases automatically", ar: "إغلاق الحالات المؤهلة تلقائياً" },
  {
    key: "require_review_for_all_student_messages",
    en: "Review every message before it reaches a student",
    ar: "مراجعة كل رسالة قبل وصولها للطالب",
  },
] as const;

type PrefKey = (typeof PREF_FIELDS)[number]["key"];

const DEFAULT_PREFS: Record<PrefKey, boolean> = {
  auto_send_routine_updates: true,
  auto_request_missing_information: true,
  auto_follow_up: true,
  auto_escalate_by_policy: true,
  auto_prepare_resolution: true,
  auto_close_eligible_cases: false,
  require_review_for_all_student_messages: false,
};

function CasesWorkspacePage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { isStaff, roles } = useAuth();
  const { tab: rawTab, unit } = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();

  // A pure Service Owner gets the lean, action-first workspace: four
  // destinations, no monitoring, SLA policy or analytics surfaces.
  const ownerOnly = isServiceOwnerOnly(roles);

  // Legacy and administrative tabs fold into the lean set for owners.
  const LEAN_ALIAS: Record<string, string> = {
    overview: "dashboard",
    cases: "assigned",
    // Messages are not a destination of their own for a lean owner: the thread
    // lives inside the request, so old links land on the action queue.
    chats: "attention",
    messages: "attention",
    followup: "attention",
    sla: "attention",
    insights: "dashboard",
    preferences: "attention",
    themes: "attention",
  };
  // Every staff role gets the same four destinations. Officers and managers
  // additionally see the tools their permissions allow (suggestions,
  // follow-up, SLA, insights); nothing else changes between roles.
  const SHARED_ALIAS: Record<string, string> = { overview: "dashboard", cases: "assigned", mine: "assigned", queue: "attention", chats: "attention", messages: "attention", escalations: "manager", approvals: "manager", unit: "dashboard" };
  const tab = ownerOnly ? (LEAN_ALIAS[rawTab] ?? rawTab) : (SHARED_ALIAS[rawTab] ?? rawTab);

  const workspace = useOwnerWorkspace(isStaff);
  const units = workspace.data?.units ?? [];
  const activeUnit = unit && units.some((u) => u.id === unit) ? unit : (units[0]?.id ?? null);
  const current = units.find((u) => u.id === activeUnit);
  const isManager = workspace.data?.isManager ?? false;


  // Automation preferences and cross-unit themes are the only surfaces that
  // still need the non-unit console payload.
  const console_ = useQuery({
    queryKey: ["owner-console"],
    enabled: isStaff && (tab === "preferences" || isManager),
    queryFn: () => getOwnerConsoleFn(),
  });

  const themes = useQuery({
    queryKey: ["suggestion-themes"],
    enabled: isStaff && isManager && tab === "themes",
    queryFn: () => getSuggestionThemes(),
  });

  const savePrefs = useMutation({
    mutationFn: (prefs: Record<string, unknown>) =>
      saveOwnerPreferencesFn({
        data: {
          ...DEFAULT_PREFS,
          preferred_response_style: "concise_formal" as const,
          ...prefs,
        } as never,
      }),
    onSuccess: () => {
      toast.success(ar ? "تم حفظ التفضيلات" : "Preferences saved");
      void qc.invalidateQueries({ queryKey: ["owner-console"] });
    },
    onError: (e: Error) => toastError(e, lang),
  });

  if (!isStaff) {
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        {ar ? "هذه الصفحة لموظفي الخدمة المصرح لهم." : "This console is for authorised service staff."}
      </p>
    );
  }

  const d = console_.data;
  const prefs = { ...DEFAULT_PREFS, ...(d?.preferences ?? {}) } as Record<PrefKey, boolean> & {
    preferred_response_style?: string;
  };

  const workspaceName = current
    ? ar
      ? current.nameAr
      : current.nameEn
    : ar
      ? "مساحة عمل الخدمة"
      : "Service workspace";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{workspaceName}</h1>
          <p className="text-sm text-muted-foreground">
            {ar
              ? "يتولى سندي الأعمال الروتينية؛ ترى هنا ما يحتاج قرارك فقط."
              : "Sanadi handles the routine work — you only see what needs your action."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ownerOnly && units.length < 2 ? null : (
            <UnitSelector
              workspace={workspace.data}
              unitId={activeUnit}
              onChange={(id) => void navigate({ search: { tab, unit: id } })}
            />
          )}
          {ownerOnly ? null : <KnowledgeIssueButton />}
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => void navigate({ search: { tab: v, unit: activeUnit ?? undefined } })}>
        <TabsList className={ownerOnly ? "flex-wrap md:hidden" : "flex-wrap"}>
          <TabsTrigger value="dashboard" className="gap-1.5">
            <LayoutDashboard className="size-4" aria-hidden />
            {ar ? "لوحة المعلومات" : "Dashboard"}
          </TabsTrigger>
          <TabsTrigger value="attention" className="gap-1.5">
            <ShieldAlert className="size-4" aria-hidden />
            {ar ? "يحتاج انتباهك" : "Needs Your Attention"}
          </TabsTrigger>
          <TabsTrigger value="assigned" className="gap-1.5">
            <Layers className="size-4" aria-hidden />
            {ar ? "طلباتي" : "My Requests"}
          </TabsTrigger>
          <TabsTrigger value="completed" className="gap-1.5">
            <CheckCircle2 className="size-4" aria-hidden />
            {ar ? "المكتملة" : "Completed"}
          </TabsTrigger>
          {ownerOnly ? null : (
            <>
              <TabsTrigger value="suggestions" className="gap-1.5">
                <Sparkles className="size-4" aria-hidden />
                {ar ? "المقترحات" : "Suggestions"}
              </TabsTrigger>
              <TabsTrigger value="followup" className="gap-1.5">
                <Timer className="size-4" aria-hidden />
                {ar ? "المتابعة" : "Follow-up"}
              </TabsTrigger>
              <TabsTrigger value="sla" className="gap-1.5">
                <Gauge className="size-4" aria-hidden />
                {ar ? "المدد والتصعيدات" : "SLA & escalations"}
              </TabsTrigger>
              <TabsTrigger value="insights" className="gap-1.5">
                <LineChart className="size-4" aria-hidden />
                {ar ? "التحليلات" : "Insights"}
              </TabsTrigger>
            </>
          )}
          {isManager ? (
            <TabsTrigger value="manager" className="gap-1.5">
              <UserCheck className="size-4" aria-hidden />
              {ar ? "أدوات المدير" : "Manager tools"}
            </TabsTrigger>
          ) : null}
          {isManager ? (
            <TabsTrigger value="themes" className="gap-1.5">
              <Bot className="size-4" aria-hidden />
              {ar ? "محاور المقترحات" : "Suggestion themes"}
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="dashboard" className="mt-4">
          <OwnerDashboard enabled={isStaff && tab === "dashboard"} unitId={activeUnit} />
        </TabsContent>

        <TabsContent value="attention" className="mt-4">
          <OwnerUnitCases
            enabled={isStaff && tab === "attention"}
            unitId={activeUnit}
            workspace={workspace.data}
            preset="attention"
            simple={ownerOnly}
          />
        </TabsContent>

        <TabsContent value="assigned" className="mt-4">
          <OwnerUnitCases
            enabled={isStaff && tab === "assigned"}
            unitId={activeUnit}
            workspace={workspace.data}
            preset="assigned"
            simple={ownerOnly}
          />
        </TabsContent>


        <TabsContent value="completed" className="mt-4">
          <OwnerUnitCases
            enabled={isStaff && tab === "completed"}
            unitId={activeUnit}
            workspace={workspace.data}
            preset="completed"
            simple={ownerOnly}
          />
        </TabsContent>

        {ownerOnly ? null : (
          <>
            <TabsContent value="suggestions" className="mt-4">
              {tab === "suggestions" ? <SuggestionsWorkspace /> : null}
            </TabsContent>

            <TabsContent value="insights" className="mt-4">
              <OwnerUnitInsights enabled={isStaff && tab === "insights"} unitId={activeUnit} />
            </TabsContent>

            <TabsContent value="followup" className="mt-4">
              <OwnerFollowUpPanel enabled={isStaff && tab === "followup"} unitId={activeUnit} />
            </TabsContent>

            <TabsContent value="sla" className="mt-4">
              <OwnerSlaPanel enabled={isStaff && tab === "sla"} unitId={activeUnit} />
            </TabsContent>
          </>
        )}


        {isManager ? (
          <TabsContent value="manager" className="mt-4">
            {tab === "manager" ? <ManagerOpsPanel /> : null}
          </TabsContent>
        ) : null}

        {isManager ? (
          <TabsContent value="themes" className="mt-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              {ar
                ? "يجمع سندي المقترحات المتشابهة في محور واحد، فتتخذ قراراً واحداً بدل مراجعة عشرات الطلبات."
                : "Sanadi groups similar suggestions into one theme, so you take one decision instead of reviewing dozens of items."}
            </p>
            {themes.isLoading ? <p className="text-sm text-muted-foreground">…</p> : null}
            {(themes.data ?? []).map((th) => (
              <Card key={th.key}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <span className="min-w-0 flex-1 truncate">{th.labelEn}</span>
                    <Badge variant={th.count > 1 ? "default" : "secondary"}>
                      {th.count} {ar ? "مقترح" : th.count === 1 ? "suggestion" : "suggestions"}
                    </Badge>
                    {th.votes ? <Badge variant="outline">{th.votes} {ar ? "تصويت" : "votes"}</Badge> : null}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-xs text-muted-foreground">
                  <p>{(ar ? th.unitNameAr : th.unitNameEn) ?? (ar ? "بانتظار التوجيه" : "Awaiting routing")}</p>
                  <ul className="space-y-0.5">
                    {th.items.slice(0, 5).map((it) => (
                      <li key={it.id} className="truncate">
                        • <bdi dir="ltr">{it.referenceNumber}</bdi> — {it.title} <span className="opacity-70">({it.status})</span>
                      </li>
                    ))}
                  </ul>
                  {th.items.length > 5 ? <p>+{th.items.length - 5} {ar ? "أخرى" : "more"}</p> : null}
                </CardContent>
              </Card>
            ))}
            {!themes.isLoading && !(themes.data ?? []).length ? (
              <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                {ar ? "لا توجد مقترحات مفتوحة حالياً." : "No open suggestions right now."}
              </p>
            ) : null}
          </TabsContent>
        ) : null}

        <TabsContent value="preferences" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="size-4 text-primary" aria-hidden />
                {ar ? "ما الذي يسمح لك للذكاء الاصطناعي بفعله" : "What you allow the AI to do"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                {ar
                  ? "هذه التفضيلات تشدد الأتمتة فقط؛ لا يمكنها تجاوز سياسات الجامعة."
                  : "These preferences can only tighten automation — they never override university policy."}
              </p>
              {PREF_FIELDS.map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-4">
                  <Label htmlFor={f.key} className="text-sm font-normal">
                    {ar ? f.ar : f.en}
                  </Label>
                  <Switch
                    id={f.key}
                    checked={prefs[f.key]}
                    onCheckedChange={(checked) =>
                      savePrefs.mutate({
                        ...prefs,
                        preferred_response_style: prefs.preferred_response_style ?? "concise_formal",
                        [f.key]: checked,
                      })
                    }
                  />
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => void console_.refetch()}>
                {ar ? "تحديث" : "Refresh"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
