/**
 * Student notification centre: reading, filtering and read-state for the
 * signed-in person's own in-app notifications. RLS already scopes every row to
 * the recipient, so these run with the caller's own database access.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  categoriseNotification,
  EVENT_TITLE,
  humanText,
  matchesTab,
  arabicNotificationBody,
  type StudentNotificationCategory,
} from "./student-categories";

/** Proactive university alerts share the feed; their ids carry this prefix. */
export const ALERT_ID_PREFIX = "alert:";

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
  conversationId: string | null;
  source: "event" | "alert";
};

const FETCH_LIMIT = 200;

export const listMyNotificationsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        tab: z
          .enum(["all", "unread", "requests", "appointments", "documents", "alerts"])
          .default("all"),
        language: z.enum(["en", "ar"]).default("en"),
        limit: z.number().int().min(1).max(100).default(50),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("notification_events")
      .select("id, event_type, title, body, action_url, created_at, read_at, case_id, entity_type, entity_id, payload")
      .eq("channel", "in_app")
      .is("dismissed_at", null)
      .order("created_at", { ascending: false })
      .limit(FETCH_LIMIT);
    if (error) throw new Error(error.message);

    const { data: alertRows, error: alertError } = await context.supabase
      .from("student_alerts")
      .select("id, title_en, title_ar, body_en, body_ar, action_url, generated_at, is_read, read_at")
      .eq("student_id", context.userId)
      .eq("status", "active")
      .is("dismissed_at", null)
      .order("generated_at", { ascending: false })
      .limit(FETCH_LIMIT);
    if (alertError) throw new Error(alertError.message);

    const caseIds = Array.from(
      new Set(
        (rows ?? [])
          .map((r) => r.case_id ?? (r.entity_type === "case" ? r.entity_id : null))
          .filter((v): v is string => Boolean(v)),
      ),
    );

    const caseMap = new Map<string, { reference: string; type: string }>();
    if (caseIds.length) {
      const { data: cases } = await context.supabase
        .from("cases")
        .select("id, case_number, case_type")
        .in("id", caseIds);
      for (const c of cases ?? []) caseMap.set(c.id, { reference: c.case_number, type: c.case_type as string });
    }

    const events: StudentNotification[] = (rows ?? []).map((r) => {
      const caseId = r.case_id ?? (r.entity_type === "case" ? r.entity_id : null);
      const c = caseId ? caseMap.get(caseId) : undefined;
      const title = EVENT_TITLE[r.event_type];
      return {
        id: r.id,
        eventType: r.event_type,
        title: title
          ? title[data.language]
          : humanText(r.title, r.event_type, c?.reference ?? null, data.language),
        body: localisedBody(r, c?.reference ?? null, data.language),
        actionUrl: r.action_url ?? (caseId ? `/requests/${caseId}` : null),
        createdAt: r.created_at,
        readAt: r.read_at,
        caseId: caseId ?? null,
        caseReference: c?.reference ?? null,
        category: categoriseNotification(r.event_type, c?.type ?? null),
        conversationId: conversationFromPayload(r.payload, r.entity_type, r.entity_id),
        source: "event" as const,
      };
    });

    const alerts: StudentNotification[] = (alertRows ?? []).map((a) => ({
      id: `${ALERT_ID_PREFIX}${a.id}`,
      eventType: "university_alert",
      title: (data.language === "ar" ? a.title_ar : a.title_en) || a.title_en || a.title_ar || "",
      body: (data.language === "ar" ? a.body_ar : a.body_en) || a.body_en || a.body_ar || "",
      actionUrl: a.action_url ?? null,
      createdAt: a.generated_at,
      readAt: a.is_read ? (a.read_at ?? a.generated_at) : null,
      caseId: null,
      caseReference: null,
      category: "alerts" as const,
      conversationId: null,
      source: "alert" as const,
    }));

    const all = mergeNotifications(events, alerts);

    const unreadCount = all.filter((n) => !n.readAt).length;
    const items = all.filter((n) => matchesTab(n.category, n.readAt, data.tab));
    return { items: items.slice(0, data.limit), unreadCount, total: all.length };
  });

export const markNotificationsReadFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        ids: z.array(z.string().max(80)).max(200).default([]),
        caseId: z.string().uuid().nullable().default(null),
        all: z.boolean().default(false),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    const uuid = z.string().uuid();
    const alertIds = data.ids
      .filter((id) => id.startsWith(ALERT_ID_PREFIX))
      .map((id) => id.slice(ALERT_ID_PREFIX.length))
      .filter((id) => uuid.safeParse(id).success);
    const eventIds = data.ids.filter((id) => uuid.safeParse(id).success);
    if (data.all || alertIds.length) {
      let aq = context.supabase
        .from("student_alerts")
        .update({ is_read: true, read_at: now })
        .eq("student_id", context.userId)
        .eq("is_read", false);
      if (!data.all) aq = aq.in("id", alertIds);
      const { error: aErr } = await aq;
      if (aErr) throw new Error(aErr.message);
    }
    let q = context.supabase
      .from("notification_events")
      .update({ read_at: now })
      .eq("recipient_profile_id", context.userId)
      .eq("channel", "in_app")
      .is("read_at", null);
    if (!data.all) {
      if (data.caseId) q = q.eq("case_id", data.caseId);
      else if (eventIds.length) q = q.in("id", eventIds);
      else return { ok: true };
    }
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Which rows a delete request covers. `null` for a side means "every row of
 * this student's", so a delete-all can never be widened to another student.
 */
export type DismissalScope = { alertIds: string[] | null; eventIds: string[] | null };

export function dismissalScope(ids: string[], all: boolean): DismissalScope {
  if (all) return { alertIds: null, eventIds: null };
  const uuid = z.string().uuid();
  return {
    alertIds: ids
      .filter((id) => id.startsWith(ALERT_ID_PREFIX))
      .map((id) => id.slice(ALERT_ID_PREFIX.length))
      .filter((id) => uuid.safeParse(id).success),
    eventIds: ids.filter((id) => uuid.safeParse(id).success),
  };
}

/** Students hide notifications from their own feed; rows are kept for audit. */
export const deleteNotificationsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        ids: z.array(z.string().max(80)).max(200).default([]),
        all: z.boolean().default(false),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { alertIds, eventIds } = dismissalScope(data.ids, data.all);
    if (alertIds !== null && eventIds !== null && !alertIds.length && !eventIds.length) {
      return { ok: true, removed: 0 };
    }
    const now = new Date().toISOString();
    let removed = 0;

    if (alertIds !== null || data.all) {
      // Stamping unseen alerts read first keeps an already-read alert's read
      // time intact when it is hidden.
      let seen = context.supabase
        .from("student_alerts")
        .update({ is_read: true, read_at: now })
        .eq("student_id", context.userId)
        .is("dismissed_at", null)
        .eq("is_read", false);
      if (alertIds !== null) seen = seen.in("id", alertIds);
      await seen;

      let hide = context.supabase
        .from("student_alerts")
        .update({ dismissed_at: now })
        .eq("student_id", context.userId)
        .is("dismissed_at", null);
      if (alertIds !== null) hide = hide.in("id", alertIds);
      const { data: gone, error } = await hide.select("id");
      if (error) throw new Error(error.message);
      removed += gone?.length ?? 0;
    }

    if (eventIds !== null || data.all) {
      let seen = context.supabase
        .from("notification_events")
        .update({ read_at: now })
        .eq("recipient_profile_id", context.userId)
        .eq("channel", "in_app")
        .is("dismissed_at", null)
        .is("read_at", null);
      if (eventIds !== null) seen = seen.in("id", eventIds);
      await seen;

      let hide = context.supabase
        .from("notification_events")
        .update({ dismissed_at: now })
        .eq("recipient_profile_id", context.userId)
        .eq("channel", "in_app")
        .is("dismissed_at", null);
      if (eventIds !== null) hide = hide.in("id", eventIds);
      const { data: gone, error } = await hide.select("id");
      if (error) throw new Error(error.message);
      removed += gone?.length ?? 0;
    }

    return { ok: true, removed };
  });


/** A conversation link is only shown when the workflow recorded one. */
export function conversationFromPayload(payload: unknown, entityType: string | null, entityId: string | null): string | null {
  if (entityType === "conversation" && entityId) return entityId;
  if (payload && typeof payload === "object") {
    const v = (payload as Record<string, unknown>)["conversation_id"] ?? (payload as Record<string, unknown>)["conversationId"];
    if (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)) return v;
  }
  return null;
}

/**
 * One feed from both sources, newest first. Rows describing the same event
 * (same type, case and minute with identical title) collapse to one, keeping
 * the unread copy so nothing the student hasn't seen disappears.
 */
export function mergeNotifications(events: StudentNotification[], alerts: StudentNotification[]): StudentNotification[] {
  const seen = new Map<string, StudentNotification>();
  for (const n of [...events, ...alerts]) {
    const key = [n.source, n.eventType, n.caseId ?? "", n.title, n.createdAt.slice(0, 16)].join("|");
    const prev = seen.get(key);
    if (!prev) seen.set(key, n);
    else if (prev.readAt && !n.readAt) seen.set(key, n);
  }
  return Array.from(seen.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const HAS_ARABIC = /[\u0600-\u06FF]/;
function localisedBody(
  r: { body: string | null; title: string | null; event_type: string; payload: unknown },
  reference: string | null,
  lang: "en" | "ar",
): string {
  const text = humanText(r.body ?? r.title, r.event_type, reference, lang);
  if (lang !== "ar" || HAS_ARABIC.test(text)) return text;
  const payload = r.payload && typeof r.payload === "object" ? (r.payload as Record<string, unknown>) : null;
  return arabicNotificationBody(r.event_type, payload, reference) ?? text;
}
