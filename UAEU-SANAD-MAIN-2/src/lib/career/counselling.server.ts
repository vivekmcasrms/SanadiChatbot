/**
 * Career counselling requests.
 *
 * A "Request a Counsellor" click creates a genuine institutional case through
 * the shared intake pipeline: classification, routing to the Career and
 * Internship Services unit, assignment to the configured owner/counsellor,
 * SLA start, notification and audit trail. Nothing here is hard-coded to a
 * named member of staff — the responsible person always comes from the unit
 * ownership configuration.
 */
import type { Db } from "./career.server";

export const COUNSELLING_TITLE_EN = "Career counselling request";
export const COUNSELLING_UNIT_CODE = "CAREER";

/** Statuses that mean the request is still being worked on. */
const OPEN_STATUSES = [
  "draft",
  "submitted",
  "acknowledged",
  "assigned",
  "classified",
  "routed",
  "in_review",
  "in_progress",
  "awaiting_student",
  "student_confirmation",
  "resolution_proposed",
  "escalated",
  "on_hold",
  "ai_processing",
  "transferred",
  "reopened",
];

export type CounsellingRequest = {
  id: string;
  reference: string;
  status: string;
  createdAt: string;
  firstResponseDueAt: string | null;
  resolutionDueAt: string | null;
};

export async function findOpenCounsellingRequest(db: Db, studentId: string): Promise<CounsellingRequest | null> {
  const { data } = await db
    .from("cases")
    .select("id, case_number, status, created_at, first_response_due_at, resolution_due_at")
    .eq("student_id", studentId)
    .eq("title", COUNSELLING_TITLE_EN)
    .in("status", OPEN_STATUSES as never[])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    reference: data.case_number,
    status: data.status,
    createdAt: data.created_at,
    firstResponseDueAt: data.first_response_due_at,
    resolutionDueAt: data.resolution_due_at,
  };
}

function describe(note: string | null, summary: string | null) {
  const lines = [
    "The student has asked to meet a human career counsellor to discuss their career direction.",
    note ? `Student's reason: ${note}` : "Student did not add a specific reason.",
  ];
  if (summary) lines.push(`Profile summary: ${summary}`);
  return lines.join("\n");
}

/** Short, non-sensitive summary of the student's career profile for the counsellor. */
async function profileSummary(db: Db, studentId: string): Promise<string | null> {
  const { data } = await db
    .from("student_career_profiles")
    .select("preferred_roles, preferred_fields, work_orientation")
    .eq("student_id", studentId)
    .maybeSingle();
  if (!data) return null;
  const parts: string[] = [];
  if (data.preferred_roles?.length) parts.push(`preferred roles: ${data.preferred_roles.slice(0, 5).join(", ")}`);
  if (data.preferred_fields?.length) parts.push(`fields: ${data.preferred_fields.slice(0, 5).join(", ")}`);
  if (data.work_orientation) parts.push(`orientation: ${data.work_orientation}`);
  return parts.length ? parts.join(" · ") : null;
}

export async function createCounsellingRequest(opts: {
  supabase: Db;
  studentId: string;
  note: string | null;
  lang: "en" | "ar";
}): Promise<{ created: boolean; request: CounsellingRequest; acknowledgement: string }> {
  const { supabase, studentId, lang } = opts;

  // Duplicate protection: repeated clicks return the live request unchanged.
  const existing = await findOpenCounsellingRequest(supabase, studentId);
  if (existing) {
    return {
      created: false,
      request: existing,
      acknowledgement:
        lang === "ar"
          ? `لديك طلب إرشاد مهني قائم بالفعل (${existing.reference}).`
          : `You already have an open counselling request (${existing.reference}).`,
    };
  }

  const summary = await profileSummary(supabase, studentId);
  const note = opts.note?.trim() ? opts.note.trim() : null;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: unit } = await supabaseAdmin
    .from("service_units")
    .select("id")
    .eq("code", COUNSELLING_UNIT_CODE)
    .eq("is_active", true)
    .maybeSingle();

  const { submitInteraction } = await import("@/lib/interactions/intake.server");
  const result = await submitInteraction({
    studentId,
    lang,
    title: COUNSELLING_TITLE_EN,
    description: describe(note, summary),
    shortcutHint: "query",
    channel: "shortcut",
    unitId: unit?.id ?? null,
    urgencyHint: "medium",
    desiredResolution: "A counselling session or written guidance from a career counsellor.",
  });

  await supabase
    .from("student_career_profiles")
    .upsert(
      {
        student_id: studentId,
        counsellor_requested: true,
        shared_with_counsellor: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id" },
    );

  await supabase.from("career_counselling_events").insert({
    student_id: studentId,
    event_type: "counsellor_requested",
    actor_id: studentId,
    details: { note, case_id: result.id, reference: result.reference } as never,
  });

  // Routing and assignment run just behind intake, so give them a short moment
  // to land before we report status back to the student.
  let routed: {
    assigned_to: string | null;
    service_unit_id: string | null;
    status: string;
    first_response_due_at: string | null;
    resolution_due_at: string | null;
    created_at: string;
    case_number: string;
  } | null = null;
  const readCase = async () =>
    (
      await supabaseAdmin
        .from("cases")
        .select("assigned_to, service_unit_id, status, first_response_due_at, resolution_due_at, created_at, case_number")
        .eq("id", result.id)
        .maybeSingle()
    ).data;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const data = await readCase();
    routed = data ?? routed;
    if (data?.assigned_to) break;
    await new Promise((r) => setTimeout(r, 400));
  }

  // If assignment still has not landed, keep watching in the background and
  // escalate to the service owner rather than letting the request sit silently
  // in a queue. The student is never made to wait for this.
  if (routed && !routed.assigned_to) {
    void (async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((r) => setTimeout(r, 1000));
        const later = await readCase();
        if (later?.assigned_to) return;
      }
      const { escalateCase } = await import("@/lib/ops/routing.server");
      await escalateCase({
        caseId: result.id,
        reason: "No career counsellor available for assignment",
        triggerType: "no_assignee",
      });
      const { notifyUnitStaff } = await import("@/lib/ops/notify.server");
      await notifyUnitStaff(routed?.service_unit_id ?? unit?.id ?? null, null, {
        eventType: "new_assignment",
        entityType: "case",
        entityId: result.id,
        vars: { case_number: result.reference },
        actionUrl: `/requests/${result.id}`,
        dedupeKey: `counselling:${result.id}`,
      });
    })();
  }



  await supabaseAdmin.from("audit_logs").insert({
    actor_id: studentId,
    action: "career.counselling.requested",
    entity_type: "case",
    entity_id: result.id,
    metadata: { reference: result.reference, assigned_to: routed?.assigned_to ?? null } as never,
  });

  return {
    created: true,
    request: {
      id: result.id,
      reference: result.reference,
      status: routed?.status ?? "submitted",
      createdAt: routed?.created_at ?? new Date().toISOString(),
      firstResponseDueAt: routed?.first_response_due_at ?? null,
      resolutionDueAt: routed?.resolution_due_at ?? null,
    },
    acknowledgement: lang === "ar" ? result.acknowledgementAr : result.acknowledgementEn,
  };
}
