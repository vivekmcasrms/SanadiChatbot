/**
 * Notification bell for the signed-in person.
 *
 * Reads persisted in-app notifications (never local state), updates live through
 * a realtime subscription, and falls back to polling/refetch when realtime is
 * unavailable. Opening a notification marks it read and goes to the related case.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { listMyNotificationsFn, markNotificationsReadFn } from "@/lib/notifications/student.functions";
import { CATEGORY_LABEL } from "@/lib/notifications/student-categories";

export function relativeTime(iso: string, ar: boolean): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return ar ? "الآن" : "just now";
  if (mins < 60) return ar ? `قبل ${mins} دقيقة` : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return ar ? `قبل ${hours} ساعة` : `${hours} h ago`;
  return d.toLocaleString(ar ? "ar-AE" : "en-GB", {
    timeZone: "Asia/Dubai",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function NotificationBell() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const list = useServerFn(listMyNotificationsFn);
  const markRead = useServerFn(markNotificationsReadFn);

  const query = useQuery({
    queryKey: ["my-notifications", "bell", user?.id, lang],
    queryFn: () => list({ data: { tab: "all", language: lang, limit: 8 } }),
    enabled: Boolean(user?.id),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  // Live updates: a new row for this recipient refreshes the bell immediately.
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notification_events",
          filter: `recipient_profile_id=eq.${user.id}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: ["my-notifications"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "student_alerts", filter: `student_id=eq.${user.id}` },
        () => {
          void qc.invalidateQueries({ queryKey: ["my-notifications"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, qc]);

  const markAll = useMutation({
    mutationFn: () => markRead({ data: { ids: [], caseId: null, all: true } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["my-notifications"] }),
  });

  const items = query.data?.items ?? [];
  const unread = query.data?.unreadCount ?? 0;

  async function openNotification(id: string, actionUrl: string | null) {
    setOpen(false);
    await markRead({ data: { ids: [id], caseId: null, all: false } });
    void qc.invalidateQueries({ queryKey: ["my-notifications"] });
    if (actionUrl) void navigate({ to: actionUrl });
  }

  if (!user?.id) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative shrink-0"
          aria-label={
            ar
              ? `الإشعارات${unread ? ` — ${unread} غير مقروء` : ""}`
              : `Notifications${unread ? ` — ${unread} unread` : ""}`
          }
        >
          <Bell className="size-5" aria-hidden />
          {unread > 0 ? (
            <span className="absolute -end-0.5 -top-0.5 min-w-4 rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0" dir={ar ? "rtl" : "ltr"}>
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">{ar ? "الإشعارات" : "Notifications"}</span>
          {unread > 0 ? (
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => markAll.mutate()}>
              <CheckCheck className="size-3.5" aria-hidden />
              {ar ? "تعليم الكل كمقروء" : "Mark all read"}
            </Button>
          ) : null}
        </div>
        <ScrollArea className="max-h-80">
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {ar ? "لا توجد إشعارات بعد." : "No notifications yet."}
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void openNotification(n.id, n.actionUrl)}
                    className={cn(
                      "w-full px-3 py-2.5 text-start transition-colors hover:bg-secondary",
                      !n.readAt && "bg-primary/5",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {!n.readAt ? <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden /> : null}
                      <span className="truncate text-sm font-medium">{n.title}</span>
                      <Badge variant="outline" className="ms-auto shrink-0 text-[10px]">
                        {CATEGORY_LABEL[n.category][ar ? "ar" : "en"]}
                      </Badge>
                    </span>
                    <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{n.body}</span>
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {n.caseReference ? `${n.caseReference} · ` : ""}
                      {relativeTime(n.createdAt, ar)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
        <div className="border-t p-2">
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link to="/my-notifications" onClick={() => setOpen(false)}>
              {ar ? "عرض كل الإشعارات" : "View All Notifications"}
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
