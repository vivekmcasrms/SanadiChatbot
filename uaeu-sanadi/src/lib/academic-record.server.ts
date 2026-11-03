/**
 * Deterministic academic record for the signed-in student. Server only.
 *
 * Identity, credits and course lists always come from the verified student
 * record under the caller's own RLS scope — never from the model or chat
 * history, and never for another student.
 */
import type { Db } from "./student-context.server";

export type CourseEntry = {
  code: string;
  titleEn: string;
  titleAr: string;
  creditHours: number;
  grade: string | null;
  termEn: string | null;
  termAr: string | null;
  requirementType: string | null;
  recommendedYear: number | null;
};

/**
 * An elective requirement group (basket). A student satisfies it by completing
 * the required number of credit hours / courses from the approved list — never
 * by completing every eligible course in it.
 */
export type BasketRequirement = {
  basketId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  basketType: string;
  effectiveCatalogYear: string;
  requiredCreditHours: number;
  requiredCourseCount: number;
  /** Approved options the student may choose from. */
  eligibleCourses: CourseEntry[];
  /** Approved options already passed. */
  completedCourses: CourseEntry[];
  /** Approved options registered this semester. */
  selectedCourses: CourseEntry[];
  completedCreditHours: number;
  selectedCreditHours: number;
  remainingCreditHours: number;
  remainingCourseCount: number;
  satisfied: boolean;
  /** False when the approved course list could not be verified officially. */
  courseListVerified: boolean;
  noteEn: string | null;
  noteAr: string | null;
};

export type AcademicCourses = {
  completed: CourseEntry[];
  current: CourseEntry[];
  /** Outstanding FIXED (mandatory) study-plan courses only. */
  remaining: CourseEntry[];
  /** Outstanding elective basket requirements. */
  baskets: BasketRequirement[];
  completedCreditHours: number;
  currentCreditHours: number;
  /** Fixed remaining credit hours only. */
  fixedRemainingCreditHours: number;
  /** Credit hours still owed across all elective baskets. */
  basketRemainingCreditHours: number;
  /** Total outstanding credit hours = fixed remaining + basket remaining. */
  remainingCreditHours: number;
  /** Number of fixed plan courses plus elective baskets on record. */
  programCourseCount: number;
};

type CourseRow = {
  id: string;
  code: string;
  title_en: string;
  title_ar: string | null;
  credit_hours: number | null;
};

const EMPTY: AcademicCourses = {
  completed: [],
  current: [],
  remaining: [],
  baskets: [],
  completedCreditHours: 0,
  currentCreditHours: 0,
  fixedRemainingCreditHours: 0,
  basketRemainingCreditHours: 0,
  remainingCreditHours: 0,
  programCourseCount: 0,
};


function entry(course: CourseRow, extra: Partial<CourseEntry> = {}): CourseEntry {
  return {
    code: course.code,
    titleEn: course.title_en,
    titleAr: course.title_ar ?? course.title_en,
    creditHours: course.credit_hours ?? 3,
    grade: null,
    termEn: null,
    termAr: null,
    requirementType: null,
    recommendedYear: null,
    ...extra,
  };
}

type BasketRow = {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  basket_type: string;
  effective_catalog_year: string;
  required_credit_hours: number;
  required_course_count: number;
  course_list_verified: boolean;
  selection_note_en: string | null;
  selection_note_ar: string | null;
  display_order: number | null;
  program_basket_courses: { courses: CourseRow | null }[] | null;
};

/**
 * Completed courses, current enrolments, the remaining FIXED programme courses
 * and the outstanding elective basket requirements.
 *
 * Electives are never expanded into mandatory courses: a basket only ever owes
 * its remaining credit hours / number of selections.
 */
export async function loadAcademicCourses(
  db: Db,
  userId: string,
  programId: string | null,
): Promise<AcademicCourses> {
  const [{ data: history }, { data: enrolments }, { data: planRows }, { data: basketRows }] =
    await Promise.all([
      db
        .from("student_course_history")
        .select(
          "grade, credits_earned, credits_attempted, completion_status, courses:course_id (id, code, title_en, title_ar, credit_hours), academic_terms:academic_term_id (name_en, name_ar, start_date)",
        )
        .eq("student_id", userId),
      db
        .from("student_current_enrollments")
        .select(
          "enrollment_status, course_sections:course_section_id (courses:course_id (id, code, title_en, title_ar, credit_hours), academic_terms:academic_term_id (name_en, name_ar))",
        )
        .eq("student_id", userId),
      programId
        ? db
            .from("program_courses")
            .select(
              "requirement_type, recommended_year, is_required, courses:course_id (id, code, title_en, title_ar, credit_hours)",
            )
            .eq("program_id", programId)
        : Promise.resolve({ data: [] as unknown[] }),
      programId
        ? db
            .from("program_requirement_baskets")
            .select(
              "id, code, name_en, name_ar, basket_type, effective_catalog_year, required_credit_hours, required_course_count, course_list_verified, selection_note_en, selection_note_ar, display_order, program_basket_courses (courses:course_id (id, code, title_en, title_ar, credit_hours))",
            )
            .eq("program_id", programId)
        : Promise.resolve({ data: [] as unknown[] }),
    ]);


  if (!history && !enrolments && !planRows) return EMPTY;

  const completed: CourseEntry[] = [];
  const completedIds = new Set<string>();
  for (const row of (history ?? []) as unknown as {
    grade: string | null;
    credits_earned: number | null;
    completion_status: string | null;
    courses: CourseRow | null;
    academic_terms: { name_en: string; name_ar: string; start_date: string | null } | null;
  }[]) {
    if (!row.courses) continue;
    if (row.completion_status && row.completion_status !== "completed") continue;
    completedIds.add(row.courses.id);
    completed.push(
      entry(row.courses, {
        grade: row.grade,
        creditHours: row.credits_earned ?? row.courses.credit_hours ?? 3,
        termEn: row.academic_terms?.name_en ?? null,
        termAr: row.academic_terms?.name_ar ?? null,
      }),
    );
  }

  const current: CourseEntry[] = [];
  const currentIds = new Set<string>();
  for (const row of (enrolments ?? []) as unknown as {
    enrollment_status: string | null;
    course_sections: {
      courses: CourseRow | null;
      academic_terms: { name_en: string; name_ar: string } | null;
    } | null;
  }[]) {
    const course = row.course_sections?.courses;
    if (!course) continue;
    if (row.enrollment_status && ["dropped", "withdrawn"].includes(row.enrollment_status)) continue;
    currentIds.add(course.id);
    current.push(
      entry(course, {
        termEn: row.course_sections?.academic_terms?.name_en ?? null,
        termAr: row.course_sections?.academic_terms?.name_ar ?? null,
      }),
    );
  }

  const remaining: CourseEntry[] = [];
  const plan = (planRows ?? []) as unknown as {
    requirement_type: string | null;
    recommended_year: number | null;
    is_required: boolean | null;
    courses: CourseRow | null;
  }[];
  // Only genuinely mandatory plan rows are course-level requirements. Anything
  // optional belongs to an elective basket and is counted there instead.
  const fixedPlan = plan.filter((row) => row.is_required !== false);
  const fixedIds = new Set<string>();
  for (const row of fixedPlan) {
    const course = row.courses;
    if (!course) continue;
    fixedIds.add(course.id);
    if (completedIds.has(course.id) || currentIds.has(course.id)) continue;
    remaining.push(
      entry(course, {
        requirementType: row.requirement_type,
        recommendedYear: row.recommended_year,
      }),
    );
  }

  const sum = (list: CourseEntry[]) => list.reduce((total, c) => total + (c.creditHours || 0), 0);
  const byCode = (a: CourseEntry, b: CourseEntry) => a.code.localeCompare(b.code);
  remaining.sort((a, b) => (a.recommendedYear ?? 9) - (b.recommendedYear ?? 9) || byCode(a, b));

  const completedById = new Map(
    (history ?? [])
      .map((r) => (r as unknown as { courses: CourseRow | null }).courses)
      .filter((c): c is CourseRow => !!c)
      .map((c) => [c.id, c]),
  );
  const currentById = new Map(
    (enrolments ?? [])
      .map(
        (r) =>
          (r as unknown as { course_sections: { courses: CourseRow | null } | null })
            .course_sections?.courses ?? null,
      )
      .filter((c): c is CourseRow => !!c)
      .map((c) => [c.id, c]),
  );

  const baskets: BasketRequirement[] = ((basketRows ?? []) as unknown as BasketRow[])
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    .map((b) => {
      const eligible = (b.program_basket_courses ?? [])
        .map((l) => l.courses)
        .filter((c): c is CourseRow => !!c);
      const done: CourseEntry[] = [];
      const selected: CourseEntry[] = [];
      for (const course of eligible) {
        // A course already satisfying a fixed requirement cannot double-count.
        if (fixedIds.has(course.id)) continue;
        if (completedIds.has(course.id))
          done.push(entry(completedById.get(course.id) ?? course, { requirementType: b.code }));
        else if (currentIds.has(course.id))
          selected.push(entry(currentById.get(course.id) ?? course, { requirementType: b.code }));
      }
      const completedCreditHours = Math.min(b.required_credit_hours, sum(done));
      const selectedCreditHours = Math.min(
        Math.max(0, b.required_credit_hours - completedCreditHours),
        sum(selected),
      );
      const remainingCreditHours = Math.max(
        0,
        b.required_credit_hours - completedCreditHours - selectedCreditHours,
      );
      const usedCourses = Math.min(b.required_course_count, done.length + selected.length);
      return {
        basketId: b.id,
        code: b.code,
        nameEn: b.name_en,
        nameAr: b.name_ar,
        basketType: b.basket_type,
        effectiveCatalogYear: b.effective_catalog_year,
        requiredCreditHours: b.required_credit_hours,
        requiredCourseCount: b.required_course_count,
        eligibleCourses: eligible.map((c) => entry(c)).sort(byCode),
        completedCourses: done.sort(byCode),
        selectedCourses: selected.sort(byCode),
        completedCreditHours,
        selectedCreditHours,
        remainingCreditHours,
        remainingCourseCount: remainingCreditHours === 0 ? 0 : b.required_course_count - usedCourses,
        satisfied: remainingCreditHours === 0,
        courseListVerified: b.course_list_verified,
        noteEn: b.selection_note_en,
        noteAr: b.selection_note_ar,
      };
    });

  const fixedRemainingCreditHours = sum(remaining);
  const basketRemainingCreditHours = baskets.reduce((t, b) => t + b.remainingCreditHours, 0);

  return {
    completed: completed.sort(byCode),
    current: current.sort(byCode),
    remaining,
    baskets,
    completedCreditHours: sum(completed),
    currentCreditHours: sum(current),
    fixedRemainingCreditHours,
    basketRemainingCreditHours,
    remainingCreditHours: fixedRemainingCreditHours + basketRemainingCreditHours,
    programCourseCount: fixedPlan.length + baskets.length,
  };
}

/** One student-facing line for an outstanding elective basket requirement. */
export function basketLine(b: BasketRequirement, ar: boolean): string {
  const name = ar ? b.nameAr : b.nameEn;
  if (b.satisfied) return ar ? `• ${name}: مكتمل.` : `• ${name}: complete.`;
  const courses = b.remainingCourseCount;
  const head = ar
    ? `• ${name}: يتبقى ${b.remainingCreditHours} ساعة معتمدة${courses > 0 ? ` — يمكنك اختيار ${courses} مادة معتمدة من القائمة` : ""}.`
    : `• ${name}: ${b.remainingCreditHours} credit hours remaining${courses > 0 ? `. You may choose ${courses} approved course${courses === 1 ? "" : "s"} from the ${name} list` : ""}.`;
  if (b.courseListVerified) return head;
  return (
    head +
    (ar
      ? " (قائمة المواد المعتمدة لهذه المجموعة غير مؤكدة رسمياً.)"
      : " (The approved course list for this group is not officially confirmed.)")
  );
}


export function courseLine(c: CourseEntry, ar: boolean): string {
  const title = ar ? c.titleAr : c.titleEn;
  const bits = [`${c.code} — ${title}`, `${c.creditHours} ${ar ? "س.م" : "cr"}`];
  if (c.grade) bits.push(ar ? `التقدير ${c.grade}` : `grade ${c.grade}`);
  const term = ar ? c.termAr : c.termEn;
  if (term) bits.push(term);
  return `• ${bits.join(" · ")}`;
}
