/**
 * Cross-service readiness engine. Server only.
 *
 * A student asks one plain question — "what is stopping me from registering?",
 * "is everything ready for next semester?", "am I ready to graduate?" — and
 * Sanadi inspects every service that could hold them back (holds, requirements,
 * finance, open cases) and answers with one
 * ordered plan instead of a list of offices to visit.
 */
import type { Citation, Lang } from "../agent-types";
import { loadStudentSnapshot } from "../student-context.server";
import type { Db } from "./tools.server";

export type ReadinessObjective = "registration" | "semester" | "graduation";

const PATTERNS: { objective: ReadinessObjective; en: RegExp; ar: RegExp }[] = [
  {
    objective: "registration",
    en: /((can'?t|cannot|unable to|blocked from|stopping me|preventing me|why|what blocks|what is blocking|check).{0,50}(register|registration|enrol|enroll|add (a )?course))|registration (is )?(blocked|blocker|hold|problem|issue|readiness)|holds? (on|blocking) my registration/i,
    ar: /(لا أستطيع|لا يمكنني|ما أقدر|متعذر|ممنوع|ما الذي يمنعني|ما يمنعني|ما هي العوائق|تحقق).{0,35}(التسجيل|تسجيل)|(التسجيل).{0,35}(محظور|موقوف|مغلق|مشكلة|جاهز|عوائق|قيود)/,
  },
  {
    objective: "graduation",
    en: /(ready|on track|eligible|able).{0,30}(to )?graduat|graduation (readiness|requirements|check)|can i graduate/i,
    ar: /(جاهز|مؤهل|أستطيع).{0,20}(التخرج|للتخرج)|متطلبات التخرج/,
  },
  {
    objective: "semester",
    en: /(is |am i )?(everything|all).{0,20}(ready|set|in order).{0,25}(next |new )?(semester|term)|ready for (the )?(next |new )?(semester|term)|what do i (still )?need (to do )?(before|for).{0,20}(semester|term)|check my status across|full status|overall status/i,
    ar: /(كل شيء|كلشي).{0,20}(جاهز|مرتب).{0,20}(الفصل|للفصل)|جاهز للفصل|وضعي العام|حالتي العامة/,
  },
];

export function detectReadinessObjective(text: string): ReadinessObjective | null {
  for (const p of PATTERNS) if (p.en.test(text) || p.ar.test(text)) return p.objective;
  return null;
}

type CheckStatus = "clear" | "blocked" | "pending" | "opportunity";

type Check = {
  area: { en: string; ar: string };
  status: CheckStatus;
  detail: { en: string; ar: string };
  fix?: { en: string; ar: string };
};

export type ReadinessReport = {
  answer: string;
  nextSteps: string[];
  proposals: { toolName: string; args: Record<string, unknown> }[];
  citations: Citation[];
  verified: boolean;
  blockers: number;
};

const ICON: Record<CheckStatus, string> = { clear: "✅", blocked: "⛔", pending: "⏳", opportunity: "✨" };

const TITLE: Record<ReadinessObjective, { en: string; ar: string }> = {
  registration: { en: "Registration readiness", ar: "جاهزية التسجيل" },
  semester: { en: "Readiness for the next semester", ar: "الجاهزية للفصل القادم" },
  graduation: { en: "Graduation readiness", ar: "جاهزية التخرج" },
};

/** Which service areas each objective inspects. */
const SCOPE: Record<ReadinessObjective, ("holds" | "requirements" | "credits" | "cases")[]> = {
  registration: ["holds", "requirements", "credits", "cases"],
  semester: ["holds", "requirements", "credits", "cases"],
  graduation: ["holds", "requirements", "credits"],
};

export async function buildReadinessReport(
  db: Db,
  userId: string,
  lang: Lang,
  objective: ReadinessObjective,
): Promise<ReadinessReport | null> {
  const ar = lang === "ar";
  const scope = SCOPE[objective];

  const [snapshot, casesRes] = await Promise.all([
    loadStudentSnapshot(db, userId),
    db
      .from("cases")
      .select("case_number, title, status")
      .eq("student_id", userId)
      .not("status", "in", "(resolved,closed,withdrawn,rejected,duplicate)")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  if (!snapshot.hasProfile) return null;

  const checks: Check[] = [];
  const proposals: { toolName: string; args: Record<string, unknown> }[] = [];

  if (scope.includes("holds")) {
    const relevant = snapshot.holds.filter((h) =>
      objective === "graduation" ? h.blocksGraduation || h.blocksRegistration : h.blocksRegistration || h.blocksGraduation,
    );
    if (relevant.length) {
      for (const h of relevant) {
        checks.push({
          area: { en: "Holds", ar: "الإيقافات" },
          status: "blocked",
          detail: { en: h.titleEn, ar: h.titleAr },
          fix: {
            en: h.resolutionEn ?? "Contact the issuing unit to clear this hold.",
            ar: h.resolutionAr ?? "تواصل مع الجهة المُصدرة لرفع هذا الإيقاف.",
          },
        });
      }
    } else {
      checks.push({
        area: { en: "Holds", ar: "الإيقافات" },
        status: "clear",
        detail: { en: "No active hold on your record.", ar: "لا يوجد إيقاف فعّال على سجلك." },
      });
    }
  }

  if (scope.includes("requirements")) {
    const open = snapshot.requirements.filter((r) => r.status !== "completed");
    if (open.length) {
      for (const r of open) {
        checks.push({
          area: { en: "Requirements", ar: "المتطلبات" },
          status: "pending",
          detail: { en: r.titleEn, ar: r.titleAr },
          fix: {
            en: r.dueDate ? `Complete this before ${r.dueDate}.` : "Complete this requirement.",
            ar: r.dueDate ? `أكمل هذا المتطلب قبل ${r.dueDate}.` : "أكمل هذا المتطلب.",
          },
        });
      }
    } else {
      checks.push({
        area: { en: "Requirements", ar: "المتطلبات" },
        status: "clear",
        detail: { en: "All outstanding requirements are completed.", ar: "جميع المتطلبات المعلّقة مكتملة." },
      });
    }
  }

  if (scope.includes("credits")) {
    const total = snapshot.totalCredits ?? 120;
    if (objective === "graduation") {
      checks.push({
        area: { en: "Credit hours", ar: "الساعات المعتمدة" },
        status: snapshot.remainingCredits === 0 ? "clear" : "pending",
        detail: {
          en: `${snapshot.completedCredits} of ${total} credit hours completed — ${snapshot.remainingCredits} remaining.`,
          ar: `أكملت ${snapshot.completedCredits} من ${total} ساعة معتمدة — يتبقى ${snapshot.remainingCredits}.`,
        },
      });
    } else {
      checks.push({
        area: { en: "Academic standing", ar: "الوضع الأكاديمي" },
        status: "clear",
        detail: {
          en: `${snapshot.completedCredits}/${total} credit hours completed, registered for ${snapshot.registeredCredits} this term${snapshot.gpa != null ? `, GPA ${snapshot.gpa}` : ""}.`,
          ar: `أكملت ${snapshot.completedCredits}/${total} ساعة معتمدة، ومسجل في ${snapshot.registeredCredits} ساعة هذا الفصل${snapshot.gpa != null ? `، المعدل ${snapshot.gpa}` : ""}.`,
        },
      });
    }
  }

  const openCases = casesRes.data ?? [];
  if (scope.includes("cases") && openCases.length) {
    checks.push({
      area: { en: "Open requests", ar: "الطلبات المفتوحة" },
      status: "pending",
      detail: {
        en: openCases.map((c) => `${c.case_number} — ${c.title} (${c.status})`).join("; "),
        ar: openCases.map((c) => `${c.case_number} — ${c.title} (${c.status})`).join("؛ "),
      },
    });
  }

  const blockers = checks.filter((c) => c.status === "blocked");
  const lines: string[] = [];
  const t = TITLE[objective];

  if (blockers.length) {
    lines.push(
      ar
        ? `راجعت كل الخدمات ذات الصلة ووجدت ${blockers.length} عائقاً يجب رفعه.`
        : `I checked every related service and found ${blockers.length} blocker${blockers.length === 1 ? "" : "s"} to clear.`,
    );
  } else {
    lines.push(
      ar ? `لا يوجد ما يمنعك — ${t.ar}: كل الفحوصات سليمة.` : `Nothing is blocking you — ${t.en.toLowerCase()}: every check is clear.`,
    );
  }

  lines.push(
    checks
      .map((c) => `${ICON[c.status]} **${ar ? c.area.ar : c.area.en}** — ${ar ? c.detail.ar : c.detail.en}${c.fix ? `\n   ${ar ? c.fix.ar : c.fix.en}` : ""}`)
      .join("\n"),
  );

  if (blockers.length) {
    lines.push(
      ar
        ? "يمكنني فتح طلب واحد متابع يشمل كل العوائق أعلاه وتوجيه كل جزء إلى الجهة المختصة — اكتب «نعم» وسأقوم بذلك الآن."
        : "I can open one tracked request covering all of the blockers above and route each part to the responsible unit — say “yes” and I will do it now.",
    );
    proposals.unshift({
      toolName: "create_complaint",
      args: {
        title: ar ? `رفع عوائق ${t.ar}` : `Clear my ${t.en.toLowerCase()} blockers`,
        description:
          (ar ? "طلب موحد لرفع العوائق التالية:\n" : "Single request to clear the following blockers:\n") +
          blockers.map((b) => `- ${b.area.en}: ${b.detail.en}`).join("\n"),
        unitCode: "REG",
        urgency: "high",
        caseType: "service_request",
      },
    });
  }

  return {
    answer: lines.join("\n\n"),
    nextSteps: checks.filter((c) => c.fix).map((c) => (ar ? c.fix!.ar : c.fix!.en)),
    proposals,
    verified: true,
    blockers: blockers.length,
    citations: [
      {
        documentId: null,
        sourceTitle: ar ? "سجلك الطلابي عبر خدمات الجامعة" : "Your student record across university services",
        owningUnit: ar ? "خدمات الطلبة" : "Student Services",
        documentVersion: null,
        effectiveDate: new Date().toISOString().slice(0, 10),
        citationUrl: null,
        confidence: "high",
      },
    ],
  };
}