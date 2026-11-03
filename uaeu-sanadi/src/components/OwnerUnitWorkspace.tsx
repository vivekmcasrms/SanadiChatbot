/**
 * Unit-scoped Service Owner surfaces: workspace selector, unit overview,
 * unit case list with routing transparency, and the unit's student chats.
 * Everything shown here is already filtered server-side to units the signed-in
 * owner is responsible for.
 */
import { useState } from "react";
import { toastError } from "@/lib/errors/toast";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Compass, MessagesSquare, Route as RouteIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MetricCard } from "@/components/MetricCard";
import { StatusChip } from "@/components/StatusChip";
import { InteractionTypeBadge } from "@/components/InteractionTypeBadge";
import { formatDate } from "@/lib/format-date";
import { CardListSkeleton } from "@/components/ListSkeleton";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import {
  getOwnerUnitInsightsFn,
  getOwnerUnitOverviewFn,
  getOwnerWorkspaceFn,
  reportMisroutingFn,
} from "@/lib/owner.functions";
import {
  listOwnerCasesFn,
  listOwnerChatsFn,
  type OwnerCaseRow,
} from "@/lib/lists/owner-lists.functions";
import { useListParams } from "@/lib/use-list-params";
import {
  FilterChips,
  ListEmpty,
  ListError,
  ListSearch,
  ListSelect,
  Pagination as ListPagination,
} from "@/components/list/ListControls";

export type Workspace = Awaited<ReturnType<typeof getOwnerWorkspaceFn>>;

/**
 * Owner data is only ever requested while a session exists. Without this gate a
 * sign-out (or an expired session) fires an authenticated server function with
 * no bearer token, which fails with "Unauthorized: No authorization header".
 */
function useSignedIn(enabled: boolean) {
  const { user } = useAuth();
  return enabled && Boolean(user);
}

export function useOwnerWorkspace(enabled: boolean) {
  return useQuery({
    queryKey: ["owner-workspace"],
    enabled: useSignedIn(enabled),
    retry: false,
    queryFn: () => getOwnerWorkspaceFn(),
  });
}

/** Workspace switcher — only rendered when the owner is responsible for several units. */
export function UnitSelector({
  workspace,
  unitId,
  onChange,
}: {
  workspace: Workspace | undefined;
  unitId: string | null;
  onChange: (id: string) => void;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const units = workspace?.units ?? [];
  if (units.length <= 1) {
    const only = units[0];
    return only ? (
      <Badge variant="secondary" className="gap-1.5 px-2.5 py-1 text-xs">
        <Compass className="size-3.5" aria-hidden />
        {ar ? only.nameAr : only.nameEn}
      </Badge>
    ) : null;
  }
  return (
    <Select value={unitId ?? units[0]!.id} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-[240px]" aria-label={ar ? "اختيار الوحدة" : "Select service unit"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {units.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {ar ? u.nameAr : u.nameEn}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function useOverview(enabled: boolean, unitId: string | null) {
  return useQuery({
    queryKey: ["owner-unit-overview", unitId ?? "all"],
    enabled: useSignedIn(enabled),
    retry: false,
    queryFn: () => getOwnerUnitOverviewFn({ data: { unitId } }),
  });
}

type UnitCase = Awaited<ReturnType<typeof getOwnerUnitOverviewFn>>["cases"][number];

function Group({ title, items, empty }: { title: string; items: UnitCase[]; empty: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="min-w-0 flex-1">{title}</span>
          <Badge variant={items.length ? "default" : "secondary"}>{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length ? (
          items.slice(0, 8).map((i) => <UnitCaseRow key={i.id} item={i} workspace={undefined} compact />)
        ) : (
          <p className="text-xs text-muted-foreground">{empty}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function OwnerUnitOverview({ enabled, unitId }: { enabled: boolean; unitId: string | null }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { data, isLoading } = useOverview(enabled, unitId);
  const c = data?.counts;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <MetricCard label={ar ? "حالات مفتوحة" : "Active cases"} value={c?.open ?? 0} />
        <MetricCard
          label={ar ? "يحتاج انتباهك" : "Need your attention"}
          value={c?.attention ?? 0}
          tone={(c?.attention ?? 0) > 0 ? "danger" : "success"}
        />
        <MetricCard label={ar ? "يديرها سندي" : "Handled by Sanadi"} value={c?.aiManaged ?? 0} />
        <MetricCard label={ar ? "بانتظار الطالب" : "Waiting on student"} value={c?.waitingStudent ?? 0} />
        <MetricCard
          label={ar ? "المدة في خطر" : "SLA at risk"}
          value={c?.atRisk ?? 0}
          tone={(c?.atRisk ?? 0) > 0 ? "warning" : "success"}
        />
        <MetricCard
          label={ar ? "تجاوز المدة" : "Breached"}
          value={c?.breached ?? 0}
          tone={(c?.breached ?? 0) > 0 ? "danger" : "success"}
        />
      </div>
      {isLoading ? <CardListSkeleton rows={3} /> : null}
      {!isLoading ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <Group
            title={ar ? "يحتاج انتباهك" : "Needs your attention"}
            items={data?.attention ?? []}
            empty={ar ? "لا شيء يحتاج قرارك الآن." : "Nothing needs your decision right now."}
          />
          <Group
            title={ar ? "سندي يعمل عليها الآن" : "Sanadi is handling now"}
            items={data?.aiManaged ?? []}
            empty={ar ? "لا توجد حالات تحت الإدارة الآلية." : "No cases under automatic handling."}
          />
          <Group
            title={ar ? "أحدث نشاط في وحدتك" : "Recent activity"}
            items={data?.recent ?? []}
            empty={ar ? "لا يوجد نشاط حديث." : "No recent activity."}
          />
          <Group
            title={ar ? "لمحة عن المدد" : "SLA snapshot"}
            items={(data?.cases ?? []).filter((i) => i.breached)}
            empty={ar ? "لا توجد حالات متجاوزة للمدة." : "No breached cases."}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Entry presets used by the console tabs, mapped onto the server query. */
type CasePreset = "all" | "attention" | "assigned" | "completed";

export function OwnerUnitCases({
  enabled,
  unitId,
  workspace,
  preset = "all",
  simple = false,
}: {
  enabled: boolean;
  unitId: string | null;
  workspace: Workspace | undefined;
  preset?: CasePreset;
  /** Lean Service Owner mode: plain statuses, no SLA or automation controls. */
  simple?: boolean;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const signedIn = useSignedIn(enabled);

  // Search, filters, sort and page live in the URL; the query itself runs
  // entirely in Postgres so a unit with thousands of cases still opens fast.
  const params = useListParams(
    {
      q: "",
      status: preset === "completed" ? "resolved" : "open",
      sla: "all",
      automation: "all",
      type: "all",
      sort: preset === "attention" ? "due" : "activity",
      pageSize: 25,
    },
    `oc_${preset}_`,
  );
  const { q, status, sla, automation, type, sort } = params.values;

  // The lean owner queues never apply a hidden handling filter: a case that is
  // open in this unit is either visible or it is not open. Counts and rows come
  // from one server query, so a chip count always matches what is listed.
  const effectiveAutomation = simple ? "all" : automation;
  const effectiveStatus = preset === "completed" ? (status === "open" ? "resolved" : status) : status;


  const query = useQuery({
    queryKey: [
      "owner-cases",
      unitId ?? "all",
      preset,
      q,
      effectiveStatus,
      sla,
      effectiveAutomation,
      type,
      sort,
      params.page,
      params.pageSize,
    ],
    enabled: signedIn,
    retry: false,
    placeholderData: (prev) => prev,
    queryFn: () =>
      listOwnerCasesFn({
        data: {
          unitId,
          search: q || undefined,
          status: effectiveStatus,
          sla: sla as "all" | "on_track" | "attention" | "critical" | "breached",
          automation: effectiveAutomation as "all" | "ai" | "human",
          type: type === "all" ? undefined : type,
          sort: sort as "activity" | "created" | "due" | "priority",
          page: params.page,
          pageSize: params.pageSize,
        },
      }),
  });

  const cases = query.data?.items ?? [];
  const counts = query.data?.counts;

  return (
    <div className="space-y-3">
      {simple ? (
        <p className="text-xs text-muted-foreground">
          {preset === "attention"
            ? ar
              ? "طلبات تحتاج قرارك أو إجراءً منك."
              : "Requests waiting on your decision or action."
            : preset === "completed"
              ? ar
                ? "الطلبات المكتملة مؤخراً للرجوع إليها."
                : "Recently completed requests, for reference."
                : ar
                  ? "الطلبات المسندة إلى وحدتك."
                  : "Requests assigned to your service."}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <ListSearch
          value={q}
          onChange={(next) => params.setFilter({ q: next })}
          placeholder={ar ? "ابحث برقم الحالة أو الموضوع" : "Search case number or subject"}
        />
        {simple ? null : (
          <>
            <ListSelect
              label={ar ? "مستوى الخدمة" : "SLA"}
              value={sla}
              onChange={(v) => params.setFilter({ sla: v })}
              options={[
                { key: "all", label: ar ? "كل الحالات" : "Any SLA" },
                { key: "breached", label: ar ? "متجاوزة" : "Breached" },
                { key: "critical", label: ar ? "حرجة (<4 ساعات)" : "Critical (<4h)" },
                { key: "attention", label: ar ? "تحتاج متابعة (<24 ساعة)" : "Due soon (<24h)" },
                { key: "on_track", label: ar ? "ضمن المدة" : "On track" },
              ]}
            />
            <ListSelect
              label={ar ? "الإدارة" : "Handling"}
              value={automation}
              onChange={(v) => params.setFilter({ automation: v })}
              width="w-[160px]"
              options={[
                { key: "all", label: ar ? "الكل" : "All handling" },
                { key: "ai", label: ar ? "يديرها سندي" : "AI managed" },
                { key: "human", label: ar ? "قرارك مطلوب" : "Needs your decision" },
              ]}
            />
          </>
        )}
        <ListSelect
          label={ar ? "النوع" : "Type"}
          value={type}
          onChange={(v) => params.setFilter({ type: v })}
          width="w-[150px]"
          options={
            simple
              ? [
                  { key: "all", label: ar ? "كل الأنواع" : "All types" },
                  { key: "complaint", label: ar ? "شكوى" : "Complaint" },
                  { key: "suggestion", label: ar ? "اقتراح" : "Suggestion" },
                  { key: "alert", label: ar ? "تنبيه" : "Alert" },
                  { key: "service_request", label: ar ? "طلب خدمة" : "Request" },
                ]
              : [
                  { key: "all", label: ar ? "كل الأنواع" : "All types" },
                  { key: "query", label: ar ? "استفسار" : "Query" },
                  { key: "complaint", label: ar ? "شكوى" : "Complaint" },
                  { key: "suggestion", label: ar ? "مقترح" : "Suggestion" },
                  { key: "service_request", label: ar ? "طلب خدمة" : "Service request" },
                  { key: "alert", label: ar ? "بلاغ" : "Alert" },
                ]
          }
        />
        {simple ? null : (
          <ListSelect
            label={ar ? "الترتيب" : "Sort"}
            value={sort}
            onChange={(v) => params.setFilter({ sort: v })}
            width="w-[170px]"
            options={[
              { key: "activity", label: ar ? "آخر نشاط" : "Latest activity" },
              { key: "due", label: ar ? "الأقرب استحقاقاً" : "Due soonest" },
              { key: "priority", label: ar ? "الأولوية" : "Priority" },
              { key: "created", label: ar ? "الأحدث إنشاءً" : "Newest" },
            ]}
          />
        )}
      </div>

      {preset === "completed" ? null : (
        <FilterChips
          ariaLabel={ar ? "تصفية الطلبات" : "Filter requests"}
          value={status}
          onChange={(v) => params.setFilter({ status: v })}
          options={
            simple
              ? [
                  { key: "open", label: ar ? "كل المفتوحة" : "All open", count: counts?.open ?? null },
                  { key: "submitted", label: ar ? "جديدة" : "New", count: counts?.newCount ?? null },
                  {
                    key: "in_progress",
                    label: ar ? "قيد التنفيذ" : "In progress",
                    count: counts?.inProgress ?? null,
                  },
                  {
                    key: "waiting_student",
                    label: ar ? "بانتظار الطالب" : "Waiting for student",
                    count: counts?.waitingStudent ?? null,
                  },
                ]
              : [
                  { key: "open", label: ar ? "مفتوحة" : "Open", count: counts?.open ?? null },
                  {
                    key: "waiting_student",
                    label: ar ? "بانتظار الطالب" : "Waiting for student",
                    count: counts?.waitingStudent ?? null,
                  },
                  { key: "escalated", label: ar ? "مصعّدة" : "Escalated" },
                  { key: "resolved", label: ar ? "تم حلها" : "Resolved", count: counts?.completed ?? null },
                  { key: "all", label: ar ? "كل الحالات" : "All" },
                ]
          }
        />
      )}


      {query.isLoading ? <CardListSkeleton rows={4} /> : null}
      {query.isError ? <ListError onRetry={() => void query.refetch()} /> : null}
      {cases.map((c) => (
        <UnitCaseRow key={c.id} item={c} workspace={workspace} readOnly={preset === "completed"} />
      ))}
      {!query.isLoading && !query.isError && cases.length === 0 ? <ListEmpty /> : null}

      <ListPagination
        page={params.page}
        pageSize={params.pageSize}
        pageCount={query.data?.pageCount ?? 1}
        total={query.data?.total ?? null}
        onPage={params.setPage}
        onPageSize={params.setPageSize}
        busy={query.isFetching}
      />
    </div>
  );
}


/** Unit-specific insights: volumes, automation, SLA and repeated root causes. */
export function OwnerUnitInsights({ enabled, unitId }: { enabled: boolean; unitId: string | null }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { data, isLoading } = useQuery({
    queryKey: ["owner-unit-insights", unitId ?? "all"],
    enabled: useSignedIn(enabled),
    retry: false,
    queryFn: () => getOwnerUnitInsightsFn({ data: { unitId } }),
  });

  if (isLoading) return <CardListSkeleton rows={3} />;

  const typeLabel = (t: string) =>
    ({
      query: ar ? "استفسارات" : "Queries",
      complaint: ar ? "شكاوى" : "Complaints",
      suggestion: ar ? "مقترحات" : "Suggestions",
      service_request: ar ? "طلبات خدمة" : "Service requests",
    })[t] ?? t;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {ar ? "آخر 30 يوماً — لوحدتك فقط." : "Last 30 days — your unit only."}
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label={ar ? "حجم الحالات" : "Case volume"} value={data?.totalCases ?? 0} />
        <MetricCard
          label={ar ? "نسبة الأتمتة" : "Automation rate"}
          value={data?.automationRate == null ? "—" : `${data.automationRate}%`}
        />
        <MetricCard
          label={ar ? "الالتزام بالمدد" : "SLA compliance"}
          value={data?.slaCompliance == null ? "—" : `${data.slaCompliance}%`}
        />
        <MetricCard
          label={ar ? "متوسط زمن الحل" : "Avg resolution"}
          value={data?.avgResolutionHours == null ? "—" : `${data.avgResolutionHours}${ar ? " س" : "h"}`}
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{ar ? "حسب النوع" : "By interaction type"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {(data?.byType ?? []).length ? (
              data!.byType.map((t) => (
                <p key={t.type} className="flex items-center justify-between">
                  <span>{typeLabel(t.type)}</span>
                  <span className="tabular-nums font-medium">{t.count}</span>
                </p>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">{ar ? "لا توجد بيانات." : "No data yet."}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{ar ? "أكثر المواضيع تكراراً" : "Top topics"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {(data?.topTopics ?? []).length ? (
              data!.topTopics.map((t) => (
                <p key={t.label} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{t.label.replace(/_/g, " ")}</span>
                  <span className="tabular-nums font-medium">{t.count}</span>
                </p>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">{ar ? "لا توجد بيانات." : "No data yet."}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{ar ? "الأسباب الجذرية المتكررة" : "Repeated root causes"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {(data?.topRootCauses ?? []).length ? (
              data!.topRootCauses.map((t) => (
                <p key={t.label} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{t.label.replace(/_/g, " ")}</span>
                  <span className="tabular-nums font-medium">{t.count}</span>
                </p>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">{ar ? "لا توجد بيانات." : "No data yet."}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function UnitCaseRow({
  item,
  workspace,
  compact = false,
  readOnly = false,
}: {
  item: UnitCase | OwnerCaseRow;
  workspace: Workspace | undefined;
  compact?: boolean;
  /** Completed work is reference-only: no routing or ownership actions. */
  readOnly?: boolean;
}) {

  const { lang } = useI18n();
  const ar = lang === "ar";
  const reason = ar ? item.routing_reason_ar : item.routing_reason_en;
  const studentName = "student_name" in item ? (item.student_name ?? null) : null;

  return (
    <Card>
      <CardContent className="space-y-2 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <InteractionTypeBadge type={item.case_type} />
          <span className="font-medium"><bdi dir="ltr">{item.case_number}</bdi></span>
          <Link to="/requests/$caseId" params={{ caseId: item.id }} className="min-w-0 flex-1 truncate hover:underline">
            {item.title}
          </Link>
          <StatusChip status={item.status} />
          {item.urgency === "critical" || item.urgency === "high" ? (
            <Badge variant={item.urgency === "critical" ? "destructive" : "outline"}>
              {item.urgency === "critical" ? (ar ? "حرجة" : "Critical") : ar ? "مرتفعة" : "High"}
            </Badge>
          ) : null}
          {item.needsAttention ? (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="size-3" aria-hidden />
              {ar ? "قرارك مطلوب" : "Your decision"}
            </Badge>
          ) : null}
          {item.breached ? <Badge variant="outline">{ar ? "تجاوز المدة" : "Overdue"}</Badge> : null}
        </div>

        <p className="text-xs text-muted-foreground">
          {studentName ? `${studentName} · ` : ""}
          {formatDate(item.created_at, lang)}
        </p>

        {reason ? (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <RouteIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {reason}
              {item.lowConfidenceRouting ? (
                <span className="ms-1 font-medium text-amber-600 dark:text-amber-400">
                  {ar ? "· تحقق من التوجيه" : "· verify routing"}
                </span>
              ) : null}
            </span>
          </p>
        ) : null}

        {compact ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/requests/$caseId" params={{ caseId: item.id }}>
                {ar ? "عرض" : "View"}
              </Link>
            </Button>
            {readOnly ? null : <MisroutingDialog caseItem={item} workspace={workspace} />}
          </div>
        )}

      </CardContent>
    </Card>
  );
}

/** "This is not my service" — records the signal and hands the case over. */
function MisroutingDialog({ caseItem, workspace }: { caseItem: UnitCase | OwnerCaseRow; workspace: Workspace | undefined }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState<string>("");

  const mutation = useMutation({
    mutationFn: () =>
      reportMisroutingFn({
        data: { caseId: caseItem.id, correctedUnitId: target || null, reason },
      }),
    onSuccess: (res) => {
      toast.success(
        res.reassigned
          ? ar
            ? "تم تحويل الحالة إلى الوحدة الصحيحة"
            : "Case handed over to the correct unit"
          : ar
            ? "تم تسجيل ملاحظة التوجيه"
            : "Routing feedback recorded",
      );
      setOpen(false);
      setReason("");
      void qc.invalidateQueries({ queryKey: ["owner-unit-overview"] });
    },
    onError: (e: Error) => toastError(e, lang),
  });

  const others = (workspace?.units ?? []).filter((u) => u.id !== caseItem.service_unit_id);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {ar ? "ليست خدمتي" : "Not my service"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ar ? "الإبلاغ عن توجيه خاطئ" : "Report incorrect routing"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {ar
              ? "ملاحظتك تُحسّن قواعد التوجيه، ولن يفقد الطالب متابعته."
              : "Your feedback improves the routing rules, and the student never loses continuity."}
          </p>
          {others.length ? (
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger aria-label={ar ? "الوحدة الصحيحة" : "Correct unit"}>
                <SelectValue placeholder={ar ? "الوحدة الصحيحة (اختياري)" : "Correct unit (optional)"} />
              </SelectTrigger>
              <SelectContent>
                {others.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {ar ? u.nameAr : u.nameEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={ar ? "لماذا لا تخص هذه الحالة وحدتك؟" : "Why does this case not belong to your unit?"}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button disabled={reason.trim().length < 5 || mutation.isPending} onClick={() => mutation.mutate()}>
            {ar ? "إرسال" : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OwnerUnitChats({ enabled, unitId }: { enabled: boolean; unitId: string | null }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const params = useListParams({ q: "", filter: "all", pageSize: 20 }, "och_");
  const { q, filter } = params.values;

  const query = useQuery({
    queryKey: ["owner-unit-chats", unitId ?? "all", q, filter, params.page, params.pageSize],
    enabled: useSignedIn(enabled),
    retry: false,
    placeholderData: (prev) => prev,
    queryFn: () =>
      listOwnerChatsFn({
        data: {
          unitId,
          search: q || undefined,
          filter: filter as "all" | "attention" | "escalated" | "linked",
          page: params.page,
          pageSize: params.pageSize,
        },
      }),
  });

  const chats = query.data?.items ?? [];

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {ar
          ? "محادثات الطلبة المرتبطة بحالات وحدتك فقط."
          : "Student conversations attached to your unit's cases only."}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <ListSearch
          value={q}
          onChange={(next) => params.setFilter({ q: next })}
          placeholder={ar ? "ابحث في المحادثات" : "Search conversations"}
        />
        <ListSelect
          label={ar ? "التصفية" : "Filter"}
          value={filter}
          onChange={(v) => params.setFilter({ filter: v })}
          options={[
            { key: "all", label: ar ? "كل المحادثات" : "All conversations" },
            { key: "attention", label: ar ? "بانتظار الطالب" : "Waiting for student" },
            { key: "escalated", label: ar ? "مصعّدة" : "Escalated cases" },
          ]}
        />
      </div>

      {query.isLoading ? <CardListSkeleton rows={3} /> : null}
      {query.isError ? <ListError onRetry={() => void query.refetch()} /> : null}
      {chats.map((cv) => (
        <Card key={cv.id}>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              <MessagesSquare className="size-4 text-primary" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{cv.title ?? (ar ? "محادثة" : "Conversation")}</span>
              {cv.caseNumber ? <Badge variant="secondary">{cv.caseNumber}</Badge> : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xs text-muted-foreground">
            {cv.caseTitle ? <p className="truncate">{cv.caseTitle}</p> : null}
            {cv.caseId ? (
              <Link to="/requests/$caseId" params={{ caseId: cv.caseId }} className="text-primary hover:underline">
                {ar ? "فتح الحالة" : "Open case"}
              </Link>
            ) : null}
          </CardContent>
        </Card>
      ))}
      {!query.isLoading && !query.isError && chats.length === 0 ? (
        <ListEmpty
          title={ar ? "لا توجد محادثات مطابقة." : "No matching conversations."}
        />
      ) : null}

      <ListPagination
        page={params.page}
        pageSize={params.pageSize}
        pageCount={query.data?.pageCount ?? 1}
        total={query.data?.total ?? null}
        onPage={params.setPage}
        onPageSize={params.setPageSize}
        busy={query.isFetching}
      />
    </div>
  );
}
