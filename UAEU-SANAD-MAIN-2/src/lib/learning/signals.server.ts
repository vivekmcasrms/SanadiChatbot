/**
 * Observation step of the learning loop: record a correction exactly as it
 * happened. Writing a signal never changes behaviour and never blocks the
 * operation that produced it — every call is best effort.
 */
import { maskExample } from "./privacy";
import { isPolicySensitive } from "./patterns";
import type { CorrectionSource, CorrectionType } from "./types";

export type LearningSignalInput = {
  correctionType: CorrectionType;
  source: CorrectionSource;
  conversationId?: string | null;
  messageId?: string | null;
  caseId?: string | null;
  studentId?: string | null;
  originalDomain?: string | null;
  originalIntent?: string | null;
  originalUnitId?: string | null;
  originalStaffId?: string | null;
  correctedDomain?: string | null;
  correctedIntent?: string | null;
  correctedUnitId?: string | null;
  correctedStaffId?: string | null;
  reasonCode?: string | null;
  originalUserText?: string | null;
  contextSummary?: string | null;
  staffComment?: string | null;
  studentFeedback?: string | null;
  outcome?: string | null;
  confidence?: number;
};

/**
 * Persists one correction. Text is masked before storage, and corrections that
 * touch policy, eligibility, permissions, money or SLA are marked so the
 * pattern detector can never turn them into an automatic proposal.
 */
export async function recordLearningSignal(input: LearningSignalInput): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const masked = {
      original_user_text: maskExample(input.originalUserText, 400) || null,
      staff_comment: maskExample(input.staffComment, 400) || null,
      student_feedback: maskExample(input.studentFeedback, 400) || null,
      relevant_context_summary: maskExample(input.contextSummary, 400) || null,
    };
    await supabaseAdmin.from("learning_signals").insert({
      correction_type: input.correctionType,
      correction_source: input.source,
      conversation_id: input.conversationId ?? null,
      message_id: input.messageId ?? null,
      case_id: input.caseId ?? null,
      student_id: input.studentId ?? null,
      original_domain: input.originalDomain ?? null,
      original_intent: input.originalIntent ?? null,
      original_unit_id: input.originalUnitId ?? null,
      original_staff_id: input.originalStaffId ?? null,
      corrected_domain: input.correctedDomain ?? null,
      corrected_intent: input.correctedIntent ?? null,
      corrected_unit_id: input.correctedUnitId ?? null,
      corrected_staff_id: input.correctedStaffId ?? null,
      reason_code: input.reasonCode ?? null,
      outcome: input.outcome ?? null,
      confidence: input.confidence ?? 0.5,
      policy_sensitive: isPolicySensitive({
        staff_comment: masked.staff_comment,
        student_feedback: masked.student_feedback,
        original_user_text: masked.original_user_text,
      }),
      ...masked,
    });
  } catch {
    // Learning is an observer. It must never break a case action or a chat turn.
  }
}
