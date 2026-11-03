/** Database-driven student context used by the assistant agents. Server only. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { formatDate, formatDueDate } from "./format-date";

export type Db = SupabaseClient<Database>;

/** Every UAEU programme is 120 credit hours; used when a record is missing the value. */
export const DEFAULT_TOTAL_CREDIT_HOURS = 120;

export type StudentSnapshot = {
  hasProfile: boolean;
  fullName: string | null;
  email: string | null;
  studentNumber: string | null;
  programId: string | null;
  programCode: string | null;
  programNameEn: string | null;
  programNameAr: string | null;
  collegeNameEn: string | null;
  collegeNameAr: string | null;
  currentTermEn: string | null;
  currentTermAr: string | null;
  enrollmentStatus: string | null;
  totalCredits: number | null;
  internshipMinimum: number | null;
  completedCredits: number;
  remainingCredits: number;
  registeredCredits: number;
  gpa: number | null;
  standing: string | null;
  level: string | null;
  expectedGraduation: string | null;
  holds: {
    titleEn: string;
    titleAr: string;
    descriptionEn: string | null;
    descriptionAr: string | null;
    resolutionEn: string | null;
    resolutionAr: string | null;
    blocksRegistration: boolean;
    blocksGraduation: boolean;
  }[];
  requirements: { titleEn: string; titleAr: string; status: string; dueDate: string | null }[];
  openCases: number;
  unreadAlerts: number;
};

export async function loadStudentSnapshot(db: Db, userId: string): Promise<StudentSnapshot> {
  const [{ data: profile }, { data: account }, { data: holds }, { data: reqs }, cases, alerts] =
    await Promise.all([
    db
      .from("student_profiles")
      .select(
        "student_number, program_id, account_status, completed_credit_hours, registered_credit_hours, cumulative_gpa, academic_standing, academic_level, expected_graduation_date, academic_programs:program_id (code, name_en, name_ar, total_credit_hours, internship_minimum_credits), colleges:college_id (name_en, name_ar), academic_terms:current_academic_term_id (name_en, name_ar)",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    // The signed-in student's own display name, under their own RLS scope.
    db.from("profiles").select("full_name, email").eq("id", userId).maybeSingle(),
    db
      .from("student_holds")
      .select("title_en, title_ar, description_en, description_ar, resolution_action_en, resolution_action_ar, prevents_registration, prevents_graduation")
      .eq("student_id", userId)
      .eq("status", "active"),
    db
      .from("student_requirements")
      .select("title_en, title_ar, status, due_date")
      .eq("student_id", userId)
      .neq("status", "completed")
      .order("due_date", { ascending: true }),
    db.from("cases").select("id", { count: "exact", head: true }).eq("student_id", userId).not("status", "in", "(resolved,closed)"),
    db.from("student_alerts").select("id", { count: "exact", head: true }).eq("student_id", userId).eq("is_read", false).eq("status", "active"),
  ]);

  const prog = (profile?.academic_programs ?? null) as
    | { code: string; name_en: string; name_ar: string; total_credit_hours: number; internship_minimum_credits: number | null }
    | null;
  const college = (profile?.colleges ?? null) as { name_en: string; name_ar: string } | null;
  const term = (profile?.academic_terms ?? null) as { name_en: string; name_ar: string } | null;

  const totalCredits = prog?.total_credit_hours ?? DEFAULT_TOTAL_CREDIT_HOURS;
  const completedCredits = profile?.completed_credit_hours ?? 0;

  return {
    hasProfile: Boolean(profile),
    fullName: account?.full_name ?? null,
    email: account?.email ?? null,
    studentNumber: profile?.student_number ?? null,
    programId: profile?.program_id ?? null,
    programCode: prog?.code ?? null,
    programNameEn: prog?.name_en ?? null,
    programNameAr: prog?.name_ar ?? null,
    collegeNameEn: college?.name_en ?? null,
    collegeNameAr: college?.name_ar ?? null,
    currentTermEn: term?.name_en ?? null,
    currentTermAr: term?.name_ar ?? null,
    enrollmentStatus: profile?.account_status ?? null,
    totalCredits,
    internshipMinimum: prog?.internship_minimum_credits ?? null,
    completedCredits,
    remainingCredits: Math.max(0, totalCredits - completedCredits),
    registeredCredits: profile?.registered_credit_hours ?? 0,
    gpa: profile?.cumulative_gpa ?? null,
    standing: profile?.academic_standing ?? null,
    level: profile?.academic_level ?? null,
    expectedGraduation: profile?.expected_graduation_date ?? null,
    holds: (holds ?? []).map((h) => ({
      titleEn: h.title_en,
      titleAr: h.title_ar,
      descriptionEn: h.description_en,
      descriptionAr: h.description_ar,
      resolutionEn: h.resolution_action_en,
      resolutionAr: h.resolution_action_ar,
      blocksRegistration: h.prevents_registration,
      blocksGraduation: h.prevents_graduation,
    })),
    requirements: (reqs ?? []).map((r) => ({ titleEn: r.title_en, titleAr: r.title_ar, status: r.status, dueDate: r.due_date })),
    openCases: cases.count ?? 0,
    unreadAlerts: alerts.count ?? 0,
  };
}

const nf = (n: number) => new Intl.NumberFormat("en-US").format(n);

/**
 * Chat-first principle: the answer itself carries the data. We only offer one
 * subtle link to the full record, anchored at the most relevant section.
 */
export function academicLinks(ar: boolean, keys: string[]): string {
  const anchors = ["profile", "progress", "standing", "current", "remaining", "completed"];
  const anchor = keys.find((k) => anchors.includes(k)) ?? "profile";
  return `\n\n[${ar ? "عرض سجلي الأكاديمي الكامل" : "View full academic record"}](/academic#${anchor})`;
}

/** Turns stored codes such as `good_standing` into readable labels. */
export async function humanValue(value: string | null, ar: boolean): Promise<string | null> {
  if (!value) return null;
  const { humanizeStatus } = await import("./agent/registration-readiness.server");
  return humanizeStatus(value, ar);
}


/** Builds a verified, record-backed answer for personal student-data intents. */
export async function answerStudentDataIntent(
  db: Db,
  userId: string,
  intent: string,
  ar: boolean,
): Promise<{ answer: string; snapshot: StudentSnapshot } | null> {
  const s = await loadStudentSnapshot(db, userId);
  if (!s.hasProfile) {
    return {
      answer: ar
        ? "لم أجد سجلاً أكاديمياً مرتبطاً بحسابك، لذلك لا يمكنني التحقق من بياناتك الشخصية."
        : "I could not find an academic record linked to your account, so I cannot verify your personal data.",
      snapshot: s,
    };
  }

  // Identity and course questions are answered from the verified record only.
  if (intent === "identity") {
    const program = (ar ? s.programNameAr : s.programNameEn) ?? s.programCode;
    const college = ar ? s.collegeNameAr : s.collegeNameEn;
    const term = ar ? s.currentTermAr : s.currentTermEn;
    const standing = await humanValue(s.standing, ar);
    const enrollment = await humanValue(s.enrollmentStatus, ar);
    const total = s.totalCredits ?? 120;
    const percent = total > 0 ? Math.round((s.completedCredits / total) * 1000) / 10 : null;

    const header = [
      `**${s.fullName ?? (ar ? "الطالب" : "Student")}**`,
      program ?? "",
      college ?? "",
      s.email ? (ar ? `البريد الإلكتروني ${s.email}` : `Email: ${s.email}`) : "",
      s.studentNumber ? (ar ? `الرقم الجامعي ${s.studentNumber}` : `Student ID ${s.studentNumber}`) : "",
    ]
      .filter(Boolean)
      .join("\n");

    const facts: string[] = [];
    if (s.level) facts.push(ar ? `المستوى: ${s.level}` : `${s.level}`);
    if (enrollment) facts.push(ar ? `القيد: ${enrollment}` : `Enrollment: ${enrollment}`);
    if (term) facts.push(ar ? `الفصل الحالي: ${term}` : `Current semester: ${term}`);
    if (s.gpa !== null) facts.push(ar ? `المعدل التراكمي: ${s.gpa}` : `GPA: ${s.gpa}`);
    if (standing) facts.push(ar ? `الحالة الأكاديمية: ${standing}` : `Academic standing: ${standing}`);
    facts.push(
      ar ? `المكتملة: ${nf(s.completedCredits)} ساعة` : `Completed: ${nf(s.completedCredits)} credits`,
    );
    facts.push(
      ar
        ? `المسجلة حالياً: ${nf(s.registeredCredits)} ساعة`
        : `Currently registered: ${nf(s.registeredCredits)} credits`,
    );
    facts.push(
      ar ? `متطلب التخرج: ${nf(total)} ساعة` : `Degree requirement: ${nf(total)} credits`,
    );
    if (s.expectedGraduation)
      facts.push(
        ar
          ? `التخرج المتوقع: ${formatDate(s.expectedGraduation, "ar")}`
          : `Expected graduation: ${formatDate(s.expectedGraduation, "en")}`,
      );

    const summary = ar
      ? `أكملت ${nf(s.completedCredits)} من ${nf(total)} ساعة معتمدة${s.registeredCredits ? `، وأنت مسجل حالياً في ${nf(s.registeredCredits)} ساعة إضافية` : ""}${standing ? `، وحالتك الأكاديمية: ${standing}` : ""}.`
      : `You have completed ${nf(s.completedCredits)} of ${nf(total)} credit hours${s.registeredCredits ? `, and you are currently registered for another ${nf(s.registeredCredits)} credits` : ""}${standing ? `, with an academic standing of ${standing}` : ""}.`;

    const progressBlock =
      percent !== null
        ? `**${ar ? "تقدم التخرج" : "Degree progress"}**\n${nf(s.completedCredits)} / ${nf(total)} ${ar ? "مكتملة" : "completed"}\n${percent}% ${ar ? "مكتمل" : "complete"}`
        : "";

    return {
      answer:
        [
          header,
          `**${ar ? "ملخصك الأكاديمي" : "Your academic snapshot"}**\n` +
            facts.map((f) => `- ${f}`).join("\n"),
          summary,
          progressBlock,
        ]
          .filter(Boolean)
          .join("\n\n") + academicLinks(ar, ["profile"]),
      snapshot: s,
    };
  }


  if (intent === "completed_courses" || intent === "current_courses" || intent === "remaining_courses") {
    const { loadAcademicCourses, courseLine, basketLine } = await import(
      "./academic-record.server"
    );

    const courses = await loadAcademicCourses(db, userId, s.programId);
    if (intent === "completed_courses") {
      if (!courses.completed.length)
        return {
          answer: ar
            ? "لا توجد مواد مكتملة مسجلة في سجلك الأكاديمي حتى الآن."
            : "Your academic record does not show any completed courses yet.",
          snapshot: s,
        };
      return {
        answer:
          (ar
            ? `أكملت ${courses.completed.length} مادة بمجموع ${nf(courses.completedCreditHours)} ساعة معتمدة:\n`
            : `You have completed ${courses.completed.length} course(s) totalling ${nf(courses.completedCreditHours)} credit hours:\n`) +
          courses.completed.map((c) => courseLine(c, ar)).join("\n") +
          academicLinks(ar, ["completed", "progress"]),
        snapshot: s,
      };
    }
    if (intent === "current_courses") {
      if (!courses.current.length)
        return {
          answer: ar
            ? "لا توجد مواد مسجلة لك في الفصل الحالي."
            : "You are not registered for any courses this semester.",
          snapshot: s,
        };
      return {
        answer:
          `**${ar ? "مواد الفصل الحالي" : "Current courses"}**\n` +
          courses.current
            .map(
              (c, i) =>
                `${i + 1}. ${c.code} — ${ar ? c.titleAr : c.titleEn} · ${c.creditHours} ${ar ? "س.م" : "cr"}`,
            )
            .join("\n") +
          "\n\n" +
          (ar
            ? `المجموع: ${courses.current.length} مادة، ${nf(courses.currentCreditHours)} ساعة معتمدة هذا الفصل.`
            : `Total: ${courses.current.length} course(s), ${nf(courses.currentCreditHours)} credit hours this semester.`) +
          academicLinks(ar, ["current"]),
        snapshot: s,
      };

    }
    if (!courses.programCourseCount)
      return {
        answer: ar
          ? "خطة البرنامج غير مسجلة في النظام، لذلك لا يمكنني حساب المواد المتبقية. يمكن لخدمات الطلبة الأكاديمية تزويدك بها."
          : "Your programme study plan is not registered in the system, so I cannot calculate your remaining courses. Student Academic Services can provide it.",
        snapshot: s,
      };
    const openBaskets = courses.baskets.filter((b) => !b.satisfied);
    if (!courses.remaining.length && !openBaskets.length)
      return {
        answer:
          (ar
            ? "أكملت أو سجلت جميع متطلبات خطة برنامجك، بما فيها المواد الاختيارية."
            : "You have completed or registered every requirement in your study plan, including your elective requirements.") +
          academicLinks(ar, ["progress", "completed"]),
        snapshot: s,
      };
    const blocks: string[] = [];
    if (courses.remaining.length)
      blocks.push(
        (ar
          ? `المواد الإجبارية المتبقية: ${courses.remaining.length} مادة (${nf(courses.fixedRemainingCreditHours)} ساعة معتمدة):\n`
          : `Required courses remaining: ${courses.remaining.length} course(s) (${nf(courses.fixedRemainingCreditHours)} credit hours):\n`) +
          courses.remaining.map((c) => courseLine(c, ar)).join("\n"),
      );
    if (openBaskets.length)
      blocks.push(
        (ar
          ? `المتطلبات الاختيارية المتبقية (${nf(courses.basketRemainingCreditHours)} ساعة معتمدة) — تختار منها ولا يُطلب إكمال كل موادها:\n`
          : `Elective requirements remaining (${nf(courses.basketRemainingCreditHours)} credit hours) — you choose from each list, you do not take every course in it:\n`) +
          openBaskets.map((b) => basketLine(b, ar)).join("\n"),
      );
    blocks.push(
      ar
        ? `الإجمالي المتبقي: ${nf(courses.remainingCreditHours)} ساعة معتمدة.`
        : `Total remaining: ${nf(courses.remainingCreditHours)} credit hours.`,
    );
    return {
      answer: blocks.join("\n\n") + academicLinks(ar, ["remaining", "progress"]),
      snapshot: s,
    };

  }

  const holdLines = s.holds
    .map((h) => `• ${ar ? h.titleAr : h.titleEn}${(ar ? h.resolutionAr : h.resolutionEn) ? ` — ${ar ? h.resolutionAr : h.resolutionEn}` : ""}`)
    .join("\n");

  if (intent === "holds") {
    if (!s.holds.length) {
      return { answer: ar ? "لا توجد قيود نشطة على سجلك حالياً." : "There are no active holds on your record.", snapshot: s };
    }
    return {
      answer: ar
        ? `يوجد ${s.holds.length} قيد نشط على سجلك:\n${holdLines}`
        : `You have ${s.holds.length} active hold(s) on your record:\n${holdLines}`,
      snapshot: s,
    };
  }

  if (intent === "registration_block") {
    const blocking = s.holds.filter((h) => h.blocksRegistration);
    if (!blocking.length) {
      return {
        answer: ar
          ? `لا يوجد ما يمنع تسجيلك. أنت مسجل حالياً في ${nf(s.registeredCredits)} ساعة معتمدة.`
          : `Nothing is currently blocking your registration. You are registered for ${nf(s.registeredCredits)} credit hours.`,
        snapshot: s,
      };
    }
    const lines = blocking.map((h) => `• ${ar ? h.titleAr : h.titleEn} — ${(ar ? h.resolutionAr : h.resolutionEn) ?? ""}`).join("\n");
    return {
      answer: ar ? `تسجيلك متوقف بسبب:\n${lines}` : `Your registration is blocked by:\n${lines}`,
      snapshot: s,
    };
  }

  if (intent === "graduation") {
    const total = s.totalCredits ?? DEFAULT_TOTAL_CREDIT_HOURS;
    const remaining = Math.max(0, total - s.completedCredits);
    const pending = s.requirements
      .map((r) => `• ${ar ? r.titleAr : r.titleEn}${r.dueDate ? ` (${formatDueDate(r.dueDate, ar ? "ar" : "en")})` : ""}`)
      .join("\n");
    const gradBlocks = s.holds.filter((h) => h.blocksGraduation);
    const parts = [
      ar
        ? `تقدمك نحو التخرج: ${nf(s.completedCredits)} من ${nf(total)} ساعة معتمدة (${Math.round((s.completedCredits / total) * 100)}%).`
        : `Graduation progress: ${nf(s.completedCredits)} of ${nf(total)} credit hours (${Math.round((s.completedCredits / total) * 100)}%).`,
      remaining > 0
        ? ar
          ? `يتبقى ${nf(remaining)} ساعة معتمدة.`
          : `${nf(remaining)} credit hours remain.`
        : ar
          ? "أكملت جميع الساعات المعتمدة المطلوبة."
          : "All required credit hours are complete.",
    ];
    if (pending) parts.push(ar ? `المتطلبات المعلقة:\n${pending}` : `Pending requirements:\n${pending}`);
    if (gradBlocks.length)
      parts.push(
        ar
          ? `قيود تؤثر على التخرج:\n${gradBlocks.map((h) => `• ${h.titleAr}`).join("\n")}`
          : `Holds affecting graduation:\n${gradBlocks.map((h) => `• ${h.titleEn}`).join("\n")}`,
      );
    if (s.expectedGraduation) {
      const when = formatDate(s.expectedGraduation, ar ? "ar" : "en");
      parts.push(ar ? `تاريخ التخرج المتوقع: ${when}.` : `Expected graduation date: ${when}.`);
    }
    return { answer: parts.join("\n\n"), snapshot: s };
  }

  if (intent === "academic_status") {
    const standing = await humanValue(s.standing, ar);
    const total = s.totalCredits ?? DEFAULT_TOTAL_CREDIT_HOURS;
    const lines = [
      standing
        ? `**${standing}**`
        : ar
          ? "**الحالة الأكاديمية غير مسجلة**"
          : "**Academic standing not recorded**",
      [
        s.gpa !== null ? (ar ? `- المعدل التراكمي: ${s.gpa}` : `- GPA: ${s.gpa}`) : "",
        ar
          ? `- المكتملة: ${nf(s.completedCredits)} من ${nf(total)} ساعة`
          : `- Completed: ${nf(s.completedCredits)} of ${nf(total)} credits`,
        ar
          ? `- المسجلة حالياً: ${nf(s.registeredCredits)} ساعة`
          : `- Currently registered: ${nf(s.registeredCredits)} credits`,
      ]
        .filter(Boolean)
        .join("\n"),
    ];
    if (standing && /good/i.test(s.standing ?? ""))
      lines.push(
        ar
          ? "هذا يعني أن معدلك ضمن الحد المطلوب ولا توجد قيود أكاديمية على تسجيلك."
          : "This means your GPA is above the required threshold and no academic restriction applies to your registration.",
      );
    return { answer: lines.join("\n\n") + academicLinks(ar, ["standing"]), snapshot: s };
  }


  if (intent === "alerts") {
    return {
      answer: s.unreadAlerts
        ? ar
          ? `لديك ${nf(s.unreadAlerts)} تنبيه غير مقروء. يمكنك مراجعتها كلها في صفحة التنبيهات.`
          : `You have ${nf(s.unreadAlerts)} unread alert(s). You can review them all on the Alerts page.`
        : ar
          ? "لا توجد تنبيهات غير مقروءة على حسابك حالياً."
          : "You have no unread alerts at the moment.",
      snapshot: s,
    };
  }

  if (intent === "cases") {
    return {
      answer: s.openCases
        ? ar
          ? `لديك ${nf(s.openCases)} طلب مفتوح قيد المعالجة. تجد حالة كل طلب وتحديثاته في صفحة طلباتي.`
          : `You have ${nf(s.openCases)} open request(s) in progress. You can see the status and updates for each one on the My Requests page.`
        : ar
          ? "لا توجد لديك طلبات مفتوحة حالياً."
          : "You have no open requests at the moment.",
      snapshot: s,
    };
  }

  return null;
}
