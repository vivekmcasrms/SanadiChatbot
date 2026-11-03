/**
 * Notification & email operations console.
 *
 * One screen for administrators: what is being sent, what failed, whether the
 * dispatcher is healthy, and the controls for safe-send redirection and emergency
 * broadcasts. Recipient addresses are always masked here.
 */
import { useState } from "react";
import { toastError } from "@/lib/errors/toast";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Mail, PlayCircle, PauseCircle, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  approveEmergencyBroadcastFn,
  createEmergencyBroadcastFn,
  getNotificationAccessFn,
  getNotificationOverviewFn,
  listEmergencyBroadcastsFn,
  listNotificationDeliveriesFn,
  runDispatchNowFn,
  setDispatchPausedFn,
  updateNotificationSettingsFn,
} from "@/lib/notifications/notifications.functions";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({
    meta: [
      { title: "Notification Operations — Sanadi | UAEU" },
      {
        name: "description",
        content:
          "Monitor Sanadi email delivery health, retry failures, control safe-send redirection and issue approved emergency broadcasts.",
      },
      { property: "og:title", content: "Notification Operations — Sanadi" },
      {
        property: "og:description",
        content: "Email delivery health, SLA escalation notices and emergency broadcasts for UAEU student services.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NotificationOpsPage,
});

const STATUS_TONE: Record<string, string> = {
  sent: "bg-emerald-100 text-emerald-800",
  queued: "bg-amber-100 text-amber-800",
  retrying: "bg-amber-100 text-amber-800",
  sending: "bg-sky-100 text-sky-800",
  failed: "bg-destructive/15 text-destructive",
  skipped: "bg-muted text-muted-foreground",
  suppressed: "bg-muted text-muted-foreground",
};

function NotificationOpsPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const getAccess = getNotificationAccessFn;
  const getOverview = getNotificationOverviewFn;
  const listDeliveries = listNotificationDeliveriesFn;
  const listBroadcasts = listEmergencyBroadcastsFn;
  const updateSettings = updateNotificationSettingsFn;
  const setPaused = setDispatchPausedFn;
  const runNow = runDispatchNowFn;
  const createBroadcast = createEmergencyBroadcastFn;
  const approveBroadcast = approveEmergencyBroadcastFn;

  const [status, setStatus] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const accessQuery = useQuery({
    queryKey: ["notif-access", user?.id],
    enabled: Boolean(user?.id),
    retry: false,
    queryFn: () => getAccess(),
  });
  const canView = accessQuery.data?.canView ?? false;
  const canManage = accessQuery.data?.canManage ?? false;

  const overviewQuery = useQuery({
    queryKey: ["notif-overview", user?.id],
    enabled: Boolean(user?.id) && canView,
    retry: false,
    queryFn: () => getOverview(),
  });

  const deliveriesQuery = useQuery({
    queryKey: ["notif-deliveries", user?.id, status, severity, q, page],
    enabled: Boolean(user?.id) && canView,
    retry: false,
    queryFn: () => listDeliveries({ data: { q, status, severity, page, pageSize: 20 } }),
  });

  const broadcastsQuery = useQuery({
    queryKey: ["notif-broadcasts", user?.id],
    enabled: Boolean(user?.id) && canView,
    retry: false,
    queryFn: () => listBroadcasts(),
  });

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["notif-overview"] });
    void queryClient.invalidateQueries({ queryKey: ["notif-deliveries"] });
    void queryClient.invalidateQueries({ queryKey: ["notif-broadcasts"] });
  };

  const settingsMutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) => updateSettings({ data: patch as never }),
    onSuccess: () => {
      toast.success(ar ? "تم الحفظ" : "Saved");
      refreshAll();
    },
    onError: (e: Error) => toastError(e, lang),
  });

  const dispatchMutation = useMutation({
    mutationFn: () => runNow(),
    onSuccess: (res) => {
      toast.success(
        ar
          ? `تمت المعالجة: ${res.processed} — أُرسلت ${res.sent}`
          : `Processed ${res.processed} — ${res.sent} sent, ${res.failed} failed, ${res.skipped} skipped`,
      );
      refreshAll();
    },
    onError: (e: Error) => toastError(e, lang),
  });

  const pauseMutation = useMutation({
    mutationFn: (paused: boolean) =>
      setPaused({ data: { paused, reason: paused ? "Paused by administrator" : null } }),
    onSuccess: refreshAll,
    onError: (e: Error) => toastError(e, lang),
  });

  const [draft, setDraft] = useState({
    title_en: "",
    title_ar: "",
    message_en: "",
    message_ar: "",
    audience: "all_students" as "all_students" | "group",
  });

  const broadcastMutation = useMutation({
    mutationFn: async () => {
      const created = await createBroadcast({
        data: {
          title_en: draft.title_en,
          title_ar: draft.title_ar,
          message_en: draft.message_en,
          message_ar: draft.message_ar,
          audience: draft.audience,
          unit_id: null,
          group_code: draft.audience === "group" ? "emergency_admins" : null,
          action_url: "/alerts",
        },
      });
      return approveBroadcast({ data: { id: created.id } });
    },
    onSuccess: (res) => {
      toast.success(ar ? `تم إرسال ${res.queued} رسالة` : `Emergency alert queued to ${res.queued} recipients`);
      setDraft({ title_en: "", title_ar: "", message_en: "", message_ar: "", audience: "all_students" });
      refreshAll();
    },
    onError: (e: Error) => toastError(e, lang),
  });

  if (accessQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>;
  }

  if (!canView) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="size-5 text-destructive" aria-hidden />
          {ar ? "ليس لديك صلاحية لعرض عمليات الإشعارات." : "You do not have access to notification operations."}
        </CardContent>
      </Card>
    );
  }

  const overview = overviewQuery.data;
  const stats = overview?.byStatus ?? {};
  const settings = overview?.settings;
  const state = overview?.state;
  const total = deliveriesQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Mail className="size-5 text-primary" aria-hidden />
            {ar ? "عمليات الإشعارات والبريد" : "Notification & email operations"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {ar
              ? "صحة الإرسال، حالات الفشل، والبث الطارئ المعتمد."
              : "Delivery health, failures, and approved emergency broadcasts."}
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => dispatchMutation.mutate()} disabled={dispatchMutation.isPending}>
              <PlayCircle className="size-4" aria-hidden />
              {ar ? "إرسال الآن" : "Send queue now"}
            </Button>
            <Button
              size="sm"
              variant={state?.paused ? "default" : "outline"}
              onClick={() => pauseMutation.mutate(!state?.paused)}
            >
              <PauseCircle className="size-4" aria-hidden />
              {state?.paused ? (ar ? "استئناف" : "Resume dispatch") : ar ? "إيقاف مؤقت" : "Pause dispatch"}
            </Button>
          </div>
        ) : null}
      </header>

      {overview?.senderDomain?.sender_domain_status === "blocked" ? (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4" aria-hidden />
            {ar
              ? "الإرسال متوقف — نطاق المرسل غير موثّق"
              : "EMAIL SENDING BLOCKED — SENDER DOMAIN NOT VERIFIED"}
          </p>
          <p className="mt-1">
            {ar
              ? "تُدرَج الرسائل في قائمة الانتظار وتُسجَّل كـ skipped حتى يتم توثيق نطاق الإرسال."
              : `Messages are queued and logged as skipped until the sender domain is verified (${
                  overview.senderDomain.sender_domain_reason ?? "domain_not_verified"
                }).`}
          </p>
        </div>
      ) : null}


      {state?.paused ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="size-4" aria-hidden />
          {ar ? "الإرسال متوقف مؤقتاً" : "Dispatch is paused"} — {state.pause_reason}
        </div>
      ) : null}


      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(["sent", "queued", "retrying", "failed", "skipped", "suppressed"] as const).map((key) => (
          <Card key={key}>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{key}</p>
              <p className="text-2xl font-semibold">{stats[key] ?? 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="deliveries">
        <TabsList>
          <TabsTrigger value="deliveries">{ar ? "سجل الإرسال" : "Delivery log"}</TabsTrigger>
          <TabsTrigger value="settings">{ar ? "الإعدادات" : "Settings"}</TabsTrigger>
          <TabsTrigger value="emergency">{ar ? "بث طارئ" : "Emergency"}</TabsTrigger>
        </TabsList>

        <TabsContent value="deliveries" className="space-y-4 pt-4">
          <div className="flex flex-wrap gap-2">
            <Input
              className="max-w-xs"
              placeholder={ar ? "بحث بالحدث أو الموضوع" : "Search event or subject"}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["all", "queued", "retrying", "sent", "failed", "skipped", "suppressed"].map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={severity}
              onValueChange={(v) => {
                setSeverity(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["all", "normal", "important", "critical", "emergency"].map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">{ar ? "الحدث" : "Event"}</th>
                  <th className="p-3">{ar ? "المستلم" : "Recipient"}</th>
                  <th className="p-3">{ar ? "الأهمية" : "Severity"}</th>
                  <th className="p-3">{ar ? "الحالة" : "Status"}</th>
                  <th className="p-3">{ar ? "التفاصيل" : "Detail"}</th>
                </tr>
              </thead>
              <tbody>
                {(deliveriesQuery.data?.rows ?? []).map((row) => (
                  <tr key={row.id} className="border-t align-top">
                    <td className="p-3">
                      <div className="font-medium">{row.event_type}</div>
                      <div className="text-xs text-muted-foreground">{new Date(row.queued_at).toLocaleString()}</div>
                    </td>
                    <td className="p-3">
                      <div>{row.recipient_masked}</div>
                      <div className="text-xs text-muted-foreground">{row.recipient_role ?? "—"} · {row.language}</div>
                    </td>
                    <td className="p-3">{row.severity}</td>
                    <td className="p-3">
                      <Badge className={STATUS_TONE[row.status] ?? ""} variant="secondary">
                        {row.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {row.failure_code ? `${row.failure_code}: ${row.failure_reason ?? ""}` : row.subject ?? "—"}
                    </td>
                  </tr>
                ))}
                {!deliveriesQuery.isLoading && (deliveriesQuery.data?.rows.length ?? 0) === 0 ? (
                  <tr>
                    <td className="p-6 text-center text-sm text-muted-foreground" colSpan={5}>
                      {ar ? "لا توجد رسائل" : "No deliveries yet"}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {ar ? "الإجمالي" : "Total"}: {total}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {ar ? "السابق" : "Previous"}
              </Button>
              <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
                {ar ? "التالي" : "Next"}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4 pt-4">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>{ar ? "تفعيل البريد الإلكتروني" : "Email sending enabled"}</Label>
                  <p className="text-xs text-muted-foreground">
                    {ar ? "إيقافه يبقي كل الإشعارات داخل التطبيق." : "Turning this off keeps every notification in-app."}
                  </p>
                </div>
                <Switch
                  disabled={!canManage}
                  checked={settings?.emails_enabled ?? true}
                  onCheckedChange={(v) => settingsMutation.mutate({ emails_enabled: v })}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>{ar ? "وضع إعادة توجيه البريد" : "Safe-send mode"}</Label>
                  <p className="text-xs text-muted-foreground">
                    {ar
                      ? "يعيد توجيه كل الرسائل إلى عنوان اختبار واحد بدلاً من الطلاب."
                      : "Redirects every email to one test address instead of real students."}
                  </p>
                </div>
                <Switch
                  disabled={!canManage}
                  checked={settings?.demo_email_mode ?? true}
                  onCheckedChange={(v) => settingsMutation.mutate({ demo_email_mode: v })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="redirect">{ar ? "عنوان الاختبار" : "Test redirect address"}</Label>
                <Input
                  id="redirect"
                  type="email"
                  autoComplete="off"
                  disabled={!canManage}
                  defaultValue={settings?.demo_redirect_email ?? ""}
                  onBlur={(e) =>
                    settingsMutation.mutate({ demo_redirect_email: e.target.value.trim() || null })
                  }
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label>{ar ? "الملخص اليومي لمالكي الخدمات" : "Daily service-owner digest"}</Label>
                <Switch
                  disabled={!canManage}
                  checked={settings?.digest_enabled ?? true}
                  onCheckedChange={(v) => settingsMutation.mutate({ digest_enabled: v })}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {ar ? "روابط الرسائل" : "Email links"}: {settings?.public_app_url ?? (ar ? "غير مُهيّأ" : "not configured")}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="emergency" className="space-y-4 pt-4">
          <Card>
            <CardContent className="space-y-4 p-5">
              <p className="text-sm text-muted-foreground">
                {ar
                  ? "تُرسل التنبيهات الطارئة بلغتين فوراً لكل المستلمين المحددين، وتُسجَّل بالكامل للمراجعة."
                  : "Emergency alerts are sent bilingually and immediately to the selected audience, and are fully audit-logged."}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="t-en">Title (EN)</Label>
                  <Input id="t-en" value={draft.title_en} onChange={(e) => setDraft({ ...draft, title_en: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="t-ar">العنوان (AR)</Label>
                  <Input id="t-ar" dir="rtl" value={draft.title_ar} onChange={(e) => setDraft({ ...draft, title_ar: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="m-en">Message (EN)</Label>
                  <Textarea id="m-en" rows={4} value={draft.message_en} onChange={(e) => setDraft({ ...draft, message_en: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="m-ar">الرسالة (AR)</Label>
                  <Textarea id="m-ar" dir="rtl" rows={4} value={draft.message_ar} onChange={(e) => setDraft({ ...draft, message_ar: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{ar ? "الجمهور" : "Audience"}</Label>
                <Select value={draft.audience} onValueChange={(v) => setDraft({ ...draft, audience: v as "all_students" | "group" })}>
                  <SelectTrigger className="sm:w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all_students">{ar ? "كل الطلاب" : "All students"}</SelectItem>
                    <SelectItem value="group">{ar ? "فريق اتصالات الطوارئ" : "Emergency communications team"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={
                  !canManage ||
                  broadcastMutation.isPending ||
                  draft.title_en.trim().length < 3 ||
                  draft.message_en.trim().length < 10 ||
                  draft.title_ar.trim().length < 3 ||
                  draft.message_ar.trim().length < 10
                }
                onClick={() => broadcastMutation.mutate()}
              >
                <AlertTriangle className="size-4" aria-hidden />
                {ar ? "اعتماد وإرسال" : "Approve & send"}
              </Button>
            </CardContent>
          </Card>

          <div className="rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">{ar ? "العنوان" : "Title"}</th>
                  <th className="p-3">{ar ? "الجمهور" : "Audience"}</th>
                  <th className="p-3">{ar ? "المستلمون" : "Recipients"}</th>
                  <th className="p-3">{ar ? "الحالة" : "Status"}</th>
                </tr>
              </thead>
              <tbody>
                {(broadcastsQuery.data ?? []).map((b) => (
                  <tr key={b.id} className="border-t">
                    <td className="p-3">{ar ? b.title_ar : b.title_en}</td>
                    <td className="p-3">{b.audience}</td>
                    <td className="p-3">{b.recipient_count}</td>
                    <td className="p-3">{b.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
