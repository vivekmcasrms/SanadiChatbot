/**
 * Deterministic, bilingual detection of a student correcting Sanadi in normal
 * conversation ("no, I meant the library", "لا، أقصد المكتبة").
 *
 * Pure and rule-based on purpose: a correction signal must never depend on a
 * model call, and must never be inferred from a merely negative sentence.
 */
import type { CorrectionType } from "./types";

const CORRECTION_RE =
  /(^|\b)(no,? i (meant|mean|said|asked)|that'?s not what i (meant|asked|said)|not what i (meant|asked)|i didn'?t (mean|ask for) that|i meant\b|i actually (meant|need|want)|wrong (service|department|unit|office|answer|information)|that'?s (the )?wrong\b|you (misunderstood|got it wrong)|this is not (right|correct)|that'?s incorrect|not correct)\b/i;

const CORRECTION_AR_RE =
  /(لا[،,]? ?أقصد|ليس هذا ما (أريد|قصدت|طلبت)|لم أقصد ذلك|أقصد\s|قصدت\s|الخدمة (الخاطئة|غير الصحيحة)|جهة خاطئة|إجابة خاطئة|هذا غير صحيح|غير صحيح|لم تفهم(ني)?|فهمت خطأ)/;

const UNDERSTANDING_RE =
  /(you (didn'?t|don'?t) understand|you (misunderstood|got it wrong)|that'?s not what i (meant|asked|said)|not what i (meant|asked)|لم تفهم|فهمت خطأ|ليس هذا ما (قصدت|طلبت))/i;

const SERVICE_RE =
  /(wrong (service|department|unit|office)|i (meant|mean|need|want) (the )?[a-z ]{3,30} (service|centre|center|office|department|unit|library|clinic)|الخدمة (الخاطئة|غير الصحيحة)|جهة خاطئة|أقصد (مركز|قسم|مكتب|مكتبة|عيادة))/i;

const ANSWER_RE =
  /(wrong (answer|information)|that'?s incorrect|this is not (right|correct)|not correct|إجابة خاطئة|معلومة خاطئة|هذا غير صحيح)/i;

export type NaturalCorrection = {
  isCorrection: boolean;
  /** The correction type to record when `isCorrection` is true. */
  correctionType: CorrectionType;
  /** The phrase that triggered detection — kept for the audit trail. */
  matched: string | null;
};

const NONE: NaturalCorrection = { isCorrection: false, correctionType: "OTHER", matched: null };

export function detectNaturalCorrection(message: string): NaturalCorrection {
  const text = (message ?? "").trim();
  if (!text || text.length > 600) return NONE;

  const hit = CORRECTION_RE.exec(text)?.[0] ?? CORRECTION_AR_RE.exec(text)?.[0] ?? null;
  if (!hit) return NONE;

  // Order matters: a named service beats a generic "wrong answer".
  if (SERVICE_RE.test(text)) return { isCorrection: true, correctionType: "ROUTING_CORRECTION", matched: hit };
  if (ANSWER_RE.test(text)) return { isCorrection: true, correctionType: "RESPONSE_QUALITY", matched: hit };
  if (UNDERSTANDING_RE.test(text)) return { isCorrection: true, correctionType: "INTENT_CORRECTION", matched: hit };
  return { isCorrection: true, correctionType: "STUDENT_CLARIFICATION", matched: hit };
}
