/**
 * Daily digest for service owners and unit staff.
 *
 * Aggregates the day's low-urgency workload into one email per owner instead of
 * one email per event. Bounded by a fixed owner cap per run and deduplicated on
 * owner + day so repeated runs never send twice.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getNotificationSettings, queueEmail } from "./queue.server";

const MAX_OWNERS_PER_RUN = 100;

export type DigestResult = { ran: boolean; reason?: string; owners: number; queued: number };

export async function runOwnerDigest(): Promise<DigestResult> {
  const settings = await getNotificationSettings();
  if (!settings.emails_enabled || !settings.digest_enabled) {
    return { ran: false, reason: "digest_disabled", owners: 0, queued: 0 };
  }

  const today = new Date().toISOString().slice(0, 10);

  const { data: owners } = await supabaseAdmin
    .from("service_unit_owners")
    .select("staff_profile_id, service_unit_id, service_units(name_en, name_ar)")
    .eq("is_active", true)
    .limit(MAX_OWNERS_PER_RUN);

  if (!owners?.length) return { ran: true, owners: 0, queued: 0 };

  let queued = 0;
  for (const owner of owners) {
    const unitId = owner.service_unit_id;
    const unit = owner.service_units as { name_en: string; name_ar: string } | null;

    const [open, overdue, waiting] = await Promise.all([
      supabaseAdmin
        .from("cases")
        .select("id", { count: "exact", head: true })
        .eq("service_unit_id", unitId)
        .not("status", "in", "(resolved,closed,withdrawn,rejected,duplicate)"),
      supabaseAdmin
        .from("cases")
        .select("id", { count: "exact", head: true })
        .eq("service_unit_id", unitId)
        .lt("sla_due_at", new Date().toISOString())
        .not("status", "in", "(resolved,closed,withdrawn,rejected,duplicate)"),
      supabaseAdmin
        .from("cases")
        .select("id", { count: "exact", head: true })
        .eq("service_unit_id", unitId)
        .eq("status", "awaiting_student"),
    ]);

    const openCount = open.count ?? 0;
    const overdueCount = overdue.count ?? 0;
    const waitingCount = waiting.count ?? 0;
    if (openCount === 0 && overdueCount === 0) continue;

    const summaryEn = [
      `• Open cases: ${openCount}`,
      `• Past their service deadline: ${overdueCount}`,
      `• Waiting on the student: ${waitingCount}`,
    ].join("\n");
    const summaryAr = [
      `• الحالات المفتوحة: ${openCount}`,
      `• تجاوزت الموعد النهائي للخدمة: ${overdueCount}`,
      `• بانتظار رد الطالب: ${waitingCount}`,
    ].join("\n");

    const res = await queueEmail({
      eventType: "OWNER_CASE_WAITING",
      recipientUserId: owner.staff_profile_id,
      recipientRole: "service_owner",
      serviceUnitId: unitId,
      actionPath: "/owner-console",
      dedupeKey: `digest:${owner.staff_profile_id}:${unitId}:${today}`,
      force: true,
      vars: {
        unit_name: unit?.name_en ?? "your service unit",
        unit_name_ar: unit?.name_ar ?? "",
        summary_lines: summaryEn,
        summary_lines_ar: summaryAr,
      },
    });
    if (res.queued) queued += 1;
  }

  return { ran: true, owners: owners.length, queued };
}
