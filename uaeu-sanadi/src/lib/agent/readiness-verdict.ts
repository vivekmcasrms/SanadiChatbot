/**
 * Deterministic registration-readiness verdict. Pure: no I/O, no model.
 *
 * verified/ready is true ONLY when every required check is PASS or
 * NOT_APPLICABLE. Any UNKNOWN or FAIL makes it false. The model may explain
 * the result but never decides it.
 */
export type CheckState = "pass" | "blocked" | "warning" | "unknown" | "not_applicable";
export type ReadinessStatus = "PASS" | "FAIL" | "UNKNOWN" | "NOT_APPLICABLE";

/** `warning` is advisory (e.g. a timetable clash the student can fix) and does not block. */
export function statusOf(state: CheckState): ReadinessStatus {
  switch (state) {
    case "pass":
    case "warning":
      return "PASS";
    case "blocked":
      return "FAIL";
    case "not_applicable":
      return "NOT_APPLICABLE";
    default:
      return "UNKNOWN";
  }
}

export function statusLabel(status: ReadinessStatus, lang: "en" | "ar"): string {
  const L: Record<ReadinessStatus, [string, string]> = {
    PASS: ["Verified", "تم التحقق"],
    UNKNOWN: ["Unable to verify", "تعذّر التحقق"],
    FAIL: ["Requires attention", "يتطلب إجراء"],
    NOT_APPLICABLE: ["Not applicable", "لا ينطبق"],
  };
  return L[status][lang === "ar" ? 1 : 0];
}

export type Verdict = {
  verified: boolean;
  outcome: "ready" | "action_required" | "unable_to_verify";
  failed: number;
  unknown: number;
};

export function readinessVerdict(checks: { state: CheckState; required?: boolean }[]): Verdict {
  const required = checks.filter((c) => c.required !== false);
  const failed = required.filter((c) => statusOf(c.state) === "FAIL").length;
  const unknown = required.filter((c) => statusOf(c.state) === "UNKNOWN").length;
  // No checks at all is not evidence of readiness.
  const verified = required.length > 0 && failed === 0 && unknown === 0;
  return {
    verified,
    outcome: failed > 0 ? "action_required" : unknown > 0 || !verified ? "unable_to_verify" : "ready",
    failed,
    unknown,
  };
}

export function verdictHeading(v: Verdict, lang: "en" | "ar"): string {
  const ar = lang === "ar";
  if (v.outcome === "ready") return ar ? "**جاهز للتسجيل**" : "**Ready to Register**";
  if (v.outcome === "action_required") return ar ? "**مطلوب إجراء**" : "**Action Required**";
  return ar ? "**تعذّر التحقق من جاهزيتك بالكامل**" : "**Unable to verify full readiness**";
}
