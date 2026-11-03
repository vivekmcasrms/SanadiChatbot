import { useEffect, useMemo, useState } from "react";
import { toastError } from "@/lib/errors/toast";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusChip, UrgencyChip } from "@/components/StatusChip";
import { MetricCard } from "@/components/MetricCard";
import { SuggestionsWorkspace } from "@/components/SuggestionsWorkspace";
import { StaffCaseWorkspace } from "@/components/StaffCaseWorkspace";
import { ManagerOpsPanel } from "@/components/ManagerOpsPanel";
import { UnitOwnerPanel } from "@/components/UnitOwnerPanel";
import { useStaffMetrics, formatDuration } from "@/lib/metrics";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

type StaffView = "queue" | "suggestions" | "approvals" | "escalations" | "unit";

export const Route = createFileRoute("/_authenticated/staff")({
  validateSearch: (search: Record<string, unknown>): { view?: StaffView | undefined } => {
    const raw = search['view'];
    const allowed: StaffView[] = ["queue", "suggestions", "approvals", "escalations", "unit"];
    return { view: allowed.includes(raw as StaffView) ? (raw as StaffView) : undefined };
  },
  head: () => ({
    meta: [
      { title: "Staff portal — Sanadi | UAEU" },
      { name: "description", content: "Triage, assign and resolve student cases with full audit history." },
      { property: "og:title", content: "Staff portal — Sanadi | UAEU" },
      { property: "og:description", content: "Service inbox for university staff." },
    ],
  }),
  component: StaffPortal,
});

const STATUSES = [
  "submitted",
  "acknowledged",
  "in_review",
  "assigned",
  "awaiting_student",
  "resolution_proposed",
  "resolved",
  "closed",
  "escalated",
] as const;

type CaseStatus = (typeof STATUSES)[number];

function StaffPortal() {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const { user, isStaff, loading, roles } = useAuth();
  const { view = "queue" } = Route.useSearch();
  const isManager = roles.includes("service_manager") || roles.includes("system_admin");
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    setStatusFilter(view === "escalations" ? "escalated" : "all");
  }, [view]);

  const casesQuery = useQuery({
    queryKey: ["staff-cases"],
    enabled: isStaff,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cases")
        .select("id, case_number, title, description, status, urgency, case_type, created_at, assigned_to")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const metricsQuery = useStaffMetrics(isStaff);
  const m = metricsQuery.data;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (casesQuery.data ?? []).filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (view === "suggestions" && c.case_type !== "suggestion") return false;
      if (!term) return true;
      return `${c.case_number} ${c.title}`.toLowerCase().includes(term);
    });
  }, [casesQuery.data, search, statusFilter, view]);

  const selected = filtered.find((c) => c.id === selectedId) ?? filtered[0] ?? null;

  async function updateStatus(caseId: string, status: CaseStatus) {
    const closing = status === "resolved" || status === "closed";
    const { error } = await supabase
      .from("cases")
      .update(closing ? { status, resolved_at: new Date().toISOString() } : { status })
      .eq("id", caseId);
    if (error) {
      toastError(error, lang);
      return;
    }
    toast.success(t("saved"));
    void queryClient.invalidateQueries({ queryKey: ["staff-cases"] });
    void queryClient.invalidateQueries({ queryKey: ["metrics"] });
  }

  async function claim(caseId: string) {
    if (!user) return;
    const { error } = await supabase
      .from("cases")
      .update({ assigned_to: user.id, status: "assigned" })
      .eq("id", caseId);
    if (error) {
      toastError(error, lang);
      return;
    }
    toast.success(t("saved"));
    void queryClient.invalidateQueries({ queryKey: ["staff-cases"] });
    void queryClient.invalidateQueries({ queryKey: ["metrics"] });
  }

  async function addNote(caseId: string, internal: boolean) {
    if (!user || note.trim().length < 2) return;
    const { error } = await supabase
      .from("case_comments")
      .insert({ case_id: caseId, author_id: user.id, body: note.trim(), is_internal: internal });
    if (error) {
      toastError(error, lang);
      return;
    }
    if (!internal) {
      await supabase
        .from("cases")
        .update({ first_response_at: new Date().toISOString() })
        .eq("id", caseId)
        .is("first_response_at", null);
      void queryClient.invalidateQueries({ queryKey: ["metrics"] });
    }
    setNote("");
    toast.success(t("saved"));
  }

  if (loading) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  if (!isStaff)
    return (
      <div className="rounded-xl border border-dashed p-8 text-center">
        <h1 className="text-base font-semibold">{t("staff_only")}</h1>
      </div>
    );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">
          {view === "suggestions"
            ? ar
              ? "المقترحات"
              : "Suggestions"
            : view === "approvals"
              ? ar
                ? "الموافقات"
                : "Approvals"
              : view === "escalations"
                ? ar
                  ? "التصعيدات"
                  : "Escalations"
                : view === "unit"
                  ? ar
                    ? "أداء وحدتي"
                    : "My unit performance"
                  : t("case_inbox")}
        </h1>
      </div>

      {view === "unit" ? <UnitOwnerPanel /> : null}

      <section aria-label={ar ? "مؤشرات مباشرة" : "Live metrics"} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label={ar ? "حالات مفتوحة" : "Open cases"}
          value={metricsQuery.isLoading ? "…" : (m?.open ?? 0)}
          hint={ar ? `${m?.total ?? 0} إجمالي الحالات` : `${m?.total ?? 0} cases in total`}
        />
        <MetricCard
          label={ar ? "غير مُسندة" : "Unassigned"}
          value={metricsQuery.isLoading ? "…" : (m?.unassigned ?? 0)}
          tone={(m?.unassigned ?? 0) > 0 ? "warning" : "default"}
          hint={ar ? "بانتظار موظف" : "Waiting for an owner"}
        />
        <MetricCard
          label={ar ? "متأخرة عن الموعد" : "Overdue"}
          value={metricsQuery.isLoading ? "…" : (m?.overdue ?? 0)}
          tone={(m?.overdue ?? 0) > 0 ? "danger" : "success"}
          hint={ar ? `${m?.escalated ?? 0} مُصعّدة` : `${m?.escalated ?? 0} escalated`}
        />
        <MetricCard
          label={ar ? "تم حلها (7 أيام)" : "Resolved (7 days)"}
          value={metricsQuery.isLoading ? "…" : (m?.resolvedLast7 ?? 0)}
          tone="success"
          hint={ar ? `${m?.awaitingStudent ?? 0} بانتظار الطالب` : `${m?.awaitingStudent ?? 0} awaiting student`}
        />
        <MetricCard
          label={ar ? "متوسط أول رد" : "Avg first response"}
          value={formatDuration(m?.avgFirstResponseHours ?? null)}
        />
        <MetricCard
          label={ar ? "متوسط زمن الحل" : "Avg resolution time"}
          value={formatDuration(m?.avgResolutionHours ?? null)}
        />
        <MetricCard
          label={ar ? "متوسط الرضا" : "Avg satisfaction"}
          value={m?.satisfactionAvg != null ? `${m.satisfactionAvg} / 5` : "—"}
        />
        <MetricCard
          label={ar ? "اقتراحات قيد المعالجة" : "Suggestions in progress"}
          value={metricsQuery.isLoading ? "…" : (m?.suggestionsOpen ?? 0)}
        />
      </section>

      {isManager ? <ManagerOpsPanel /> : null}

      {m?.byStatus.length ? (
        <div className="flex flex-wrap gap-2">
          {m.byStatus.map((s) => (
            <button
              key={s.status}
              type="button"
              onClick={() => setStatusFilter(s.status)}
              className="flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs transition-colors hover:border-primary/40"
            >
              <StatusChip status={s.status} />
              <span className="tabular-nums font-semibold">{s.count}</span>
            </button>
          ))}
        </div>
      ) : null}

      {view === "suggestions" ? (
        <SuggestionsWorkspace />
      ) : (
        <>
      <div className="flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("search")}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filter_all")}</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                <StatusChip status={s} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <ul className="space-y-2">
          {casesQuery.isLoading ? (
            <li className="text-sm text-muted-foreground">{t("loading")}</li>
          ) : filtered.length ? (
            filtered.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full rounded-lg border bg-card p-3 text-start transition-colors hover:border-primary/40 ${
                    selected?.id === c.id ? "border-primary" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold">{c.case_number}</span>
                    <StatusChip status={c.status} />
                    <UrgencyChip urgency={c.urgency} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm">{c.title}</p>
                </button>
              </li>
            ))
          ) : (
            <li className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t("none_yet")}
            </li>
          )}
        </ul>

        {selected ? (
          <section className="space-y-4 rounded-xl border bg-card p-5 card-shadow">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">{selected.case_number}</h2>
              <StatusChip status={selected.status} />
              <UrgencyChip urgency={selected.urgency} />
            </div>
            <p className="text-sm font-medium">{selected.title}</p>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{selected.description}</p>

            <div className="flex flex-wrap items-center gap-2">
              <Select value={selected.status} onValueChange={(value) => updateStatus(selected.id, value as CaseStatus)}>
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      <StatusChip status={s} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                disabled={Boolean(user && selected.assigned_to === user.id)}
                onClick={() => claim(selected.id)}
              >
                {t("assign_to_me")}
              </Button>
            </div>

            <div className="space-y-2">
              <Textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("write_message")}
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => addNote(selected.id, false)} disabled={!note.trim()}>
                  {t("student_reply")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => addNote(selected.id, true)}
                  disabled={!note.trim()}
                >
                  {t("internal_note")}
                </Button>
              </div>
            </div>

            <StaffCaseWorkspace caseId={selected.id} />
          </section>
        ) : null}
      </div>
        </>
      )}
    </div>
  );
}