import { pendingActionExpired } from "@/lib/routing/state";
/**
 * Conversation continuity.
 *
 * A student must never have to start again. Everything that matters about a
 * conversation already lives in the database (messages, conversation state,
 * issued documents, cases); this module answers two questions the interface
 * needs when Sanadi is reopened on any device:
 *
 *   1. Which conversation was I in?
 *   2. Where had we got to — which topic, which request, who is handling it,
 *      and what is still waiting on me?
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { statusLabel } from "@/lib/cases/status-labels";

export type ContinuityCase = {
  caseId: string;
  caseNumber: string;
  statusEn: string;
  statusAr: string;
  staffName: string | null;
  unitEn: string | null;
  unitAr: string | null;
};

export type ChatContinuity = {
  conversationId: string | null;
  title: string | null;
  updatedAt: string | null;
  /** Short recap of the conversation so far, written by the assistant. */
  summary: string | null;
  /** The topic the conversation was on, in the student's own words. */
  topicEn: string | null;
  topicAr: string | null;
  /** Anything Sanadi is still waiting for from the student. */
  openQuestion: string | null;
  /** An action the student was asked to approve and has not answered yet. */
  awaitingApproval: boolean;
  /** The tracked request this conversation belongs to, with live state. */
  linkedCase: ContinuityCase | null;
  documentCount: number;
};

const EMPTY: ChatContinuity = {
  conversationId: null,
  title: null,
  updatedAt: null,
  summary: null,
  topicEn: null,
  topicAr: null,
  openQuestion: null,
  awaitingApproval: false,
  linkedCase: null,
  documentCount: 0,
};

async function buildContinuity(
  supabase: { from: (t: string) => any },
  userId: string,
  conversationId: string,
): Promise<ChatContinuity> {
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, title, updated_at, related_case_id")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!conv) return EMPTY;

  const [{ data: state }, { data: docs }] = await Promise.all([
    supabase
      .from("conversation_state")
      .select(
        "summary, pending_questions, pending_confirmation_type, current_service_id, current_service_unit_id, related_case_id, updated_at",
      )
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("issued_documents")
      .select("id")
      .eq("student_id", userId)
      .eq("conversation_id", conversationId)
      .is("deleted_at", null),
  ]);

  const questions = Array.isArray(state?.pending_questions) ? (state!.pending_questions as unknown[]) : [];
  const firstQuestion = questions.find((q) => typeof q === "string" && q.trim().length > 0) as
    | string
    | undefined;

  let topicEn: string | null = null;
  let topicAr: string | null = null;
  const unitId = state?.current_service_unit_id ?? null;
  if (unitId) {
    const { data: unit } = await supabase
      .from("service_units")
      .select("name_en, name_ar")
      .eq("id", unitId)
      .maybeSingle();
    topicEn = unit?.name_en ?? null;
    topicAr = unit?.name_ar ?? null;
  }
  if (!topicEn && state?.current_service_id) {
    const { data: service } = await supabase
      .from("services")
      .select("name_en, name_ar")
      .eq("id", state.current_service_id)
      .maybeSingle();
    topicEn = service?.name_en ?? null;
    topicAr = service?.name_ar ?? null;
  }

  let linkedCase: ContinuityCase | null = null;
  const caseId = conv.related_case_id ?? state?.related_case_id ?? null;
  if (caseId) {
    const { data: row } = await supabase
      .from("cases")
      .select("id, case_number, status, assigned_to, service_units(name_en, name_ar)")
      .eq("id", caseId)
      .eq("student_id", userId)
      .maybeSingle();
    if (row) {
      let staffName: string | null = null;
      if (row.assigned_to) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: staff } = await supabaseAdmin
          .from("profiles")
          .select("full_name")
          .eq("id", row.assigned_to)
          .maybeSingle();
        staffName = staff?.full_name ?? null;
      }
      const unit = row.service_units as { name_en?: string; name_ar?: string } | null;
      linkedCase = {
        caseId: row.id,
        caseNumber: row.case_number,
        statusEn: statusLabel(row.status, "en"),
        statusAr: statusLabel(row.status, "ar"),
        staffName,
        unitEn: unit?.name_en ?? null,
        unitAr: unit?.name_ar ?? null,
      };
    }
  }

  return {
    conversationId: conv.id,
    title: conv.title ?? null,
    updatedAt: conv.updated_at ?? null,
    summary: state?.summary ?? null,
    topicEn,
    topicAr,
    openQuestion: firstQuestion ?? null,
    // An expired pending action is not shown as awaiting approval.
    awaitingApproval:
      Boolean(state?.pending_confirmation_type) && !pendingActionExpired(state?.updated_at ?? null, Date.now()),
    linkedCase,
    documentCount: (docs ?? []).length,
  };
}

/**
 * The conversation to reopen, with its restored context. Called with no id it
 * returns the student's most recent conversation — that is what makes a new
 * device, a new browser or a fresh sign-in continue where the student left off.
 */
export const getChatContinuityFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ conversationId: z.string().uuid().nullable().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<ChatContinuity> => {
    const { supabase, userId } = context;
    let conversationId = data.conversationId ?? null;

    if (!conversationId) {
      const { data: recent } = await supabase
        .from("conversations")
        .select("id")
        .eq("user_id", userId)
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      conversationId = recent?.id ?? null;
    }
    if (!conversationId) return EMPTY;

    return buildContinuity(supabase as never, userId, conversationId);
  });
