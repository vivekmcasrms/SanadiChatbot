import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toastError } from "@/lib/errors/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardListSkeleton } from "@/components/ListSkeleton";
import { UrgencyChip } from "@/components/StatusChip";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { pick, useI18n } from "@/lib/i18n";
import { refreshMyProactiveAlerts } from "@/lib/proactive.functions";
import { listMyAlertsFn } from "@/lib/lists/student-lists.functions";
import { useListParams } from "@/lib/use-list-params";
import {
  FilterChips,
  ListEmpty,
  ListError,
  ListSearch,
  Pagination as ListPagination,
} from "@/components/list/ListControls";

export const Route = createFileRoute("/_authenticated/alerts")({
  head: () => ({
    meta: [
      { title: "Alerts — Sanadi | UAEU" },
      {
        name: "description",
        content: "Personalised university deadlines, reminders and recommended actions.",
      },
      { property: "og:title", content: "Alerts — Sanadi | UAEU" },
      { property: "og:description", content: "Deadlines and reminders tailored to you." },
    ],
  }),
  // Search, filter and page live in the URL so an alert view stays linkable.
  validateSearch: (search: Record<string, unknown>) => search,
  component: AlertsPage,
});

function AlertsPage() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const params = useListParams({ q: "", filter: "all", pageSize: 20 }, "a_");
  const { q, filter } = params.values;

  const alertsQuery = useQuery({
    queryKey: ["student-alerts", user?.id, q, filter, params.page, params.pageSize],
    enabled: Boolean(user?.id),
    placeholderData: (prev) => prev,
    queryFn: async () => {
      // Sanadi checks the student's live records first, so the list already
      // reflects anything that changed since they last looked. Only the first
      // page pays for the refresh.
      if (params.page === 1) await refreshMyProactiveAlerts().catch(() => undefined);
      return listMyAlertsFn({
        data: {
          search: q || undefined,
          filter: filter as "all" | "unread" | "critical",
          page: params.page,
          pageSize: params.pageSize,
        },
      });
    },
  });

  const alerts = alertsQuery.data?.items ?? [];

  const prefsQuery = useQuery({
    queryKey: ["notification-prefs", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("in_app, email, sms, push, quiet_hours_start, quiet_hours_end")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  async function markRead(id: string) {
    const { error } = await supabase
      .from("student_alerts")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toastError(error, lang);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["student-alerts", user?.id] });
  }

  async function updatePref(patch: Record<string, unknown>) {
    if (!user) return;
    const { error } = await supabase
      .from("notification_preferences")
      .upsert({ user_id: user.id, ...patch }, { onConflict: "user_id" });
    if (error) {
      toastError(error, lang);
      return;
    }
    toast.success(t("saved"));
    void queryClient.invalidateQueries({ queryKey: ["notification-prefs", user.id] });
  }

  const prefs = prefsQuery.data;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">{t("alerts_title")}</h1>
          <p className="text-sm text-muted-foreground">{t("alerts_sub")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ListSearch
            value={q}
            onChange={(next) => params.setFilter({ q: next })}
            placeholder={lang === "ar" ? "ابحث في التنبيهات" : "Search alerts"}
          />
          <FilterChips
            ariaLabel={lang === "ar" ? "تصفية التنبيهات" : "Filter alerts"}
            value={filter}
            onChange={(v) => params.setFilter({ filter: v })}
            options={[
              { key: "all", label: lang === "ar" ? "الكل" : "All" },
              { key: "unread", label: t("unread") },
              { key: "critical", label: lang === "ar" ? "عاجلة" : "Urgent" },
            ]}
          />
        </div>

        {alertsQuery.isLoading ? (
          <CardListSkeleton rows={3} />
        ) : alertsQuery.isError ? (
          <ListError onRetry={() => void alertsQuery.refetch()} />
        ) : alerts.length ? (
          alerts.map((alert) => (
            <article key={alert.id} className="rounded-xl border bg-card p-5 card-shadow">
              <div className="flex flex-wrap items-center gap-2">
                <BellRing className="size-4 text-primary" aria-hidden />
                <h2 className="text-sm font-semibold">{pick(alert, "title", lang)}</h2>
                <UrgencyChip urgency={alert.severity} />
                <span className="ms-auto text-xs text-muted-foreground">
                  {alert.is_read ? t("read") : t("unread")}
                </span>
              </div>
              <p className="mt-2 text-sm">{pick(alert, "body", lang)}</p>
              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                {alert.deadline ? (
                  <p className="flex items-center gap-1">
                    <CalendarClock className="size-3.5" aria-hidden />
                    {t("deadline")}: {new Date(alert.deadline).toLocaleDateString()}
                  </p>
                ) : null}
                {alert.unit_en || alert.unit_ar ? (
                  <p>
                    <span className="font-medium">{t("source")}: </span>
                    {lang === "ar" ? alert.unit_ar : alert.unit_en}
                  </p>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {alert.action_url ? (
                  <Button size="sm" onClick={() => navigate({ to: alert.action_url! })}>
                    {t("view_all")}
                  </Button>
                ) : null}
                {!alert.is_read ? (
                  <Button size="sm" variant="outline" onClick={() => markRead(alert.id)}>
                    {t("mark_read")}
                  </Button>
                ) : null}
              </div>
            </article>
          ))
        ) : q || filter !== "all" ? (
          <ListEmpty />
        ) : (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {t("no_alerts")}
          </p>
        )}

        <ListPagination
          page={params.page}
          pageSize={params.pageSize}
          pageCount={alertsQuery.data?.pageCount ?? 1}
          total={alertsQuery.data?.total ?? null}
          onPage={params.setPage}
          onPageSize={params.setPageSize}
          busy={alertsQuery.isFetching}
        />
      </section>

      <aside className="space-y-4 rounded-xl border bg-card p-5 card-shadow">
        <h2 className="text-sm font-semibold">{t("notification_prefs")}</h2>
        {prefsQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">{t("loading")}</p>
        ) : (
          <div className="space-y-3 text-sm">
            <PrefRow
              label={t("channel_in_app")}
              checked={prefs?.in_app ?? true}
              onChange={(v) => updatePref({ in_app: v })}
            />
            <PrefRow
              label={t("channel_email")}
              checked={prefs?.email ?? true}
              onChange={(v) => updatePref({ email: v })}
            />
            <PrefRow label={t("channel_sms")} checked={false} disabled onChange={() => {}} />
            <PrefRow label={t("channel_push")} checked={false} disabled onChange={() => {}} />
            <div className="space-y-2 pt-2">
              <Label className="text-xs">{t("quiet_hours")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  defaultValue={prefs?.quiet_hours_start ?? ""}
                  onBlur={(e) => updatePref({ quiet_hours_start: e.target.value || null })}
                  aria-label={t("from")}
                />
                <Input
                  type="time"
                  defaultValue={prefs?.quiet_hours_end ?? ""}
                  onBlur={(e) => updatePref({ quiet_hours_end: e.target.value || null })}
                  aria-label={t("to")}
                />
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function PrefRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={disabled ? "text-muted-foreground" : undefined}>{label}</span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
