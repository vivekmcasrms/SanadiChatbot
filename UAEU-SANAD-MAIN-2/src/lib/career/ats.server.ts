/**
 * Deterministic ATS scoring engine. Server only.
 *
 * The engine is authoritative: every number here is produced from structured
 * evidence extracted from the CV plus the student's verified university record.
 * The LLM is never asked for a score — it may only explain what this file
 * calculated. Same CV + same engine version + same weights => same score.
 */
import type { CareerRole, ParsedCv, StudentEvidence } from "./career.server";
import { norm } from "./normalise.server";

export const ATS_ENGINE_VERSION = "ats.v2";
export const ATS_WEIGHTS_VERSION = "ats-weights.v1";

export type Bi = { en: string; ar: string };
export type ParsingConfidence = "high" | "medium" | "low" | "failed";
export type EvidenceStrength = "none" | "mentioned" | "demonstrated" | "strong";

export type SkillEvidence = { skill: string; strength: EvidenceStrength; excerpt: string | null };

export type AtsCategory = {
  key: string;
  labelEn: string;
  labelAr: string;
  score: number;
  max: number;
  notes: Bi[];
};

export type AtsBand = { min: number; labelEn: string; labelAr: string };

export type GeneralAtsWeights = {
  parsing: number;
  contact: number;
  education: number;
  skills: number;
  experienceProject: number;
  achievement: number;
  keyword: number;
  completeness: number;
  clarity: number;
};

export type RoleAtsWeights = {
  requiredSkills: number;
  preferredSkills: number;
  tools: number;
  projects: number;
  experience: number;
  coursework: number;
  certifications: number;
  terminology: number;
};

export const DEFAULT_GENERAL_WEIGHTS: GeneralAtsWeights = {
  parsing: 15,
  contact: 10,
  education: 10,
  skills: 15,
  experienceProject: 20,
  achievement: 10,
  keyword: 10,
  completeness: 5,
  clarity: 5,
};

export const DEFAULT_ROLE_WEIGHTS: RoleAtsWeights = {
  requiredSkills: 25,
  preferredSkills: 10,
  tools: 15,
  projects: 15,
  experience: 15,
  coursework: 10,
  certifications: 5,
  terminology: 5,
};

export const DEFAULT_BANDS: AtsBand[] = [
  { min: 90, labelEn: "Excellent ATS Readiness", labelAr: "جاهزية ممتازة لأنظمة الفرز" },
  { min: 80, labelEn: "Strong", labelAr: "قوية" },
  { min: 70, labelEn: "Good, with improvements recommended", labelAr: "جيدة مع تحسينات مقترحة" },
  { min: 60, labelEn: "Needs Improvement", labelAr: "تحتاج إلى تحسين" },
  { min: 0, labelEn: "Significant Improvement Needed", labelAr: "تحتاج إلى تحسين جوهري" },
];

export const ATS_DISCLAIMER: Bi = {
  en: "ATS systems differ across employers. This score estimates CV readability and role alignment using Sanadi's scoring model and does not guarantee employer screening outcomes.",
  ar: "تختلف أنظمة الفرز الآلي بين جهات التوظيف. تقدّر هذه الدرجة وضوح السيرة الذاتية ومدى توافقها مع الوظيفة وفق نموذج سندي، ولا تضمن نتائج الفرز لدى جهة التوظيف.",
};

export type AtsScore = {
  engineVersion: string;
  weightsVersion: string;
  cvVersion: string | null;
  calculatedAt: string;
  confidence: ParsingConfidence;
  confidenceNote: Bi | null;
  overall: number;
  band: AtsBand;
  categories: AtsCategory[];
  strengths: Bi[];
  improvements: Bi[];
  recommendedKeywords: string[];
  evidence: SkillEvidence[];
  dateIssues: Bi[];
  disclaimer: Bi;
};

export type RoleAtsScore = {
  roleId: string;
  roleCode: string;
  titleEn: string;
  titleAr: string;
  overall: number;
  band: AtsBand;
  categories: AtsCategory[];
  strongMatches: SkillEvidence[];
  missingEvidence: string[];
  engineVersion: string;
  weightsVersion: string;
  cvVersion: string | null;
  calculatedAt: string;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

export function bandFor(score: number, bands: AtsBand[]): AtsBand {
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  return sorted.find((b) => score >= b.min) ?? sorted[sorted.length - 1] ?? DEFAULT_BANDS[DEFAULT_BANDS.length - 1]!;
}

const ACTION_VERBS = [
  "built", "developed", "designed", "implemented", "analysed", "analyzed", "led", "improved", "automated",
  "delivered", "created", "reduced", "increased", "deployed", "trained", "managed", "optimised", "optimized",
  "engineered", "researched", "presented", "launched", "migrated", "integrated",
];

const PROFESSIONAL_TERMS = [
  "project", "team", "data", "analysis", "research", "design", "development", "testing", "report",
  "stakeholder", "requirements", "documentation", "presentation", "collaboration", "problem solving",
  "internship", "capstone", "dashboard", "database", "automation", "customer", "process", "quality",
];

const CURRENT_TOKENS = ["present", "current", "ongoing", "now", "till date", "to date", "حتى الآن", "حالياً", "حاليا"];

/** Splits a body of CV text into deduplicated evidence sentences. */
function sentences(parts: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const p of parts) {
    if (!p) continue;
    for (const s of p.split(/(?<=[.;!?])\s+|\n+/)) {
      const t = s.trim();
      if (t.length >= 8) out.add(t);
    }
  }
  return [...out];
}

function mentions(haystack: string, needle: string): boolean {
  const n = norm(needle);
  if (n.length < 2) return false;
  const h = ` ${norm(haystack)} `;
  return h.includes(` ${n} `) || h.includes(`${n} `) || h.includes(` ${n}`) || norm(haystack).includes(n);
}

/**
 * Classifies how strongly a skill is evidenced.
 * Listing it counts as MENTIONED; using it in a described project or role is
 * DEMONSTRATED; using it with a measurable outcome is STRONG. Repetition alone
 * never raises the strength — evidence is deduplicated first.
 */
export function skillEvidence(cv: ParsedCv, skill: string): SkillEvidence {
  const listed = [...cv.skills, ...cv.tools, ...cv.certifications].some((s) => mentions(s, skill));
  const contexts = sentences([
    ...cv.experience.flatMap((e) => [`${e.title ?? ""} ${e.organisation ?? ""}`, ...e.bullets]),
    ...cv.projects.map((p) => `${p.title ?? ""} ${p.description ?? ""} ${p.technologies.join(", ")}`),
    ...cv.achievements,
    cv.summary,
  ]).filter((s) => mentions(s, skill));

  if (contexts.length === 0) {
    return { skill, strength: listed ? "mentioned" : "none", excerpt: null };
  }
  const strong = contexts.find((c) => /\d/.test(c) && ACTION_VERBS.some((v) => c.toLowerCase().includes(v)));
  if (strong) return { skill, strength: "strong", excerpt: strong.slice(0, 220) };
  const demonstrated = contexts.find((c) => c.split(/\s+/).length >= 5) ?? contexts[0]!;
  return { skill, strength: "demonstrated", excerpt: demonstrated.slice(0, 220) };
}

const STRENGTH_CREDIT: Record<EvidenceStrength, number> = {
  none: 0,
  mentioned: 0.5,
  demonstrated: 0.85,
  strong: 1,
};

/* ------------------------------------------------------------------ */
/* Parsing confidence                                                  */
/* ------------------------------------------------------------------ */

export function assessParsing(
  cv: ParsedCv,
  rawText: string,
  parsingStatus: string | null,
): { confidence: ParsingConfidence; ratio: number; notes: Bi[] } {
  const notes: Bi[] = [];
  if (parsingStatus === "failed" || !rawText || rawText.trim().length < 60) {
    return {
      confidence: "failed",
      ratio: 0,
      notes: [
        {
          en: "No readable text could be extracted from this file. Upload a text-based PDF or a DOCX rather than a scan.",
          ar: "تعذّر استخراج نص قابل للقراءة من هذا الملف. يرجى رفع ملف PDF نصي أو ملف Word بدلاً من صورة ممسوحة ضوئياً.",
        },
      ],
    };
  }

  const words = rawText.split(/\s+/).filter(Boolean).length;
  const corrupted = (rawText.match(/[\uFFFD]|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) ?? []).length;
  const corruptRatio = corrupted / Math.max(1, rawText.length);
  const lines = rawText.split(/\r?\n/).filter((l) => l.trim());
  const columnArtefacts = lines.filter((l) => /\S {4,}\S {4,}\S/.test(l)).length / Math.max(1, lines.length);

  const expected = ["education", "experience", "skills", "projects"];
  const lower = rawText.toLowerCase();
  const found = expected.filter((s) => lower.includes(s) || cv.sections.some((x) => norm(x).includes(s)));

  let ratio = 0;
  ratio += words >= 120 ? 0.3 : words >= 60 ? 0.15 : 0;
  ratio += 0.3 * (found.length / expected.length);
  ratio += corruptRatio < 0.001 ? 0.2 : corruptRatio < 0.01 ? 0.1 : 0;
  ratio += columnArtefacts < 0.15 ? 0.2 : columnArtefacts < 0.35 ? 0.1 : 0;
  ratio = clamp01(ratio);

  if (found.length < expected.length) {
    notes.push({
      en: `Some standard sections were not recognised: ${expected.filter((s) => !found.includes(s)).join(", ")}.`,
      ar: `لم يتم التعرّف على بعض الأقسام القياسية: ${expected.filter((s) => !found.includes(s)).join("، ")}.`,
    });
  }
  if (columnArtefacts >= 0.35) {
    notes.push({
      en: "Multi-column or table layout is interfering with text extraction. A single-column layout parses more reliably.",
      ar: "التنسيق متعدد الأعمدة أو الجداول يعيق استخراج النص. التنسيق بعمود واحد أسهل في القراءة الآلية.",
    });
  }
  if (corruptRatio >= 0.001) {
    notes.push({
      en: "Some characters were extracted incorrectly, which can confuse automated screening.",
      ar: "تم استخراج بعض المحارف بشكل غير صحيح، ما قد يربك أنظمة الفرز الآلي.",
    });
  }

  const structured = cv.education.length + cv.experience.length + cv.projects.length + cv.skills.length;
  const confidence: ParsingConfidence =
    parsingStatus === "parsed" && ratio >= 0.75 && structured >= 4
      ? "high"
      : ratio >= 0.5 && structured >= 2
        ? "medium"
        : "low";

  return { confidence, ratio, notes };
}

/* ------------------------------------------------------------------ */
/* Date validation                                                     */
/* ------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** Parses "Sep 2023", "09/2023", "2023" into a Date; null when unknown. */
export function parsePartialDate(value: string): Date | null {
  const t = value.trim().toLowerCase();
  if (!t) return null;
  const m1 = /([a-z]{3,4})[a-z]*\.?\s+(\d{4})/.exec(t);
  if (m1 && MONTHS[m1[1]!] !== undefined) return new Date(Date.UTC(Number(m1[2]), MONTHS[m1[1]!]!, 1));
  const m2 = /(\d{1,2})[/-](\d{4})/.exec(t);
  if (m2) return new Date(Date.UTC(Number(m2[2]), Math.max(0, Number(m2[1]) - 1), 1));
  const m3 = /(\d{4})[-/](\d{1,2})/.exec(t);
  if (m3) return new Date(Date.UTC(Number(m3[1]), Math.max(0, Number(m3[2]) - 1), 1));
  const m4 = /\b(19|20)\d{2}\b/.exec(t);
  if (m4) return new Date(Date.UTC(Number(m4[0]), 0, 1));
  return null;
}

export function isCurrentToken(value: string): boolean {
  const t = value.toLowerCase();
  return CURRENT_TOKENS.some((c) => t.includes(c));
}

/** Splits "Sep 2023 – Present" into its two halves. */
function splitPeriod(period: string): { start: string; end: string } {
  const parts = period.split(/[–—-]|\bto\b|\bحتى\b/i).map((p) => p.trim()).filter(Boolean);
  return { start: parts[0] ?? "", end: parts[1] ?? "" };
}

/**
 * Flags only genuine date problems, measured against the server's current date.
 * "Present"/"Current"/"Ongoing" and valid expected graduation dates are never flagged.
 */
export function validateDates(cv: ParsedCv, now: Date): Bi[] {
  const issues: Bi[] = [];
  const entries: { label: string; period: string | null; kind: "experience" | "education" }[] = [
    ...cv.experience.map((e) => ({ label: e.title ?? e.organisation ?? "experience", period: e.period, kind: "experience" as const })),
    ...cv.education.map((e) => ({ label: e.qualification ?? e.institution ?? "education", period: e.period, kind: "education" as const })),
  ];

  for (const entry of entries) {
    if (!entry.period) continue;
    const { start, end } = splitPeriod(entry.period);
    const startDate = parsePartialDate(start);
    const ongoing = isCurrentToken(end) || isCurrentToken(entry.period);
    const endDate = ongoing ? null : parsePartialDate(end);

    if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
      issues.push({
        en: `"${entry.label}" starts after it ends (${entry.period}).`,
        ar: `"${entry.label}" يبدأ بعد تاريخ انتهائه (${entry.period}).`,
      });
      continue;
    }
    // A completed role cannot both have finished and start in the future.
    if (entry.kind === "experience" && !ongoing && startDate && startDate.getTime() > now.getTime()) {
      issues.push({
        en: `"${entry.label}" is listed as completed work but starts in the future (${entry.period}).`,
        ar: `"${entry.label}" مُدرج كخبرة منتهية لكن تاريخ بدايته في المستقبل (${entry.period}).`,
      });
    }
    // Expected graduation in the future is valid; an implausible far future is not.
    if (endDate && endDate.getUTCFullYear() > now.getUTCFullYear() + 8) {
      issues.push({
        en: `"${entry.label}" ends implausibly far in the future (${entry.period}).`,
        ar: `"${entry.label}" ينتهي في تاريخ بعيد غير منطقي (${entry.period}).`,
      });
    }
  }
  return issues;
}

/* ------------------------------------------------------------------ */
/* General ATS                                                         */
/* ------------------------------------------------------------------ */

export type GeneralAtsInput = {
  cv: ParsedCv;
  rawText: string;
  parsingStatus: string | null;
  evidence: StudentEvidence;
  targetRole: CareerRole | null;
  weights?: GeneralAtsWeights;
  bands?: AtsBand[];
  cvVersion?: string | null;
  now?: Date;
};

/**
 * 100-point deterministic general ATS assessment.
 * Every category is a 0..1 evidence ratio multiplied by a configurable weight;
 * the overall score is exactly the sum of the rounded categories.
 */
export function scoreGeneralAts(input: GeneralAtsInput): AtsScore | null {
  const weights = input.weights ?? DEFAULT_GENERAL_WEIGHTS;
  const bands = input.bands?.length ? input.bands : DEFAULT_BANDS;
  const now = input.now ?? new Date();
  const cv = input.cv;
  const rawText = input.rawText ?? "";
  const parsing = assessParsing(cv, rawText, input.parsingStatus);

  // A failed parse must never produce a score.
  if (parsing.confidence === "failed") return null;

  const strengths: Bi[] = [];
  const improvements: Bi[] = [];
  const text = rawText.toLowerCase();
  const words = rawText.split(/\s+/).filter(Boolean).length;
  const bullets = cv.experience.flatMap((e) => e.bullets);
  const descriptions = [...bullets, ...cv.projects.map((p) => p.description ?? "")].filter(Boolean);

  /* Parsing & readability */
  const parsingNotes = parsing.notes;
  if (parsing.ratio >= 0.9) {
    strengths.push({ en: "The CV parses cleanly and all standard sections are recognised.", ar: "يتم تحليل السيرة الذاتية بوضوح ويتم التعرّف على جميع الأقسام القياسية." });
  } else {
    improvements.push({
      en: "Use clearly labelled, single-column sections (Education, Experience, Projects, Skills) so parsers read the CV correctly.",
      ar: "استخدم أقساماً واضحة بعمود واحد (التعليم، الخبرة، المشاريع، المهارات) ليقرأ نظام الفرز سيرتك بشكل صحيح.",
    });
  }

  /* Contact */
  const hasLocation = /\b(uae|emirates|abu dhabi|dubai|sharjah|al ain|ajman|fujairah|ras al khaimah|umm al quwain)\b/i.test(rawText);
  const professionalEmail = cv.email ? !/(temp|fake|test)@/i.test(cv.email) : false;
  let contactRatio = 0;
  if (cv.fullName) contactRatio += 0.25;
  if (cv.email && professionalEmail) contactRatio += 0.35;
  if (cv.phone) contactRatio += 0.25;
  if (hasLocation) contactRatio += 0.05;
  if (cv.links.length) contactRatio += 0.1;
  contactRatio = clamp01(contactRatio);
  const contactNotes: Bi[] = [];
  if (!cv.email || !cv.phone) {
    contactNotes.push({ en: "Add a professional email address and phone number at the top of the CV.", ar: "أضف بريداً إلكترونياً مهنياً ورقم هاتف في أعلى السيرة الذاتية." });
    improvements.push(contactNotes[contactNotes.length - 1]!);
  } else if (!cv.links.length) {
    contactNotes.push({ en: "Add a LinkedIn or GitHub/portfolio link.", ar: "أضف رابط LinkedIn أو GitHub أو معرض أعمالك." });
    improvements.push(contactNotes[contactNotes.length - 1]!);
  } else {
    strengths.push({ en: "Contact details are complete and machine-readable.", ar: "بيانات التواصل كاملة وقابلة للقراءة الآلية." });
  }

  /* Education */
  let educationRatio = 0;
  if (cv.education.length) educationRatio += 0.5;
  if (cv.education.some((e) => e.institution)) educationRatio += 0.15;
  if (cv.education.some((e) => e.qualification)) educationRatio += 0.2;
  if (cv.education.some((e) => e.period)) educationRatio += 0.15;
  educationRatio = clamp01(educationRatio);
  const educationNotes: Bi[] = [];
  if (educationRatio < 1) {
    educationNotes.push({
      en: "State your university, degree/programme and expected graduation date on the education entry.",
      ar: "اذكر الجامعة والدرجة/البرنامج وتاريخ التخرج المتوقع في بند التعليم.",
    });
    improvements.push(educationNotes[0]!);
  }

  /* Skills — deduplicated, so repetition cannot inflate the score */
  const uniqueSkills = new Set<string>([...cv.skills, ...cv.tools, ...cv.projects.flatMap((p) => p.technologies)].map(norm).filter((s) => s.length > 1));
  const evidencedSkills = [...uniqueSkills].map((s) => skillEvidence(cv, s));
  const demonstratedCount = evidencedSkills.filter((e) => e.strength === "demonstrated" || e.strength === "strong").length;
  const skillsRatio = clamp01(0.7 * Math.min(1, uniqueSkills.size / 10) + 0.3 * Math.min(1, demonstratedCount / 4));
  const skillsNotes: Bi[] = [];
  if (uniqueSkills.size < 10) {
    skillsNotes.push({ en: "List at least 10 distinct technical skills, tools and languages in a dedicated Skills section.", ar: "أدرج ما لا يقل عن 10 مهارات وأدوات ولغات تقنية مختلفة في قسم مخصص للمهارات." });
    improvements.push(skillsNotes[skillsNotes.length - 1]!);
  }
  if (demonstratedCount < 4) {
    skillsNotes.push({ en: "Show your key skills in action inside project or experience bullets, not only as a list.", ar: "أظهر مهاراتك الأساسية داخل وصف المشاريع أو الخبرات، وليس كقائمة فقط." });
    improvements.push(skillsNotes[skillsNotes.length - 1]!);
  }
  if (uniqueSkills.size >= 12 && demonstratedCount >= 4) {
    strengths.push({ en: "Skills are both listed and demonstrated in your projects.", ar: "المهارات مذكورة وموثقة في مشاريعك أيضاً." });
  }

  /* Experience & projects — student friendly: projects count meaningfully */
  const describedItems = [
    ...cv.experience.map((e) => e.bullets.join(" ")),
    ...cv.projects.map((p) => `${p.description ?? ""} ${p.technologies.join(" ")}`),
  ].filter((d) => d.trim().split(/\s+/).length >= 8).length;
  const totalItems = cv.experience.length + cv.projects.length;
  const hasActionVerbs = descriptions.some((d) => ACTION_VERBS.some((v) => d.toLowerCase().includes(v)));
  const datedItems = [...cv.experience, ...cv.education].filter((e) => e.period).length;
  let expRatio =
    Math.min(0.45, cv.experience.length * 0.2) +
    Math.min(0.3, cv.projects.length * 0.12) +
    (input.evidence.hasInternship ? 0.15 : 0) +
    Math.min(0.2, describedItems * 0.07) +
    (hasActionVerbs ? 0.1 : 0) +
    (datedItems > 0 ? 0.05 : 0);
  expRatio = clamp01(expRatio);
  const expNotes: Bi[] = [];
  if (totalItems < 2) {
    expNotes.push({ en: "Add at least two projects (capstone, coursework or personal) with a short description of what you did.", ar: "أضف مشروعين على الأقل (مشروع تخرج أو دراسي أو شخصي) مع وصف موجز لما قمت به." });
    improvements.push(expNotes[expNotes.length - 1]!);
  }
  if (!hasActionVerbs) {
    expNotes.push({ en: "Start each bullet with an action verb (built, analysed, automated, delivered).", ar: "ابدأ كل نقطة بفعل إجرائي (بنيت، حللت، أتمتت، أنجزت)." });
    improvements.push(expNotes[expNotes.length - 1]!);
  }
  if (input.evidence.hasInternship && !cv.experience.length) {
    expNotes.push({ en: "Your verified internship is missing from the CV — add it as an experience entry.", ar: "تدريبك العملي المعتمد غير مذكور في السيرة الذاتية — أضفه كخبرة." });
    improvements.push(expNotes[expNotes.length - 1]!);
  }

  /* Achievements & evidence */
  const quantified = new Set(
    [...bullets, ...cv.achievements].filter((b) => /\d+\s*(%|percent|users|students|hours|records|aed|k\b)|\b\d{2,}\b/.test(b.toLowerCase())),
  ).size;
  const leadership = /\b(led|president|captain|founder|chair|organis|organiz|volunteer|mentor)/i.test(rawText);
  const achievementRatio = clamp01(
    Math.min(0.5, quantified * 0.17) +
      (cv.certifications.length ? 0.2 : 0) +
      (cv.achievements.length ? 0.2 : 0) +
      (leadership ? 0.1 : 0),
  );
  const achievementNotes: Bi[] = [];
  if (quantified < 3) {
    achievementNotes.push({ en: "Quantify at least three results (accuracy achieved, records processed, hours saved, users reached).", ar: "أضف نتائج قابلة للقياس في ثلاث نقاط على الأقل (دقة النموذج، عدد السجلات، الساعات الموفّرة، عدد المستخدمين)." });
    improvements.push(achievementNotes[achievementNotes.length - 1]!);
  } else {
    strengths.push({ en: "Several achievements are quantified with measurable outcomes.", ar: "عدد من الإنجازات موثق بنتائج قابلة للقياس." });
  }
  if (!cv.certifications.length) {
    achievementNotes.push({ en: "Add any certifications, competitions or awards you have completed.", ar: "أضف الشهادات أو المسابقات أو الجوائز التي حصلت عليها." });
  }

  /* Keywords & professional language */
  const matchedTerms = new Set(PROFESSIONAL_TERMS.filter((t) => text.includes(t)));
  const roleKeywords = input.targetRole?.ats_keywords ?? [];
  const matchedRoleKeywords = roleKeywords.filter((k) => text.includes(k.toLowerCase()) || [...uniqueSkills].some((s) => s.includes(norm(k))));
  const recommendedKeywords = roleKeywords.filter((k) => !matchedRoleKeywords.includes(k)).slice(0, 10);
  const keywordRatio = clamp01(
    roleKeywords.length
      ? 0.5 * Math.min(1, matchedTerms.size / 10) + 0.5 * (matchedRoleKeywords.length / roleKeywords.length)
      : Math.min(1, matchedTerms.size / 10),
  );
  const keywordNotes: Bi[] = [];
  if (recommendedKeywords.length && input.targetRole) {
    keywordNotes.push({
      en: `Mirror the professional wording used in ${input.targetRole.title_en} adverts where it is genuinely true of you: ${recommendedKeywords.slice(0, 6).join(", ")}.`,
      ar: `استخدم المصطلحات المهنية الواردة في إعلانات وظيفة ${input.targetRole.title_ar} عندما تنطبق عليك فعلاً: ${recommendedKeywords.slice(0, 6).join("، ")}.`,
    });
    improvements.push(keywordNotes[0]!);
  }

  /* Completeness & consistency */
  const dateIssues = validateDates(cv, now);
  const duplicateBullets = bullets.length - new Set(bullets.map((b) => b.trim().toLowerCase())).size;
  const completenessRatio = clamp01(
    (cv.summary ? 0.3 : 0) +
      (cv.education.length && (cv.experience.length || cv.projects.length) && uniqueSkills.size ? 0.3 : 0) +
      (dateIssues.length === 0 ? 0.2 : 0) +
      (duplicateBullets === 0 ? 0.2 : 0),
  );
  const completenessNotes: Bi[] = [];
  if (!cv.summary) {
    completenessNotes.push({ en: "Open with a two or three line professional summary naming your target role.", ar: "ابدأ سيرتك بملخص مهني من سطرين أو ثلاثة يذكر الوظيفة المستهدفة." });
    improvements.push(completenessNotes[completenessNotes.length - 1]!);
  }
  for (const issue of dateIssues) completenessNotes.push(issue);
  if (duplicateBullets > 0) {
    completenessNotes.push({ en: "Remove duplicated bullet points.", ar: "احذف النقاط المكررة." });
  }

  /* Clarity & formatting — parsing-relevant only, no style taste penalties */
  const clarityRatio = clamp01(
    (words >= 200 ? 0.4 : words >= 120 ? 0.2 : 0) +
      (words <= 1400 ? 0.2 : 0) +
      (bullets.length + cv.projects.length >= 3 ? 0.2 : 0) +
      (cv.sections.length >= 3 ? 0.2 : 0),
  );
  const clarityNotes: Bi[] = [];
  if (words < 200) {
    clarityNotes.push({ en: "The CV is very short — describe your projects and experience in more detail.", ar: "السيرة الذاتية قصيرة جداً — فصّل أكثر في وصف مشاريعك وخبراتك." });
    improvements.push(clarityNotes[0]!);
  } else if (words > 1400) {
    clarityNotes.push({ en: "The CV is very long — keep the most relevant content and tighten the bullets.", ar: "السيرة الذاتية طويلة جداً — أبقِ المحتوى الأكثر صلة واختصر النقاط." });
    improvements.push(clarityNotes[0]!);
  }

  const parts: { key: keyof GeneralAtsWeights; ratio: number; labelEn: string; labelAr: string; notes: Bi[] }[] = [
    { key: "parsing", ratio: parsing.ratio, labelEn: "Parsing & Readability", labelAr: "قابلية القراءة الآلية", notes: parsingNotes },
    { key: "contact", ratio: contactRatio, labelEn: "Contact Information", labelAr: "بيانات التواصل", notes: contactNotes },
    { key: "education", ratio: educationRatio, labelEn: "Education", labelAr: "التعليم", notes: educationNotes },
    { key: "skills", ratio: skillsRatio, labelEn: "Skills", labelAr: "المهارات", notes: skillsNotes },
    { key: "experienceProject", ratio: expRatio, labelEn: "Experience & Projects", labelAr: "الخبرات والمشاريع", notes: expNotes },
    { key: "achievement", ratio: achievementRatio, labelEn: "Achievements & Evidence", labelAr: "الإنجازات والأدلة", notes: achievementNotes },
    { key: "keyword", ratio: keywordRatio, labelEn: "Keywords & Professional Language", labelAr: "المصطلحات المهنية", notes: keywordNotes },
    { key: "completeness", ratio: completenessRatio, labelEn: "Completeness & Consistency", labelAr: "الاكتمال والاتساق", notes: completenessNotes },
    { key: "clarity", ratio: clarityRatio, labelEn: "Clarity & Formatting", labelAr: "الوضوح والتنسيق", notes: clarityNotes },
  ];

  const categories: AtsCategory[] = parts.map((p) => {
    const max = Math.max(0, Number(weights[p.key]) || 0);
    const score = Math.min(max, Math.round(clamp01(p.ratio) * max));
    return { key: p.key, labelEn: p.labelEn, labelAr: p.labelAr, score, max, notes: p.notes };
  });

  const overall = Math.max(0, Math.min(100, categories.reduce((a, c) => a + c.score, 0)));

  if (parsing.confidence === "low") {
    improvements.unshift({
      en: "Your CV could not be read reliably. Please upload a cleaner PDF or DOCX for a more accurate ATS assessment.",
      ar: "تعذّرت قراءة سيرتك الذاتية بشكل موثوق. يرجى رفع ملف PDF أو Word أوضح للحصول على تقييم أدق لأنظمة الفرز.",
    });
  }

  const seen = new Set<string>();
  const uniqueImprovements = improvements.filter((i) => (seen.has(i.en) ? false : (seen.add(i.en), true)));

  return {
    engineVersion: ATS_ENGINE_VERSION,
    weightsVersion: ATS_WEIGHTS_VERSION,
    cvVersion: input.cvVersion ?? null,
    calculatedAt: now.toISOString(),
    confidence: parsing.confidence,
    confidenceNote:
      parsing.confidence === "low"
        ? {
            en: "Your CV could not be read reliably, so this score is indicative only.",
            ar: "تعذّرت قراءة سيرتك الذاتية بشكل موثوق، لذا فهذه الدرجة استرشادية فقط.",
          }
        : null,
    overall,
    band: bandFor(overall, bands),
    categories,
    strengths,
    improvements: uniqueImprovements,
    recommendedKeywords,
    evidence: evidencedSkills.filter((e) => e.strength !== "none").slice(0, 40),
    dateIssues,
    disclaimer: ATS_DISCLAIMER,
  };
}

/* ------------------------------------------------------------------ */
/* Role-specific ATS                                                   */
/* ------------------------------------------------------------------ */

export type RoleAtsInput = {
  role: CareerRole;
  cv: ParsedCv;
  rawText: string;
  evidence: StudentEvidence;
  weights?: RoleAtsWeights;
  bands?: AtsBand[];
  cvVersion?: string | null;
  now?: Date;
};

/** Evidence-weighted match of one parsed CV against one versioned role profile. */
export function scoreRoleAts(input: RoleAtsInput): RoleAtsScore {
  const weights = input.weights ?? DEFAULT_ROLE_WEIGHTS;
  const bands = input.bands?.length ? input.bands : DEFAULT_BANDS;
  const now = input.now ?? new Date();
  const { role, cv, evidence } = input;
  const text = (input.rawText ?? "").toLowerCase();

  const credit = (skills: string[]): { ratio: number; items: SkillEvidence[] } => {
    if (!skills.length) return { ratio: 1, items: [] };
    const items = skills.map((s) => skillEvidence(cv, s));
    const total = items.reduce((a, i) => a + STRENGTH_CREDIT[i.strength], 0);
    return { ratio: clamp01(total / skills.length), items };
  };

  const required = credit(role.required_hard_skills);
  const preferred = credit(role.preferred_hard_skills);
  const tools = credit(role.preferred_tools);
  const certs = credit(role.certifications);

  const roleTerms = [...role.required_hard_skills, ...role.preferred_hard_skills, ...role.preferred_tools];
  const relevantProjects = cv.projects.filter((p) =>
    roleTerms.some((s) => mentions(`${p.title ?? ""} ${p.description ?? ""} ${p.technologies.join(" ")}`, s)),
  );
  const projectsRatio = clamp01(
    Math.min(0.7, relevantProjects.length * 0.35) +
      (relevantProjects.some((p) => (p.description ?? "").split(/\s+/).length >= 12) ? 0.2 : 0) +
      (relevantProjects.some((p) => /\d/.test(p.description ?? "")) ? 0.1 : 0),
  );

  const relevantExperience = cv.experience.filter((e) => roleTerms.some((s) => mentions([e.title ?? "", ...e.bullets].join(" "), s)));
  const experienceRatio = clamp01(
    Math.min(0.6, relevantExperience.length * 0.35) +
      (evidence.hasInternship ? 0.3 : 0) +
      (relevantExperience.some((e) => e.bullets.some((b) => /\d/.test(b))) ? 0.1 : 0),
  );

  const courseText = [
    ...evidence.completedCourses.map((c) => c.title),
    ...evidence.completedCourses.map((c) => c.code),
  ].join(" ");
  const matchedCourses = role.preferred_courses.filter((c) => mentions(courseText, c));
  const programmeMatch = role.suitable_programmes.some((p) => mentions(evidence.programmeEn ?? "", p));
  const courseworkRatio = clamp01(
    (role.preferred_courses.length ? 0.7 * (matchedCourses.length / role.preferred_courses.length) : 0.5) + (programmeMatch ? 0.3 : 0),
  );

  const keywords = role.ats_keywords ?? [];
  const matchedKeywords = keywords.filter((k) => text.includes(k.toLowerCase()));
  const terminologyRatio = keywords.length ? clamp01(matchedKeywords.length / keywords.length) : 0.5;

  const parts: { key: keyof RoleAtsWeights; ratio: number; labelEn: string; labelAr: string }[] = [
    { key: "requiredSkills", ratio: required.ratio, labelEn: "Required skills", labelAr: "المهارات المطلوبة" },
    { key: "preferredSkills", ratio: preferred.ratio, labelEn: "Preferred skills", labelAr: "المهارات المفضلة" },
    { key: "tools", ratio: tools.ratio, labelEn: "Tools & platforms", labelAr: "الأدوات والمنصات" },
    { key: "projects", ratio: projectsRatio, labelEn: "Relevant projects", labelAr: "المشاريع ذات الصلة" },
    { key: "experience", ratio: experienceRatio, labelEn: "Relevant experience", labelAr: "الخبرة ذات الصلة" },
    { key: "coursework", ratio: courseworkRatio, labelEn: "Coursework & education", labelAr: "المقررات والتعليم" },
    { key: "certifications", ratio: certs.ratio, labelEn: "Certifications", labelAr: "الشهادات" },
    { key: "terminology", ratio: terminologyRatio, labelEn: "Role terminology", labelAr: "مصطلحات الوظيفة" },
  ];

  const categories: AtsCategory[] = parts.map((p) => {
    const max = Math.max(0, Number(weights[p.key]) || 0);
    return {
      key: p.key,
      labelEn: p.labelEn,
      labelAr: p.labelAr,
      score: Math.min(max, Math.round(clamp01(p.ratio) * max)),
      max,
      notes: [],
    };
  });

  const overall = Math.max(0, Math.min(100, categories.reduce((a, c) => a + c.score, 0)));
  const allItems = [...required.items, ...preferred.items, ...tools.items];
  const strongMatches = allItems.filter((i) => i.strength === "demonstrated" || i.strength === "strong").slice(0, 8);
  const missingEvidence = [
    ...allItems.filter((i) => i.strength === "none").map((i) => i.skill),
    ...(relevantProjects.length ? [] : [role.portfolio_expectations || "Portfolio project"]),
    ...(relevantExperience.length || evidence.hasInternship ? [] : [role.experience_expectations || "Applied experience"]),
  ].slice(0, 8);

  return {
    roleId: role.id,
    roleCode: role.role_code,
    titleEn: role.title_en,
    titleAr: role.title_ar,
    overall,
    band: bandFor(overall, bands),
    categories,
    strongMatches,
    missingEvidence,
    engineVersion: ATS_ENGINE_VERSION,
    weightsVersion: ATS_WEIGHTS_VERSION,
    cvVersion: input.cvVersion ?? null,
    calculatedAt: now.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Integrity checks                                                    */
/* ------------------------------------------------------------------ */

/** Guards the invariants: no NaN, no category above its maximum, total = sum, 0..100. */
export function validateAtsIntegrity(score: { overall: number; categories: AtsCategory[] }): string[] {
  const errors: string[] = [];
  let sum = 0;
  for (const c of score.categories) {
    if (!Number.isFinite(c.score) || !Number.isFinite(c.max)) errors.push(`Category ${c.key} has a non-numeric score.`);
    if (c.score < 0 || c.score > c.max) errors.push(`Category ${c.key} is out of range (${c.score}/${c.max}).`);
    sum += c.score;
  }
  if (!Number.isFinite(score.overall)) errors.push("Overall score is not a number.");
  if (score.overall !== sum) errors.push(`Overall (${score.overall}) does not equal the sum of categories (${sum}).`);
  if (score.overall < 0 || score.overall > 100) errors.push("Overall score is outside 0–100.");
  return errors;
}
