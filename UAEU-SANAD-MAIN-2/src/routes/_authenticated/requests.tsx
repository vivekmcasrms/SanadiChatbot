import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CardListSkeleton } from "@/components/ListSkeleton";
import { formatDateWithContext } from "@/lib/format-date";
import { CalendarClock } from "lucide-react";
import { MEETING_MODE_LABEL, formatMeetingWhen } from "@/components/CaseMeetingCard";
import { StatusChip, UrgencyChip } from "@/components/StatusChip";
import { MetricCard } from "@/components/MetricCard";
import { useStudentMetrics, formatDuration } from "@/lib/metrics";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Checkbox } from "@/components/ui/checkbox";
import { deleteAllMyChats, deleteMyChat, listMyChatsPagedFn } from "@/lib/chat-history.functions";
import { removeMyRequests, removeMySuggestions } from "@/lib/my-requests.functions";
import { listMyCasesFn, listMySuggestionsFn } from "@/lib/lists/student-lists.functions";
import { useListParams } from "@/lib/use-list-params";
import {
  ListEmpty,
  ListError,
  ListSearch,
  ListSelect,
  Pagination as ListPagination,
} from "@/components/list/ListControls";

export const Route = createFileRoute("/_authenticated/requests")({
  // List state (tab, search, filters, sort, page) is URL-backed so views stay
  // linkable and survive navigating into a case and back.
  validateSearch: (search: Record<string, unknown>) => search,
  head: () => ({
    meta: [
      { title: "My Requests — Sanadi | UAEU" },
      {
        name: "description",
        content: "Track your university complaints, suggestions and service requests from submission to resolution.",
      },
      { property: "og:title", content: "My Requests — Sanadi | UAEU" },
      { property: "og:description", content: "Follow the status of every case you submitted." },
    ],
  }),
  component: RequestsLayout,
});

function RequestsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname !== "/requests") return <Outlet />;
  return <RequestsList />;
}


/** Suggestions inside an active review/implementation workflow stay visible. */
const REMOVABLE_SUGGESTION_STATUS = ["draft", "submitted", "implemented", "closed", "not_proceeding"];

type RemovalKind = "case" | "suggestion" | "selected_cases" | "selected_suggestions" | "all_resolved" | "all_suggestions";

type PendingRemoval = { kind: RemovalKind; ids?: string[]; count?: number };

function ConfirmRemoveDialog({
  pending,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: PendingRemoval | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t, lang } = useI18n();
  if (!pending) return null;
  const ar = lang === "ar";
  const count = pending.count ?? pending.ids?.length ?? 0;

  const copy: Record<RemovalKind, { title: string; desc: string }> = {
    case: { title: t("remove_resolved_q"), desc: t("remove_resolved_desc") },
    suggestion: { title: t("remove_suggestion_q"), desc: t("remove_suggestion_desc") },
    selected_cases: {
      title: t("remove_selected_q"),
      desc: ar
        ? `أنت على وشك إزالة ${count} من الطلبات من صفحة طلباتي.`
        : `You are about to remove ${count} request${count === 1 ? "" : "s"} from My Requests.`,
    },
    selected_suggestions: {
      title: t("remove_selected_q"),
      desc: ar
        ? `أنت على وشك إزالة ${count} من الاقتراحات من صفحة طلباتي.`
        : `You are about to remove ${count} suggestion${count === 1 ? "" : "s"} from My Requests.`,
    },
    all_resolved: { title: t("remove_all_resolved_q"), desc: t("remove_all_resolved_desc") },
    all_suggestions: { title: t("remove_all_suggestions_q"), desc: t("remove_all_suggestions_desc") },
  };

  const confirmLabel =
    count > 1
      ? ar
        ? `إزالة ${count}`
        : `Remove ${count}`
      : t("remove");

  return (
    <AlertDialog open onOpenChange={(open) => (!open ? onCancel() : undefined)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy[pending.kind].title}</AlertDialogTitle>
          <AlertDialogDescription>{copy[pending.kind].desc}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("cancel")}</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {busy ? t("loading") : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RemoveIconButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
    >
      <Trash2 className="size-4" aria-hidden />
    </button>
  );
}

function RequestsList() {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const metricsQuery = useStudentMetrics(user?.id);
  const m = metricsQuery.data;

  const [selectMode, setSelectMode] = useState(false);
  const [selectedCases, setSelectedCases] = useState<string[]>([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingRemoval | null>(null);
  const [busy, setBusy] = useState(false);

  // Search, filters, sort and page all live in the URL, so returning from
  // a case detail restores exactly where the student was. Requests are one
  // list refined by Type/Status filters — there are no per-type/per-status
  // tabs. The only remaining tab switch is Requests vs Chat history.
  const params = useListParams(
    { tab: "requests", q: "", type: "all", status: "all", sort: "recent", range: "any", pageSize: 20 },
    "",
  );
  const { tab, q, type, status, sort, range } = params.values;
  const showChats = tab === "chats";
  const showSuggestions = !showChats && type === "suggestion";

  // Suggestions live in their own workflow, so the plain-language status
  // filter maps to the closest suggestion status.
  const SUGGESTION_STATUS: Record<string, string> = {
    new: "submitted",
    assigned: "assigned",
    in_progress: "planned",
    in_review: "under_review",
    waiting_student: "awaiting_student",
    resolved: "implemented",
    closed: "closed",
  };

  const casesQuery = useQuery({
    staleTime: 0,
    refetchOnMount: "always",
    queryKey: ["cases", "mine", user?.id, q, type, status, sort, range, params.page, params.pageSize],
    enabled: Boolean(user?.id) && !showChats && !showSuggestions,
    placeholderData: (prev) => prev,
    queryFn: () =>
      listMyCasesFn({
        data: {
          tab: "all",
          search: q || undefined,
          type: type === "all" ? undefined : type,
          status: status === "all" ? undefined : status,
          sort: sort as "recent" | "oldest" | "activity",
          range,
          page: params.page,
          pageSize: params.pageSize,
        },
      }),
  });

  const suggestionsQuery = useQuery({
    staleTime: 0,
    refetchOnMount: "always",
    queryKey: ["suggestions", "mine", user?.id, q, status, sort, params.page, params.pageSize],
    enabled: Boolean(user?.id) && showSuggestions,
    placeholderData: (prev) => prev,
    queryFn: () =>
      listMySuggestionsFn({
        data: {
          search: q || undefined,
          status: status === "all" ? undefined : (SUGGESTION_STATUS[status] ?? status),
          sort: sort === "oldest" ? "oldest" : "recent",
          page: params.page,
          pageSize: params.pageSize,
        },
      }),
  });

  const caseItems = casesQuery.data?.items ?? [];
  const suggestions = suggestionsQuery.data?.items ?? [];
  const removableSuggestions = suggestions.filter((s) =>
    REMOVABLE_SUGGESTION_STATUS.includes(s.status),
  );

  /**
   * Search + Type/Status/Period/Sort filters shared by the requests list.
   * Kept as an element, not a nested component: a nested component function is
   * a new element type on every render, which remounts the search input and
   * steals focus mid-typing.
   */
  const listControls = (
      <div className="flex flex-wrap items-center gap-2">
        <ListSearch
          value={q}
          onChange={(next) => params.setFilter({ q: next })}
          placeholder={ar ? "ابحث برقم الطلب أو الموضوع" : "Search by number or subject"}
        />
        <ListSelect
          label={ar ? "النوع" : "Type"}
          value={type}
          onChange={(v) => params.setFilter({ type: v })}
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
          label={ar ? "الحالة" : "Status"}
          value={status}
          onChange={(v) => params.setFilter({ status: v })}
          width="w-[170px]"
          options={[
            { key: "all", label: ar ? "كل الحالات" : "All statuses" },
            { key: "new", label: ar ? "جديد" : "New" },
            { key: "assigned", label: ar ? "مُسند" : "Assigned" },
            { key: "in_progress", label: ar ? "قيد المعالجة" : "In progress" },
            { key: "in_review", label: ar ? "قيد المراجعة" : "In review" },
            { key: "waiting_student", label: ar ? "بانتظار ردك" : "Waiting for you" },
            { key: "resolved", label: ar ? "تم حلها" : "Resolved" },
            { key: "closed", label: ar ? "مغلق" : "Closed" },
          ]}
        />
        <ListSelect
          label={ar ? "الفترة" : "Period"}
          value={range}
          onChange={(v) => params.setFilter({ range: v })}
          width="w-[150px]"
          options={[
            { key: "any", label: ar ? "كل الفترات" : "All time" },
            { key: "today", label: ar ? "اليوم" : "Today" },
            { key: "7d", label: ar ? "آخر 7 أيام" : "Last 7 days" },
            { key: "30d", label: ar ? "آخر 30 يوماً" : "Last 30 days" },
          ]}
        />
        <ListSelect
          label={ar ? "الترتيب" : "Sort"}
          value={sort}
          onChange={(v) => params.setFilter({ sort: v })}
          width="w-[160px]"
          options={[
            { key: "recent", label: ar ? "الأحدث أولاً" : "Newest first" },
            { key: "activity", label: ar ? "آخر نشاط" : "Latest activity" },
            { key: "oldest", label: ar ? "الأقدم أولاً" : "Oldest first" },
          ]}
        />
      </div>
  );


  function toggle(list: string[], id: string) {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  function reportResult(result: { removed: number; skipped: number }) {
    if (result.removed === 0 && result.skipped === 0) {
      toast.info(t("nothing_eligible"));
      return;
    }
    const removedMsg =
      result.removed === 1
        ? t("request_removed")
        : ar
          ? `تمت إزالة ${result.removed} من الطلبات.`
          : `${result.removed} requests removed.`;
    const skippedMsg = result.skipped
      ? ar
        ? ` تعذّرت إزالة ${result.skipped} لتغيّر حالتها.`
        : ` ${result.skipped} could not be removed because their status changed.`
      : "";
    if (result.removed === 0) toast.warning(skippedMsg.trim());
    else if (result.skipped) toast.warning(`${removedMsg}${skippedMsg}`);
    else toast.success(removedMsg);
  }

  async function runRemoval() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const result =
        pending.kind === "case" || pending.kind === "selected_cases"
          ? await removeMyRequests({ data: { scope: "selected", ids: pending.ids ?? [] } })
          : pending.kind === "all_resolved"
            ? await removeMyRequests({ data: { scope: "all_resolved" } })
            : pending.kind === "all_suggestions"
              ? await removeMySuggestions({ data: { scope: "all_suggestions" } })
              : await removeMySuggestions({ data: { scope: "selected", ids: pending.ids ?? [] } });
      reportResult(result);
      setSelectedCases([]);
      setSelectedSuggestions([]);
      setPending(null);
      // Refresh lists, counts and any sidebar badges from server state.
      await queryClient.invalidateQueries();
    } catch {
      toast.error(t("error_generic"));
      await queryClient.invalidateQueries();
    } finally {
      setBusy(false);
    }
  }

  function BulkBar({
    eligibleIds,
    selected,
    setSelected,
    allKind,
    selectedKind,
    allLabel,
  }: {
    eligibleIds: string[];
    selected: string[];
    setSelected: (ids: string[]) => void;
    allKind: RemovalKind;
    selectedKind: RemovalKind;
    allLabel: string;
  }) {
    if (!eligibleIds.length) return null;
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-surface p-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setSelectMode(!selectMode);
            setSelected([]);
          }}
        >
          {selectMode ? t("done_selecting") : t("select_items")}
        </Button>
        {selectMode ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(selected.length === eligibleIds.length ? [] : eligibleIds)}
            >
              {t("select_all_eligible")}
            </Button>
            <span className="text-xs text-muted-foreground">
              {ar ? `${selected.length} محدد` : `${selected.length} selected`}
            </span>
            <Button
              size="sm"
              variant="destructive"
              disabled={!selected.length}
              onClick={() => setPending({ kind: selectedKind, ids: selected })}
            >
              {t("remove_selected")}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="ms-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setPending({ kind: allKind, count: eligibleIds.length })}
          >
            <Trash2 className="me-1.5 size-4" aria-hidden />
            {allLabel}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("my_requests")}</h1>
        <div className="flex gap-2">
          <Button asChild size="sm">
            <Link to="/submit/$type" params={{ type: "complaint" }}>
              {t("new_complaint")}
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/submit/$type" params={{ type: "suggestion" }}>
              {t("new_suggestion")}
            </Link>
          </Button>
        </div>
      </div>

      {casesQuery.isError || suggestionsQuery.isError ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {t("error_generic")}
        </p>
      ) : null}

      <section aria-label={ar ? "ملخص طلباتي" : "My request summary"} className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard label={ar ? "مفتوحة" : "Open"} value={metricsQuery.isLoading ? "…" : (m?.openCases ?? 0)} />
        <MetricCard
          label={ar ? "بانتظار ردك" : "Awaiting you"}
          value={metricsQuery.isLoading ? "…" : (m?.awaitingStudent ?? 0)}
          tone={(m?.awaitingStudent ?? 0) > 0 ? "warning" : "default"}
        />
        <MetricCard
          label={ar ? "تم حلها" : "Resolved"}
          value={metricsQuery.isLoading ? "…" : (m?.resolvedCases ?? 0)}
          tone="success"
        />
        <MetricCard label={ar ? "اقتراحاتي" : "Suggestions"} value={metricsQuery.isLoading ? "…" : (m?.suggestions ?? 0)} />
        <MetricCard
          label={ar ? "تنبيهات غير مقروءة" : "Unread alerts"}
          value={metricsQuery.isLoading ? "…" : (m?.unreadAlerts ?? 0)}
          hint={ar ? `متوسط زمن الحل ${formatDuration(m?.avgResolutionHours ?? null)}` : `Avg resolution ${formatDuration(m?.avgResolutionHours ?? null)}`}
        />
      </section>

      <Tabs
        value={showChats ? "chats" : "requests"}
        onValueChange={(next) => {
          setSelectMode(false);
          setSelectedCases([]);
          setSelectedSuggestions([]);
          params.setFilter({ tab: next, q: "" });
        }}
      >
        <TabsList>
          <TabsTrigger value="requests">{ar ? "الطلبات" : "Requests"}</TabsTrigger>
          <TabsTrigger value="chats">{t("chat_history")}</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="mt-4 space-y-3">
          {listControls}
          {!showSuggestions ? (
            <>
          {casesQuery.isLoading ? (
            <CardListSkeleton rows={3} />
          ) : casesQuery.isError ? (
            <ListError onRetry={() => void casesQuery.refetch()} />
          ) : caseItems.length ? (
            <>
              {status === "resolved" || status === "closed" ? (
                <BulkBar
                  eligibleIds={caseItems.filter((c) => c.removable).map((c) => c.id)}
                  selected={selectedCases}
                  setSelected={setSelectedCases}
                  allKind="all_resolved"
                  selectedKind="selected_cases"
                  allLabel={t("remove_all_resolved")}
                />
              ) : null}
              {caseItems.map((c) => (
                <div key={c.id} className="flex items-start gap-2 rounded-xl border bg-card p-4 card-shadow transition-colors hover:border-primary/40">
                  {selectMode && c.removable ? (
                    <Checkbox
                      checked={selectedCases.includes(c.id)}
                      onCheckedChange={() => setSelectedCases(toggle(selectedCases, c.id))}
                      aria-label={c.case_number}
                    />
                  ) : null}
                  <Link to="/requests/$caseId" params={{ caseId: c.id }} className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{c.case_number}</span>
                      <StatusChip status={c.status} />
                      <UrgencyChip urgency={c.urgency} />
                      <span className="ms-auto text-xs text-muted-foreground">
                        {formatDateWithContext(c.created_at, lang)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm">{c.title}</p>
                    {c.meeting_at ? (
                      <p className="mt-2 inline-flex flex-wrap items-center gap-1 rounded-lg bg-surface px-2 py-1 text-xs text-muted-foreground">
                        <CalendarClock className="size-3.5 text-primary" aria-hidden />
                        {ar ? "اللقاء" : "Meeting"}: {formatMeetingWhen(c.meeting_at, lang)}
                        {c.meeting_mode
                          ? ` · ${ar ? (MEETING_MODE_LABEL[c.meeting_mode]?.ar ?? "") : (MEETING_MODE_LABEL[c.meeting_mode]?.en ?? "")}`
                          : ""}
                        {c.meeting_location ? ` · ${c.meeting_location}` : ""}
                      </p>
                    ) : null}
                  </Link>
                  {!selectMode && c.removable ? (
                    <RemoveIconButton
                      label={t("remove_from_my_requests")}
                      onClick={() => setPending({ kind: "case", ids: [c.id] })}
                    />
                  ) : null}
                </div>
              ))}
            </>
          ) : q || type !== "all" || status !== "all" || range !== "any" ? (
            <ListEmpty />
          ) : (
            <EmptyRequests />
          )}
          <ListPagination
            page={params.page}
            pageSize={params.pageSize}
            pageCount={casesQuery.data?.pageCount ?? 1}
            total={casesQuery.data?.total ?? null}
            onPage={params.setPage}
            onPageSize={params.setPageSize}
            busy={casesQuery.isFetching}
          />
            </>
          ) : null}

          {showSuggestions ? (
            <>
          {suggestionsQuery.isLoading ? (
            <CardListSkeleton rows={2} />
          ) : suggestionsQuery.isError ? (
            <ListError onRetry={() => void suggestionsQuery.refetch()} />
          ) : suggestions.length ? (
            <>
              <BulkBar
                eligibleIds={removableSuggestions.map((s) => s.id)}
                selected={selectedSuggestions}
                setSelected={setSelectedSuggestions}
                allKind="all_suggestions"
                selectedKind="selected_suggestions"
                allLabel={t("remove_all_suggestions")}
              />
              {suggestions.map((s) => {
                const eligible = REMOVABLE_SUGGESTION_STATUS.includes(s.status);
                return (
                  <div key={s.id} className="rounded-xl border bg-card p-4 card-shadow">
                    <div className="flex flex-wrap items-center gap-2">
                      {selectMode && eligible ? (
                        <Checkbox
                          checked={selectedSuggestions.includes(s.id)}
                          onCheckedChange={() =>
                            setSelectedSuggestions(toggle(selectedSuggestions, s.id))
                          }
                          aria-label={s.title}
                        />
                      ) : null}
                      <span className="text-sm font-semibold">{s.reference_number}</span>
                      <StatusChip status={s.status} />
                      <span className="ms-auto text-xs text-muted-foreground">
                        {formatDateWithContext(s.created_at, lang)}
                      </span>
                      {!selectMode && eligible ? (
                        <RemoveIconButton
                          label={t("remove_from_my_requests")}
                          onClick={() => setPending({ kind: "suggestion", ids: [s.id] })}
                        />
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm">{s.title}</p>
                    {(() => {
                      const text =
                        (ar ? s.latestUpdateAr : s.latestUpdateEn) ?? s.outcome_summary;
                      return text ? (
                        <p className="mt-2 rounded-lg bg-surface p-2 text-xs text-muted-foreground">{text}</p>
                      ) : null;
                    })()}
                    {s.implementation_target_date ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {ar ? "تاريخ التنفيذ المستهدف" : "Target implementation"}:{" "}
                        {new Date(s.implementation_target_date).toLocaleDateString()}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </>
          ) : q ? (
            <ListEmpty />
          ) : (
            <EmptyRequests />
          )}
          <ListPagination
            page={params.page}
            pageSize={params.pageSize}
            pageCount={suggestionsQuery.data?.pageCount ?? 1}
            total={suggestionsQuery.data?.total ?? null}
            onPage={params.setPage}
            onPageSize={params.setPageSize}
            busy={suggestionsQuery.isFetching}
          />
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="chats" className="mt-4 space-y-3">
          <ChatsTab />
        </TabsContent>
      </Tabs>


      <ConfirmRemoveDialog
        pending={pending}
        busy={busy}
        onCancel={() => (busy ? undefined : setPending(null))}
        onConfirm={() => void runRemoval()}
      />
    </div>
  );
}

function EmptyRequests() {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      <p className="text-sm font-medium">{t("no_requests_title")}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t("no_requests_desc")}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button asChild size="sm">
          <Link to="/assistant">{t("ask_sanadi")}</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to="/submit/$type" params={{ type: "complaint" }}>
            {t("new_complaint")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
function ChatsTab() {
  const { t } = useI18n();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const { lang } = useI18n();
  const ar = lang === "ar";
  const params = useListParams({ chatq: "", chatfilter: "all", pageSize: 20 }, "c_");
  const { chatq, chatfilter } = params.values;

  const chatsQuery = useQuery({
    staleTime: 0,
    refetchOnMount: "always",
    queryKey: ["my-chats", user?.id, chatq, chatfilter, params.page, params.pageSize],
    enabled: Boolean(user?.id),
    placeholderData: (prev) => prev,
    queryFn: () =>
      listMyChatsPagedFn({
        data: {
          ...(chatq ? { search: chatq } : {}),
          filter: chatfilter as "all" | "linked" | "unlinked",
          page: params.page,
          pageSize: params.pageSize,
        },
      }),
  });

  async function removeChat(id: string) {
    if (!window.confirm(t("delete_chat_confirm"))) return;
    try {
      await deleteMyChat({ data: { conversationId: id } });
      await chatsQuery.refetch();
      toast.success(t("chat_deleted"));
    } catch {
      toast.error(t("error_generic"));
    }
  }

  async function removeAllChats() {
    if (deletingAll) return;
    setDeletingAll(true);
    try {
      await deleteAllMyChats();
      await queryClient.invalidateQueries({ queryKey: ["my-chats"] });
      await chatsQuery.refetch();
      setConfirmAllOpen(false);
      toast.success(t("all_chats_deleted"));
    } catch {
      // Never fake success: refresh from authoritative server state.
      await chatsQuery.refetch();
      toast.error(t("error_generic"));
    } finally {
      setDeletingAll(false);
    }
  }

  const chats = chatsQuery.data?.items ?? [];
  const hasChats = chats.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button asChild size="sm" variant="outline">
          <Link to="/assistant">{t("new_chat")}</Link>
        </Button>
        <AlertDialog open={confirmAllOpen} onOpenChange={setConfirmAllOpen}>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              disabled={!hasChats || deletingAll}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="me-1.5 size-4" aria-hidden />
              {t("delete_all_chats")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("delete_all_chats_q")}</AlertDialogTitle>
              <AlertDialogDescription>{t("delete_all_chats_desc")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletingAll}>{t("cancel")}</AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={deletingAll}
                onClick={(e) => {
                  e.preventDefault();
                  void removeAllChats();
                }}
              >
                {deletingAll ? t("deleting") : t("delete_all_chats")}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ListSearch
          value={chatq}
          onChange={(next) => params.setFilter({ chatq: next })}
          placeholder={ar ? "ابحث في المحادثات" : "Search chats"}
        />
        <ListSelect
          label={ar ? "التصفية" : "Filter"}
          value={chatfilter}
          onChange={(v) => params.setFilter({ chatfilter: v })}
          options={[
            { key: "all", label: ar ? "كل المحادثات" : "All chats" },
            { key: "linked", label: ar ? "مرتبطة بطلب" : "Linked to a request" },
            { key: "unlinked", label: ar ? "غير مرتبطة" : "Not linked" },
          ]}
        />
      </div>

      {chatsQuery.isLoading ? (
        <CardListSkeleton rows={3} lines={1} />
      ) : chatsQuery.isError ? (
        <ListError onRetry={() => void chatsQuery.refetch()} />
      ) : !hasChats && chatq ? (
        <ListEmpty />
      ) : !hasChats ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm font-medium">{t("no_chats_title")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("no_chats_desc")}</p>
          <Button asChild size="sm" className="mt-4">
            <Link to="/assistant">{t("start_new_chat")}</Link>
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {chats.map((chat) => (
            <li
              key={chat.id}
              className="flex items-center gap-2 rounded-xl border bg-card p-3 card-shadow"
            >
              <Link
                to="/assistant"
                search={{ chat: chat.id }}
                className="min-w-0 flex-1 truncate text-sm hover:text-primary"
              >
                {chat.title || t("untitled_chat")}
              </Link>
              <span className="shrink-0 text-xs text-muted-foreground">
                {new Date(chat.updatedAt).toLocaleDateString()}
              </span>
              <button
                type="button"
                aria-label={t("delete_chat")}
                title={t("delete_chat")}
                onClick={() => void removeChat(chat.id)}
                className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ListPagination
        page={params.page}
        pageSize={params.pageSize}
        pageCount={chatsQuery.data?.pageCount ?? 1}
        total={chatsQuery.data?.total ?? null}
        onPage={params.setPage}
        onPageSize={params.setPageSize}
        busy={chatsQuery.isFetching}
      />
    </div>
  );
}
