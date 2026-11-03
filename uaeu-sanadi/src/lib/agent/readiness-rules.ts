/**
 * Deterministic readiness rules. Pure — no I/O, safe to unit-test.
 *
 * Separate concepts are evaluated as separate checks and never collapsed into
 * one "all clear": holds, academic standing, programme requirements, credit
 * requirements, and (for graduation) the derived "eligible to graduate".
 * Missing or unreadable data is "unknown" — never a pass.
 */
export type ReadinessObjective = "registration" | "semester" | "graduation";
export type CheckStatus = "clear" | "blocked" | "pending" | "unknown";
export type Bi = { en: string; ar: string };

export type ReadinessInput = {
  totalCredits: number | null;
  totalCreditsVerified: boolean;
  completedCredits: number | null;
  completedCreditsKnown: boolean;
  registeredCredits: number;
  gpa: number | null;
  standing: string | null;
  holdsKnown: boolean;
  holds: { titleEn: string; titleAr: string; resolutionEn: string | null; resolutionAr: string | null; blocksRegistration: boolean; blocksGraduation: boolean }[];
  requirementsKnown: boolean;
  requirements: { titleEn: string; titleAr: string; status: string; dueDate: string | null }[];
  openCases?: { case_number: string; title: string; status: string }[];
};

export type ReadinessCheck = { key: string; area: Bi; status: CheckStatus; detail: Bi; fix?: Bi };

export type ReadinessEvaluation = {
  checks: ReadinessCheck[];
  blockers: number;
  pending: number;
  unknown: number;
  /** True only when every check is clear. */
  allClear: boolean;
  /** Graduation only: true only when credits, requirements, holds and standing are all verified clear. */
  eligibleToGraduate: boolean | null;
  summary: Bi;
};

const POOR_STANDING = /probation|suspend|dismiss|warning|إنذار|موقوف|مفصول/i;

const TITLE: Record<ReadinessObjective, Bi> = {
  registration: { en: "Registration readiness", ar: "جاهزية التسجيل" },
  semester: { en: "Readiness for the next semester", ar: "الجاهزية للفصل القادم" },
  graduation: { en: "Graduation readiness", ar: "جاهزية التخرج" },
};

const UNKNOWN_DETAIL: Bi = { en: "Unknown — unable to verify from your record.", ar: "غير معروف — تعذّر التحقق من سجلك." };

export function evaluateReadiness(objective: ReadinessObjective, s: ReadinessInput): ReadinessEvaluation {
  const checks: ReadinessCheck[] = [];

  // 1. Holds
  if (!s.holdsKnown) {
    checks.push({ key: "holds", area: { en: "Holds", ar: "الإيقافات" }, status: "unknown", detail: UNKNOWN_DETAIL });
  } else {
    const relevant = s.holds.filter((h) =>
      objective === "graduation" ? h.blocksGraduation : h.blocksRegistration || h.blocksGraduation,
    );
    if (relevant.length) {
      for (const h of relevant)
        checks.push({
          key: "holds",
          area: { en: "Holds", ar: "الإيقافات" },
          status: "blocked",
          detail: { en: h.titleEn, ar: h.titleAr },
          fix: {
            en: h.resolutionEn ?? "Contact the issuing unit to clear this hold.",
            ar: h.resolutionAr ?? "تواصل مع الجهة المُصدرة لرفع هذا الإيقاف.",
          },
        });
    } else {
      checks.push({ key: "holds", area: { en: "Holds", ar: "الإيقافات" }, status: "clear", detail: { en: "No active hold on your record.", ar: "لا يوجد إيقاف فعّال على سجلك." } });
    }
  }

  // 2. Academic standing
  const standingArea = { en: "Academic standing", ar: "الوضع الأكاديمي" };
  if (!s.standing) checks.push({ key: "standing", area: standingArea, status: "unknown", detail: UNKNOWN_DETAIL });
  else
    checks.push({
      key: "standing",
      area: standingArea,
      status: POOR_STANDING.test(s.standing) ? "blocked" : "clear",
      detail: { en: `${s.standing}${s.gpa != null ? `, GPA ${s.gpa}` : ""}.`, ar: `${s.standing}${s.gpa != null ? `، المعدل ${s.gpa}` : ""}.` },
    });

  // 3. Programme requirements
  const reqArea = { en: "Programme requirements", ar: "متطلبات البرنامج" };
  if (!s.requirementsKnown) checks.push({ key: "requirements", area: reqArea, status: "unknown", detail: UNKNOWN_DETAIL });
  else {
    const open = s.requirements.filter((r) => r.status !== "completed");
    if (open.length)
      for (const r of open)
        checks.push({
          key: "requirements",
          area: reqArea,
          status: "pending",
          detail: { en: r.titleEn, ar: r.titleAr },
          fix: {
            en: r.dueDate ? `Complete this before ${r.dueDate}.` : "Complete this requirement.",
            ar: r.dueDate ? `أكمل هذا المتطلب قبل ${r.dueDate}.` : "أكمل هذا المتطلب.",
          },
        });
    else checks.push({ key: "requirements", area: reqArea, status: "clear", detail: { en: "No outstanding requirement on your record.", ar: "لا توجد متطلبات معلّقة في سجلك." } });
  }

  // 4. Credit requirement
  const credArea = { en: "Credit hours", ar: "الساعات المعتمدة" };
  const total = s.totalCredits;
  const done = s.completedCredits;
  if (!s.completedCreditsKnown || done == null || !s.totalCreditsVerified || total == null) {
    checks.push({
      key: "credits",
      area: credArea,
      status: "unknown",
      detail: done != null && s.completedCreditsKnown
        ? { en: `${done} credit hours completed; programme total could not be verified.`, ar: `أكملت ${done} ساعة معتمدة؛ تعذّر التحقق من إجمالي ساعات البرنامج.` }
        : UNKNOWN_DETAIL,
    });
  } else {
    const remaining = Math.max(0, total - done);
    const detail = {
      en: `${done} of ${total} credit hours completed — ${remaining} remaining.`,
      ar: `أكملت ${done} من ${total} ساعة معتمدة — يتبقى ${remaining}.`,
    };
    // Remaining credits only gate graduation; for registration they are progress info.
    checks.push({ key: "credits", area: credArea, status: objective === "graduation" ? (remaining === 0 ? "clear" : "pending") : "clear", detail });
  }

  // 5. Open requests (registration / semester only; informational)
  if (objective !== "graduation" && s.openCases?.length)
    checks.push({
      key: "cases",
      area: { en: "Open requests", ar: "الطلبات المفتوحة" },
      status: "pending",
      detail: {
        en: s.openCases.map((c) => `${c.case_number} — ${c.title} (${c.status})`).join("; "),
        ar: s.openCases.map((c) => `${c.case_number} — ${c.title} (${c.status})`).join("؛ "),
      },
    });

  const count = (st: CheckStatus) => checks.filter((c) => c.status === st).length;
  const blockers = count("blocked");
  const pending = count("pending");
  const unknown = count("unknown");
  const allClear = blockers === 0 && pending === 0 && unknown === 0;
  const eligibleToGraduate = objective === "graduation" ? allClear : null;
  const t = TITLE[objective];

  let summary: Bi;
  if (objective === "graduation") {
    if (allClear)
      summary = { en: "Based on your student record, every graduation check is met.", ar: "بحسب سجلك الطلابي، جميع شروط التخرج مستوفاة." };
    else if (blockers)
      summary = { en: `You are not yet eligible to graduate — ${blockers} blocker${blockers === 1 ? "" : "s"} must be cleared first.`, ar: `لست مؤهلاً للتخرج بعد — يجب رفع ${blockers} من العوائق أولاً.` };
    else if (pending)
      summary = { en: "You are not yet eligible to graduate — some requirements are still outstanding.", ar: "لست مؤهلاً للتخرج بعد — بعض المتطلبات ما زالت غير مكتملة." };
    else
      summary = { en: "I can't confirm graduation eligibility — some checks could not be verified from your record.", ar: "لا أستطيع تأكيد أهليتك للتخرج — تعذّر التحقق من بعض الشروط في سجلك." };
  } else if (blockers) {
    summary = { en: `I checked every related service and found ${blockers} blocker${blockers === 1 ? "" : "s"} to clear.`, ar: `راجعت كل الخدمات ذات الصلة ووجدت ${blockers} من العوائق يجب رفعها.` };
  } else if (allClear) {
    summary = { en: `${t.en}: every check is clear.`, ar: `${t.ar}: كل الفحوصات سليمة.` };
  } else if (unknown) {
    summary = { en: `${t.en}: nothing is blocking you, but ${unknown} check${unknown === 1 ? "" : "s"} could not be verified.`, ar: `${t.ar}: لا يوجد عائق، لكن تعذّر التحقق من ${unknown} من الفحوصات.` };
  } else {
    summary = { en: `${t.en}: nothing is blocking you; ${pending} item${pending === 1 ? " is" : "s are"} still pending.`, ar: `${t.ar}: لا يوجد عائق، لكن ما زال ${pending} من البنود معلّقاً.` };
  }

  return { checks, blockers, pending, unknown, allClear, eligibleToGraduate, summary };
}
