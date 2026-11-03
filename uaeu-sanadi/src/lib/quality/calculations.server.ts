/**
 * Deterministic calculations. The model may explain these results but must
 * never compute them itself: every number the student sees comes from here.
 */
export type CalculationResult = {
  calculation: string;
  inputs: Record<string, number | string | boolean | null>;
  result: number | boolean | string | null;
  sourceTimestamp: string;
  validationStatus: "valid" | "insufficient_input";
  explanationEn: string;
  explanationAr: string;
};

const stamp = () => new Date().toISOString();

function insufficient(name: string, inputs: CalculationResult["inputs"]): CalculationResult {
  return {
    calculation: name,
    inputs,
    result: null,
    sourceTimestamp: stamp(),
    validationStatus: "insufficient_input",
    explanationEn: "The required input data was not available, so this value was not calculated.",
    explanationAr: "لم تتوفر البيانات المطلوبة، لذلك لم يتم احتساب هذه القيمة.",
  };
}

export function completedCredits(credits: number | null | undefined): CalculationResult {
  if (credits == null) return insufficient("completed_credits", { credits: null });
  return {
    calculation: "completed_credits",
    inputs: { credits },
    result: credits,
    sourceTimestamp: stamp(),
    validationStatus: "valid",
    explanationEn: `${credits} credit hours completed.`,
    explanationAr: `تم إنجاز ${credits} ساعة معتمدة.`,
  };
}

export function remainingGraduationCredits(
  completed: number | null | undefined,
  required: number | null | undefined,
): CalculationResult {
  if (completed == null || required == null)
    return insufficient("remaining_graduation_credits", { completed: completed ?? null, required: required ?? null });
  const remaining = Math.max(0, required - completed);
  return {
    calculation: "remaining_graduation_credits",
    inputs: { completed, required },
    result: remaining,
    sourceTimestamp: stamp(),
    validationStatus: "valid",
    explanationEn: `${remaining} of ${required} credit hours remain (${completed} completed).`,
    explanationAr: `تبقّى ${remaining} ساعة من أصل ${required} (تم إنجاز ${completed}).`,
  };
}

export function gpaComparison(gpa: number | null | undefined, minimum: number): CalculationResult {
  if (gpa == null) return insufficient("gpa_comparison", { gpa: null, minimum });
  const meets = gpa >= minimum;
  return {
    calculation: "gpa_comparison",
    inputs: { gpa: Number(gpa.toFixed(2)), minimum },
    result: meets,
    sourceTimestamp: stamp(),
    validationStatus: "valid",
    explanationEn: `Cumulative GPA ${gpa.toFixed(2)} ${meets ? "meets" : "is below"} the minimum of ${minimum.toFixed(2)}.`,
    explanationAr: `المعدل التراكمي ${gpa.toFixed(2)} ${meets ? "يحقق" : "أقل من"} الحد الأدنى ${minimum.toFixed(2)}.`,
  };
}

export function internshipEligibility(opts: {
  completedCredits: number | null | undefined;
  requiredCredits: number;
  gpa: number | null | undefined;
  minimumGpa: number;
  activeHolds: number;
}): CalculationResult {
  const { completedCredits: c, requiredCredits, gpa, minimumGpa, activeHolds } = opts;
  if (c == null || gpa == null)
    return insufficient("internship_eligibility", {
      completedCredits: c ?? null,
      gpa: gpa ?? null,
      requiredCredits,
      minimumGpa,
      activeHolds,
    });
  const creditsOk = c >= requiredCredits;
  const gpaOk = gpa >= minimumGpa;
  const holdsOk = activeHolds === 0;
  const eligible = creditsOk && gpaOk && holdsOk;
  const failed = [
    !creditsOk ? { en: "credit hours", ar: "الساعات المعتمدة" } : null,
    !gpaOk ? { en: "cumulative GPA", ar: "المعدل التراكمي" } : null,
    !holdsOk ? { en: "active holds", ar: "الإيقافات النشطة" } : null,
  ].filter(Boolean) as { en: string; ar: string }[];
  return {
    calculation: "internship_eligibility",
    inputs: { completedCredits: c, requiredCredits, gpa: Number(gpa.toFixed(2)), minimumGpa, activeHolds },
    result: eligible,
    sourceTimestamp: stamp(),
    validationStatus: "valid",
    explanationEn: eligible
      ? `Meets all internship conditions: ${c}/${requiredCredits} credit hours, GPA ${gpa.toFixed(2)}/${minimumGpa}, no active holds.`
      : `Does not yet meet: ${failed.map((f) => f.en).join(", ")}.`,
    explanationAr: eligible
      ? `تتحقق جميع شروط التدريب: ${c}/${requiredCredits} ساعة، المعدل ${gpa.toFixed(2)}/${minimumGpa}، بدون إيقافات.`
      : `الشروط غير المستوفاة: ${failed.map((f) => f.ar).join("، ")}.`,
  };
}

export function prerequisiteSatisfied(
  required: string[],
  passed: string[],
): CalculationResult {
  const missing = required.filter((code) => !passed.includes(code));
  return {
    calculation: "prerequisite_satisfaction",
    inputs: { required: required.join(","), passed: passed.join(","), missingCount: missing.length },
    result: missing.length === 0,
    sourceTimestamp: stamp(),
    validationStatus: "valid",
    explanationEn: missing.length ? `Missing prerequisite(s): ${missing.join(", ")}.` : "All prerequisites satisfied.",
    explanationAr: missing.length ? `المتطلبات السابقة الناقصة: ${missing.join("، ")}.` : "جميع المتطلبات السابقة مستوفاة.",
  };
}

export function daysUntil(deadlineIso: string | null | undefined): CalculationResult {
  if (!deadlineIso) return insufficient("days_until_deadline", { deadline: null });
  const days = Math.ceil((new Date(deadlineIso).getTime() - Date.now()) / 86_400_000);
  return {
    calculation: "days_until_deadline",
    inputs: { deadline: deadlineIso },
    result: days,
    sourceTimestamp: stamp(),
    validationStatus: "valid",
    explanationEn: days >= 0 ? `${days} day(s) remaining.` : `Overdue by ${Math.abs(days)} day(s).`,
    explanationAr: days >= 0 ? `متبقٍ ${days} يوم.` : `متأخر بمقدار ${Math.abs(days)} يوم.`,
  };
}
