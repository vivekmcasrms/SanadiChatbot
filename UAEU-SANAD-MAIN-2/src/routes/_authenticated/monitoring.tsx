/**
 * Admin case monitoring & SLA oversight.
 *
 * Purpose: one screen where an administrator can see every interaction that is
 * pending, late, stalled, escalated or closed without telling the student — and
 * who is accountable for each. Everything is server-paginated; state lives in
 * the URL so a filtered queue is linkable and survives navigation.
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { apiFetch } from "@/lib/auth-token";
import type { MonitorRow, MonitorSummary, OwnerMonitorRow, UnitMonitorRow } from "@/lib/monitoring/monitoring.functions";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useListParams } from "@/lib/use-list-params";
import { FilterChips, ListSearch, ListSelect, Pagination } from "@/components/list/ListControls";
import { MonitoringSummary } from "@/components/monitoring/MonitoringSummary";
import { MonitoringTable } from "@/components/monitoring/MonitoringTable";
import { CaseOversightDrawer } from "@/components/monitoring/CaseOversightDrawer";
import { UnitOwnerBreakdown } from "@/components/monitoring/UnitOwnerBreakdown";
import { RecoveryLog } from "@/components/monitoring/RecoveryLog";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/monitoring")({
  head: () => ({
    meta: [
      { title: "Case Monitoring & SLA Oversight — Sanadi | UAEU" },
      {
        name: "description",
        content:
          "University-wide oversight of pending, overdue, stalled and escalated student cases with responsibility and SLA tracking.",
      },
      { property: "og:title", content: "Case Monitoring & SLA Oversight — Sanadi" },
      {
        property: "og:description",
        content: "Track responsibility, response times and SLA risk across every UAEU student service unit.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MonitoringPage,
});

const DEFAULTS = {
  q: "",
  view: "open",
  unit: "all",
  type: "all",
  status: "all",
  sla: "all",
  actor: "all",
  escalation: "all",
  priority: "all",
  range: "any",
  sort: "risk",
  pageSize: 25,
};

type MonitorPage = { items: MonitorRow[]; total: number; page: number; pageSize: number; pageCount: number };

function sinceIso(range: string): string | undefined {
  const now = Date.now();
  if (range === "today") {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date.toISOString();
  }
  if (range === "7d") return new Date(now - 7 * 86_400_000).toISOString();
  if (range === "30d") return new Date(now - 30 * 86_400_000).toISOString();
  if (range === "90d") return new Date(now - 90 * 86_400_000).toISOString();
  return undefined;
}

function MonitoringPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { session } = useAuth();
  const signedIn = Boolean(session);
  const params = useListParams(DEFAULTS);
  const v = params.values;
  const [selected, setSelected] = useState<MonitorRow | null>(null);
  const [tile, setTile] = useState<string | undefined>(undefined);

  const access = useQuery({
    queryKey: ["monitor-access"],
    queryFn: async () => {
      const userId = session?.user.id;
      if (!userId) return { canMonitor: false, allUnits: false };
      const [canMonitor, allUnits] = await Promise.all([
        apiFetch<boolean>("/api/v1/rpc/can_monitor_cases", { method: "POST", body: JSON.stringify({ _user_id: userId }) }),
        apiFetch<boolean>("/api/v1/rpc/can_monitor_all_units", { method: "POST", body: JSON.stringify({ _user_id: userId }) }),
      ]);
      return { canMonitor: Boolean(canMonitor), allUnits: Boolean(allUnits) };
    },
    enabled: signedIn,
    retry: false,
  });
  const allowed = access.data?.canMonitor === true;

  const listArgs = useMemo(
    () => ({
      search: String(v["q"] ?? ""),
      view: String(v["view"]),
      unit: v["unit"] === "all" ? null : String(v["unit"]),
      type: String(v["type"]),
      status: String(v["status"]),
      sla: String(v["sla"]),
      actor: String(v["actor"]),
      escalation: String(v["escalation"]),
      priority: String(v["priority"]),
      range: String(v["range"]),
      sort: String(v["sort"]),
      page: params.page,
      pageSize: params.pageSize,
    }),
    [v, params.page, params.pageSize],
  );

  const list = useQuery({
    queryKey: ["monitor-list", listArgs],
    queryFn: async () => {
      const result = await apiFetch<{ items?: MonitorRow[]; total?: number }>("/api/v1/rpc/admin_case_monitor", {
        method: "POST",
        body: JSON.stringify({
          _view: listArgs.view || "open",
          _sort: listArgs.sort || "risk",
          _page: listArgs.page,
          _page_size: listArgs.pageSize,
          ...(listArgs.search.trim() ? { _search: listArgs.search.trim() } : {}),
          ...(listArgs.unit ? { _unit: listArgs.unit } : {}),
          ...(listArgs.type !== "all" ? { _type: listArgs.type } : {}),
          ...(listArgs.status !== "all" ? { _status: listArgs.status } : {}),
          ...(listArgs.sla !== "all" ? { _sla: listArgs.sla } : {}),
          ...(listArgs.actor !== "all" ? { _actor: listArgs.actor } : {}),
          ...(listArgs.escalation !== "all" ? { _escalation: listArgs.escalation } : {}),
          ...(listArgs.priority !== "all" ? { _priority: listArgs.priority } : {}),
          ...(listArgs.range !== "any" && sinceIso(listArgs.range) ? { _since: sinceIso(listArgs.range) } : {}),
        }),
      });
      const total = result.total ?? 0;
      return { items: result.items ?? [], total, page: listArgs.page, pageSize: listArgs.pageSize, pageCount: Math.max(1, Math.ceil(total / listArgs.pageSize)) };
    },
    enabled: signedIn && allowed,
    retry: false,
    placeholderData: (prev) => prev,
  });

  const summary = useQuery({
    queryKey: ["monitor-summary"],
    queryFn: () => apiFetch<MonitorSummary>("/api/v1/rpc/admin_case_monitor_summary"),
    enabled: signedIn && allowed,
    retry: false,
  });

  const units = useQuery({
    queryKey: ["monitor-units"],
    queryFn: () => apiFetch<UnitMonitorRow[]>("/api/v1/rpc/admin_unit_monitor"),
    enabled: signedIn && allowed,
    retry: false,
  });

  const owners = useQuery({
    queryKey: ["monitor-owners"],
    queryFn: () => apiFetch<OwnerMonitorRow[]>("/api/v1/rpc/admin_owner_monitor"),
    enabled: signedIn && allowed,
    retry: false,
  });

  if (access.isLoading) {
    return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  }

  if (!allowed) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 p-6">
          <ShieldAlert className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
          <div>
            <h1 className="font-medium">{ar ? "غير مصرّح" : "Not authorised"}</h1>
            <p className="text-sm text-muted-foreground">
              {ar
                ? "مراقبة الحالات متاحة لمسؤولي النظام والقيادة ومالكي الوحدات المصرّح لهم."
                : "Case monitoring is available to system admins, leadership and authorised unit owners."}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const unitOptions = [
    { key: "all", label: ar ? "كل الوحدات" : "All units" },
    ...(units.data ?? [])
      .filter((u) => u.unitId)
      .map((u) => ({ key: u.unitId!, label: ar ? u.unitAr : u.unitEn })),
  ];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {ar ? "مراقبة الحالات ومستويات الخدمة" : "Case monitoring & SLA oversight"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {ar
            ? "من المسؤول الآن، ومنذ متى، وما الذي تجاوز المدة أو توقف أو أُغلق دون إبلاغ الطالب."
            : "Who is responsible right now, for how long, and what is overdue, stalled or closed without telling the student."}
        </p>
      </header>

      <MonitoringSummary
        data={summary.data}
        loading={summary.isLoading}
        activeKey={tile}
        onSelect={(filter, key) => {
          setTile(key);
          params.setFilter({
            view: "open",
            type: "all",
            sla: "all",
            actor: "all",
            escalation: "all",
            priority: "all",
            ...filter,
          });
        }}
      />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <ListSearch
            value={String(v["q"] ?? "")}
            onChange={(next) => params.setFilter({ q: next })}
            placeholder={ar ? "رقم الحالة، العنوان، أو الطالب…" : "Case number, title or student…"}
          />
          <FilterChips
            ariaLabel={ar ? "طريقة العرض" : "View"}
            value={String(v["view"])}
            onChange={(key) => {
              setTile(undefined);
              params.setFilter({ view: key });
            }}
            options={[
              { key: "intervention", label: ar ? "يحتاج تدخلاً" : "Needs intervention" },
              { key: "open", label: ar ? "المفتوحة" : "Open" },
              { key: "complaints", label: ar ? "شكاوى" : "Complaints" },
              { key: "suggestions", label: ar ? "اقتراحات" : "Suggestions" },
              { key: "reopened", label: ar ? "أُعيد فتحها" : "Reopened" },
              { key: "closure", label: ar ? "إغلاق ناقص" : "Closure gap" },
              { key: "all", label: ar ? "الكل" : "All" },
            ]}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ListSelect
            label={ar ? "الوحدة" : "Unit"}
            value={String(v["unit"])}
            options={unitOptions}
            onChange={(key) => params.setFilter({ unit: key })}
            width="w-[210px]"
          />
          <ListSelect
            label={ar ? "النوع" : "Type"}
            value={String(v["type"])}
            onChange={(key) => params.setFilter({ type: key })}
            options={[
              { key: "all", label: ar ? "كل الأنواع" : "All types" },
              { key: "query", label: ar ? "استفسار" : "Query" },
              { key: "complaint", label: ar ? "شكوى" : "Complaint" },
              { key: "suggestion", label: ar ? "اقتراح" : "Suggestion" },
              { key: "service_request", label: ar ? "طلب خدمة" : "Service request" },
              { key: "alert", label: ar ? "بلاغ" : "Alert" },
            ]}
          />
          <ListSelect
            label={ar ? "حالة المدة" : "SLA"}
            value={String(v["sla"])}
            onChange={(key) => params.setFilter({ sla: key })}
            options={[
              { key: "all", label: ar ? "كل مستويات المدة" : "All SLA states" },
              { key: "on_track", label: ar ? "ضمن المدة" : "On track" },
              { key: "attention", label: ar ? "يحتاج متابعة" : "Attention" },
              { key: "critical", label: ar ? "حرِج" : "Critical" },
              { key: "breached", label: ar ? "تجاوز المدة" : "Breached" },
              { key: "paused", label: ar ? "موقوف" : "Paused" },
            ]}
          />
          <ListSelect
            label={ar ? "المسؤول" : "Responsible"}
            value={String(v["actor"])}
            onChange={(key) => params.setFilter({ actor: key })}
            options={[
              { key: "all", label: ar ? "أي مسؤول" : "Any actor" },
              { key: "ai", label: ar ? "سندي الذكي" : "Sanadi AI" },
              { key: "student", label: ar ? "الطالب" : "Student" },
              { key: "service_owner", label: ar ? "مالك الخدمة" : "Service owner" },
              { key: "specific_officer", label: ar ? "موظف محدد" : "Assigned officer" },
              { key: "external_party", label: ar ? "جهة خارجية" : "External party" },
            ]}
          />
          <ListSelect
            label={ar ? "التصعيد" : "Escalation"}
            value={String(v["escalation"])}
            onChange={(key) => params.setFilter({ escalation: key })}
            options={[
              { key: "all", label: ar ? "الكل" : "Any" },
              { key: "unresolved", label: ar ? "غير محلول" : "Unresolved" },
              { key: "none", label: ar ? "بدون تصعيد" : "Not escalated" },
            ]}
          />
          <ListSelect
            label={ar ? "الأولوية" : "Priority"}
            value={String(v["priority"])}
            onChange={(key) => params.setFilter({ priority: key })}
            options={[
              { key: "all", label: ar ? "كل الأولويات" : "All priorities" },
              { key: "critical", label: ar ? "حرجة" : "Critical" },
              { key: "high", label: ar ? "عالية" : "High" },
              { key: "medium", label: ar ? "متوسطة" : "Medium" },
              { key: "low", label: ar ? "منخفضة" : "Low" },
            ]}
          />
          <ListSelect
            label={ar ? "الفترة" : "Period"}
            value={String(v["range"])}
            onChange={(key) => params.setFilter({ range: key })}
            options={[
              { key: "any", label: ar ? "كل الفترات" : "Any time" },
              { key: "today", label: ar ? "اليوم" : "Today" },
              { key: "7d", label: ar ? "٧ أيام" : "Last 7 days" },
              { key: "30d", label: ar ? "٣٠ يوماً" : "Last 30 days" },
              { key: "90d", label: ar ? "٩٠ يوماً" : "Last 90 days" },
            ]}
          />
          <ListSelect
            label={ar ? "الترتيب" : "Sort"}
            value={String(v["sort"])}
            onChange={(key) => params.setFilter({ sort: key })}
            options={[
              { key: "risk", label: ar ? "الأعلى خطورة" : "Highest risk" },
              { key: "waiting", label: ar ? "الأطول انتظاراً" : "Longest waiting" },
              { key: "due", label: ar ? "الأقرب للموعد" : "Soonest due" },
              { key: "updated", label: ar ? "آخر تحديث" : "Recently updated" },
              { key: "created", label: ar ? "الأحدث" : "Newest" },
            ]}
          />
        </div>

        <MonitoringTable
          rows={list.data?.items ?? []}
          loading={list.isLoading}
          onOpen={(row) => setSelected(row)}
        />

        <Pagination
          page={list.data?.page ?? params.page}
          pageSize={list.data?.pageSize ?? params.pageSize}
          pageCount={list.data?.pageCount ?? 1}
          total={list.data?.total ?? 0}
          onPage={params.setPage}
          onPageSize={params.setPageSize}
          busy={list.isFetching}
        />
      </section>

      <UnitOwnerBreakdown
        units={units.data ?? []}
        owners={owners.data ?? []}
        loading={units.isLoading || owners.isLoading}
        onUnit={(unitId) => params.setFilter({ unit: unitId, view: "open" })}
      />

      <RecoveryLog />

      <CaseOversightDrawer row={selected} units={units.data ?? []} onClose={() => setSelected(null)} />
    </div>
  );
}
