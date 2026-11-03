/**
 * Career Counselling engine. Server only.
 *
 * All scoring here is deterministic: the LLM is only used to turn free CV text
 * into a structured profile, and its output is treated as student-provided data
 * (never as instructions). Fit, ATS and gap analysis run entirely in code so the
 * same CV always produces the same numbers.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Lang } from "../agent-types";
import { loadStudentSnapshot } from "../student-context.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ATS_ENGINE_VERSION,
  ATS_WEIGHTS_VERSION,
  DEFAULT_BANDS,
  DEFAULT_GENERAL_WEIGHTS,
  DEFAULT_ROLE_WEIGHTS,
  scoreGeneralAts,
  scoreRoleAts,
  validateAtsIntegrity,
} from "./ats.server";
import type { AtsBand, AtsScore, GeneralAtsWeights, RoleAtsScore, RoleAtsWeights } from "./ats.server";



export type Db = SupabaseClient<Database>;

export const CAREER_FIT_VERSION = "career-fit.v1";
export const ATS_VERSION = "ats.v1";

/* ------------------------------------------------------------------ */
/* Parsed CV profile                                                   */
/* ------------------------------------------------------------------ */

export type ParsedCv = {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  links: string[];
  summary: string | null;
  education: { institution: string | null; qualification: string | null; period: string | null }[];
  experience: { title: string | null; organisation: string | null; period: string | null; bullets: string[] }[];
  projects: { title: string | null; description: string | null; technologies: string[] }[];
  skills: string[];
  tools: string[];
  certifications: string[];
  languages: string[];
  achievements: string[];
  sections: string[];
};

export const EMPTY_PARSED_CV: ParsedCv = {
  fullName: null,
  email: null,
  phone: null,
  links: [],
  summary: null,
  education: [],
  experience: [],
  projects: [],
  skills: [],
  tools: [],
  certifications: [],
  languages: [],
  achievements: [],
  sections: [],
};

/* ------------------------------------------------------------------ */
/* Prompt-injection defence                                            */
/* ------------------------------------------------------------------ */

const INJECTION_PATTERNS: { code: string; re: RegExp }[] = [
  { code: "instruction_override", re: /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all)\b[^.\n]{0,20}\b(instruction|prompt|rule)/i },
  { code: "role_hijack", re: /\b(you are now|act as|pretend to be|system prompt|as an ai)\b/i },
  { code: "score_manipulation", re: /\b(give|assign|set|award)\b[^.\n]{0,30}\b(100|full|maximum|highest)\b[^.\n]{0,20}\b(score|rating|match)/i },
  { code: "hidden_directive", re: /\b(do not|don'?t)\b[^.\n]{0,30}\b(mention|reveal|tell|report)\b/i },
  { code: "tool_invocation", re: /<\s*\/?\s*(system|assistant|tool_call|function_call)\s*>/i },
];

/** Flags text that tries to instruct the model rather than describe the student. */
export function detectInjection(text: string): { code: string; excerpt: string }[] {
  const flags: { code: string; excerpt: string }[] = [];
  for (const p of INJECTION_PATTERNS) {
    const m = p.re.exec(text);
    if (m) flags.push({ code: p.code, excerpt: text.slice(Math.max(0, m.index - 40), m.index + 120).trim() });
  }
  return flags;
}

/** Neutralises directive-looking lines so the CV is read as data. */
export function sanitiseCvText(text: string): string {
  return text
    .replace(/\u0000/g, " ")
    .split(/\r?\n/)
    .map((line) => (INJECTION_PATTERNS.some((p) => p.re.test(line)) ? `[removed non-CV content]` : line))
    .join("\n")
    .slice(0, 40_000);
}

/* ------------------------------------------------------------------ */
/* Normalisation helpers                                               */
/* ------------------------------------------------------------------ */

import { norm } from "./normalise.server";

export { norm };


function normSet(values: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const v of values) if (v && v.trim()) out.add(norm(v));
  return out;
}

/** Loose containment match so "Python programming" satisfies "Python". */
function has(haystack: Set<string>, needle: string): boolean {
  const n = norm(needle);
  if (!n) return false;
  if (haystack.has(n)) return true;
  for (const h of haystack) {
    if (h.includes(n) || n.includes(h)) {
      if (Math.min(h.length, n.length) >= 3) return true;
    }
  }
  return false;
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 1;
  return Math.max(0, Math.min(1, part / whole));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ------------------------------------------------------------------ */
/* Student evidence                                                    */
/* ------------------------------------------------------------------ */

export type StudentEvidence = {
  hasProfile: boolean;
  studentNumber: string | null;
  programmeEn: string | null;
  programmeAr: string | null;
  gpa: number | null;
  level: string | null;
  completedCredits: number;
  totalCredits: number | null;
  expectedGraduation: string | null;
  completedCourses: { code: string; title: string; grade: string | null }[];
  hasInternship: boolean;
  internshipTitle: string | null;
};

export async function loadStudentEvidence(db: Db, userId: string): Promise<StudentEvidence> {
  const snapshot = await loadStudentSnapshot(db, userId);
  const [{ data: history }, { data: assignments }] = await Promise.all([
    db
      .from("student_course_history")
      .select("grade, completion_status, courses:course_id (code, title_en)")
      .eq("student_id", userId),
    db
      .from("internship_assignments")
      .select("assignment_status, opportunity_id")
      .eq("student_id", userId)
      .in("assignment_status", ["assigned", "confirmed", "registered", "completed"])
      .limit(5),
  ]);

  const completedCourses = (history ?? [])
    .filter((h) => (h.completion_status ?? "completed") === "completed")
    .map((h) => {
      const c = h.courses as { code: string; title_en: string } | null;
      return { code: c?.code ?? "", title: c?.title_en ?? "", grade: h.grade ?? null };
    })
    .filter((c) => c.code || c.title);

  const active = (assignments ?? [])[0] ?? null;
  let opp: { title_en: string } | null = null;
  if (active?.opportunity_id) {
    const { data } = await db.from("internship_opportunities").select("title_en").eq("id", active.opportunity_id).maybeSingle();
    opp = data ?? null;
  }


  return {
    hasProfile: snapshot.hasProfile,
    studentNumber: snapshot.studentNumber,
    programmeEn: snapshot.programNameEn,
    programmeAr: snapshot.programNameAr,
    gpa: snapshot.gpa,
    level: snapshot.level,
    completedCredits: snapshot.completedCredits,
    totalCredits: snapshot.totalCredits,
    expectedGraduation: snapshot.expectedGraduation,
    completedCourses,
    hasInternship: Boolean(active),
    internshipTitle: opp?.title_en ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Career fit scoring                                                  */
/* ------------------------------------------------------------------ */

export type CareerRole = Database["public"]["Tables"]["career_roles"]["Row"];

export type CareerPreferences = {
  preferredRoles: string[];
  preferredFields: string[];
  preferredSectors: string[];
  workOrientation: string | null;
};

export type EvidenceItem = { textEn: string; textAr: string; source: "university" | "cv" };

export type RoleMatch = {
  roleId: string;
  roleCode: string;
  titleEn: string;
  titleAr: string;
  careerFamily: string;
  fitScore: number;
  jobReadinessScore: number;
  breakdown: {
    programme: number;
    coursework: number;
    hardSkills: number;
    experience: number;
    tools: number;
    certifications: number;
    softSkills: number;
    preference: number;
  };
  matchedEvidence: string[];
  evidenceItems: EvidenceItem[];
  missingRequirements: string[];
  skillBreakdown: {
    matchedRequired: string[];
    missingRequired: string[];
    matchedPreferred: string[];
    missingPreferred: string[];
    matchedTools: string[];
    missingTools: string[];
    matchedCourses: string[];
    missingCourses: string[];
    cvSkills: string[];
  };
};

/** Deterministic weights — the whole fit score is auditable from these. */
export type MatchWeights = {
  programme: number;
  coursework: number;
  hardSkills: number;
  experience: number;
  tools: number;
  certifications: number;
  softSkills: number;
  preference: number;
};

/** Academic-only mode leans on the verified record; CV evidence is absent by definition. */
export const DEFAULT_ACADEMIC_WEIGHTS: MatchWeights = {
  programme: 35,
  coursework: 30,
  hardSkills: 10,
  experience: 10,
  tools: 3,
  certifications: 2,
  softSkills: 2,
  preference: 8,
};

/** CV-enhanced mode spreads the score across the broader evidence model. */
export const DEFAULT_CV_WEIGHTS: MatchWeights = {
  programme: 15,
  coursework: 15,
  hardSkills: 20,
  experience: 15,
  tools: 10,
  certifications: 5,
  softSkills: 5,
  preference: 15,
};

export type ProfileSource = "academic" | "academic_cv";

/** Weights are configurable in the database; the constants above are the fallback. */
export async function loadMatchWeights(_db: Db, mode: ProfileSource): Promise<MatchWeights> {
  const fallback = mode === "academic_cv" ? DEFAULT_CV_WEIGHTS : DEFAULT_ACADEMIC_WEIGHTS;
  // Internal configuration: staff-only under RLS, loaded with the privileged client.
  const { data } = await supabaseAdmin
    .from("career_matching_weight_profiles")
    .select("weights")
    .eq("profile_mode", mode === "academic_cv" ? "cv_enhanced" : "academic")
    .eq("active", true)
    .maybeSingle();
  const raw = (data?.weights ?? null) as Partial<MatchWeights> | null;
  if (!raw) return fallback;
  const merged = { ...fallback, ...raw };
  const out: MatchWeights = { ...fallback };
  for (const k of Object.keys(fallback) as (keyof MatchWeights)[]) {
    const v = Number(merged[k]);
    out[k] = Number.isFinite(v) && v >= 0 ? v : fallback[k];
  }
  return out;
}


export function scoreRole(
  role: CareerRole,
  cvInput: ParsedCv,
  evidence: StudentEvidence,
  prefs: CareerPreferences,
  opts: { weights?: MatchWeights; mode?: ProfileSource } = {},
): RoleMatch {
  const mode: ProfileSource = opts.mode ?? "academic_cv";
  // Academic-only analysis never reads CV evidence, even if a stale CV exists.
  const cv = mode === "academic" ? EMPTY_PARSED_CV : cvInput;
  const weights = opts.weights ?? (mode === "academic" ? DEFAULT_ACADEMIC_WEIGHTS : DEFAULT_CV_WEIGHTS);

  const cvSkills = normSet([...cv.skills, ...cv.tools, ...cv.projects.flatMap((p) => p.technologies)]);
  const cvTools = normSet([...cv.tools, ...cv.projects.flatMap((p) => p.technologies)]);
  const cvCerts = normSet(cv.certifications);
  const cvText = normSet([
    ...cv.skills,
    ...cv.tools,
    ...cv.achievements,
    ...cv.experience.flatMap((e) => [e.title ?? "", ...e.bullets]),
    ...cv.projects.map((p) => `${p.title ?? ""} ${p.description ?? ""}`),
    cv.summary ?? "",
  ]);
  const courseText = normSet([
    ...evidence.completedCourses.map((c) => c.title),
    ...evidence.completedCourses.map((c) => c.code),
  ]);

  // Programme alignment — verified university record
  const programme = evidence.programmeEn ?? "";
  const programmeMatch = role.suitable_programmes.some((p) => has(normSet([programme]), p));
  const familyHint = has(normSet([programme]), role.career_family.replace(/_/g, " "));
  const programmeScore = programmeMatch ? 1 : familyHint ? 0.6 : 0.25;

  // Coursework — verified university records only
  const matchedCourses = role.preferred_courses.filter((c) => has(courseText, c));
  const missingCourses = role.preferred_courses.filter((c) => !has(courseText, c));
  const courseworkScore = pct(matchedCourses.length, role.preferred_courses.length);

  // Hard skills — tracked by where the evidence came from
  const skillSource = (s: string): "cv" | "university" | null =>
    has(cvSkills, s) ? "cv" : has(courseText, s) ? "university" : null;
  const matchedRequired = role.required_hard_skills.filter((s) => skillSource(s) !== null);
  const missingRequired = role.required_hard_skills.filter((s) => !matchedRequired.includes(s));
  const matchedPreferred = role.preferred_hard_skills.filter((s) => skillSource(s) !== null);
  const missingPreferred = role.preferred_hard_skills.filter((s) => !matchedPreferred.includes(s));
  const cvDemonstratedSkills = role.required_hard_skills
    .concat(role.preferred_hard_skills)
    .filter((s) => has(cvSkills, s));
  const hardSkillScore =
    0.75 * pct(matchedRequired.length, role.required_hard_skills.length) +
    0.25 * pct(matchedPreferred.length, role.preferred_hard_skills.length);

  // Experience and projects — CV evidence plus the verified internship record
  const relevantExperience = cv.experience.filter((e) =>
    role.required_hard_skills.concat(role.preferred_hard_skills).some((s) =>
      has(normSet([e.title ?? "", ...e.bullets]), s),
    ),
  ).length;
  const relevantProjects = cv.projects.filter((p) =>
    role.required_hard_skills.concat(role.preferred_hard_skills).some((s) =>
      has(normSet([p.title ?? "", p.description ?? "", ...p.technologies]), s),
    ),
  ).length;
  const experienceScore = Math.min(
    1,
    (evidence.hasInternship ? 0.35 : 0) + Math.min(0.4, relevantExperience * 0.2) + Math.min(0.35, relevantProjects * 0.15),
  );

  // Tools
  const matchedTools = role.preferred_tools.filter((t) => has(cvTools, t));
  const missingTools = role.preferred_tools.filter((t) => !matchedTools.includes(t));
  const toolsScore = pct(matchedTools.length, role.preferred_tools.length);

  // Certifications
  const matchedCerts = role.certifications.filter((c) => has(cvCerts, c));
  const certificationScore = role.certifications.length === 0 ? 0.6 : pct(matchedCerts.length, role.certifications.length);

  // Soft skills
  const matchedSoft = role.required_soft_skills.filter((s) => has(cvText, s));
  const softSkillScore = pct(matchedSoft.length, role.required_soft_skills.length);

  // Stated preferences
  const prefSet = normSet([...prefs.preferredRoles, ...prefs.preferredFields, ...prefs.preferredSectors]);
  const preferenceScore =
    prefSet.size === 0
      ? 0.5
      : has(prefSet, role.title_en) || has(prefSet, role.career_family.replace(/_/g, " ")) ||
          role.industry_sectors.some((s) => has(prefSet, s))
        ? 1
        : 0.2;

  const raw = {
    programme: programmeScore * weights.programme,
    coursework: courseworkScore * weights.coursework,
    hardSkills: hardSkillScore * weights.hardSkills,
    experience: experienceScore * weights.experience,
    tools: toolsScore * weights.tools,
    certifications: certificationScore * weights.certifications,
    softSkills: softSkillScore * weights.softSkills,
    preference: preferenceScore * weights.preference,
  };
  // Weights are configurable, so normalise to a 0–100 scale regardless of their sum.
  // In academic mode the CV-only categories cannot be evidenced, so they are excluded
  // from the denominator instead of silently dragging every score down.
  const applicable: (keyof MatchWeights)[] =
    mode === "academic"
      ? ["programme", "coursework", "hardSkills", "experience", "preference"]
      : (Object.keys(weights) as (keyof MatchWeights)[]);
  const totalWeight = applicable.reduce((a, k) => a + weights[k], 0) || 100;
  const scale = 100 / totalWeight;

  const contribute = (k: keyof MatchWeights) => (applicable.includes(k) ? round1(raw[k] * scale) : 0);
  const breakdown = {
    programme: contribute("programme"),
    coursework: contribute("coursework"),
    hardSkills: contribute("hardSkills"),
    experience: contribute("experience"),
    tools: contribute("tools"),
    certifications: contribute("certifications"),
    softSkills: contribute("softSkills"),
    preference: contribute("preference"),
  };

  const fitScore = Math.round(Object.values(breakdown).reduce((a, b) => a + b, 0));

  // Readiness weights the "can you apply today" signals only.
  const jobReadinessScore = Math.round(
    100 *
      (0.45 * pct(matchedRequired.length, role.required_hard_skills.length) +
        0.25 * experienceScore +
        0.2 * toolsScore +
        0.1 * certificationScore),
  );

  const evidenceItems: EvidenceItem[] = [];
  const push = (source: EvidenceItem["source"], textEn: string, textAr: string) =>
    evidenceItems.push({ source, textEn, textAr });

  if (programmeMatch && evidence.programmeEn) {
    push("university", `${evidence.programmeEn} programme`, `برنامج ${evidence.programmeAr ?? evidence.programmeEn}`);
  }
  if (matchedCourses.length) {
    push("university", `Completed ${matchedCourses.slice(0, 4).join(", ")}`, `أنجزت مواد: ${matchedCourses.slice(0, 4).join("، ")}`);
  }
  if (evidence.hasInternship) {
    push(
      "university",
      `Verified internship record: ${evidence.internshipTitle ?? "completed placement"}`,
      `سجل تدريب عملي معتمد: ${evidence.internshipTitle ?? "تدريب منجز"}`,
    );
  }
  if (cvDemonstratedSkills.length) {
    push("cv", `CV demonstrates ${cvDemonstratedSkills.slice(0, 5).join(", ")}`, `تُظهر السيرة الذاتية: ${cvDemonstratedSkills.slice(0, 5).join("، ")}`);
  }
  if (relevantProjects) {
    push("cv", `${relevantProjects} relevant project${relevantProjects > 1 ? "s" : ""} found in the CV`, `${relevantProjects} مشروع ذو صلة في السيرة الذاتية`);
  }
  if (relevantExperience) {
    push("cv", `${relevantExperience} relevant work or internship entr${relevantExperience > 1 ? "ies" : "y"} in the CV`, `${relevantExperience} خبرة عملية ذات صلة في السيرة الذاتية`);
  }
  if (matchedTools.length) {
    push("cv", `Tools evidenced: ${matchedTools.slice(0, 4).join(", ")}`, `أدوات موثقة: ${matchedTools.slice(0, 4).join("، ")}`);
  }
  if (matchedCerts.length) {
    push("cv", `Certifications: ${matchedCerts.slice(0, 3).join(", ")}`, `شهادات: ${matchedCerts.slice(0, 3).join("، ")}`);
  }
  if (matchedSoft.length) {
    push("cv", `Soft-skill evidence: ${matchedSoft.slice(0, 3).join(", ")}`, `مهارات شخصية موثقة: ${matchedSoft.slice(0, 3).join("، ")}`);
  }

  const missingRequirements: string[] = [];
  if (missingRequired.length) missingRequirements.push(`Missing core skills: ${missingRequired.join(", ")}`);
  if (missingTools.length) missingRequirements.push(`Unfamiliar tools: ${missingTools.slice(0, 4).join(", ")}`);
  if (!evidence.hasInternship && !relevantExperience) missingRequirements.push(role.experience_expectations || "No applied experience evidenced yet.");
  if (mode === "academic_cv" && !relevantProjects) missingRequirements.push(role.portfolio_expectations || "No portfolio project evidenced yet.");
  if (missingCourses.length) missingRequirements.push(`Recommended courses not yet completed: ${missingCourses.slice(0, 4).join(", ")}`);

  return {
    roleId: role.id,
    roleCode: role.role_code,
    titleEn: role.title_en,
    titleAr: role.title_ar,
    careerFamily: role.career_family,
    fitScore,
    jobReadinessScore,
    breakdown,
    matchedEvidence: evidenceItems.map((e) => e.textEn),
    evidenceItems,
    missingRequirements,
    skillBreakdown: {
      matchedRequired,
      missingRequired,
      matchedPreferred,
      missingPreferred,
      matchedTools,
      missingTools,
      matchedCourses,
      missingCourses,
      cvSkills: cvDemonstratedSkills,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Skill gap analysis                                                  */
/* ------------------------------------------------------------------ */

export type SkillEvidenceSource = "cv" | "coursework" | "recommended";
export type SkillGapEntry = { skill: string; source: SkillEvidenceSource; required: boolean };
export type SkillGapAnalysis = {
  preliminary: boolean;
  targetRoleEn: string | null;
  targetRoleAr: string | null;
  strong: SkillGapEntry[];
  developing: SkillGapEntry[];
  missing: SkillGapEntry[];
};

/**
 * Splits the target role's skill requirements into strong (demonstrated in the CV),
 * developing (supported by coursework only) and missing (nothing yet).
 * Without a CV the result is explicitly preliminary.
 */
export function buildSkillGaps(
  role: CareerRole | null,
  match: RoleMatch | null,
  cv: ParsedCv,
  evidence: StudentEvidence,
  hasCv: boolean,
): SkillGapAnalysis {
  const empty: SkillGapAnalysis = {
    preliminary: !hasCv,
    targetRoleEn: role?.title_en ?? null,
    targetRoleAr: role?.title_ar ?? null,
    strong: [],
    developing: [],
    missing: [],
  };
  if (!role || !match) return empty;

  const cvSkills = normSet(hasCv ? [...cv.skills, ...cv.tools, ...cv.projects.flatMap((p) => p.technologies)] : []);
  const courseText = normSet([
    ...evidence.completedCourses.map((c) => c.title),
    ...evidence.completedCourses.map((c) => c.code),
  ]);

  const all: { skill: string; required: boolean }[] = [
    ...role.required_hard_skills.map((s) => ({ skill: s, required: true })),
    ...role.preferred_hard_skills.map((s) => ({ skill: s, required: false })),
    ...role.preferred_tools.map((s) => ({ skill: s, required: false })),
  ];

  const out = { ...empty, strong: [] as SkillGapEntry[], developing: [] as SkillGapEntry[], missing: [] as SkillGapEntry[] };
  const seen = new Set<string>();
  for (const item of all) {
    const key = norm(item.skill);
    if (seen.has(key)) continue;
    seen.add(key);
    if (has(cvSkills, item.skill)) out.strong.push({ skill: item.skill, source: "cv", required: item.required });
    else if (has(courseText, item.skill)) out.developing.push({ skill: item.skill, source: "coursework", required: item.required });
    else out.missing.push({ skill: item.skill, source: "recommended", required: item.required });
  }
  out.missing.sort((a, b) => Number(b.required) - Number(a.required));
  return out;
}


/* ------------------------------------------------------------------ */
/* ATS scoring (deterministic engine in ./ats.server)                  */
/* ------------------------------------------------------------------ */

export type {
  AtsScore,
  AtsCategory,
  AtsBand,
  RoleAtsScore,
  SkillEvidence,
  EvidenceStrength,
  ParsingConfidence,
} from "./ats.server";

export type AtsConfig = {
  general: GeneralAtsWeights;
  role: RoleAtsWeights;
  bands: AtsBand[];
};

/**
 * Loads the active, versioned scoring configuration. Weights and bands are
 * data, not code, so the model can be tuned without changing the engine —
 * and every stored score records the weights version it was produced with.
 */
export async function loadAtsConfig(_db: Db): Promise<AtsConfig> {
  const { data } = await supabaseAdmin
    .from("ats_scoring_profiles")
    .select("scope, role_code, weights, bands, weights_version")
    .eq("active", true)
    .eq("weights_version", ATS_WEIGHTS_VERSION);

  const rows = data ?? [];
  const generalRow = rows.find((r) => r.scope === "general" && !r.role_code);
  const roleRow = rows.find((r) => r.scope === "role" && !r.role_code);

  const merge = <T extends Record<string, number>>(fallback: T, raw: unknown): T => {
    const out = { ...fallback };
    const source = (raw ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(fallback) as (keyof T)[]) {
      const v = Number(source[k as string]);
      if (Number.isFinite(v) && v >= 0) out[k] = v as T[keyof T];
    }
    return out;
  };

  const bands = Array.isArray(generalRow?.bands) ? (generalRow.bands as unknown as AtsBand[]) : [];
  return {
    general: merge(DEFAULT_GENERAL_WEIGHTS, generalRow?.weights),
    role: merge(DEFAULT_ROLE_WEIGHTS, roleRow?.weights),
    bands: bands.length ? bands : DEFAULT_BANDS,
  };
}


/* ------------------------------------------------------------------ */
/* Action plan                                                         */
/* ------------------------------------------------------------------ */

export type ActionPlanItem = { horizon: "30_days" | "90_days" | "before_graduation"; titleEn: string; titleAr: string; detailEn: string; detailAr: string };

export function buildActionPlan(top: RoleMatch, role: CareerRole, ats: AtsScore | null, evidence: StudentEvidence): ActionPlanItem[] {
  const plan: ActionPlanItem[] = [];
  const missing = top.skillBreakdown.missingRequired;
  const tools = top.skillBreakdown.missingTools;

  if (ats && ats.improvements.length) {
    plan.push({
      horizon: "30_days",
      titleEn: "Fix the CV issues that block automated screening",
      titleAr: "معالجة ملاحظات السيرة الذاتية التي تعيق الفرز الآلي",
      detailEn: ats.improvements.slice(0, 3).map((i) => i.en).join(" "),
      detailAr: ats.improvements.slice(0, 3).map((i) => i.ar).join(" "),
    });
  }
  if (missing.length) {
    plan.push({
      horizon: "30_days",
      titleEn: `Start closing the core skill gap for ${role.title_en}`,
      titleAr: `ابدأ بسد الفجوة في المهارات الأساسية لوظيفة ${role.title_ar}`,
      detailEn: `Focus first on: ${missing.slice(0, 3).join(", ")}.`,
      detailAr: `ركّز أولاً على: ${missing.slice(0, 3).join("، ")}.`,
    });
  }
  if (tools.length) {
    plan.push({
      horizon: "90_days",
      titleEn: "Build one portfolio project using the expected tools",
      titleAr: "أنجز مشروعاً واحداً باستخدام الأدوات المطلوبة",
      detailEn: `${role.portfolio_expectations || "Publish a documented project."} Use ${tools.slice(0, 3).join(", ")}.`,
      detailAr: `انشر مشروعاً موثقاً باستخدام ${tools.slice(0, 3).join("، ")}.`,
    });
  }
  if (role.certifications.length) {
    plan.push({
      horizon: "90_days",
      titleEn: "Prepare for a recognised certification",
      titleAr: "استعد لشهادة مهنية معتمدة",
      detailEn: `Employers screen for: ${role.certifications.join(", ")}.`,
      detailAr: `الشهادات المطلوبة: ${role.certifications.join("، ")}.`,
    });
  }
  if (!evidence.hasInternship) {
    plan.push({
      horizon: "before_graduation",
      titleEn: "Secure an internship placement through Sanadi",
      titleAr: "احجز فرصة تدريب عملي عبر سندي",
      detailEn: role.experience_expectations || "Applied experience is expected for this role.",
      detailAr: "الخبرة التطبيقية شرط أساسي للتقدم لهذه الوظيفة.",
    });
  }
  if (top.skillBreakdown.missingCourses.length) {
    plan.push({
      horizon: "before_graduation",
      titleEn: "Choose electives that match the target role",
      titleAr: "اختر مواد اختيارية تناسب الوظيفة المستهدفة",
      detailEn: `Recommended: ${top.skillBreakdown.missingCourses.slice(0, 3).join(", ")}.`,
      detailAr: `المواد المقترحة: ${top.skillBreakdown.missingCourses.slice(0, 3).join("، ")}.`,
    });
  }
  return plan;
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

export async function loadPreferences(db: Db, userId: string): Promise<CareerPreferences & { latestCvId: string | null; counsellorRequested: boolean }> {
  const { data } = await db
    .from("student_career_profiles")
    .select("preferred_roles, preferred_fields, preferred_sectors, work_orientation, latest_cv_id, counsellor_requested")
    .eq("student_id", userId)
    .maybeSingle();
  return {
    preferredRoles: data?.preferred_roles ?? [],
    preferredFields: data?.preferred_fields ?? [],
    preferredSectors: data?.preferred_sectors ?? [],
    workOrientation: data?.work_orientation ?? null,
    latestCvId: data?.latest_cv_id ?? null,
    counsellorRequested: data?.counsellor_requested ?? false,
  };
}

/**
 * Single source of truth for "this student has a CV":
 * a row owned by the authenticated student, current, and not deleted.
 */
export async function loadCurrentCv(db: Db, userId: string) {
  const { data } = await db
    .from("student_cv_documents")
    .select("*")
    .eq("student_id", userId)
    .eq("is_current", true)
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export type AnalysisVersionSummary = {
  versionNo: number;
  profileSource: ProfileSource;
  cvFileName: string | null;
  calculatedAt: string;
  topRoles: { roleCode: string; titleEn: string; titleAr: string; fitScore: number }[];
};

export type CareerAnalysis = {
  /** A current, non-deleted CV record exists for this student. */
  hasCv: boolean;
  /** The current CV yielded readable text and is used in the analysis. */
  cvAnalyzed: boolean;
  cvId: string | null;
  cvFileName: string | null;
  cvUploadedAt: string | null;
  parsingStatus: string | null;
  profileSource: ProfileSource;
  versionNo: number;
  weights: MatchWeights;
  evidence: StudentEvidence;
  matches: RoleMatch[];
  ats: AtsScore | null;
  roleAts: RoleAtsScore[];
  atsHistory: { previousScore: number; previousAt: string; delta: number } | null;
  skillGaps: SkillGapAnalysis;
  actionPlan: ActionPlanItem[];
  injectionFlagged: boolean;
  discrepancies: string[];
  calculatedAt: string;
  previousVersion: AnalysisVersionSummary | null;
  rankingChange: { en: string; ar: string } | null;
};

function summariseVersion(row: {
  version_no: number;
  profile_source: string;
  cv_file_name: string | null;
  calculated_at: string;
  matches: unknown;
}): AnalysisVersionSummary {
  const matches = Array.isArray(row.matches) ? (row.matches as RoleMatch[]) : [];
  return {
    versionNo: row.version_no,
    profileSource: row.profile_source === "academic_cv" ? "academic_cv" : "academic",
    cvFileName: row.cv_file_name,
    calculatedAt: row.calculated_at,
    topRoles: matches.slice(0, 3).map((m) => ({ roleCode: m.roleCode, titleEn: m.titleEn, titleAr: m.titleAr, fitScore: m.fitScore })),
  };
}

/** Explains a change of top role between two analysis runs so rankings never look arbitrary. */
function explainRankingChange(
  previous: AnalysisVersionSummary | null,
  current: RoleMatch[],
  profileSource: ProfileSource,
): { en: string; ar: string } | null {
  const top = current[0];
  const prevTop = previous?.topRoles[0];
  if (!top || !prevTop || prevTop.roleCode === top.roleCode) return null;
  const cvEvidence = top.evidenceItems.filter((e) => e.source === "cv").slice(0, 3);
  if (profileSource === "academic_cv" && cvEvidence.length) {
    return {
      en: `Based only on your academic programme, ${prevTop.titleEn} was your strongest match. After reviewing your CV, ${top.titleEn} is now your best fit because ${cvEvidence.map((e) => e.textEn.toLowerCase()).join("; ")}.`,
      ar: `اعتماداً على برنامجك الأكاديمي فقط، كان ${prevTop.titleAr} أقوى تطابق لديك. وبعد مراجعة سيرتك الذاتية، أصبح ${top.titleAr} الأنسب لأن ${cvEvidence.map((e) => e.textAr).join("؛ ")}.`,
    };
  }
  return {
    en: `Your strongest match changed from ${prevTop.titleEn} to ${top.titleEn} after this update to your profile.`,
    ar: `تغيّر أقوى تطابق لديك من ${prevTop.titleAr} إلى ${top.titleAr} بعد تحديث ملفك.`,
  };
}

/** Runs fit + ATS + skill gaps + plan for the signed-in student and persists a new analysis version. */
export async function analyseCareer(
  db: Db,
  userId: string,
  opts: { targetRoleCode?: string | null; limit?: number; persist?: boolean } = {},
): Promise<CareerAnalysis> {
  // Weight profiles and the previous version used to be two extra sequential
  // round-trips after this batch; both are independent of it, so they run here.
  const [cv, prefs, evidence, { data: roles }, { data: weightRows }, { data: prevRow }, atsConfig, { data: atsRows }] =
    await Promise.all([
      loadCurrentCv(db, userId),
      loadPreferences(db, userId),
      loadStudentEvidence(db, userId),
      db.from("career_roles").select("*").eq("active", true),
      supabaseAdmin.from("career_matching_weight_profiles").select("profile_mode, weights").eq("active", true),
      db
        .from("career_analysis_versions")
        .select("version_no, profile_source, cv_file_name, calculated_at, matches")
        .eq("student_id", userId)
        .order("version_no", { ascending: false })
        .limit(1)
        .maybeSingle(),
      loadAtsConfig(db),
      db
        .from("cv_ats_scores")
        .select("overall_score, calculated_at, cv_id, weights_version, scoring_version, score_kind")
        .eq("student_id", userId)
        .eq("score_kind", "general")
        .order("calculated_at", { ascending: false })
        .limit(5),
    ]);


  // A CV exists as soon as there is a current, non-deleted record. It is usable
  // for scoring whenever readable text was extracted — a heuristic ("partial")
  // parse is still real evidence, only a "failed" extraction is not.
  const cvExists = Boolean(cv);
  const hasCv = Boolean(cv && cv.parsing_status !== "failed" && (cv.parsed_text?.length ?? 0) >= 60);
  const profileSource: ProfileSource = hasCv ? "academic_cv" : "academic";
  const fallbackWeights = hasCv ? DEFAULT_CV_WEIGHTS : DEFAULT_ACADEMIC_WEIGHTS;
  const rawWeights = ((weightRows ?? []).find(
    (w) => w.profile_mode === (hasCv ? "cv_enhanced" : "academic"),
  )?.weights ?? null) as Partial<MatchWeights> | null;
  const weights: MatchWeights = { ...fallbackWeights };
  if (rawWeights) {
    for (const k of Object.keys(fallbackWeights) as (keyof MatchWeights)[]) {
      const v = Number({ ...fallbackWeights, ...rawWeights }[k]);
      weights[k] = Number.isFinite(v) && v >= 0 ? v : fallbackWeights[k];
    }
  }


  const parsed: ParsedCv = { ...EMPTY_PARSED_CV, ...((cv?.parsed_profile_json as Partial<ParsedCv> | null) ?? {}) };
  const allRoles = (roles ?? []) as CareerRole[];
  const matches = allRoles
    .map((r) => scoreRole(r, parsed, evidence, prefs, { weights, mode: profileSource }))
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, opts.limit ?? 5);

  const targetRole =
    allRoles.find((r) => r.role_code === opts.targetRoleCode) ??
    allRoles.find((r) => r.id === matches[0]?.roleId) ??
    null;
  const targetMatch = matches.find((m) => m.roleId === targetRole?.id) ?? matches[0] ?? null;

  // ATS is meaningless without a CV — never fabricate a score.
  const now = new Date();
  const cvVersion = hasCv ? ((cv!.content_sha256 as string | null) ?? cv!.id) : null;
  const ats =
    hasCv && cv?.parsed_text
      ? scoreGeneralAts({
          cv: parsed,
          rawText: cv.parsed_text,
          parsingStatus: cv.parsing_status,
          evidence,
          targetRole,
          weights: atsConfig.general,
          bands: atsConfig.bands,
          cvVersion,
          now,
        })
      : null;

  // Score the top matches against the role-specific model as well.
  const roleAts: RoleAtsScore[] =
    hasCv && cv?.parsed_text
      ? matches
          .slice(0, 3)
          .map((m) => allRoles.find((r) => r.id === m.roleId))
          .filter((r): r is CareerRole => Boolean(r))
          .map((role) =>
            scoreRoleAts({
              role,
              cv: parsed,
              rawText: cv.parsed_text!,
              evidence,
              weights: atsConfig.role,
              bands: atsConfig.bands,
              cvVersion,
              now,
            }),
          )
      : [];

  // Invariant guard: a malformed score must never reach the student.
  const integrityErrors = [...(ats ? validateAtsIntegrity(ats) : []), ...roleAts.flatMap((r) => validateAtsIntegrity(r))];
  if (integrityErrors.length) console.error("[ats] integrity check failed", integrityErrors);

  const priorGeneral = (atsRows ?? []).find((r) => r.cv_id !== (hasCv ? cv!.id : null)) ?? null;
  const atsHistory =
    ats && priorGeneral
      ? {
          previousScore: priorGeneral.overall_score,
          previousAt: priorGeneral.calculated_at,
          delta: ats.overall - priorGeneral.overall_score,
        }
      : null;

  const skillGaps = buildSkillGaps(targetRole, targetMatch, parsed, evidence, hasCv);
  const actionPlan = targetMatch && targetRole ? buildActionPlan(targetMatch, targetRole, ats, evidence) : [];
  const calculatedAt = now.toISOString();


  const previousVersion = prevRow ? summariseVersion(prevRow) : null;
  const rankingChange = explainRankingChange(previousVersion, matches, profileSource);

  // Only record a new version when the analysis actually changed, so page views don't inflate history.
  const signature = (src: string, cvName: string | null, top: { roleCode: string; fitScore: number }[]) =>
    `${src}|${cvName ?? ""}|${top.map((t) => `${t.roleCode}:${t.fitScore}`).join(",")}`;
  const currentSig = signature(profileSource, hasCv ? (cv!.file_name ?? null) : null, matches.slice(0, 3));
  const changed =
    !previousVersion ||
    currentSig !== signature(previousVersion.profileSource, previousVersion.cvFileName, previousVersion.topRoles);
  const versionNo = changed ? (previousVersion?.versionNo ?? 0) + 1 : previousVersion.versionNo;

  const persist = opts.persist !== false;
  if (persist) {

    await db.from("career_role_matches").delete().eq("student_id", userId);
    if (matches.length) {
      await db.from("career_role_matches").insert(
        matches.map((m) => ({
          student_id: userId,
          cv_id: hasCv ? cv!.id : null,
          career_role_id: m.roleId,
          fit_score: m.fitScore,
          programme_score: m.breakdown.programme,
          coursework_score: m.breakdown.coursework,
          hard_skill_score: m.breakdown.hardSkills,
          experience_score: m.breakdown.experience,
          tools_score: m.breakdown.tools,
          certification_score: m.breakdown.certifications,
          soft_skill_score: m.breakdown.softSkills,
          preference_score: m.breakdown.preference,
          job_readiness_score: m.jobReadinessScore,
          matched_evidence: m.matchedEvidence,
          missing_requirements: m.missingRequirements,
          skill_breakdown: m.skillBreakdown,
          scoring_version: CAREER_FIT_VERSION,
          calculated_at: calculatedAt,
        })),
      );
    }

    // Keep every distinct run so the student's analysis history is never lost.
    if (changed) {
      await db.from("career_analysis_versions").insert({
        student_id: userId,
        version_no: versionNo,
        profile_source: profileSource,
        cv_id: hasCv ? cv!.id : null,
        cv_file_name: hasCv ? (cv!.file_name ?? null) : null,
        weights: JSON.parse(JSON.stringify(weights)),
        matches: JSON.parse(JSON.stringify(matches)),
        ats: ats ? JSON.parse(JSON.stringify(ats)) : null,
        skill_gaps: JSON.parse(JSON.stringify(skillGaps)),
        action_plan: JSON.parse(JSON.stringify(actionPlan)),
        scoring_version: CAREER_FIT_VERSION,
        calculated_at: calculatedAt,
      });
    }


    // Scores are reproducible, so one row per (CV, kind, role, engine, weights)
    // is enough — and older runs stay in place as history.
    if (hasCv && ats) {
      const cat = (s: { categories: { key: string; score: number }[] }, key: string) =>
        s.categories.find((c) => c.key === key)?.score ?? 0;
      const rows = [
        {
          student_id: userId,
          cv_id: cv!.id,
          target_role_id: targetRole?.id ?? null,
          score_kind: "general",
          role_code: null as string | null,
          cv_version: cvVersion,
          parsing_confidence: ats.confidence,
          overall_score: ats.overall,
          structure_score: cat(ats, "parsing"),
          contact_score: cat(ats, "contact"),
          education_score: cat(ats, "education"),
          skills_score: cat(ats, "skills"),
          experience_project_score: cat(ats, "experienceProject"),
          achievement_score: cat(ats, "achievement"),
          keyword_score: cat(ats, "keyword"),
          completeness_score: cat(ats, "completeness"),
          clarity_score: cat(ats, "clarity"),
          strengths: ats.strengths.map((s) => s.en),
          improvements: ats.improvements.map((s) => s.en),
          recommended_keywords: ats.recommendedKeywords,
          breakdown: JSON.parse(JSON.stringify(ats.categories)),
          details: JSON.parse(JSON.stringify({ band: ats.band, evidence: ats.evidence, dateIssues: ats.dateIssues })),
          scoring_version: ATS_ENGINE_VERSION,
          weights_version: ATS_WEIGHTS_VERSION,
          calculated_at: calculatedAt,
        },
        ...roleAts.map((r) => ({
          student_id: userId,
          cv_id: cv!.id,
          target_role_id: r.roleId,
          score_kind: "role",
          role_code: r.roleCode,
          cv_version: cvVersion,
          parsing_confidence: ats.confidence,
          overall_score: r.overall,
          structure_score: 0,
          contact_score: 0,
          education_score: cat(r, "coursework"),
          skills_score: cat(r, "requiredSkills"),
          experience_project_score: cat(r, "experience"),
          achievement_score: cat(r, "certifications"),
          keyword_score: cat(r, "terminology"),
          completeness_score: cat(r, "projects"),
          clarity_score: cat(r, "tools"),
          strengths: r.strongMatches.map((m) => m.skill),
          improvements: r.missingEvidence,
          recommended_keywords: [],
          breakdown: JSON.parse(JSON.stringify(r.categories)),
          details: JSON.parse(JSON.stringify({ band: r.band, strongMatches: r.strongMatches })),
          scoring_version: ATS_ENGINE_VERSION,
          weights_version: ATS_WEIGHTS_VERSION,
          calculated_at: calculatedAt,
        })),
      ];

      const { data: existing } = await db
        .from("cv_ats_scores")
        .select("score_kind, role_code")
        .eq("cv_id", cv!.id)
        .eq("scoring_version", ATS_ENGINE_VERSION)
        .eq("weights_version", ATS_WEIGHTS_VERSION);
      const seen = new Set((existing ?? []).map((e) => `${e.score_kind}|${e.role_code ?? ""}`));
      const fresh = rows.filter((r) => !seen.has(`${r.score_kind}|${r.role_code ?? ""}`));
      if (fresh.length) await db.from("cv_ats_scores").insert(fresh);
    }


    await db
      .from("student_career_profiles")
      .upsert(
        { student_id: userId, latest_cv_id: hasCv ? cv!.id : null, career_fit_updated_at: calculatedAt },
        { onConflict: "student_id" },
      );
    await db.from("career_counselling_events").insert({
      student_id: userId,
      cv_id: hasCv ? cv!.id : null,
      event_type: "analysis_run",
      actor_id: userId,
      details: {
        topRole: matches[0]?.roleCode ?? null,
        atsScore: ats?.overall ?? null,
        profileSource,
        versionNo,
        version: CAREER_FIT_VERSION,
      },
    });
  }

  return {
    hasCv: cvExists,
    cvAnalyzed: hasCv,
    cvId: cv?.id ?? null,
    cvFileName: cv?.file_name ?? null,
    cvUploadedAt: cv?.uploaded_at ?? null,
    parsingStatus: cv?.parsing_status ?? null,
    profileSource,
    versionNo,
    weights,
    evidence,
    matches,
    ats,
    roleAts,
    atsHistory,
    skillGaps,
    actionPlan,
    injectionFlagged: Array.isArray(cv?.injection_flags) && (cv!.injection_flags as unknown[]).length > 0,
    discrepancies: ((cv?.discrepancies as string[] | null) ?? []).map(String),
    calculatedAt,
    previousVersion,
    rankingChange,
  };
}


/** Compares CV claims with verified university records. */
export function findDiscrepancies(cv: ParsedCv, evidence: StudentEvidence, lang: Lang = "en"): string[] {
  const out: string[] = [];
  const ar = lang === "ar";
  const cvText = normSet([cv.summary ?? "", ...cv.education.map((e) => `${e.institution ?? ""} ${e.qualification ?? ""}`)]);
  if (evidence.programmeEn && !has(cvText, evidence.programmeEn)) {
    out.push(ar ? `برنامجك المسجل رسمياً هو ${evidence.programmeAr ?? evidence.programmeEn} ولم يُذكر في السيرة الذاتية.` : `Your registered programme (${evidence.programmeEn}) is not stated in the CV.`);
  }
  if (evidence.hasInternship && !cv.experience.length) {
    out.push(ar ? "لديك سجل تدريب عملي معتمد لم يُدرج في السيرة الذاتية." : "You have a verified internship record that is missing from the CV.");
  }
  const gpaClaim = /gpa[^0-9]{0,6}([0-4](?:\.\d{1,2})?)/i.exec(cv.summary ?? "");
  if (gpaClaim && evidence.gpa != null && Math.abs(Number(gpaClaim[1]) - evidence.gpa) > 0.05) {
    out.push(ar ? `المعدل المذكور في السيرة (${gpaClaim[1]}) يختلف عن سجلك الرسمي (${evidence.gpa}).` : `The GPA in the CV (${gpaClaim[1]}) differs from your official record (${evidence.gpa}).`);
  }
  return out;
}
