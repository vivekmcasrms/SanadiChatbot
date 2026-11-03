/**
 * Academic Progress Agent. Server only.
 *
 * Responsibility: explain a signed-in student's academic progress from the
 * verified university record only. Every number here is computed by this
 * module — the model never invents credits, courses or graduation dates.
 *
 * Inputs : authenticated user id (never a student id supplied by the model)
 * Data   : student_profiles, academic_programs, student_course_history,
 *          student_current_enrollments, program_courses, student_holds,
 *          student_requirements (all under the caller's own RLS scope)
 * Outputs: a structured report (credits, course lists, degree progress,
 *          on-track assessment, data gaps) plus bilingual prose, quick actions
 *          and — when data cannot be verified — a routed escalation proposal.
 */
import type { Citation, Lang } from "../agent-types";
import { formatDate } from "../format-date";
import {
  academicLinks,
  loadStudentSnapshot,
  DEFAULT_TOTAL_CREDIT_HOURS,
  type StudentSnapshot,
} from "../student-context.server";
import {
  loadAcademicCourses,
  courseLine,
  basketLine,
  type AcademicCourses,
} from "../academic-record.server";

import type { Db } from "./tools.server";
import { humanizeStatus } from "./registration-readiness.server";


export type AcademicProgressIntent =
  | "credits_completed"
  | "credits_remaining"
  | "courses_completed"
  | "courses_current"
  | "courses_remaining"
  | "graduation"
  | "focus"
  | "overview";

/** Unit that owns study plans and degree audits when data is missing. */
export const ACADEMIC_UNIT_CODE = "SAS";

const RE: { intent: AcademicProgressIntent; re: RegExp }[] = [
  {
    intent: "courses_remaining",
    re: /((courses?|subjects?|modules?|classes)\s+(do i|i)?\s*(still\s+)?(need|have left|remain|are left|to take))|(remaining|outstanding|left)\s+(courses?|subjects?|requirements?)|what('| i)?s left (in|on) my (plan|programme|program)|ما (هي )?المواد (المتبقية|الباقية|اللي باقي)|المواد المتبقية|المقررات المتبقية|كم (مادة|مقرر) (باقي|متبقي)/i,
  },
  {
    intent: "courses_current",
    re: /(courses?|subjects?|classes|modules?).{0,20}(am i (currently )?(taking|registered|enrolled)|this (semester|term)|current(ly)?)|(current|this term) (courses?|registration)|المواد (الحالية|المسجلة)|المقررات (الحالية|المسجلة)|ماذا أدرس (الآن|هذا الفصل)/i,
  },
  {
    intent: "courses_completed",
    re: /(courses?|subjects?|classes|modules?).{0,20}(have i (completed|finished|passed|taken)|i (completed|finished|passed))|completed (courses?|subjects?)|المواد (المكتملة|المنجزة|التي أنهيتها)|المقررات المكتملة|ما (هي )?المواد التي (أنهيتها|أكملتها)/i,
  },
  {
    intent: "credits_remaining",
    re: /(credits?|credit hours?|hours?).{0,25}(left|remain|do i (still )?need|to graduate)|(how many|كم).{0,20}(credits?|ساعة|ساعات).{0,20}(left|remaining|متبقي|باقي)|(الساعات|ساعات) (المتبقية|الباقية)|كم ساعة (باقي|متبقية)/i,
  },
  {
    intent: "credits_completed",
    re: /(how many )?(credits?|credit hours?).{0,25}(have i (completed|earned|finished|done)|completed|earned)|كم (ساعة|ساعات) (أكملت|أنهيت|درست)|الساعات (المكتملة|المنجزة)/i,
  },
  {
    intent: "graduation",
    re: /(on track|able|eligible|ready).{0,20}(to )?graduat|when (will|do) i graduate|graduation (progress|date|status)|degree progress|هل (أنا )?(في المسار|جاهز|مؤهل).{0,15}(للتخرج|التخرج)|متى أتخرج|تقدم(ي)? (نحو )?التخرج|نسبة الإنجاز/i,
  },
  {
    intent: "focus",
    re: /what should i (focus on|prioriti[sz]e|study|do) (academically|next)?|academic (advice|priorit|focus)|كيف أحسن (وضعي|مستواي) الأكاديمي|على ماذا أركز (أكاديمي|دراسي)|ما (الذي )?يجب أن أركز عليه/i,
  },
  {
    intent: "overview",
    re: /(my )?academic (progress|record|standing|summary|status)|(how am i doing).{0,20}(academic|in my (studies|programme|program))|(تقدمي|وضعي|سجلي) الأكاديمي|ملخص (دراستي|وضعي الأكاديمي)/i,
  },
];

/** True intent detection: bilingual, deterministic, no model call. */
export function detectAcademicProgressIntent(message: string): AcademicProgressIntent | null {
  const text = message.trim();
  if (!text) return null;
  for (const entry of RE) if (entry.re.test(text)) return entry.intent;
  return null;
}

export type DegreeProgress = {
  completedCredits: number;
  registeredCredits: number;
  requiredCredits: number;
  remainingCredits: number;
  percentComplete: number;
  /** Credits still needed once this term's registered credits are counted. */
  remainingAfterCurrentTerm: number;
  /** Estimated remaining terms at the student's current registration load. */
  estimatedTermsLeft: number | null;
  expectedGraduation: string | null;
  onTrack: boolean | null;
  graduationHolds: string[];
  pendingRequirements: { title: string; status: string; dueDate: string | null }[];
};

export type AcademicProgressReport = {
  intent: AcademicProgressIntent;
  answer: string;
  nextSteps: string[];
  citations: Citation[];
  verified: boolean;
  /** Anything the record could not confirm; never guessed around. */
  dataGaps: string[];
  proposals: { toolName: string; args: Record<string, unknown> }[];
  state: {
    programme: string | null;
    view: AcademicProgressIntent;
    progress: DegreeProgress;
    completedCourses: number;
    currentCourses: number;
    remainingCourses: number;
    studyPlanRegistered: boolean;
  };
};

const nf = (n: number) => new Intl.NumberFormat("en-US").format(n);

/** Pure, deterministic degree maths — the single source of these numbers. */
export function computeDegreeProgress(
  snapshot: StudentSnapshot,
  courses: AcademicCourses,
): DegreeProgress {
  const requiredCredits = snapshot.totalCredits ?? DEFAULT_TOTAL_CREDIT_HOURS;
  const completedCredits = snapshot.completedCredits;
  const registeredCredits = snapshot.registeredCredits;
  // Plan-derived remaining credits are preferred when the study plan exists,
  // because they reflect the actual outstanding requirements.
  const planRemaining = courses.programCourseCount > 0 ? courses.remainingCreditHours : null;
  const creditRemaining = Math.max(0, requiredCredits - completedCredits);
  const remainingCredits = planRemaining ?? creditRemaining;
  const remainingAfterCurrentTerm = Math.max(0, remainingCredits - registeredCredits);
  const load = registeredCredits > 0 ? registeredCredits : 15;
  const estimatedTermsLeft =
    remainingAfterCurrentTerm === 0 ? 0 : Math.ceil(remainingAfterCurrentTerm / load);

  let onTrack: boolean | null = null;
  if (snapshot.expectedGraduation) {
    const months =
      (new Date(snapshot.expectedGraduation).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30.4);
    // ~4 months to a term; a term of slack is allowed before calling it off-track.
    const termsAvailable = Math.floor(months / 4) + 1;
    onTrack = estimatedTermsLeft !== null && estimatedTermsLeft <= termsAvailable;
  }

  return {
    completedCredits,
    registeredCredits,
    requiredCredits,
    remainingCredits,
    percentComplete: requiredCredits > 0 ? Math.round((completedCredits / requiredCredits) * 100) : 0,
    remainingAfterCurrentTerm,
    estimatedTermsLeft,
    expectedGraduation: snapshot.expectedGraduation,
    onTrack,
    graduationHolds: snapshot.holds.filter((h) => h.blocksGraduation).map((h) => h.titleEn),
    pendingRequirements: snapshot.requirements.map((r) => ({
      title: r.titleEn,
      status: r.status,
      dueDate: r.dueDate,
    })),
  };
}

function citation(ar: boolean): Citation {
  return {
    documentId: null,
    sourceTitle: ar ? "سجلك الأكاديمي المعتمد" : "Your verified academic record",
    owningUnit: ar ? "خدمات الطلبة الأكاديمية" : "Student Academic Services",
    documentVersion: null,
    effectiveDate: new Date().toISOString().slice(0, 10),
    citationUrl: null,
    confidence: "high",
  };
}

function escalation(ar: boolean, gaps: string[]) {
  return {
    toolName: "escalate_to_human",
    args: {
      reason: ar
        ? `تعذّر التحقق من بيانات أكاديمية مطلوبة لحساب تقدم الطالب: ${gaps.join("، ")}`
        : `Academic data needed to calculate this student's progress could not be verified: ${gaps.join("; ")}`,
      unitCode: ACADEMIC_UNIT_CODE,
    },
  };
}

/**
 * Runs the agent: loads verified data, computes everything deterministically
 * and produces the student-facing answer. Returns null when no student record
 * is linked, so the caller can fall back to its own handling.
 */
export async function runAcademicProgressAgent(
  db: Db,
  userId: string,
  lang: Lang,
  intent: AcademicProgressIntent,
): Promise<AcademicProgressReport | null> {
  const ar = lang === "ar";
  const snapshot = await loadStudentSnapshot(db, userId);
  if (!snapshot.hasProfile) return null;

  const courses = await loadAcademicCourses(db, userId, snapshot.programId);
  const progress = computeDegreeProgress(snapshot, courses);
  const planRegistered = courses.programCourseCount > 0;

  const dataGaps: string[] = [];
  if (!planRegistered)
    dataGaps.push(ar ? "خطة البرنامج الدراسية غير مسجلة" : "programme study plan not registered");
  if (!courses.completed.length && snapshot.completedCredits > 0)
    dataGaps.push(ar ? "قائمة المواد المكتملة غير متوفرة" : "completed course list not available");
  if (!snapshot.expectedGraduation)
    dataGaps.push(ar ? "تاريخ التخرج المتوقع غير مسجل" : "expected graduation date not recorded");
  for (const b of courses.baskets.filter((x) => !x.courseListVerified))
    dataGaps.push(
      ar
        ? `قائمة المواد المعتمدة لمجموعة ${b.nameAr} غير مؤكدة رسمياً`
        : `the approved course list for ${b.nameEn} is not officially confirmed`,
    );


  const programme = (ar ? snapshot.programNameAr : snapshot.programNameEn) ?? snapshot.programCode;
  const parts: string[] = [];
  const nextSteps: string[] = [];
  let links: string[] = ["progress"];

  const creditsLine = ar
    ? `أكملت ${nf(progress.completedCredits)} من ${nf(progress.requiredCredits)} ساعة معتمدة (${progress.percentComplete}%)، وأنت مسجل في ${nf(progress.registeredCredits)} ساعة هذا الفصل.`
    : `You have completed ${nf(progress.completedCredits)} of ${nf(progress.requiredCredits)} credit hours (${progress.percentComplete}%), and you are registered for ${nf(progress.registeredCredits)} credit hours this semester.`;

  const remainingLine = ar
    ? `يتبقى ${nf(progress.remainingCredits)} ساعة معتمدة${progress.registeredCredits ? `، منها ${nf(progress.remainingAfterCurrentTerm)} ساعة بعد احتساب فصلك الحالي` : ""}.`
    : `${nf(progress.remainingCredits)} credit hours remain${progress.registeredCredits ? `, or ${nf(progress.remainingAfterCurrentTerm)} once this semester is counted` : ""}.`;

  const listOr = (list: typeof courses.completed, emptyEn: string, emptyAr: string) =>
    list.length ? list.map((c) => courseLine(c, ar)).join("\n") : ar ? emptyAr : emptyEn;

  switch (intent) {
    case "credits_completed":
      parts.push(creditsLine);
      links = ["completed", "progress"];
      break;

    case "credits_remaining":
      parts.push(remainingLine, creditsLine);
      links = ["remaining", "progress"];
      break;

    case "courses_completed":
      parts.push(
        ar
          ? `أكملت ${courses.completed.length} مادة بمجموع ${nf(courses.completedCreditHours)} ساعة معتمدة:`
          : `You have completed ${courses.completed.length} course(s) totalling ${nf(courses.completedCreditHours)} credit hours:`,
        listOr(
          courses.completed,
          "No completed courses are recorded yet.",
          "لا توجد مواد مكتملة مسجلة حتى الآن.",
        ),
      );
      links = ["completed", "progress"];
      break;

    case "courses_current":
      if (courses.current.length) {
        parts.push(
          `**${ar ? "مواد الفصل الحالي" : "Current courses"}**\n` +
            courses.current
              .map(
                (c, i) =>
                  `${i + 1}. ${c.code} — ${ar ? c.titleAr : c.titleEn} · ${c.creditHours} ${ar ? "س.م" : "cr"}`,
              )
              .join("\n"),
          ar
            ? `المجموع: ${courses.current.length} مادة، ${nf(courses.currentCreditHours)} ساعة معتمدة هذا الفصل.`
            : `Total: ${courses.current.length} course(s), ${nf(courses.currentCreditHours)} credit hours this semester.`,
        );
      } else {
        parts.push(
          ar
            ? "لا توجد مواد مسجلة لك في الفصل الحالي."
            : "You are not registered for any courses this semester.",
        );
      }
      links = ["current"];
      break;


    case "courses_remaining": {
      const openBaskets = courses.baskets.filter((b) => !b.satisfied);
      if (!planRegistered) {
        parts.push(
          ar
            ? "خطة برنامجك الدراسية غير مسجلة في النظام، لذلك لا أستطيع تحديد المواد المتبقية بدقة، ولن أخمّنها."
            : "Your programme study plan is not registered in the system, so I cannot determine your remaining courses precisely — and I will not guess them.",
          remainingLine,
        );
      } else if (!courses.remaining.length && !openBaskets.length) {
        parts.push(
          ar
            ? "أكملت أو سجّلت جميع متطلبات خطة برنامجك، بما فيها المواد الاختيارية."
            : "You have completed or registered every requirement in your study plan, including your elective requirements.",
        );
      } else {
        if (courses.remaining.length) {
          parts.push(
            ar
              ? `المواد الإجبارية المتبقية: ${courses.remaining.length} مادة (${nf(courses.fixedRemainingCreditHours)} ساعة معتمدة):`
              : `Required courses remaining: ${courses.remaining.length} course(s) (${nf(courses.fixedRemainingCreditHours)} credit hours):`,
            courses.remaining
              .slice(0, 12)
              .map((c) => courseLine(c, ar))
              .join("\n"),
          );
          if (courses.remaining.length > 12)
            parts.push(
              ar
                ? `و${courses.remaining.length - 12} مادة أخرى في صفحة المواد المتبقية.`
                : `And ${courses.remaining.length - 12} more on your remaining courses page.`,
            );
        }
        if (openBaskets.length) {
          parts.push(
            (ar
              ? `المتطلبات الاختيارية المتبقية (${nf(courses.basketRemainingCreditHours)} ساعة معتمدة) — تختار منها ولا يُطلب إكمال كل موادها:\n`
              : `Elective requirements remaining (${nf(courses.basketRemainingCreditHours)} credit hours) — you choose from each list, you do not take every course in it:\n`) +
              openBaskets.map((b) => basketLine(b, ar)).join("\n"),
          );
        }
        parts.push(
          ar
            ? `الإجمالي المتبقي: ${nf(courses.remainingCreditHours)} ساعة معتمدة من أصل ${nf(progress.requiredCredits)}.`
            : `Total remaining: ${nf(courses.remainingCreditHours)} credit hours out of ${nf(progress.requiredCredits)}.`,
        );
      }
      links = ["remaining", "progress"];
      break;
    }


    case "graduation": {
      parts.push(creditsLine, remainingLine);
      if (progress.expectedGraduation) {
        const when = formatDate(progress.expectedGraduation, ar ? "ar" : "en");
        parts.push(
          progress.onTrack
            ? ar
              ? `أنت في المسار الصحيح للتخرج في ${when} بمعدل تسجيلك الحالي (يتبقى نحو ${progress.estimatedTermsLeft} فصل دراسي).`
              : `At your current registration load you are on track for your expected graduation in ${when} (about ${progress.estimatedTermsLeft} semester(s) left).`
            : ar
              ? `بمعدل تسجيلك الحالي تحتاج نحو ${progress.estimatedTermsLeft} فصل دراسي، وهو أطول من المتوقع في ${when}. يُنصح بمراجعة الإرشاد الأكاديمي.`
              : `At your current load you need about ${progress.estimatedTermsLeft} more semester(s), which is longer than your expected graduation in ${when}. Academic Advising can help you re-plan.`,
        );
      } else {
        parts.push(
          ar
            ? `لا يوجد تاريخ تخرج متوقع مسجل، لكن بمعدل تسجيلك الحالي تحتاج نحو ${progress.estimatedTermsLeft} فصل دراسي.`
            : `No expected graduation date is recorded, but at your current load you need about ${progress.estimatedTermsLeft} more semester(s).`,
        );
      }
      if (progress.graduationHolds.length)
        parts.push(
          ar
            ? `قيود تؤثر على التخرج:\n${snapshot.holds.filter((h) => h.blocksGraduation).map((h) => `• ${h.titleAr}`).join("\n")}`
            : `Holds affecting graduation:\n${progress.graduationHolds.map((h) => `• ${h}`).join("\n")}`,
        );
      if (progress.pendingRequirements.length)
        parts.push(
          (ar ? "متطلبات معلّقة:\n" : "Pending requirements:\n") +
            snapshot.requirements
              .map((r) => `• ${ar ? r.titleAr : r.titleEn}${r.dueDate ? ` (${r.dueDate})` : ""}`)
              .join("\n"),
        );
      links = ["progress", "remaining"];
      break;
    }

    case "focus": {
      parts.push(creditsLine);
      const focus: string[] = [];
      if (progress.graduationHolds.length)
        focus.push(
          ar
            ? "ارفع القيود المؤثرة على سجلك أولاً — فهي تمنع التسجيل أو التخرج."
            : "Clear the holds on your record first — they block registration or graduation.",
        );
      if (snapshot.gpa != null && snapshot.gpa < 2.5)
        focus.push(
          ar
            ? `معدلك التراكمي ${snapshot.gpa}؛ ركّز على رفعه قبل زيادة العبء الدراسي.`
            : `Your cumulative GPA is ${snapshot.gpa}; prioritise raising it before increasing your course load.`,
        );
      const early = courses.remaining.filter((c) => (c.recommendedYear ?? 9) <= 2).slice(0, 3);
      if (early.length)
        focus.push(
          (ar
            ? "قدّم المواد المتبقية من السنوات المبكرة لأنها غالباً متطلبات سابقة:\n"
            : "Take these earlier-year remaining courses next — they are usually prerequisites:\n") +
            early.map((c) => courseLine(c, ar)).join("\n"),
        );
      if (snapshot.requirements.length)
        focus.push(
          ar
            ? `أكمل ${snapshot.requirements.length} متطلباً معلّقاً على سجلك.`
            : `Complete the ${snapshot.requirements.length} pending requirement(s) on your record.`,
        );
      if (!focus.length)
        focus.push(
          ar
            ? "سجلك سليم: واصل بنفس العبء الدراسي وتابع خطة برنامجك."
            : "Your record is clear: keep your current load and follow your study plan.",
        );
      parts.push(focus.join("\n\n"));
      links = ["progress", "remaining", "standing"];
      break;
    }

    case "overview":
    default:
      parts.push(
        ar
          ? `ملخص تقدمك الأكاديمي${programme ? ` في ${programme}` : ""}:`
          : `Your academic progress${programme ? ` in ${programme}` : ""}:`,
        [
          `• ${creditsLine}`,
          `• ${remainingLine}`,
          `• ${ar ? `المواد: ${courses.completed.length} مكتملة · ${courses.current.length} حالية · ${courses.remaining.length} إجبارية متبقية` : `Courses: ${courses.completed.length} completed · ${courses.current.length} in progress · ${courses.remaining.length} required course(s) remaining`}`,
          courses.baskets.some((b) => !b.satisfied)
            ? `• ${ar ? `متطلبات اختيارية متبقية: ${nf(courses.basketRemainingCreditHours)} ساعة معتمدة` : `Elective requirements remaining: ${nf(courses.basketRemainingCreditHours)} credit hours`}`
            : "",

          snapshot.gpa != null
            ? `• ${ar ? `المعدل التراكمي ${snapshot.gpa}` : `Cumulative GPA ${snapshot.gpa}`}${snapshot.standing ? ` · ${humanizeStatus(snapshot.standing, ar)}` : ""}`
            : "",
          snapshot.expectedGraduation
            ? `• ${ar ? "التخرج المتوقع" : "Expected graduation"}: ${formatDate(snapshot.expectedGraduation, ar ? "ar" : "en")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      links = ["progress", "completed", "current", "remaining"];
      break;
  }

  const proposals: { toolName: string; args: Record<string, unknown> }[] = [];
  if (dataGaps.length) {
    parts.push(
      (ar ? "لم أتمكن من التحقق من: " : "I could not verify: ") +
        dataGaps.join(ar ? "، " : "; ") +
        (ar
          ? ". لم أخمّن أي رقم بديل، ويمكنني تحويل الأمر إلى خدمات الطلبة الأكاديمية لتصحيح سجلك."
          : ". I have not guessed any substitute figure, and I can route this to Student Academic Services to correct your record."),
    );
    nextSteps.push(
      ar
        ? "اطلب من خدمات الطلبة الأكاديمية استكمال بيانات خطتك الدراسية."
        : "Ask Student Academic Services to complete your study-plan data.",
    );
    proposals.push(escalation(ar, dataGaps));
  }

  return {
    intent,
    answer: parts.filter(Boolean).join("\n\n") + academicLinks(ar, links),
    nextSteps,
    citations: [citation(ar)],
    verified: true,
    dataGaps,
    proposals,
    state: {
      programme,
      view: intent,
      progress,
      completedCourses: courses.completed.length,
      currentCourses: courses.current.length,
      remainingCourses: courses.remaining.length,
      studyPlanRegistered: planRegistered,
    },
  };
}
