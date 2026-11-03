/**
 * Proactive Sanadi. Server only.
 *
 * Sanadi does not wait to be asked. These rules read the student's own live
 * records and raise a personal alert the moment something changes or becomes
 * possible — a reply
 * a unit is waiting for, a deadline about to pass.
 *
 * Every rule is data-driven and idempotent: an alert of the same type is not
 * raised again while an identical one is still active.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

type Candidate = {
  alertType: string;
  severity: "low" | "medium" | "high" | "critical";
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  actionLabelEn?: string;
  actionLabelAr?: string;
  actionUrl?: string;
  deadline?: string | null;
  relatedCaseId?: string | null;
};

const DAY = 86_400_000;

/** Evaluates every proactive rule for one student and inserts what is new. */
export async function generateProactiveAlerts(db: Db, userId: string): Promise<{ created: number; types: string[] }> {
  const now = Date.now();

  const [casesRes, requirementsRes, holdsRes, existingRes] = await Promise.all([
    db
      .from("cases")
      .select("id, case_number, title, status")
      .eq("student_id", userId)
      .in("status", ["awaiting_student", "student_confirmation", "resolution_proposed"])
      .limit(5),
    db
      .from("student_requirements")
      .select("title_en, title_ar, due_date, status")
      .eq("student_id", userId)
      .neq("status", "completed")
      .not("due_date", "is", null)
      .limit(10),
    db
      .from("student_holds")
      .select("title_en, title_ar, resolution_action_en, resolution_action_ar, prevents_registration")
      .eq("student_id", userId)
      .eq("status", "active"),
    db
      .from("student_alerts")
      .select("alert_type, status, created_at")
      .eq("student_id", userId)
      .eq("status", "active"),
  ]);

  const active = new Set((existingRes.data ?? []).map((a) => a.alert_type));
  const candidates: Candidate[] = [];

  /* Rule 4 — a unit is waiting for the student. */
  for (const c of casesRes.data ?? []) {
    candidates.push({
      alertType: `case_waiting_${c.status}`,
      severity: "high",
      titleEn: c.status === "resolution_proposed" ? "A resolution is waiting for your answer" : "Your request is waiting for you",
      titleAr: c.status === "resolution_proposed" ? "هناك حل بانتظار ردك" : "طلبك بانتظار ردك",
      bodyEn: `${c.case_number} — ${c.title}. The unit cannot move forward until you reply.`,
      bodyAr: `${c.case_number} — ${c.title}. لا يمكن للجهة المختصة المتابعة حتى ترد.`,
      actionLabelEn: "Open the request",
      actionLabelAr: "فتح الطلب",
      actionUrl: `/requests/${c.id}`,
      relatedCaseId: c.id,
    });
  }

  /* Rule 5 — a requirement deadline is close. */
  for (const r of requirementsRes.data ?? []) {
    const due = r.due_date ? new Date(r.due_date).getTime() : null;
    if (due == null) continue;
    const days = Math.round((due - now) / DAY);
    if (days < 0 || days > 14) continue;
    candidates.push({
      alertType: "requirement_due_soon",
      severity: days <= 3 ? "critical" : "high",
      titleEn: `Requirement due in ${days} day${days === 1 ? "" : "s"}`,
      titleAr: `متطلب مستحق خلال ${days} يوم`,
      bodyEn: `${r.title_en} is due on ${r.due_date}. Leaving it can block your registration.`,
      bodyAr: `${r.title_ar} مستحق بتاريخ ${r.due_date}. تأخيره قد يمنع تسجيلك.`,
      actionLabelEn: "Ask Sanadi to help",
      actionLabelAr: "اطلب مساعدة سندي",
      actionUrl: "/assistant",
      deadline: r.due_date ? new Date(r.due_date).toISOString() : null,
    });
  }

  /* Rule 6 — a hold is silently blocking registration. */
  for (const h of (holdsRes.data ?? []).filter((x) => x.prevents_registration)) {
    candidates.push({
      alertType: "registration_hold_active",
      severity: "critical",
      titleEn: "A hold is blocking your registration",
      titleAr: "يوجد إيقاف يمنع تسجيلك",
      bodyEn: `${h.title_en}. ${h.resolution_action_en ?? "I can open one tracked request to clear it."}`,
      bodyAr: `${h.title_ar}. ${h.resolution_action_ar ?? "يمكنني فتح طلب واحد متابع لرفعه."}`,
      actionLabelEn: "Clear it with Sanadi",
      actionLabelAr: "رفع الإيقاف مع سندي",
      actionUrl: "/assistant?ask=What%20is%20stopping%20me%20from%20registering%3F",
    });
  }

  const fresh = candidates.filter((c) => !active.has(c.alertType));
  if (!fresh.length) return { created: 0, types: [] };

  const { error } = await db.from("student_alerts").insert(
    fresh.map((c) => ({
      student_id: userId,
      alert_type: c.alertType,
      severity: c.severity,
      title_en: c.titleEn,
      title_ar: c.titleAr,
      body_en: c.bodyEn,
      body_ar: c.bodyAr,
      action_label_en: c.actionLabelEn ?? null,
      action_label_ar: c.actionLabelAr ?? null,
      action_url: c.actionUrl ?? null,
      deadline: c.deadline ?? null,
      related_case_id: c.relatedCaseId ?? null,
      status: "active",
    })),
  );
  if (error) {
    console.error("[proactive] insert failed", error.message);
    return { created: 0, types: [] };
  }
  return { created: fresh.length, types: fresh.map((c) => c.alertType) };
}

/** Closes alerts whose trigger no longer holds, so the student never sees stale nudges. */
export async function reconcileProactiveAlerts(db: Db, userId: string): Promise<number> {
  const { data: alerts } = await db
    .from("student_alerts")
    .select("id, alert_type, related_case_id")
    .eq("student_id", userId)
    .eq("status", "active")
    .like("alert_type", "case_waiting_%");
  if (!alerts?.length) return 0;

  const caseIds = alerts.map((a) => a.related_case_id).filter((x): x is string => Boolean(x));
  if (!caseIds.length) return 0;
  const { data: stillWaiting } = await db
    .from("cases")
    .select("id")
    .in("id", caseIds)
    .in("status", ["awaiting_student", "student_confirmation", "resolution_proposed"]);
  const waiting = new Set((stillWaiting ?? []).map((c) => c.id));
  const stale = alerts.filter((a) => a.related_case_id && !waiting.has(a.related_case_id)).map((a) => a.id);
  if (!stale.length) return 0;
  await db.from("student_alerts").update({ status: "resolved" }).in("id", stale);
  return stale.length;
}