import { must } from "@/lib/result";
/**
 * Registration Readiness Agent. Server only.
 *
 * Responsibility: answer "am I ready to register?" with a verified yes/no and,
 * when the answer is no, the exact list of blockers. Every decision here is a
 * deterministic backend rule over verified records — the model may explain the
 * result, never decide it, and this agent never registers a course.
 *
 * Checks: service availability · registration window · enrolment status ·
 * holds · academic standing · outstanding requirements · prerequisites ·
 * course eligibility · timetable conflicts · credit-load rules.
 *
 * Data: university_services availability RPC, academic_terms,
 * student_profiles, student_holds, student_requirements, program_courses,
 * course_prerequisites, student_course_history, student_current_enrollments —
 * all read under the caller's own RLS scope.
 */
import type { Citation, Lang } from "../agent-types";
import { formatDate } from "../format-date";
import { loadStudentSnapshot, type StudentSnapshot } from "../student-context.server";
import { loadAcademicCourses } from "../academic-record.server";
import { getServiceAvailability } from "../services/availability.server";
import type { Db } from "./tools.server";

/** Registration service in the catalogue; absent means "not gated". */
export const REGISTRATION_SERVICE_CODE = "SVC-REGISTRATION";
/** Unit that owns registration. */
export const REGISTRATION_UNIT_CODE = "REG";

/** Institutional credit-load rules applied by the backend, not the model. */
export const CREDIT_RULES = {
  minPerTerm: 12,
  maxPerTerm: 18,
  /** Students on probation are capped lower. */
  maxOnProbation: 12,
} as const;

const READY_RE =
  /((am i|can i|may i|able to|eligible to|ready to)\s*(now\s*)?(register|enrol|enroll|sign up for courses))|registration (readiness|eligibility|check)|(ready|eligible|allowed).{0,20}(for )?(course )?registration|can i add (a )?course|هل (أستطيع|يمكنني|أقدر).{0,15}(التسجيل|أسجل)|هل أنا (جاهز|مؤهل).{0,15}(للتسجيل|التسجيل)|جاهزية التسجيل|أهلية التسجيل|هل يمكنني تسجيل (المواد|المقررات)/i;

const BLOCK_RE =
  /(what|why).{0,40}(blocking|stopping|preventing|prevents).{0,30}(register|registration|enrol)|(can'?t|cannot|unable to|couldn'?t).{0,20}(register|enrol|enroll)|registration (blocked|hold|blockers?|issues?|problem)|ما (الذي )?يمنعني.{0,20}(التسجيل)|لا (أستطيع|يمكنني|أقدر).{0,15}(التسجيل|أسجل)|التسجيل (محظور|موقوف|مغلق)/i;

/** Deterministic bilingual intent detection — no model call. */
export function detectRegistrationReadinessIntent(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return READY_RE.test(text) || BLOCK_RE.test(text);
}

export type CheckKey =
  | "service"
  | "window"
  | "enrollment"
  | "holds"
  | "standing"
  | "requirements"
  | "prerequisites"
  | "eligibility"
  | "timetable"
  | "credits";

export type { CheckState } from "./readiness-verdict";
import { readinessVerdict, statusLabel, statusOf, verdictHeading, type CheckState } from "./readiness-verdict";

export type ReadinessCheck = {
  key: CheckKey;
  state: CheckState;
  labelEn: string;
  labelAr: string;
  detailEn: string;
  detailAr: string;
  fixEn?: string;
  fixAr?: string;
};

export type RegistrationWindow = {
  termId: string | null;
  termNameEn: string | null;
  termNameAr: string | null;
  registrationStart: string | null;
  registrationEnd: string | null;
  addDropDeadline: string | null;
  state: "open" | "upcoming" | "closed" | "unknown";
  daysUntilOpen: number | null;
  daysUntilClose: number | null;
};

export type RegistrationReadiness = {
  ready: boolean;
  checks: ReadinessCheck[];
  blockers: ReadinessCheck[];
  warnings: ReadinessCheck[];
  unknowns: ReadinessCheck[];
  window: RegistrationWindow;
  eligibleCourses: { code: string; title: string; creditHours: number }[];
  ineligibleCourses: { code: string; title: string; missing: string[] }[];
  registeredCredits: number;
};

export type RegistrationReadinessReport = {
  ready: boolean;
  answer: string;
  nextSteps: string[];
  citations: Citation[];
  verified: boolean;
  proposals: { toolName: string; args: Record<string, unknown>; labelEn?: string; labelAr?: string }[];
  readiness: RegistrationReadiness;
};

const day = 86_400_000;
const days = (iso: string) => Math.ceil((new Date(`${iso}T00:00:00Z`).getTime() - Date.now()) / day);

/* ------------------------------------------------------------------ */
/* Individual verified reads (each is also exposed as an agent tool)    */
/* ------------------------------------------------------------------ */

/** The registration window of the current or next term, from academic_terms. */
export async function getRegistrationWindow(db: Db): Promise<RegistrationWindow> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await db
    .from("academic_terms")
    .select("id, name_en, name_ar, registration_start, registration_end, add_drop_deadline, is_current")
    .eq("is_active", true)
    .not("registration_end", "is", null)
    .gte("registration_end", today)
    .order("registration_start", { ascending: true })
    .limit(1)
    .then((r) => ({ data: must(r, "readiness") }));

  const row = data?.[0];
  if (!row?.registration_start || !row.registration_end) {
    return {
      termId: row?.id ?? null,
      termNameEn: row?.name_en ?? null,
      termNameAr: row?.name_ar ?? null,
      registrationStart: row?.registration_start ?? null,
      registrationEnd: row?.registration_end ?? null,
      addDropDeadline: row?.add_drop_deadline ?? null,
      state: "unknown",
      daysUntilOpen: null,
      daysUntilClose: null,
    };
  }

  const untilOpen = days(row.registration_start);
  const untilClose = days(row.registration_end);
  return {
    termId: row.id,
    termNameEn: row.name_en,
    termNameAr: row.name_ar,
    registrationStart: row.registration_start,
    registrationEnd: row.registration_end,
    addDropDeadline: row.add_drop_deadline,
    state: untilOpen > 0 ? "upcoming" : untilClose >= 0 ? "open" : "closed",
    daysUntilOpen: untilOpen,
    daysUntilClose: untilClose,
  };
}

export type PrerequisiteStatus = {
  courseCode: string;
  courseTitleEn: string;
  courseTitleAr: string;
  satisfied: boolean;
  missing: { code: string; titleEn: string; titleAr: string; minimumGrade: string | null }[];
};

/** Prerequisite status for a set of course ids, against completed history. */
export async function getPrerequisiteStatus(
  db: Db,
  userId: string,
  courseIds: string[],
): Promise<Map<string, PrerequisiteStatus["missing"]>> {
  const missing = new Map<string, PrerequisiteStatus["missing"]>();
  if (!courseIds.length) return missing;

  const [{ data: prereqs }, { data: history }] = await Promise.all([
    db
      .from("course_prerequisites")
      .select(
        "course_id, minimum_grade, prerequisite_course_id, courses!course_prerequisites_prerequisite_course_id_fkey (code, title_en, title_ar)",
      )
      .in("course_id", courseIds)
      .eq("is_active", true),
    db
      .from("student_course_history")
      .select("course_id, completion_status")
      .eq("student_id", userId),
  ]);

  const completed = new Set(
    (history ?? []).filter((h) => h.completion_status === "completed").map((h) => h.course_id),
  );
  for (const p of prereqs ?? []) {
    if (completed.has(p.prerequisite_course_id)) continue;
    const c = p.courses as { code: string; title_en: string; title_ar: string } | null;
    const list = missing.get(p.course_id) ?? [];
    list.push({
      code: c?.code ?? "—",
      titleEn: c?.title_en ?? "—",
      titleAr: c?.title_ar ?? "—",
      minimumGrade: p.minimum_grade,
    });
    missing.set(p.course_id, list);
  }
  return missing;
}

/** Simple "DAY HH:MM-HH:MM" parser used for timetable conflict detection. */
type Slot = { day: string; start: number; end: number };
export function parseMeetingSchedule(text: string | null): Slot[] | null {
  if (!text) return null;
  const dayRe = /(sun|mon|tue|wed|thu|fri|sat)[a-z]*/gi;
  const timeRe = /(\d{1,2}):(\d{2})\s*(?:-|–|to)\s*(\d{1,2}):(\d{2})/i;
  const time = timeRe.exec(text);
  const dayMatches = text.match(dayRe);
  if (!time || !dayMatches?.length) return null;
  const start = Number(time[1]) * 60 + Number(time[2]);
  const end = Number(time[3]) * 60 + Number(time[4]);
  if (!(end > start)) return null;
  return dayMatches.map((d) => ({ day: d.slice(0, 3).toLowerCase(), start, end }));
}

/** Overlapping registered sections, when the schedule text can be parsed. */
export function findTimetableConflicts(
  sections: { label: string; schedule: string | null }[],
): { conflicts: [string, string][]; unparsed: string[] } {
  const parsed: { label: string; slots: Slot[] }[] = [];
  const unparsed: string[] = [];
  for (const s of sections) {
    const slots = parseMeetingSchedule(s.schedule);
    if (!slots) unparsed.push(s.label);
    else parsed.push({ label: s.label, slots });
  }
  const conflicts: [string, string][] = [];
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const a = parsed[i]!;
      const b = parsed[j]!;
      const clash = a.slots.some((x) =>
        b.slots.some((y) => x.day === y.day && x.start < y.end && y.start < x.end),
      );
      if (clash) conflicts.push([a.label, b.label]);
    }
  }
  return { conflicts, unparsed };
}

/* ------------------------------------------------------------------ */
/* Deterministic decision engine                                       */
/* ------------------------------------------------------------------ */

const BLOCKED_STANDING = /suspend|dismiss|withdraw|فصل|إيقاف|تعليق/i;
const PROBATION_STANDING = /probation|warning|إنذار|مراقبة/i;

/**
 * Student-facing labels for record values. Raw database enums such as
 * "good_standing" must never be shown to the student.
 */
export function humanizeStatus(value: string, ar: boolean): string {
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const map: Record<string, [string, string]> = {
    active: ["Active", "فعّال"],
    inactive: ["Inactive", "غير فعّال"],
    good_standing: ["Good Standing", "وضع أكاديمي جيد"],
    probation: ["Academic Probation", "إنذار أكاديمي"],
    academic_probation: ["Academic Probation", "إنذار أكاديمي"],
    warning: ["Academic Warning", "تحذير أكاديمي"],
    suspended: ["Suspended", "موقوف"],
    dismissed: ["Dismissed", "مفصول"],
    withdrawn: ["Withdrawn", "منسحب"],
    graduated: ["Graduated", "متخرج"],
    deferred: ["Deferred", "مؤجل"],
    leave_of_absence: ["Leave of Absence", "إجازة دراسية"],
  };
  const hit = map[key];
  if (hit) return ar ? hit[1] : hit[0];
  if (ar) return value;
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function evaluateRegistrationReadiness(
  db: Db,
  userId: string,
): Promise<{ snapshot: StudentSnapshot; readiness: RegistrationReadiness } | null> {
  const snapshot = await loadStudentSnapshot(db, userId);
  if (!snapshot.hasProfile) return null;

  const [availability, window, courses, enrolments] = await Promise.all([
    getServiceAvailability(db, REGISTRATION_SERVICE_CODE).catch(() => null),
    getRegistrationWindow(db).catch(
      (): RegistrationWindow => ({
        termId: null,
        termNameEn: null,
        termNameAr: null,
        registrationStart: null,
        registrationEnd: null,
        addDropDeadline: null,
        state: "unknown",
        daysUntilOpen: null,
        daysUntilClose: null,
      }),
    ),
    loadAcademicCourses(db, userId, snapshot.programId),
    db
      .from("student_current_enrollments")
      .select(
        "enrollment_status, course_sections:course_section_id (meeting_schedule, courses:course_id (code))",
      )
      .eq("student_id", userId),
  ]);

  const checks: ReadinessCheck[] = [];

  // 1. Service availability -------------------------------------------------
  if (availability && availability.exists && !availability.isAvailable) {
    checks.push({
      key: "service",
      state: "blocked",
      labelEn: "Registration service",
      labelAr: "خدمة التسجيل",
      detailEn: availability.studentMessageEn ?? availability.reasonEn ?? "The registration service is currently closed.",
      detailAr: availability.studentMessageAr ?? availability.reasonAr ?? "خدمة التسجيل مغلقة حالياً.",
      fixEn: availability.nextOpenAt
        ? `The service reopens on ${formatDate(availability.nextOpenAt, "en")}.`
        : "Try again once the service reopens.",
      fixAr: availability.nextOpenAt
        ? `تُفتح الخدمة مجدداً في ${formatDate(availability.nextOpenAt, "ar")}.`
        : "أعد المحاولة عند إعادة فتح الخدمة.",
    });
  } else {
    checks.push({
      key: "service",
      state: "pass",
      labelEn: "Registration service",
      labelAr: "خدمة التسجيل",
      detailEn: "The registration service is available.",
      detailAr: "خدمة التسجيل متاحة.",
    });
  }

  // 2. Registration window --------------------------------------------------
  const term = window.termNameEn ?? "the upcoming term";
  const termAr = window.termNameAr ?? "الفصل القادم";
  if (window.state === "open") {
    checks.push({
      key: "window",
      state: "pass",
      labelEn: "Registration window",
      labelAr: "فترة التسجيل",
      detailEn: `Registration for ${term} is open until ${formatDate(window.registrationEnd, "en")}.`,
      detailAr: `التسجيل لـ${termAr} مفتوح حتى ${formatDate(window.registrationEnd, "ar")}.`,
    });
  } else if (window.state === "upcoming") {
    checks.push({
      key: "window",
      state: "blocked",
      labelEn: "Registration window",
      labelAr: "فترة التسجيل",
      detailEn: `Registration for ${term} has not opened yet — it opens on ${formatDate(window.registrationStart, "en")} (in ${window.daysUntilOpen} day(s)).`,
      detailAr: `لم تبدأ فترة التسجيل لـ${termAr} بعد — تبدأ في ${formatDate(window.registrationStart, "ar")} (بعد ${window.daysUntilOpen} يوم).`,
      fixEn: "Prepare your course list now and register as soon as the window opens.",
      fixAr: "جهّز قائمة موادك الآن وسجّل فور فتح الفترة.",
    });
  } else if (window.state === "closed") {
    checks.push({
      key: "window",
      state: "blocked",
      labelEn: "Registration window",
      labelAr: "فترة التسجيل",
      detailEn: `Registration for ${term} closed on ${formatDate(window.registrationEnd, "en")}.`,
      detailAr: `أُغلقت فترة التسجيل لـ${termAr} في ${formatDate(window.registrationEnd, "ar")}.`,
      fixEn: "Admission & Registration can advise on late registration.",
      fixAr: "يمكن للقبول والتسجيل إفادتك بشأن التسجيل المتأخر.",
    });
  } else {
    checks.push({
      key: "window",
      state: "unknown",
      labelEn: "Registration window",
      labelAr: "فترة التسجيل",
      detailEn: "No registration window is published in the academic calendar, so I cannot confirm the dates.",
      detailAr: "لا توجد فترة تسجيل منشورة في التقويم الأكاديمي، لذلك لا يمكنني تأكيد التواريخ.",
      fixEn: "Ask Admission & Registration to confirm the registration dates.",
      fixAr: "اسأل القبول والتسجيل لتأكيد مواعيد التسجيل.",
    });
  }

  // 3. Enrolment status -----------------------------------------------------
  const status = snapshot.enrollmentStatus;
  if (!status) {
    checks.push({
      key: "enrollment",
      state: "unknown",
      labelEn: "Enrolment status",
      labelAr: "حالة القيد",
      detailEn: "Your enrolment status is not recorded on your profile.",
      detailAr: "حالة القيد غير مسجلة في ملفك.",
      fixEn: "Ask Student Academic Services to update your enrolment status.",
      fixAr: "اطلب من خدمات الطلبة الأكاديمية تحديث حالة قيدك.",
    });
  } else if (status !== "active") {
    checks.push({
      key: "enrollment",
      state: "blocked",
      labelEn: "Enrolment status",
      labelAr: "حالة القيد",
      detailEn: `Your enrolment status is ${humanizeStatus(status, false)}, which does not allow registration.`,
      detailAr: `حالة قيدك «${humanizeStatus(status, true)}»، وهي لا تسمح بالتسجيل.`,
      fixEn: "Contact Admission & Registration to reactivate your enrolment.",
      fixAr: "تواصل مع القبول والتسجيل لإعادة تفعيل قيدك.",
    });
  } else {
    checks.push({
      key: "enrollment",
      state: "pass",
      labelEn: "Enrolment status",
      labelAr: "حالة القيد",
      detailEn: "Your enrolment is Active.",
      detailAr: "قيدك فعّال.",
    });
  }

  // 4. Holds ----------------------------------------------------------------
  const blockingHolds = snapshot.holds.filter((h) => h.blocksRegistration);
  if (blockingHolds.length) {
    for (const h of blockingHolds) {
      checks.push({
        key: "holds",
        state: "blocked",
        labelEn: "Hold",
        labelAr: "إيقاف",
        detailEn: h.titleEn,
        detailAr: h.titleAr,
        fixEn: h.resolutionEn ?? "Contact the issuing unit to clear this hold.",
        fixAr: h.resolutionAr ?? "تواصل مع الجهة المُصدرة لرفع هذا الإيقاف.",
      });
    }
  } else {
    checks.push({
      key: "holds",
      state: "pass",
      labelEn: "Holds",
      labelAr: "الإيقافات",
      detailEn: "No hold on your record blocks registration.",
      detailAr: "لا يوجد إيقاف على سجلك يمنع التسجيل.",
    });
  }

  // 5. Academic standing ----------------------------------------------------
  const standing = snapshot.standing;
  const onProbation = Boolean(standing && PROBATION_STANDING.test(standing));
  if (standing && BLOCKED_STANDING.test(standing)) {
    checks.push({
      key: "standing",
      state: "blocked",
      labelEn: "Academic standing",
      labelAr: "الوضع الأكاديمي",
      detailEn: `Your academic standing is ${humanizeStatus(standing, false)}, which suspends registration.`,
      detailAr: `وضعك الأكاديمي «${humanizeStatus(standing, true)}»، وهو يوقف التسجيل.`,
      fixEn: "Academic Advising must review your case before you can register.",
      fixAr: "يجب أن يراجع الإرشاد الأكاديمي حالتك قبل أن تتمكن من التسجيل.",
    });
  } else if (onProbation) {
    checks.push({
      key: "standing",
      state: "warning",
      labelEn: "Academic standing",
      labelAr: "الوضع الأكاديمي",
      detailEn: `Your academic standing is ${humanizeStatus(standing ?? "", false)}, so your load is capped at ${CREDIT_RULES.maxOnProbation} credit hours and advisor approval may be required.`,
      detailAr: `وضعك الأكاديمي «${humanizeStatus(standing ?? "", true)}»، لذلك يقتصر عبؤك على ${CREDIT_RULES.maxOnProbation} ساعة معتمدة وقد تحتاج موافقة المرشد.`,
    });
  } else {
    checks.push({
      key: "standing",
      state: standing ? "pass" : "unknown",
      labelEn: "Academic standing",
      labelAr: "الوضع الأكاديمي",
      detailEn: standing ? `Your academic standing is ${humanizeStatus(standing, false)}.` : "Your academic standing is not recorded.",
      detailAr: standing ? `وضعك الأكاديمي «${humanizeStatus(standing, true)}».` : "وضعك الأكاديمي غير مسجل.",
    });
  }

  // 6. Outstanding requirements --------------------------------------------
  if (snapshot.requirements.length) {
    checks.push({
      key: "requirements",
      state: "warning",
      labelEn: "Outstanding requirements",
      labelAr: "متطلبات معلّقة",
      detailEn: snapshot.requirements.map((r) => r.titleEn + (r.dueDate ? ` (due ${r.dueDate})` : "")).join("; "),
      detailAr: snapshot.requirements.map((r) => r.titleAr + (r.dueDate ? ` (حتى ${r.dueDate})` : "")).join("؛ "),
      fixEn: "Complete these requirements to avoid a new hold.",
      fixAr: "أكمل هذه المتطلبات لتفادي إيقاف جديد.",
    });
  } else {
    checks.push({
      key: "requirements",
      state: "pass",
      labelEn: "Outstanding requirements",
      labelAr: "متطلبات معلّقة",
      detailEn: "No outstanding requirements on your record.",
      detailAr: "لا توجد متطلبات معلّقة على سجلك.",
    });
  }

  // 7 + 8. Prerequisites and course eligibility -----------------------------
  const eligibleCourses: RegistrationReadiness["eligibleCourses"] = [];
  const ineligibleCourses: RegistrationReadiness["ineligibleCourses"] = [];
  if (!courses.programCourseCount) {
    checks.push({
      key: "prerequisites",
      state: "unknown",
      labelEn: "Prerequisites",
      labelAr: "المتطلبات السابقة",
      detailEn: "Your programme study plan is not registered, so I cannot verify prerequisites or eligible courses.",
      detailAr: "خطة برنامجك الدراسية غير مسجلة، لذلك لا يمكنني التحقق من المتطلبات السابقة أو المواد المتاحة.",
      fixEn: "Ask Student Academic Services to register your study plan.",
      fixAr: "اطلب من خدمات الطلبة الأكاديمية تسجيل خطتك الدراسية.",
    });
  } else {
    // Only the next wave of plan courses is checked, which keeps the answer
    // short and reflects what the student would actually register for.
    const candidates = courses.remaining.slice(0, 10);
    const ids = candidates.map((c) => c.code);
    const { data: rows } = await db
      .from("courses")
      .select("id, code")
      .in("code", ids.length ? ids : ["__none__"])
      .then((r) => ({ data: must(r, "readiness") }));
    const idByCode = new Map((rows ?? []).map((r) => [r.code, r.id]));
    const missingByCourse = await getPrerequisiteStatus(
      db,
      userId,
      [...idByCode.values()],
    );

    for (const c of candidates) {
      const id = idByCode.get(c.code);
      const missing = id ? (missingByCourse.get(id) ?? []) : [];
      if (missing.length) {
        ineligibleCourses.push({
          code: c.code,
          title: c.titleEn,
          missing: missing.map((m) => `${m.code}${m.minimumGrade ? ` (min ${m.minimumGrade})` : ""}`),
        });
      } else {
        eligibleCourses.push({ code: c.code, title: c.titleEn, creditHours: c.creditHours });
      }
    }

    if (ineligibleCourses.length) {
      for (const c of ineligibleCourses) {
        checks.push({
          key: "prerequisites",
          state: eligibleCourses.length ? "warning" : "blocked",
          labelEn: "Prerequisite",
          labelAr: "متطلب سابق",
          detailEn: `${c.code} is not open to you yet — missing prerequisite ${c.missing.join(", ")}.`,
          detailAr: `${c.code} غير متاحة لك بعد — ينقصك المتطلب السابق ${c.missing.join("، ")}.`,
          fixEn: `Complete ${c.missing.join(", ")} first, or ask Academic Advising about a waiver.`,
          fixAr: `أكمل ${c.missing.join("، ")} أولاً، أو راجع الإرشاد الأكاديمي بشأن استثناء.`,
        });
      }
    } else {
      checks.push({
        key: "prerequisites",
        state: "pass",
        labelEn: "Prerequisites",
        labelAr: "المتطلبات السابقة",
        detailEn: "You meet the prerequisites for your next plan courses.",
        detailAr: "أنت مستوفٍ للمتطلبات السابقة لمواد خطتك القادمة.",
      });
    }

    // "No remaining courses" is only claimed when the computation is
    // verifiable: a registered study plan AND some record of progress
    // (completed or current courses) to subtract from it. With no progress
    // evidence an empty remainder means the data is incomplete, not finished.
    const remainingVerified =
      !courses.remaining.length && (courses.completed.length > 0 || courses.current.length > 0);
    const remainingUnknown = !courses.remaining.length && !remainingVerified;
    checks.push({
      key: "eligibility",
      state: eligibleCourses.length || remainingVerified ? "pass" : remainingUnknown ? "unknown" : "blocked",
      labelEn: "Course eligibility",
      labelAr: "أهلية المواد",
      detailEn: courses.remaining.length
        ? `${eligibleCourses.length} of your next ${candidates.length} plan course(s) are open to you now.`
        : remainingVerified
          ? "Your study plan has no remaining courses."
          : "I could not verify which plan courses remain, because your completed-course history is not on record.",
      detailAr: courses.remaining.length
        ? `${eligibleCourses.length} من ${candidates.length} مادة قادمة في خطتك متاحة لك الآن.`
        : remainingVerified
          ? "لا توجد مواد متبقية في خطتك الدراسية."
          : "تعذّر التحقق من المواد المتبقية في خطتك لعدم وجود سجل مواد مكتملة.",
      ...(eligibleCourses.length || remainingUnknown
        ? remainingUnknown
          ? {
              fixEn: "Student Academic Services can complete your course-history record.",
              fixAr: "يمكن لخدمات الطلبة الأكاديمية استكمال سجل موادك.",
            }
          : {}
        : {
            fixEn: "Academic Advising can help you find an alternative course.",
            fixAr: "يمكن للإرشاد الأكاديمي مساعدتك في إيجاد مادة بديلة.",
          }),

    });
  }

  // 9. Timetable conflicts --------------------------------------------------
  const sections = ((enrolments.data ?? []) as unknown as {
    enrollment_status: string | null;
    course_sections: { meeting_schedule: string | null; courses: { code: string } | null } | null;
  }[])
    .filter((r) => r.course_sections && !["dropped", "withdrawn"].includes(r.enrollment_status ?? ""))
    .map((r) => ({
      label: r.course_sections?.courses?.code ?? "—",
      schedule: r.course_sections?.meeting_schedule ?? null,
    }));
  const { conflicts, unparsed } = findTimetableConflicts(sections);
  if (conflicts.length) {
    checks.push({
      key: "timetable",
      state: "blocked",
      labelEn: "Timetable",
      labelAr: "الجدول الدراسي",
      detailEn: `Your registered sections clash: ${conflicts.map(([a, b]) => `${a} ↔ ${b}`).join("; ")}.`,
      detailAr: `تتعارض شعبك المسجلة: ${conflicts.map(([a, b]) => `${a} ↔ ${b}`).join("؛ ")}.`,
      fixEn: "Drop or swap one of the clashing sections before adding more courses.",
      fixAr: "احذف أو استبدل إحدى الشعب المتعارضة قبل إضافة مواد أخرى.",
    });
  } else if (!sections.length || unparsed.length === sections.length) {
    checks.push({
      key: "timetable",
      state: sections.length ? "unknown" : "pass",
      labelEn: "Timetable",
      labelAr: "الجدول الدراسي",
      detailEn: sections.length
        ? "Section meeting times are not published in a readable format, so I could not check for clashes."
        : "No registered sections yet, so there are no clashes.",
      detailAr: sections.length
        ? "أوقات الشعب غير منشورة بصيغة قابلة للقراءة، لذلك تعذّر فحص التعارضات."
        : "لا توجد شعب مسجلة بعد، لذلك لا توجد تعارضات.",
    });
  } else {
    checks.push({
      key: "timetable",
      state: "pass",
      labelEn: "Timetable",
      labelAr: "الجدول الدراسي",
      detailEn: "No clash between your registered sections.",
      detailAr: "لا يوجد تعارض بين شعبك المسجلة.",
    });
  }

  // 10. Credit-load rules ---------------------------------------------------
  const registered = snapshot.registeredCredits;
  const maxCredits = onProbation ? CREDIT_RULES.maxOnProbation : CREDIT_RULES.maxPerTerm;
  if (registered > maxCredits) {
    checks.push({
      key: "credits",
      state: "blocked",
      labelEn: "Credit load",
      labelAr: "العبء الدراسي",
      detailEn: `You are registered for ${registered} credit hours, above the ${maxCredits}-hour maximum.`,
      detailAr: `أنت مسجل في ${registered} ساعة معتمدة، وهو أعلى من الحد الأقصى ${maxCredits} ساعة.`,
      fixEn: "Drop a course or request an overload approval from Academic Advising.",
      fixAr: "احذف مادة أو اطلب موافقة تجاوز العبء من الإرشاد الأكاديمي.",
    });
  } else if (registered > 0 && registered < CREDIT_RULES.minPerTerm) {
    checks.push({
      key: "credits",
      state: "warning",
      labelEn: "Credit load",
      labelAr: "العبء الدراسي",
      detailEn: `You are registered for ${registered} credit hours, below the ${CREDIT_RULES.minPerTerm}-hour full-time minimum.`,
      detailAr: `أنت مسجل في ${registered} ساعة معتمدة، أقل من الحد الأدنى للتفرغ ${CREDIT_RULES.minPerTerm} ساعة.`,
      fixEn: `Add ${CREDIT_RULES.minPerTerm - registered} more credit hour(s) to stay full-time.`,
      fixAr: `أضف ${CREDIT_RULES.minPerTerm - registered} ساعة معتمدة للبقاء متفرغاً.`,
    });
  } else {
    checks.push({
      key: "credits",
      state: "pass",
      labelEn: "Credit load",
      labelAr: "العبء الدراسي",
      detailEn: `You may register between ${CREDIT_RULES.minPerTerm} and ${maxCredits} credit hours; you currently hold ${registered}.`,
      detailAr: `يمكنك التسجيل بين ${CREDIT_RULES.minPerTerm} و${maxCredits} ساعة معتمدة؛ لديك حالياً ${registered}.`,
    });
  }

  const blockers = checks.filter((c) => c.state === "blocked");
  const warnings = checks.filter((c) => c.state === "warning");
  const unknowns = checks.filter((c) => c.state === "unknown");

  return {
    snapshot,
    readiness: {
      // Ready only when every required check is PASS / NOT_APPLICABLE.
      ready: readinessVerdict(checks).verified,
      checks,
      blockers,
      warnings,
      unknowns,
      window,
      eligibleCourses,
      ineligibleCourses,
      registeredCredits: registered,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Student-facing report                                               */
/* ------------------------------------------------------------------ */

/**
 * Which issues genuinely need a staff member, and which unit owns them.
 * Issues the student can fix alone (timetable swap, credit load, outstanding
 * requirements) never trigger a staff handover.
 */
const STAFF_ISSUE: Partial<
  Record<CheckKey, { unitCode: string; whyEn: string; whyAr: string }>
> = {
  service: {
    unitCode: REGISTRATION_UNIT_CODE,
    whyEn: "confirm when the registration service will be available",
    whyAr: "تأكيد موعد إتاحة خدمة التسجيل",
  },
  window: {
    unitCode: REGISTRATION_UNIT_CODE,
    whyEn: "confirm the registration window",
    whyAr: "تأكيد فترة التسجيل",
  },
  enrollment: {
    unitCode: REGISTRATION_UNIT_CODE,
    whyEn: "review your enrolment status",
    whyAr: "مراجعة حالة قيدك",
  },
  holds: {
    unitCode: REGISTRATION_UNIT_CODE,
    whyEn: "resolve the hold on your record",
    whyAr: "حل القيد المسجل على ملفك",
  },
  standing: {
    unitCode: "ADV",
    whyEn: "review your academic standing before registration",
    whyAr: "مراجعة وضعك الأكاديمي قبل التسجيل",
  },
  prerequisites: {
    unitCode: "ADV",
    whyEn: "review your missing prerequisites or a possible waiver",
    whyAr: "مراجعة متطلباتك السابقة الناقصة أو إمكانية استثنائها",
  },
  eligibility: {
    unitCode: "SAS",
    whyEn: "verify your study-plan record",
    whyAr: "التحقق من سجل خطتك الدراسية",
  },
};

const UNIT_NAME: Record<string, [string, string]> = {
  REG: ["Admission & Registration", "القبول والتسجيل"],
  ADV: ["Academic Advising", "الإرشاد الأكاديمي"],
  SAS: ["Student Academic Services", "خدمات الطلبة الأكاديمية"],
};

function quickLinks(ar: boolean, r: RegistrationReadiness): string {
  const links: { label: string; href: string }[] = [];
  if (r.blockers.some((b) => b.key === "holds"))
    links.push({ label: ar ? "عرض القيود" : "View Hold", href: "/academic#standing" });
  if (r.ineligibleCourses.length)
    links.push({ label: ar ? "عرض المتطلبات السابقة" : "View Prerequisite", href: "/academic#remaining" });
  links.push({ label: ar ? "عرض فترة التسجيل" : "Check Registration Window", href: "/services" });
  links.push({ label: ar ? "عرض تقدم التخرج" : "View Degree Progress", href: "/academic#progress" });
  return `\n\n${ar ? "**روابط سريعة**" : "**Quick links**"}\n${links.map((l) => `• [${l.label}](${l.href})`).join("\n")}`;
}

export async function buildRegistrationReadinessReport(
  db: Db,
  userId: string,
  lang: Lang,
  opts: { holdQuestion?: boolean } = {},
): Promise<RegistrationReadinessReport | null> {
  const ar = lang === "ar";
  const result = await evaluateRegistrationReadiness(db, userId);
  if (!result) return null;
  const r = result.readiness;

  const sections: string[] = [];

  // 1. Direct answer to the question the student actually asked. A hold
  //    question is answered about the hold first — never implied to exist.
  const holdBlockers = r.blockers.filter((c) => c.key === "holds");
  const holdUnknown = !r.checks.some((c) => c.key === "holds") || r.unknowns.some((c) => c.key === "holds");
  if (opts.holdQuestion && holdUnknown && !holdBlockers.length) {
    sections.push(ar ? "تعذّر عليّ التحقق من حالة القيود على سجلك الآن." : "I couldn't verify your hold status right now.");
  } else if (opts.holdQuestion) {
    sections.push(
      holdBlockers.length
        ? ar
          ? `نعم، يوجد قيد نشط على سجلك يمنع التسجيل.`
          : `Yes — there is an active hold on your record that blocks registration.`
        : ar
          ? `لم يتم العثور على أي قيد يمنع التسجيل في سجلك.`
          : `No registration hold was found on your record.`,
    );
  }

  // 2. Verdict.
  const verdict = readinessVerdict(r.checks);
  sections.push(verdictHeading(verdict, lang));

  // 3. Issues found — blockers and warnings, each listed once.
  const issues = [...r.blockers, ...r.warnings];
  if (issues.length) {
    const intro = verdict.failed === 0
      ? ar
        ? "لا شيء يمنع تسجيلك، لكن انتبه لهذه النقاط:"
        : "Nothing blocks your registration, but keep an eye on:"
      : ar
        ? "وجدت هذه المشكلات التي قد تؤثر على تسجيلك:"
        : "However, I found these issues that may affect registration:";
    sections.push(
      `${intro}\n` +
        issues
          .map(
            (c, i) =>
              `${i + 1}. **${ar ? c.labelAr : c.labelEn}** — ${ar ? c.detailAr : c.detailEn}${
                (ar ? c.fixAr : c.fixEn) ? `\n   ${ar ? c.fixAr : c.fixEn}` : ""
              }`,
          )
          .join("\n"),
    );
  } else if (verdict.verified) {
    sections.push(
      ar
        ? "راجعت كل الفحوصات المطلوبة على سجلك ولا يوجد ما يمنع تسجيلك."
        : "I checked every required condition on your record and nothing is blocking your registration.",
    );
  }

  // 4. Other checks — passes and unverifiable items, one line each.
  const others = r.checks.filter((c) => c.state === "pass" || c.state === "unknown" || c.state === "not_applicable");
  if (verdict.unknown > 0 && verdict.failed === 0) {
    sections.push(
      ar
        ? `لم أجد ما يمنع تسجيلك، لكن تعذّر التحقق من ${verdict.unknown} ${verdict.unknown === 1 ? "فحص مطلوب" : "فحوصات مطلوبة"}، لذا لا يمكنني تأكيد جاهزيتك بعد.`
        : `Nothing I could check is blocking you, but ${verdict.unknown} required check${verdict.unknown === 1 ? "" : "s"} could not be verified, so I can't confirm you are ready yet.`,
    );
  }
  if (others.length) {
    sections.push(
      (ar ? "**فحوصات أخرى**\n" : "**Other checks**\n") +
        others.map((c) => `- ${ar ? c.labelAr : c.labelEn} (${statusLabel(statusOf(c.state), lang)}) — ${ar ? c.detailAr : c.detailEn}`).join("\n"),
    );
  }

  if (r.eligibleCourses.length)
    sections.push(
      (ar ? "مواد من خطتك متاحة لك الآن:\n" : "Plan courses open to you right now:\n") +
        r.eligibleCourses
          .slice(0, 6)
          .map((c) => `• ${c.code} — ${c.title} (${c.creditHours} ${ar ? "س.م" : "cr"})`)
          .join("\n"),
    );

  // 5. Next action — staff handover only when an issue genuinely needs staff,
  //    routed to the owning unit with the exact reason stated.
  const staffCheck = [...r.blockers, ...r.unknowns].find((c) => STAFF_ISSUE[c.key]);
  const staffIssue = staffCheck ? STAFF_ISSUE[staffCheck.key] : undefined;
  const proposals: RegistrationReadinessReport["proposals"] = [];
  if (staffIssue && staffCheck) {
    const [unitEn, unitAr] = UNIT_NAME[staffIssue.unitCode] ?? UNIT_NAME["REG"]!;
    const labelEn = `Forward a request to ${unitEn} to ${staffIssue.whyEn}`;
    const labelAr = `إرسال طلب إلى ${unitAr} من أجل ${staffIssue.whyAr}`;
    sections.push(
      ar
        ? `الخطوة التالية: يمكنني إرسال طلب إلى ${unitAr} من أجل ${staffIssue.whyAr}.`
        : `Next step: I can forward a request to ${unitEn} to ${staffIssue.whyEn}.`,
    );
    proposals.push({
      toolName: "escalate_to_human",
      labelEn,
      labelAr,
      args: {
        reason:
          (ar ? `طلب إلى ${unitAr}: ${staffIssue.whyAr}. النتائج المتحقق منها:\n` : `Request to ${unitEn}: ${staffIssue.whyEn}. Verified findings:\n`) +
          [...r.blockers, ...r.unknowns].map((c) => `- ${c.labelEn}: ${c.detailEn}`).join("\n"),
        unitCode: staffIssue.unitCode,
      },
    });
  } else if (issues.length) {
    const first = issues[0]!;
    const fix = ar ? first.fixAr : first.fixEn;
    if (fix) sections.push(`${ar ? "الخطوة التالية" : "Next step"}: ${fix}`);
  }

  return {
    ready: r.ready,
    answer: sections.join("\n\n") + quickLinks(ar, r),
    nextSteps: [...r.blockers, ...r.warnings, ...r.unknowns]
      .map((c) => (ar ? c.fixAr : c.fixEn))
      .filter((x): x is string => Boolean(x)),
    verified: verdict.verified,
    proposals,
    readiness: r,
    citations: [
      {
        documentId: null,
        sourceTitle: ar
          ? "سجلك الطلابي والتقويم الأكاديمي"
          : "Your student record and the academic calendar",
        owningUnit: ar ? "القبول والتسجيل" : "Admission & Registration",
        documentVersion: null,
        effectiveDate: new Date().toISOString().slice(0, 10),
        citationUrl: null,
        confidence: "high",
      },
    ],
  };
}
