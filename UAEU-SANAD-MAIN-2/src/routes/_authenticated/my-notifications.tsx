/** Full notification history for the signed-in student, filtered by area. */
import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { relativeTime } from "@/components/NotificationBell";
import { listMyNotificationsFn, markNotificationsReadFn } from "@/lib/notifications/student.functions";
import {
  CATEGORY_LABEL,
  STUDENT_NOTIFICATION_TABS,
  type StudentNotificationTab,
} from "@/lib/notifications/student-categories";

export const Route = createFileRoute("/_authenticated/my-notifications")({
  head: () => ({
    meta: [
      { title: "My Notifications — Sanadi | UAEU" },
      {
        name: "description",
        content:
          "Every update on your UAEU requests, complaints, suggestions, appointments and documents, kept in one place.",
      },
      { property: "og:title", content: "My Notifications — Sanadi" },
      {
        property: "og:description",
        content: "Updates on your UAEU requests, appointments and documents in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<StudentNotificationTab>("all");

  const list = listMyNotificationsFn;
  const markRead = markNotificationsReadFn;

  const query = useQuery({
    queryKey: ["my-notifications", "page", user?.id, tab, lang],
    queryFn: () => list({ data: { tab, language: lang, limit: 100 } }),
    enabled: Boolean(user?.id),
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
          <>
            <Badge variant="secondary">{ar ? `${unread} غير مقروء` : `${unread} unread`}</Badge>
            <Button variant="outline" size="sm" className="ms-auto gap-1" onClick={() => markAll.mutate()}>
              <CheckCheck className="size-4" aria-hidden />
              {ar ? "تعليم الكل كمقروء" : "Mark all as read"}
            </Button>
          </>
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as StudentNotificationTab)}>
        <TabsList className="flex w-full flex-wrap justify-start">
          {STUDENT_NOTIFICATION_TABS.map((t) => (
            <TabsTrigger key={t.code} value={t.code}>
              {ar ? t.ar : t.en}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {query.isLoading ? (
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
            <li key={n.id}>
              <button
                type="button"
                onClick={() => void openNotification(n.id, n.actionUrl)}
                className={cn(
                  "w-full rounded-lg border bg-card px-4 py-3 text-start transition-colors hover:bg-secondary",
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
                  <span className="mt-1 block text-xs font-medium text-primary">{n.caseReference}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
