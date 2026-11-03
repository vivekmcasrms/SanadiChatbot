import { emiratiGloss } from "@/lib/arabic/emirati";
/**
 * Career Counselling inside the Assistant chat.
 *
 * This module owns nothing analytical: every number it shows comes from
 * `analyseCareer`, the same deterministic engine behind the Career page. Its
 * job is only to (a) recognise a career question in natural language, and
 * (b) turn one analysis run into a grounded answer plus a compact chat card.
 *
 * No model is involved in producing a score, a fit percentage or a gap here.
 */
import type { CareerInsightCard } from "@/lib/agent-types";
import type { CareerAnalysis, Db } from "./career.server";
import { analyseCareer } from "./career.server";
import { findOpenCounsellingRequest } from "./counselling.server";

export type CareerChatTopic = CareerInsightCard["topic"];

type Lang = "en" | "ar";

/* ------------------------------------------------------------------ */
/* Intent detection                                                    */
/* ------------------------------------------------------------------ */

/**
 * Ordered most-specific-first: a message mentioning both "interview" and "cv"
 * is an interview question, so the first match wins.
 */
const TOPIC_PATTERNS: { topic: CareerChatTopic; pattern: RegExp }[] = [
  {
    topic: "counsellor",
    pattern:
      /\b(career (adviser|advisor|counsell?or|coach)|counsell?or|speak to (someone|a human|an advisor)|talk to (someone|a human|an advisor)|book .*(advisor|counsell?or)|human help)\b|مرشد|مستشار مهني|أتحدث مع (شخص|مختص)/i,
  },
  {
    topic: "interview",
    pattern:
      /\b(interview|interviews|mock interview|interview questions|hiring manager questions|prepare for (an|the|my) interview|behavioural questions|behavioral questions)\b|مقابلة|مقابلات|أسئلة المقابلة/i,
  },
  {
    topic: "ats",
    pattern:
      /\b(ats|applicant tracking|screening system|resume score|cv score|score of my (cv|resume)|why is my (score|ats)|pass the (screening|filter)|keyword(s)? (match|missing))\b|نظام الفرز|أنظمة الفرز|درجة السيرة|درجة سيرتي/i,
  },
  {
    topic: "cv_review",
    pattern:
      /\b(review my (cv|resume)|check my (cv|resume)|feedback on my (cv|resume)|improve my (cv|resume)|fix my (cv|resume)|what('| i)?s wrong with my (cv|resume)|is my (cv|resume) (good|strong|ready)|rewrite my (cv|resume)|cv review)\b|مراجعة سيرتي|تحسين سيرتي|السيرة الذاتية/i,
  },
  {
    topic: "skill_gap",
    pattern:
      /\b(skill(s)? (gap|gaps|missing|do i need|should i learn)|what (skills|should i learn|do i need to learn)|missing skills|what am i missing|learn next|upskill|certification(s)? (should|do) i)\b|المهارات (الناقصة|المطلوبة)|ماذا أتعلم/i,
  },
  {
    topic: "readiness",
    pattern:
      /\b(am i ready|ready to apply|application readiness|how employable|employab|am i competitive|ready for the job market|graduate ready)\b|هل أنا جاهز|جاهزية التقديم/i,
  },
  {
    topic: "matches",
    pattern:
      /\b(career|careers|career path|job|jobs|role|roles|profession|vacanc|employment|what (can|could) i (do|work|apply)|which (jobs|roles|careers)|jobs after graduation|suits my degree|match(es)? my (degree|major|programme|program)|career options|job options|career advice|career guidance)\b|مسار مهني|وظائف|الوظائف|فرص عمل|تخصصي.*(وظيفة|عمل)|الإرشاد المهني/i,
  },
];

/** Returns the career topic of a message, or null when it is not a career question. */
export function detectCareerChatTopic(text: string): CareerChatTopic | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  for (const { topic, pattern } of TOPIC_PATTERNS) {
    if (pattern.test(t) || pattern.test(emiratiGloss(t))) return topic;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

const pct = (n: number) => `${Math.round(n)}%`;

function roleTitle(m: { titleEn: string; titleAr: string }, lang: Lang) {
  return lang === "ar" ? m.titleAr : m.titleEn;
}

function bi(v: { en: string; ar: string } | undefined | null, lang: Lang) {
  if (!v) return "";
  return lang === "ar" ? v.ar : v.en;
}

/** Maps one analysis run onto the client-safe chat card. */
export function toCareerInsightCard(
  analysis: CareerAnalysis,
  lang: Lang,
  topic: CareerChatTopic,
  counselling: { reference: string; status: string } | null,
): CareerInsightCard {
  return {
    topic,
    cv: {
      hasCv: analysis.hasCv,
      analysed: analysis.cvAnalyzed,
      fileName: analysis.cvFileName,
      uploadedAt: analysis.cvUploadedAt,
      cvId: analysis.cvId,
    },
    ats: analysis.ats
      ? {
          overall: Math.round(analysis.ats.overall),
          band: lang === "ar" ? analysis.ats.band.labelAr : analysis.ats.band.labelEn,
          strengths: analysis.ats.strengths.slice(0, 4).map((i) => bi(i, lang)),
          improvements: analysis.ats.improvements.slice(0, 4).map((i) => bi(i, lang)),
        }
      : null,
    matches: analysis.matches.slice(0, 3).map((m) => ({
      roleCode: m.roleCode,
      title: roleTitle(m, lang),
      fitScore: Math.round(m.fitScore),
      readinessScore: Math.round(m.jobReadinessScore),
      reason:
        (lang === "ar"
          ? m.evidenceItems.map((e) => e.textAr)
          : m.evidenceItems.map((e) => e.textEn)
        )[0] ?? "",
    })),
    skillGaps: analysis.skillGaps
      ? {
          targetRole: lang === "ar" ? analysis.skillGaps.targetRoleAr : analysis.skillGaps.targetRoleEn,
          strong: analysis.skillGaps.strong.slice(0, 6).map((s) => s.skill),
          developing: analysis.skillGaps.developing.slice(0, 6).map((s) => s.skill),
          missing: analysis.skillGaps.missing.slice(0, 6).map((s) => s.skill),
        }
      : null,
    recommendedActions: analysis.actionPlan.slice(0, 4).map((p) => (lang === "ar" ? p.titleAr : p.titleEn)),
    counsellingRequest: counselling,
    analysisVersion: analysis.versionNo,
    calculatedAt: analysis.calculatedAt,
  };

}

/* ------------------------------------------------------------------ */
/* Deterministic answers                                               */
/* ------------------------------------------------------------------ */

const NO_CV: Record<Lang, string> = {
  en: "I do not have a CV on file for you yet, so this is based on your university record only. Upload your CV right here in the chat and I will score it and come straight back with the results.",
  ar: "لا توجد سيرة ذاتية محفوظة لديك حتى الآن، لذلك يعتمد هذا على سجلك الجامعي فقط. ارفع سيرتك الذاتية هنا في المحادثة وسأقيّمها وأعود إليك بالنتائج مباشرة.",
};


function list(items: string[]) {
  return items.map((i) => `- ${i}`).join("\n");
}

function matchesAnswer(a: CareerAnalysis, lang: Lang) {
  if (!a.matches.length) {
    return lang === "ar"
      ? "لم أتمكن من حساب مسارات مهنية مطابقة من سجلك الحالي."
      : "I could not compute matching career paths from your current record.";
  }
  const lines = a.matches.slice(0, 3).map((m, i) => {
    const evidence = (lang === "ar" ? m.evidenceItems.map((e) => e.textAr) : m.evidenceItems.map((e) => e.textEn))
      .slice(0, 2)
      .join("; ");
    return `${i + 1}. **${roleTitle(m, lang)}** — ${lang === "ar" ? "التوافق" : "fit"} ${pct(m.fitScore)}, ${lang === "ar" ? "الجاهزية" : "readiness"} ${pct(m.jobReadinessScore)}${evidence ? `\n   ${evidence}` : ""}`;
  });
  const head =
    lang === "ar"
      ? "بناءً على برنامجك ومقرراتك المكتملة" + (a.hasCv ? " وسيرتك الذاتية" : "") + "، هذه أقوى المسارات المهنية لك:"
      : `Based on your programme and completed coursework${a.hasCv ? " and your CV" : ""}, these are your strongest career paths:`;
  return `${head}\n\n${lines.join("\n")}${a.hasCv ? "" : `\n\n${NO_CV[lang]}`}`;
}

function atsAnswer(a: CareerAnalysis, lang: Lang) {
  if (!a.ats) {
    return `${lang === "ar" ? "لا يمكن حساب درجة أنظمة الفرز بدون سيرة ذاتية قابلة للقراءة." : "An ATS score needs a readable CV on file."}\n\n${NO_CV[lang]}`;
  }
  const improvements = a.ats.improvements.slice(0, 4).map((i) => bi(i, lang));
  const strengths = a.ats.strengths.slice(0, 3).map((i) => bi(i, lang));
  const parts = [
    lang === "ar"
      ? `درجة سيرتك الذاتية في أنظمة الفرز الآلي هي **${Math.round(a.ats.overall)} من 100**.`
      : `Your CV scores **${Math.round(a.ats.overall)} out of 100** for automated screening.`,
  ];
  if (strengths.length) parts.push(`${lang === "ar" ? "**نقاط القوة**" : "**Working well**"}\n${list(strengths)}`);
  if (improvements.length)
    parts.push(`${lang === "ar" ? "**ما يخفض درجتك**" : "**What is holding the score down**"}\n${list(improvements)}`);
  parts.push(bi(a.ats.disclaimer, lang));
  return parts.join("\n\n");
}

function cvReviewAnswer(a: CareerAnalysis, lang: Lang) {
  if (!a.hasCv || !a.cvAnalyzed) {
    return `${lang === "ar" ? "لا توجد سيرة ذاتية يمكنني مراجعتها." : "There is no CV on file for me to review."}\n\n${NO_CV[lang]}`;
  }
  const parts: string[] = [
    lang === "ar"
      ? `راجعت سيرتك الذاتية المحفوظة (${a.cvFileName ?? "CV"}).`
      : `I reviewed your saved CV (${a.cvFileName ?? "CV"}).`,
  ];
  if (a.ats) {
    parts.push(
      lang === "ar"
        ? `درجة الفرز الآلي: **${Math.round(a.ats.overall)}/100**.`
        : `Automated screening score: **${Math.round(a.ats.overall)}/100**.`,
    );
    const strengths = a.ats.strengths.slice(0, 3).map((i) => bi(i, lang));
    if (strengths.length) parts.push(`${lang === "ar" ? "**ما هو جيد**" : "**Strengths**"}\n${list(strengths)}`);
    const improvements = a.ats.improvements.slice(0, 5).map((i) => bi(i, lang));
    if (improvements.length)
      parts.push(`${lang === "ar" ? "**ما يجب إصلاحه**" : "**What to fix**"}\n${list(improvements)}`);
    if (a.ats.dateIssues.length)
      parts.push(
        `${lang === "ar" ? "**مشكلات في التواريخ**" : "**Date issues**"}\n${list(a.ats.dateIssues.map((d) => bi(d, lang)))}`,
      );
    if (a.ats.recommendedKeywords.length)
      parts.push(
        `${lang === "ar" ? "**كلمات مفتاحية ينبغي إضافتها**" : "**Keywords worth adding**"}\n${list(a.ats.recommendedKeywords.slice(0, 8))}`,
      );
  }
  if (a.discrepancies.length)
    parts.push(
      `${lang === "ar" ? "**اختلافات مقابل سجلك الجامعي**" : "**Differences against your university record**"}\n${list(a.discrepancies.slice(0, 4))}`,
    );
  return parts.join("\n\n");
}

function skillGapAnswer(a: CareerAnalysis, lang: Lang) {
  const g = a.skillGaps;
  const target = (lang === "ar" ? g?.targetRoleAr : g?.targetRoleEn) ?? roleTitle(a.matches[0] ?? { titleEn: "", titleAr: "" }, lang);
  const parts: string[] = [
    target
      ? lang === "ar"
        ? `مقارنة بمتطلبات دور **${target}**:`
        : `Compared with what **${target}** requires:`
      : lang === "ar"
        ? "مقارنة بمتطلبات مسارك المهني الأقرب:"
        : "Compared with your closest career path:",
  ];
  if (g?.strong.length)
    parts.push(`${lang === "ar" ? "**نقاط قوة مثبتة**" : "**Demonstrated strengths**"}\n${list(g.strong.slice(0, 6).map((s) => s.skill))}`);
  if (g?.developing.length)
    parts.push(
      `${lang === "ar" ? "**قيد التطوير (من المقررات)**" : "**Developing (coursework only)**"}\n${list(g.developing.slice(0, 6).map((s) => s.skill))}`,
    );
  if (g?.missing.length)
    parts.push(`${lang === "ar" ? "**ناقصة**" : "**Missing**"}\n${list(g.missing.slice(0, 6).map((s) => s.skill))}`);
  const plan = a.actionPlan.slice(0, 3).map((p) => (lang === "ar" ? `${p.titleAr}: ${p.detailAr}` : `${p.titleEn}: ${p.detailEn}`));
  if (plan.length) parts.push(`${lang === "ar" ? "**الخطوات التالية**" : "**Next steps**"}\n${list(plan)}`);
  if (!a.hasCv) parts.push(NO_CV[lang]);
  return parts.join("\n\n");
}

function readinessAnswer(a: CareerAnalysis, lang: Lang) {
  const top = a.matches[0];
  const parts: string[] = [];
  if (top) {
    parts.push(
      lang === "ar"
        ? `جاهزيتك لدور **${roleTitle(top, lang)}** هي **${pct(top.jobReadinessScore)}** (توافق ${pct(top.fitScore)}).`
        : `Your readiness for **${roleTitle(top, lang)}** is **${pct(top.jobReadinessScore)}** (fit ${pct(top.fitScore)}).`,
    );
  }
  if (a.ats)
    parts.push(
      lang === "ar"
        ? `سيرتك الذاتية تحصل على ${Math.round(a.ats.overall)}/100 في الفرز الآلي.`
        : `Your CV scores ${Math.round(a.ats.overall)}/100 for automated screening.`,
    );
  const missing = a.skillGaps?.missing.slice(0, 4).map((s) => s.skill) ?? [];
  if (missing.length)
    parts.push(`${lang === "ar" ? "**ما يجب إغلاقه قبل التقديم**" : "**Close these before applying**"}\n${list(missing)}`);
  if (!a.hasCv) parts.push(NO_CV[lang]);
  return parts.join("\n\n") || matchesAnswer(a, lang);
}

/** Interview questions built from the target role's own requirements and the student's evidence. */
export function buildInterviewPrep(a: CareerAnalysis, lang: Lang) {
  const top = a.matches[0];
  if (!top) {
    return lang === "ar"
      ? "لم أتمكن من تحديد دور مستهدف لإعداد أسئلة مقابلة."
      : "I could not determine a target role to build interview questions for.";
  }
  const role = roleTitle(top, lang);
  const strengths = top.skillBreakdown.matchedRequired.slice(0, 3);
  const gaps = top.skillBreakdown.missingRequired.slice(0, 3);
  const tools = top.skillBreakdown.matchedTools.slice(0, 2);
  const courses = top.skillBreakdown.matchedCourses.slice(0, 2);

  const q: string[] = [];
  if (lang === "ar") {
    q.push(`لماذا ترى نفسك مناسبًا لدور ${role}؟`);
    strengths.forEach((s) => q.push(`صف موقفًا استخدمت فيه ${s} لحل مشكلة حقيقية.`));
    courses.forEach((c) => q.push(`ما الذي طبقته عمليًا مما تعلمته في ${c}؟`));
    tools.forEach((t) => q.push(`كيف استخدمت ${t}، وما حدود خبرتك فيه؟`));
    gaps.forEach((g) => q.push(`ليست لديك خبرة موثقة في ${g} — كيف تخطط لسد هذه الفجوة؟`));
    q.push("أخبرني عن خطأ ارتكبته وما تعلمته منه.");
  } else {
    q.push(`Why do you see yourself as a fit for a ${role} role?`);
    strengths.forEach((s) => q.push(`Describe a time you used ${s} to solve a real problem.`));
    courses.forEach((c) => q.push(`What did you apply in practice from ${c}?`));
    tools.forEach((t) => q.push(`How have you used ${t}, and where does your experience end?`));
    gaps.forEach((g) => q.push(`You have no recorded evidence of ${g} — how would you close that gap?`));
    q.push("Tell me about a mistake you made and what you took from it.");
  }

  const head =
    lang === "ar"
      ? `أسئلة مقابلة لدور **${role}**، مبنية على متطلبات الدور وسجلك:`
      : `Interview questions for **${role}**, built from the role's requirements and your own record:`;
  const tail =
    lang === "ar"
      ? "أجب عن أي سؤال هنا وسأعطيك ملاحظات على إجابتك باستخدام أسلوب الموقف–المهمة–الإجراء–النتيجة."
      : "Answer any of these here and I will give you feedback using the Situation–Task–Action–Result structure.";
  return `${head}\n\n${q
    .slice(0, 8)
    .map((x, i) => `${i + 1}. ${x}`)
    .join("\n")}\n\n${tail}`;
}

export function renderCareerAnswer(a: CareerAnalysis, lang: Lang, topic: CareerChatTopic): string {
  switch (topic) {
    case "ats":
      return atsAnswer(a, lang);
    case "cv_review":
      return cvReviewAnswer(a, lang);
    case "skill_gap":
      return skillGapAnswer(a, lang);
    case "interview":
      return buildInterviewPrep(a, lang);
    case "readiness":
      return readinessAnswer(a, lang);
    default:
      return matchesAnswer(a, lang);
  }
}

/* ------------------------------------------------------------------ */
/* One entry point for chat                                            */
/* ------------------------------------------------------------------ */

export type CareerChatResult = {
  answer: string;
  card: CareerInsightCard;
  nextSteps: string[];
  analysis: CareerAnalysis;
};

/**
 * Runs the deterministic analysis once and returns everything chat needs.
 * The run is persisted, so results are reused by the Career page and by
 * later turns rather than recomputed from scratch each time.
 */
export async function runCareerChat(
  db: Db,
  userId: string,
  lang: Lang,
  topic: CareerChatTopic,
  targetRoleCode?: string | null,
): Promise<CareerChatResult> {
  const [analysis, counselling] = await Promise.all([
    analyseCareer(db, userId, { targetRoleCode: targetRoleCode ?? null, persist: true }),
    findOpenCounsellingRequest(db, userId),
  ]);
  const card = toCareerInsightCard(
    analysis,
    lang,
    topic,
    counselling ? { reference: counselling.reference, status: counselling.status } : null,
  );
  const nextSteps: string[] = [];
  if (!analysis.hasCv) {
    nextSteps.push(
      lang === "ar"
        ? "استخدم زر «رفع السيرة الذاتية» هنا في المحادثة وسأحلّلها فوراً."
        : "Use the Upload CV button here in the chat and I will analyse it straight away.",
    );
  }

  if (!counselling) {
    nextSteps.push(
      lang === "ar"
        ? "اطلب مني ترتيب موعد مع مرشد مهني في أي وقت."
        : "Ask me to arrange a session with a career counsellor at any time.",
    );
  }
  return { answer: renderCareerAnswer(analysis, lang, topic), card, nextSteps, analysis };
}
