/** Full notification history for the signed-in student, filtered by area. */
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, CheckCheck, MessagesSquare, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { NotificationPreferences } from "@/components/NotificationPreferences";
import { refreshMyProactiveAlerts } from "@/lib/proactive.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { relativeTime } from "@/components/NotificationBell";
import { deleteNotificationsFn, listMyNotificationsFn, markNotificationsReadFn } from "@/lib/notifications/student.functions";
import {
  CATEGORY_LABEL,
  STUDENT_NOTIFICATION_TABS,
  type StudentNotificationTab,
} from "@/lib/notifications/student-categories";

type PageTab = StudentNotificationTab | "preferences";
const PAGE_TABS: PageTab[] = [...STUDENT_NOTIFICATION_TABS.map((t) => t.code), "preferences"];

export const Route = createFileRoute("/_authenticated/my-notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — Sanadi | UAEU" },
      {
        name: "description",
        content:
          "Every update on your UAEU requests, appointments, documents and university alerts, plus your notification preferences, in one place.",
      },
      { property: "og:title", content: "Notifications — Sanadi" },
      {
        property: "og:description",
        content: "Updates on your UAEU requests, appointments and documents in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { tab?: PageTab } => {
    const t = search["tab"];
    return typeof t === "string" && PAGE_TABS.includes(t as PageTab) ? { tab: t as PageTab } : {};
  },
  component: NotificationsPage,
});

function NotificationsPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tab: PageTab = Route.useSearch().tab ?? "all";
  const setTab = (v: PageTab) => void navigate({ to: "/my-notifications", search: v === "all" ? {} : { tab: v }, replace: true });
  const listTab: StudentNotificationTab = tab === "preferences" ? "all" : tab;

  // Refresh proactive university alerts from live records once per visit.
  useEffect(() => {
    if (!user?.id) return;
    void refreshMyProactiveAlerts()
      .then(() => qc.invalidateQueries({ queryKey: ["my-notifications"] }))
      .catch(() => undefined);
  }, [user?.id, qc]);

  const list = useServerFn(listMyNotificationsFn);
  const markRead = useServerFn(markNotificationsReadFn);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const removeFn = useServerFn(deleteNotificationsFn);
  const remove = useMutation({
    mutationFn: (ids: string[]) => removeFn({ data: { ids } }),
    onSuccess: (res) => {
      const n = res?.removed ?? 0;
      toast.success(n > 1
        ? (ar ? `تم حذف ${n} إشعارات` : `${n} notifications deleted`)
        : (ar ? "تم حذف الإشعار" : "Notification deleted"));
      void qc.invalidateQueries({ queryKey: ["my-notifications"] });
    },
    onError: () => toast.error(ar ? "تعذر حذف الإشعار. حاول مرة أخرى." : "Couldn't delete the notification. Please try again."),
  });
  const removeAll = useMutation({
    mutationFn: () => removeFn({ data: { ids: [], all: true } }),
    onSuccess: (res) => {
      toast.success((res?.removed ?? 0) > 0
        ? (ar ? "تم حذف كل الإشعارات" : "All notifications deleted")
        : (ar ? "لا توجد إشعارات للحذف" : "Nothing left to delete"));

      void qc.invalidateQueries({ queryKey: ["my-notifications"] });
    },
    onError: () => toast.error(ar ? "تعذر حذف الإشعارات. حاول مرة أخرى." : "Couldn't delete your notifications. Please try again."),
    onSettled: () => setConfirmDelete(false),
  });


  const query = useQuery({
    queryKey: ["my-notifications", "page", user?.id, listTab, lang],
    queryFn: () => list({ data: { tab: listTab, language: lang, limit: 100 } }),
    enabled: Boolean(user?.id) && tab !== "preferences",
    refetchInterval: 60_000,
  });

  const markAll = useMutation({
    mutationFn: () => markRead({ data: { ids: [], caseId: null, all: true } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["my-notifications"] }),
  });

  const items = query.data?.items ?? [];
  const unread = query.data?.unreadCount ?? 0;

  async function openNotification(id: string, actionUrl: string | null) {
    await markRead({ data: { ids: [id], caseId: null, all: false } });
    void qc.invalidateQueries({ queryKey: ["my-notifications"] });
    if (actionUrl) void navigate({ to: actionUrl });
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4" dir={ar ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Bell className="size-5 text-primary" aria-hidden />
          {ar ? "الإشعارات" : "Notifications"}
        </h1>
        {unread > 0 ? (
          <Badge variant="secondary">{ar ? `${unread} غير مقروء` : `${unread} unread`}</Badge>
        ) : null}
        {unread > 0 ? (
          <Button variant="outline" size="sm" className="ms-auto gap-1" onClick={() => markAll.mutate()}>
            <CheckCheck className="size-4" aria-hidden />
            {ar ? "تعليم الكل كمقروء" : "Mark all as read"}
          </Button>
        ) : null}
        {(query.data?.total ?? 0) > 0 ? (
          <Button
            variant="outline"
            size="sm"
            className={cn("gap-1 text-destructive hover:text-destructive", unread === 0 && "ms-auto")}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-4" aria-hidden />
            {ar ? "حذف الكل" : "Delete all"}
          </Button>
        ) : null}
      </div>


      <Tabs value={tab} onValueChange={(v) => setTab(v as PageTab)}>
        <TabsList className="flex w-full flex-wrap justify-start">
          {STUDENT_NOTIFICATION_TABS.map((t) => (
            <TabsTrigger key={t.code} value={t.code}>
              {ar ? t.ar : t.en}
            </TabsTrigger>
          ))}
          <TabsTrigger value="preferences">{ar ? "التفضيلات" : "Preferences"}</TabsTrigger>
        </TabsList>
      </Tabs>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {ar ? "حذف كل الإشعارات؟" : "Delete all notifications?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {ar
                ? `سيتم إخفاء ${query.data?.total ?? 0} إشعاراً من قائمة الإشعارات لديك ومن الجرس، بما في ذلك الإشعارات في الأقسام الأخرى.`
                : `This hides ${query.data?.total ?? 0} notification${query.data?.total === 1 ? "" : "s"} from your list and the bell, including ones in other sections.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{ar ? "إلغاء" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={removeAll.isPending}
              onClick={() => removeAll.mutate()}
            >
              {ar ? "حذف الكل" : "Delete all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      {tab === "preferences" ? (
        <NotificationPreferences />
      ) : query.isLoading ? (
        <p className="text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {ar ? "لا توجد إشعارات في هذا القسم." : "Nothing here yet."}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id} className="relative">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute end-1 bottom-1 z-10 size-7 text-muted-foreground hover:text-destructive"
                aria-label={ar ? "حذف الإشعار" : "Delete notification"}
                disabled={remove.isPending}
                onClick={() => remove.mutate([n.id])}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
              <button
                type="button"
                onClick={() => void openNotification(n.id, n.actionUrl)}
                className={cn(
                  "w-full rounded-lg border bg-card px-4 py-3 pe-10 text-start transition-colors hover:bg-secondary",
                  !n.readAt && "border-primary/40 bg-primary/5",
                )}
              >
                <span className="flex flex-wrap items-center gap-2">
                  {!n.readAt ? <span className="size-2 rounded-full bg-primary" aria-hidden /> : null}
                  <span className="font-medium">{n.title}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {CATEGORY_LABEL[n.category][ar ? "ar" : "en"]}
                  </Badge>
                  <span className="ms-auto text-xs text-muted-foreground">{relativeTime(n.createdAt, ar)}</span>
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">{n.body}</span>
                {n.caseReference ? (
                  <span className="mt-1 block text-xs font-medium text-primary"><bdi dir="ltr">{n.caseReference}</bdi></span>
                ) : null}
              </button>
              {n.conversationId ? (
                <button
                  type="button"
                  onClick={() => {
                    void markRead({ data: { ids: [n.id], caseId: null, all: false } });
                    void navigate({ to: "/assistant", search: { chat: n.conversationId! } });
                  }}
                  className="mt-1 inline-flex items-center gap-1 px-4 text-xs text-primary hover:underline"
                >
                  <MessagesSquare className="size-3.5" aria-hidden />
                  {ar ? "فتح المحادثة" : "Open conversation"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
