/**
 * "Ask the Librarian" human handoff.
 *
 * A librarian request is a genuine institutional case created through the
 * shared intake pipeline (classification, routing to Library Services,
 * assignment to the configured owner, SLA start, notification and audit
 * trail). Nothing is inserted straight into `cases` here, so the request shows
 * up in Needs Your Attention and My Requests like every other case.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const LIBRARIAN_TITLE_EN = "Ask the Librarian request";
export const LIBRARY_UNIT_CODE = "LIB";

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

export type LibrarianRequest = {
  id: string;
  reference: string;
  status: string;
  createdAt: string;
  firstResponseDueAt: string | null;
  resolutionDueAt: string | null;
};

type Db = { from: (table: string) => any };

export async function findOpenLibrarianRequest(db: Db, studentId: string): Promise<LibrarianRequest | null> {
  const { data } = await db
    .from("cases")
    .select("id, case_number, status, created_at, first_response_due_at, resolution_due_at")
    .eq("student_id", studentId)
    .eq("title", LIBRARIAN_TITLE_EN)
    .in("status", OPEN_STATUSES)
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

/**
 * Creates (or returns the live) librarian request. Repeated asks never open a
 * second case for the same student.
 */
export async function createLibrarianRequest(opts: {
  db: Db;
  studentId: string;
  question: string;
  details?: string | null;
  lang: "en" | "ar";
  conversationId?: string | null;
}): Promise<{ created: boolean; request: LibrarianRequest; acknowledgement: string }> {
  const { db, studentId, lang } = opts;

  const existing = await findOpenLibrarianRequest(db, studentId);
  if (existing) {
    return {
      created: false,
      request: existing,
      acknowledgement:
        lang === "ar"
          ? `لديك طلب قائم لدى خدمات المكتبة (${existing.reference}) وسيتم الرد عليه.`
          : `You already have an open request with Library Services (${existing.reference}).`,
    };
  }

  const question = opts.question.trim().slice(0, 2000);
  const details = opts.details?.trim() ? opts.details.trim().slice(0, 2000) : null;

  const { data: unit } = await supabaseAdmin
    .from("service_units")
    .select("id")
    .eq("code", LIBRARY_UNIT_CODE)
    .eq("is_active", true)
    .maybeSingle();

  const { submitInteraction } = await import("@/lib/interactions/intake.server");
  const result = await submitInteraction({
    studentId,
    lang,
    title: LIBRARIAN_TITLE_EN,
    description: details
      ? `Library question from the student:\n${question}\n\nAdditional details: ${details}`
      : `Library question from the student:\n${question}`,
    shortcutHint: "query",
    channel: opts.conversationId ? "chat" : "shortcut",
    unitId: unit?.id ?? null,
    urgencyHint: "medium",
    conversationId: opts.conversationId ?? null,
    desiredResolution: "A verified answer or guidance from a librarian.",
  });

  const { data: routed } = await supabaseAdmin
    .from("cases")
    .select("status, created_at, first_response_due_at, resolution_due_at, case_number")
    .eq("id", result.id)
    .maybeSingle();

  const request: LibrarianRequest = {
    id: result.id,
    reference: routed?.case_number ?? result.reference,
    status: routed?.status ?? "submitted",
    createdAt: routed?.created_at ?? new Date().toISOString(),
    firstResponseDueAt: routed?.first_response_due_at ?? null,
    resolutionDueAt: routed?.resolution_due_at ?? null,
  };

  return {
    created: true,
    request,
    acknowledgement:
      lang === "ar"
        ? `تم إرسال سؤالك إلى خدمات المكتبة برقم مرجعي ${request.reference}، ويمكنك متابعته من "طلباتي".`
        : `Your question has been sent to Library Services with reference ${request.reference}. You can follow it in My Requests.`,
  };
}
