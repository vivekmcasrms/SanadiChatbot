/**
 * Fictional UAEU demo environment seeding.
 * Server-only: uses the service-role client to provision demo auth accounts
 * and their operational records. Every record is clearly fictional.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Every demo account gets its own random password, generated here at seed time.
 * It is handed straight to the auth service (which stores only a hash), never
 * logged, persisted, or returned. Persona sign-in uses one-time sign-in tokens
 * instead (see mintDemoSignInToken), so nobody ever needs to know a password.
 */
function randomDemoPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "x");
}

/** True only for the fictional persona addresses defined in this module. */
export function isDemoPersonaEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  return DEMO_STUDENTS.some((s) => studentEmail(s).toLowerCase() === e) || DEMO_STAFF.some((s) => staffEmail(s).toLowerCase() === e);
}

/** One-time sign-in token for a demo persona. Never a password. */
export async function mintDemoSignInToken(email: string): Promise<string> {
  if (!isDemoPersonaEmail(email)) throw new Error("Not a demo account");
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email: email.trim().toLowerCase() });
  const token = data?.properties?.hashed_token;
  if (error || !token) throw new Error("Could not open this demo account");
  return token;
}

type StudentSpec = {
  key: string;
  studentNumber: string;
  /** Optional sign-in address; defaults to the university student mail pattern. */
  email?: string;
  nameEn: string;
  nameAr: string;
  program: string;
  level: string;
  completed: number;
  registered: number;
  gpa: number;
  lang: "en" | "ar";
  standing: string;
  accessibility?: boolean;
  /** on_campus | off_campus — off_campus students can apply for a hostel. */
  residency?: string;
  scenario: string;
};

export const DEMO_STUDENTS: StudentSpec[] = [
  { key: "s1", studentNumber: "202101", nameEn: "Hessa Al Falasi", nameAr: "حصة الفلاسي", program: "BSCS", level: "senior", completed: 113, registered: 9, gpa: 3.46, lang: "en", standing: "good_standing", scenario: "graduation_one_course" },
  { key: "s2", studentNumber: "202102", nameEn: "Rashid Al Nuaimi", nameAr: "راشد النعيمي", program: "BSDSAI", level: "junior", completed: 83, registered: 12, gpa: 3.11, lang: "ar", standing: "good_standing", scenario: "internship_eligible" },
  { key: "s3", studentNumber: "202103", nameEn: "Maitha Al Ketbi", nameAr: "ميثاء الكتبي", program: "BSIS", level: "junior", completed: 71, registered: 12, gpa: 2.94, lang: "en", standing: "good_standing", scenario: "missing_prerequisite" },
  { key: "s4", studentNumber: "202104", nameEn: "Saif Al Shamsi", nameAr: "سيف الشامسي", program: "BSEE", level: "sophomore", completed: 48, registered: 0, gpa: 2.71, lang: "ar", standing: "good_standing", scenario: "financial_hold" },
  { key: "s5", studentNumber: "202105", nameEn: "Noor Al Suwaidi", nameAr: "نور السويدي", program: "BBA", level: "sophomore", completed: 54, registered: 15, gpa: 3.22, lang: "en", standing: "good_standing", scenario: "advising_appointment" },
  { key: "s6", studentNumber: "202106", nameEn: "Alia Al Mazrouei", nameAr: "عالية المزروعي", program: "BSMATH", level: "sophomore", completed: 42, registered: 9, gpa: 1.84, lang: "ar", standing: "academic_warning", scenario: "low_gpa" },
  { key: "s7", studentNumber: "202107", nameEn: "Omar Al Hammadi", nameAr: "عمر الحمادي", program: "BSBIO", level: "freshman", completed: 27, registered: 15, gpa: 2.88, lang: "en", standing: "good_standing", scenario: "missing_document" },
  { key: "s8", studentNumber: "202108", nameEn: "Salama Al Ali", nameAr: "سلامة العلي", program: "BED", level: "junior", completed: 66, registered: 12, gpa: 3.05, lang: "ar", standing: "good_standing", scenario: "transport_complaint" },
  { key: "s9", studentNumber: "202109", nameEn: "Yousef Al Marzooqi", nameAr: "يوسف المرزوقي", program: "BSCS", level: "junior", completed: 78, registered: 12, gpa: 3.38, lang: "en", standing: "good_standing", scenario: "suggestion_lab_hours" },
  { key: "s10", studentNumber: "202110", nameEn: "Khalifa Al Blooshi", nameAr: "خليفة البلوشي", program: "BSME", level: "junior", completed: 69, registered: 13, gpa: 2.65, lang: "ar", standing: "good_standing", scenario: "overdue_it_case" },
  { key: "s11", studentNumber: "202111", nameEn: "Fatima Al Dhaheri", nameAr: "فاطمة الظاهري", program: "BSDSAI", level: "senior", completed: 120, registered: 0, gpa: 3.61, lang: "en", standing: "good_standing", scenario: "graduation_ready" },
  { key: "s12", studentNumber: "202112", nameEn: "Mariam Al Kaabi", nameAr: "مريم الكعبي", program: "BSIS", level: "sophomore", completed: 51, registered: 12, gpa: 3.02, lang: "ar", standing: "good_standing", accessibility: true, scenario: "accessibility_support" },
  { key: "hous1", studentNumber: "DEMO-HOUS-001", email: "omar.housing@student.demo.local", nameEn: "Omar Al Falasi", nameAr: "عمر الفلاسي", program: "BSIS", level: "sophomore", completed: 45, registered: 12, gpa: 3.10, lang: "en", standing: "good_standing", residency: "off_campus", scenario: "hostel_registration" },
];

export type StaffRole =
  | "service_owner"
  | "service_officer"
  | "service_manager"
  | "knowledge_manager"
  | "system_admin";

type StaffSpec = {
  key: string;
  nameEn: string;
  nameAr: string;
  /** Short display name used in the persona switcher. */
  display: string;
  email: string;
  /** Earlier demo address for the same person; the account is renamed, not duplicated. */
  legacyEmail?: string;
  unit: string;
  /** Every role granted to the account. The first one drives the persona label. */
  roles: StaffRole[];
  jobEn: string;
  jobAr: string;
  owner?: boolean;
  approve?: boolean;
  sensitive?: boolean;
  assign?: boolean;
  /** Additional units this person oversees (manager) or backs up (officer). */
  extraUnits?: string[];
  scenario?: string;
};

/**
 * Fictional demonstration staff. Named Service Owners keep the original demo
 * account identifiers so historical demo cases stay assigned to the same person.
 */
export const DEMO_STAFF: StaffSpec[] = [
  { key: "trn1", nameEn: "Obaid Al Mansoori", nameAr: "عبيد المنصوري", display: "Obaid", email: "obaid@staff.demo.local", legacyEmail: "trn1@staff.demo.local", unit: "TRANS", roles: ["service_owner", "service_officer"], jobEn: "Service Owner - Transportation Services", jobAr: "مالك الخدمة - خدمات النقل", owner: true, assign: true, scenario: "Transportation complaints, bus tracking suggestion" },
  { key: "reg1", nameEn: "Mariam Al Nuaimi", nameAr: "مريم النعيمي", display: "Mariam", email: "mariam.registration@staff.demo.local", legacyEmail: "reg1@staff.demo.local", unit: "REG", roles: ["service_owner", "service_officer"], jobEn: "Service Owner - Registration Department", jobAr: "مالكة الخدمة - قسم التسجيل", owner: true, assign: true, scenario: "Registration support, prerequisites, deadlines" },
  { key: "adv1", nameEn: "Khalid Al Shamsi", nameAr: "خالد الشامسي", display: "Khalid", email: "khalid.advising@staff.demo.local", legacyEmail: "adv1@staff.demo.local", unit: "ADV", roles: ["service_owner", "service_officer"], jobEn: "Service Owner - Academic Advising", jobAr: "مالك الخدمة - الإرشاد الأكاديمي", owner: true, assign: true, scenario: "Advising appointments, graduation progress" },
  { key: "car1", nameEn: "Sara Al Mazrouei", nameAr: "سارة المزروعي", display: "Sara", email: "sara.internship@staff.demo.local", legacyEmail: "car1@staff.demo.local", unit: "CAREER", roles: ["service_owner", "service_officer"], jobEn: "Service Owner - Career and Internship Services", jobAr: "مالكة الخدمة - خدمات المهن والتدريب", owner: true, assign: true, scenario: "Internship eligibility and applications" },
  { key: "it1", nameEn: "Ahmed Al Ketbi", nameAr: "أحمد الكتبي", display: "Ahmed", email: "ahmed.it@staff.demo.local", legacyEmail: "it1@staff.demo.local", unit: "ITS", roles: ["service_owner", "service_officer"], jobEn: "Service Owner - IT Support", jobAr: "مالك الخدمة - الدعم التقني", owner: true, assign: true, scenario: "IT support, account issues, overdue case" },
  { key: "fin1", nameEn: "Fatima Al Kaabi", nameAr: "فاطمة الكعبي", display: "Fatima", email: "fatima.accounts@staff.demo.local", legacyEmail: "fin1@staff.demo.local", unit: "FEES", roles: ["service_owner", "service_officer"], jobEn: "Service Owner - Student Accounts", jobAr: "مالكة الخدمة - حسابات الطلبة", owner: true, assign: true, scenario: "Financial holds and payment support" },
  { key: "lib1", nameEn: "Noora Al Darmaki", nameAr: "نورة الدرمكي", display: "Noora", email: "noora.library@staff.demo.local", unit: "LIB", roles: ["service_owner", "service_officer"], jobEn: "Service Owner - Library Services", jobAr: "مالكة الخدمة - خدمات المكتبة", owner: true, assign: true, scenario: "Library hours suggestions" },
  { key: "cmp1", nameEn: "Yousef Al Dhaheri", nameAr: "يوسف الظاهري", display: "Yousef", email: "yousef.complaints@staff.demo.local", legacyEmail: "cmp1@staff.demo.local", unit: "COMP", roles: ["service_owner", "service_officer"], jobEn: "Service Owner - Student Complaints Office", jobAr: "مالك الخدمة - مكتب شكاوى الطلبة", owner: true, assign: true, approve: true, sensitive: true, scenario: "General, escalated and sensitive complaints" },
  { key: "acc1", nameEn: "Aisha Al Neyadi", nameAr: "عائشة النيادي", display: "Aisha", email: "aisha.accessibility@staff.demo.local", legacyEmail: "acc1@staff.demo.local", unit: "ACCESS", roles: ["service_owner", "service_officer"], jobEn: "Service Owner - Accessibility Support", jobAr: "مالكة الخدمة - الدعم لذوي الهمم", owner: true, assign: true, sensitive: true, scenario: "Accessibility support requests" },
  { key: "hou1", nameEn: "Maha Al Marri", nameAr: "مها المري", display: "Maha", email: "maha.housing@staff.demo.local", unit: "HOUSING", roles: ["service_owner", "service_officer"], jobEn: "Service Owner - Student Housing", jobAr: "مالكة الخدمة - السكن الطلابي", owner: true, assign: true, approve: true, scenario: "Hostel eligibility, room allocation and housing overrides" },
  { key: "mgr1", nameEn: "Dr. Hassan Al Suwaidi", nameAr: "د. حسن السويدي", display: "Hassan", email: "hassan.manager@staff.demo.local", unit: "SAS", roles: ["service_manager"], jobEn: "Service Manager - Student Services", jobAr: "مدير الخدمات - خدمات الطلبة", approve: true, assign: true, sensitive: true, extraUnits: ["TRANS", "REG", "ADV", "CAREER", "ITS", "FEES", "LIB", "COMP", "ACCESS", "HOUSING"], scenario: "Escalations, approvals, SLA oversight" },
  { key: "adv2", nameEn: "Hamad Advisor", nameAr: "حمد مرشد", display: "Hamad", email: "adv2@staff.demo.local", unit: "ADV", roles: ["service_officer"], jobEn: "Academic Advising Officer (back-up)", jobAr: "موظف إرشاد أكاديمي (احتياطي)" },
  { key: "reg2", nameEn: "Ali Registrar", nameAr: "علي التسجيل", display: "Ali", email: "reg2@staff.demo.local", unit: "SAS", roles: ["service_officer"], jobEn: "Student Academic Services Officer", jobAr: "موظف خدمات الطلبة الأكاديمية" },
  { key: "it2", nameEn: "Latifa Support", nameAr: "لطيفة الدعم", display: "Latifa", email: "it2@staff.demo.local", unit: "ITS", roles: ["service_officer"], jobEn: "IT Support Officer (back-up)", jobAr: "موظفة دعم تقني (احتياطي)" },
  { key: "hous1", nameEn: "Salem Housing", nameAr: "سالم السكن", display: "Salem", email: "hous1@staff.demo.local", unit: "HOUS", roles: ["service_owner", "service_officer"], jobEn: "Service Owner - Student Housing Services", jobAr: "مالك الخدمة - خدمات سكن الطلبة", owner: true, assign: true },
  { key: "hap1", nameEn: "Shamma Happiness", nameAr: "شما السعادة", display: "Shamma", email: "hap1@staff.demo.local", unit: "HAPPY", roles: ["service_owner", "service_officer"], jobEn: "Service Owner - Student Happiness and Engagement", jobAr: "مالكة الخدمة - سعادة الطلبة", owner: true, assign: true },
  { key: "sas1", nameEn: "Meera Academic Services", nameAr: "ميرة الخدمات الأكاديمية", display: "Meera", email: "meera.academic@staff.demo.local", unit: "SAS", roles: ["service_owner", "service_officer"], jobEn: "Service Owner - Student Academic Services", jobAr: "مالكة الخدمة - خدمات الطلبة الأكاديمية", owner: true, assign: true },
  { key: "km1", nameEn: "Badr Knowledge", nameAr: "بدر المعرفة", display: "Badr", email: "km1@staff.demo.local", unit: "SAS", roles: ["knowledge_manager"], jobEn: "Knowledge Manager", jobAr: "مدير المعرفة" },
  { key: "sys1", nameEn: "System Administrator", nameAr: "مدير النظام ال", display: "Admin", email: "sys1@staff.demo.local", unit: "SAS", roles: ["system_admin"], jobEn: "System Administrator", jobAr: "مدير النظام" },
];

export const studentEmail = (s: StudentSpec) => s.email ?? `${s.studentNumber}@uaeu.ac.ae`;
export const staffEmail = (s: StaffSpec) => s.email;

async function findUserByEmail(email: string): Promise<string | null> {
  for (let page = 1; page <= 10; page++) {
    const { data } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    const found = data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found.id;
    if (!data || data.users.length < 200) break;
  }
  return null;
}

/**
 * Provision (or re-use) a demo auth account. When `legacyEmail` is supplied and
 * an account already exists under that older address, it is renamed in place so
 * historical demo assignments keep pointing at the same person.
 */
async function ensureUser(
  email: string,
  password: string,
  fullName: string,
  legacyEmail?: string,
): Promise<string> {
  const existing = await findUserByEmail(email);
  if (existing) {
    await supabaseAdmin.auth.admin.updateUserById(existing, {
      password,
      user_metadata: { full_name: fullName, demo_account: true },
    });
    return existing;
  }

  if (legacyEmail) {
    const legacyId = await findUserByEmail(legacyEmail);
    if (legacyId) {
      await supabaseAdmin.auth.admin.updateUserById(legacyId, {
        email,
        email_confirm: true,
        password,
        user_metadata: { full_name: fullName, demo_account: true },
      });
      return legacyId;
    }
  }

  const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, demo_account: true },
  });
  if (!error && created.user) return created.user.id;
  throw new Error(`Could not provision demo account ${email}: ${error?.message ?? "unknown error"}`);
}

export async function seedDemoEnvironment(): Promise<{ students: number; staff: number; cases: number; alerts: number; suggestions: number }> {
  const db = supabaseAdmin;

  const [{ data: units }, { data: programs }, { data: terms }, { data: courses }, { data: sections }] = await Promise.all([
    db.from("service_units").select("id, code"),
    db.from("academic_programs").select("id, code, college_id, department_id, total_credit_hours, internship_minimum_credits"),
    db.from("academic_terms").select("id, code, is_current"),
    db.from("courses").select("id, code, credit_hours"),
    db.from("course_sections").select("id, course_id, academic_term_id"),
  ]);

  const unit = (code: string) => units?.find((u) => u.code === code)?.id ?? null;
  const program = (code: string) => programs?.find((p) => p.code === code);
  const currentTerm = terms?.find((t) => t.is_current);

  // ---------- staff ----------
  const staffIds: Record<string, string> = {};
  for (const s of DEMO_STAFF) {
    const id = await ensureUser(staffEmail(s), randomDemoPassword(), s.nameEn, s.legacyEmail);
    staffIds[s.key] = id;
    await db.from("profiles").upsert({ id, full_name: s.nameEn, email: staffEmail(s), is_demo_account: true });
    for (const role of s.roles) {
      await db.from("user_roles").upsert({ user_id: id, role }, { onConflict: "user_id,role", ignoreDuplicates: true });
    }
    // Demo personas own exactly the roles declared in the spec.
    await db.from("user_roles").delete().eq("user_id", id).not("role", "in", `(${s.roles.join(",")})`);
    await db.from("staff_profiles").upsert({ user_id: id, service_unit_id: unit(s.unit), job_title_en: s.jobEn, job_title_ar: s.jobAr });
    const homeUnitId = unit(s.unit);
    const memberships = [s.unit, ...(s.extraUnits ?? [])];
    for (const code of memberships) {
      const unitId = unit(code);
      if (!unitId) continue;
      const isPrimaryUnit = code === s.unit;
      const isOwnerHere = !!s.owner && isPrimaryUnit;
      await db.from("service_staff").upsert(
        {
          staff_profile_id: id,
          service_unit_id: unitId,
          role_type: s.roles.includes("service_manager")
            ? "manager"
            : isOwnerHere
              ? "service_owner"
              : (s.roles[0] ?? "service_officer"),
          can_receive_cases: s.roles.includes("service_owner") || s.roles.includes("service_officer"),
          can_approve_actions: !!s.approve,
          can_view_sensitive_cases: !!s.sensitive,
          is_service_owner: isOwnerHere,
          can_assign_cases: !!s.assign,
          can_approve_normal_resolution: s.roles.includes("service_owner") || s.roles.includes("service_manager"),
          can_escalate: s.roles.includes("service_owner") || s.roles.includes("service_manager") || s.roles.includes("service_officer"),
          is_demo_record: true,
        },
        { onConflict: "staff_profile_id,service_unit_id" },
      );
    }

    // Named Service Owner becomes the unit's primary owner of record.
    if (s.owner && homeUnitId) {
      await db.from("service_units").update({ primary_service_owner_id: id }).eq("id", homeUnitId);
      const { data: currentOwner } = await db
        .from("service_unit_owners")
        .select("id, staff_profile_id")
        .eq("service_unit_id", homeUnitId)
        .eq("ownership_type", "primary")
        .eq("is_active", true)
        .maybeSingle();
      if (currentOwner && currentOwner.staff_profile_id !== id) {
        await db
          .from("service_unit_owners")
          .update({ is_active: false, ended_at: new Date().toISOString() })
          .eq("id", currentOwner.id);
      }
      if (!currentOwner || currentOwner.staff_profile_id !== id) {
        await db.from("service_unit_owners").insert({
          service_unit_id: homeUnitId,
          staff_profile_id: id,
          ownership_type: "primary",
          is_active: true,
          notes: s.jobEn,
          is_demo_record: true,
        });
      }
    }
  }

  // ---------- students ----------
  const studentIds: Record<string, string> = {};
  for (const s of DEMO_STUDENTS) {
    const id = await ensureUser(studentEmail(s), randomDemoPassword(), s.nameEn);
    studentIds[s.key] = id;
    const prog = program(s.program);
    await db.from("profiles").upsert({ id, full_name: s.nameEn, email: studentEmail(s), preferred_language: s.lang });
    await db.from("user_roles").upsert({ user_id: id, role: "student" }, { onConflict: "user_id,role", ignoreDuplicates: true });
    await db.from("student_profiles").upsert({
      user_id: id,
      student_number: s.studentNumber,
      preferred_name: s.nameAr,
      program_id: prog?.id ?? null,
      college_id: prog?.college_id ?? null,
      department_id: prog?.department_id ?? null,
      current_academic_term_id: currentTerm?.id ?? null,
      academic_level: s.level,
      completed_credit_hours: s.completed,
      registered_credit_hours: s.registered,
      cumulative_gpa: s.gpa,
      academic_standing: s.standing,
      preferred_language: s.lang,
      accessibility_support_required: !!s.accessibility,
      expected_graduation_date: s.completed > 100 ? "2026-12-17" : null,
      advisor_staff_id: staffIds[s.completed % 2 === 0 ? "adv1" : "adv2"] ?? null,
      residency_status: s.residency ?? "on_campus",
      scholarship_status: s.gpa >= 3.5 ? "merit_scholarship" : "self_funded",
      is_demo_record: true,
    });

    // course history from the programme plan
    const { data: planRows } = await db.from("program_courses").select("course_id").eq("program_id", prog?.id ?? "");
    const planned = (planRows ?? []).map((r) => r.course_id);
    let credited = 0;
    const history: { student_id: string; course_id: string; academic_term_id: string | null; grade: string; credits_attempted: number; credits_earned: number; completion_status: string }[] = [];
    for (const courseId of planned) {
      const c = courses?.find((x) => x.id === courseId);
      if (!c) continue;
      if (credited + c.credit_hours > s.completed) continue;
      credited += c.credit_hours;
      const grade = s.gpa >= 3.4 ? "A-" : s.gpa >= 3.0 ? "B" : s.gpa >= 2.5 ? "C+" : "C";
      history.push({
        student_id: id,
        course_id: courseId,
        academic_term_id: terms?.[0]?.id ?? null,
        grade,
        credits_attempted: c.credit_hours,
        credits_earned: c.credit_hours,
        completion_status: "completed",
      });
    }
    await db.from("student_course_history").delete().eq("student_id", id);
    if (history.length) await db.from("student_course_history").insert(history);

    // current enrolments
    await db.from("student_current_enrollments").delete().eq("student_id", id);
    const termSections = (sections ?? []).filter(
      (sec) => sec.academic_term_id === currentTerm?.id && planned.includes(sec.course_id),
    ).slice(0, Math.max(0, Math.round(s.registered / 3)));
    if (termSections.length) {
      await db.from("student_current_enrollments").insert(
        termSections.map((sec) => ({ student_id: id, course_section_id: sec.id, enrollment_status: "registered" })),
      );
    }
  }

  // Accounts and academic master records only. Cases, alerts, suggestions,
  // appointments and documents are never seeded: every transactional record
  // must originate from a real action in the running application.
  return { students: DEMO_STUDENTS.length, staff: DEMO_STAFF.length, cases: 0, alerts: 0, suggestions: 0 };
}
