/**
 * Student notification centre: reading, filtering and read-state for the
 * signed-in person's own in-app notifications.
 *
 * These used to be TanStack server functions backed directly by Supabase
 * (RLS scoped every row to the recipient). They are now thin client-side
 * wrappers around the C# API (NotificationController), which performs the
 * same recipient scoping server-side from the caller's JWT. Categorisation /
 * humanisation is pure, UI-only logic, so it stays on the client unchanged.
 */
import { apiFetch } from "@/lib/auth-token";
import {
  categoriseNotification,
  EVENT_TITLE,
  humanText,
  type StudentNotificationCategory,
} from "./student-categories";

export type StudentNotification = {
  id: string;
  eventType: string;
  title: string;
  body: string;
  actionUrl: string | null;
  createdAt: string;
  readAt: string | null;
  caseId: string | null;
  caseReference: string | null;
  category: StudentNotificationCategory;
};

type RawNotificationEvent = {
  id: string;
  eventType: string;
  title: string | null;
  body: string | null;
  actionUrl: string | null;
  createdAt: string;
  readAt: string | null;
  caseId: string | null;
  caseReference: string | null;
  caseType: string | null;
};

export type ListMyNotificationsInput = {
  tab?: "all" | "unread" | "requests" | "complaints" | "suggestions" | "appointments" | "documents";
  language?: "en" | "ar";
  limit?: number;
};

export async function listMyNotificationsFn(opts?: { data?: ListMyNotificationsInput }) {
  const tab = opts?.data?.tab ?? "all";
  const language = opts?.data?.language ?? "en";
  const limit = opts?.data?.limit ?? 50;

  const [rows, counts] = await Promise.all([
    apiFetch<RawNotificationEvent[]>("/api/notifications/me"),
    apiFetch<{ unreadCount: number }>("/api/notifications/me/unread-count"),
  ]);

  const all: StudentNotification[] = rows.map((r) => {
    const title = EVENT_TITLE[r.eventType];
    return {
      id: r.id,
      eventType: r.eventType,
      title: title ? title[language] : humanText(r.title ?? "", r.eventType, r.caseReference, language),
      body: humanText(r.body ?? r.title ?? "", r.eventType, r.caseReference, language),
      actionUrl: r.actionUrl ?? (r.caseId ? `/requests/${r.caseId}` : null),
      createdAt: r.createdAt,
      readAt: r.readAt,
      caseId: r.caseId,
      caseReference: r.caseReference,
      category: categoriseNotification(r.eventType, r.caseType),
    };
  });

  const unreadCount = counts.unreadCount;
  let items = all;
  if (tab === "unread") items = all.filter((n) => !n.readAt);
  else if (tab !== "all") items = all.filter((n) => n.category === tab);
  return { items: items.slice(0, limit), unreadCount, total: all.length };
}

export type MarkNotificationsReadInput = {
  ids?: string[];
  caseId?: string | null;
  all?: boolean;
};

export async function markNotificationsReadFn(opts?: { data?: MarkNotificationsReadInput }) {
  return apiFetch<{ ok: true }>("/api/notifications/me/read", {
    method: "POST",
    body: JSON.stringify({
      ids: opts?.data?.ids ?? [],
      caseId: opts?.data?.caseId ?? null,
      all: opts?.data?.all ?? false,
    }),
  });
}
