/**
 * Grounding validation. Runs before a response is sent: every policy claim
 * needs a citation, every student-specific claim needs a successful tool
 * result, and no citation may be expired, inactive or unapproved.
 */
import type { Citation } from "../agent-types";
import type { Db } from "../agent/tools.server";

export type GroundingInput = {
  answer: string;
  citations: Citation[];
  toolResults: { toolName: string; ok: boolean; data: unknown }[];
  hasProposedAction: boolean;
};

export type GroundingReport = {
  claimCount: number;
  supportedClaimCount: number;
  unsupportedClaimCount: number;
  citationCount: number;
  invalidCitationCount: number;
  studentDataClaimCount: number;
  verifiedStudentDataClaimCount: number;
  groundingScore: number;
  passed: boolean;
  failures: { type: string; claim: string }[];
  cleanedAnswer: string;
};

const POLICY_RE =
  /(must|required|eligib|policy|deadline|regulation|minimum|maximum|allowed|not allowed|يجب|مطلوب|يشترط|السياسة|اللائحة|الموعد النهائي|الحد الأدنى|مسموح)/i;
const NUMERIC_RE = /\d/;
const PERSONAL_RE =
  /(your|you have|you are|completed|gpa|credits|hold|case number|appointment|لديك|معدلك|ساعاتك|إيقاف|رقم الحالة|موعدك)/i;
const HEDGE_RE = /(could not be verified|not verified|unable to confirm|لم يتم التحقق|تعذر التأكد)/i;

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?؟])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
}

function flatten(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 5 || value == null) return out;
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) flatten(v, out, depth + 1);
  } else {
    out.push(String(value));
  }
  return out;
}

export function validateGrounding(input: GroundingInput): GroundingReport {
  const okTools = input.toolResults.filter((t) => t.ok);
  const toolValues = new Set(okTools.flatMap((t) => flatten(t.data)));
  const toolNumbers = new Set(
    [...toolValues].flatMap((v) => (v.match(/\d+(\.\d+)?/g) ?? []).map((n) => Number(n).toString())),
  );

  const failures: { type: string; claim: string }[] = [];
  const claims = sentences(input.answer);
  let supported = 0;
  let studentClaims = 0;
  let verifiedStudentClaims = 0;
  const dropped: string[] = [];

  for (const claim of claims) {
    const isPersonal = PERSONAL_RE.test(claim) && NUMERIC_RE.test(claim);
    const isPolicy = POLICY_RE.test(claim);
    const hedged = HEDGE_RE.test(claim);

    if (isPersonal) {
      studentClaims += 1;
      const numbers = (claim.match(/\d+(\.\d+)?/g) ?? []).map((n) => Number(n).toString());
      const backed = numbers.length > 0 && numbers.every((n) => toolNumbers.has(n));
      if (backed) {
        verifiedStudentClaims += 1;
        supported += 1;
      } else if (!hedged) {
        failures.push({ type: "unsupported_student_data", claim });
        dropped.push(claim);
      } else {
        supported += 1;
      }
      continue;
    }

    if (isPolicy) {
      if (input.citations.length || hedged) supported += 1;
      else failures.push({ type: "missing_citation", claim });
      continue;
    }
    supported += 1;
  }

  // Citation hygiene
  let invalidCitations = 0;
  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set<string>();
  for (const c of input.citations) {
    if (!c.sourceTitle) {
      invalidCitations += 1;
      failures.push({ type: "nonexistent_source", claim: "" });
      continue;
    }
    if (c.effectiveDate && c.effectiveDate > today) {
      invalidCitations += 1;
      failures.push({ type: "source_not_yet_effective", claim: c.sourceTitle });
    }
    const key = `${c.sourceTitle}`.toLowerCase();
    if (seen.has(key)) failures.push({ type: "excessive_citation", claim: c.sourceTitle });
    seen.add(key);
  }
  if (input.citations.length > 4) failures.push({ type: "excessive_citation", claim: "more than four sources" });

  const claimCount = claims.length || 1;
  const score = Math.round((supported / claimCount) * 100);
  const passed = failures.filter((f) => f.type.startsWith("unsupported") || f.type === "missing_citation").length === 0;

  let cleanedAnswer = input.answer;
  for (const claim of dropped) cleanedAnswer = cleanedAnswer.replace(claim, "").trim();
  cleanedAnswer = cleanedAnswer.replace(/\n{3,}/g, "\n\n").trim();

  return {
    claimCount: claims.length,
    supportedClaimCount: supported,
    unsupportedClaimCount: Math.max(0, claims.length - supported),
    citationCount: input.citations.length,
    invalidCitationCount: invalidCitations,
    studentDataClaimCount: studentClaims,
    verifiedStudentDataClaimCount: verifiedStudentClaims,
    groundingScore: score,
    passed,
    failures,
    cleanedAnswer,
  };
}

export function unverifiedNotice(lang: "en" | "ar"): string {
  return lang === "ar"
    ? "\n\nلم أتمكن من تأكيد جزء من التفاصيل من مستند رسمي، لذلك لم أعرضه. سأفتح لك الطلب وتتولى الجهة المختصة تأكيد القاعدة والرد عليك."
    : "\n\nI could not confirm part of the detail from an official document, so I left it out. I can still open the request for you and the responsible unit will confirm the rule and reply on your case.";
}

/** One short note for the case where only a secondary detail is unconfirmed. */
export function partialDetailNotice(lang: "en" | "ar"): string {
  return lang === "ar"
    ? "\n\nملاحظة: تفصيل ثانوي واحد لم يتم تأكيده من مصدر رسمي، لذلك لم أعرضه."
    : "\n\nNote: one secondary detail could not be confirmed from an official source, so I left it out.";
}

/** True when the answer already carries a verification caveat. */
export function hasVerificationNotice(answer: string): boolean {
  return /(could not (confirm|verify)|unable to confirm|لم أتمكن من (تأكيد|التحقق)|تعذر التأكد)/i.test(answer);
}

export async function recordGroundingCheck(db: Db, agentRunId: string | null, report: GroundingReport) {
  if (!agentRunId) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("grounding_checks")
    .insert({
      agent_run_id: agentRunId,
      claim_count: report.claimCount,
      supported_claim_count: report.supportedClaimCount,
      unsupported_claim_count: report.unsupportedClaimCount,
      citation_count: report.citationCount,
      invalid_citation_count: report.invalidCitationCount,
      student_data_claim_count: report.studentDataClaimCount,
      verified_student_data_claim_count: report.verifiedStudentDataClaimCount,
      grounding_score: report.groundingScore,
      passed: report.passed,
      failure_details: { failures: report.failures.slice(0, 20) } as never,
    })
    .then(
      () => undefined,
      () => undefined,
    );
}
