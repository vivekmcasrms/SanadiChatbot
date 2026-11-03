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

import { evaluateReadiness, type CheckStatus, type ReadinessObjective } from "./readiness-rules";
export type { ReadinessObjective };

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

export type ReadinessReport = {
  answer: string;
  nextSteps: string[];
  proposals: { toolName: string; args: Record<string, unknown> }[];
  citations: Citation[];
  verified: boolean;
  blockers: number;
};

const TITLE: Record<ReadinessObjective, { en: string; ar: string }> = {
  registration: { en: "Registration readiness", ar: "جاهزية التسجيل" },
  semester: { en: "Readiness for the next semester", ar: "الجاهزية للفصل القادم" },
  graduation: { en: "Graduation readiness", ar: "جاهزية التخرج" },
};
const SCOPE: Record<ReadinessObjective, ("cases" | "other")[]> = {
  registration: ["cases"],
  semester: ["cases"],
  graduation: [],
};

const ICON: Record<CheckStatus, string> = { clear: "✅", blocked: "⛔", pending: "⏳", unknown: "❔" };

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

  const ev = evaluateReadiness(objective, {
    ...snapshot,
    openCases: scope.includes("cases") ? (casesRes.data ?? []) : [],
  });
  const checks = ev.checks;
  const blockers = checks.filter((c) => c.status === "blocked");
  const proposals: { toolName: string; args: Record<string, unknown> }[] = [];
  const lines: string[] = [];
  const t = TITLE[objective];
  lines.push(ar ? ev.summary.ar : ev.summary.en);
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
    verified: ev.unknown === 0,
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