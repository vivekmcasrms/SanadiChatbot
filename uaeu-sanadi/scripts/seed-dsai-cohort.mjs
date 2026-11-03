#!/usr/bin/env node
/**
 * Imports the official UAEU BSc Data Science and Artificial Intelligence
 * programme (catalogue PROGRAM_ID 2887.2968.23022, 120 CH) and creates three
 * sample students at different academic stages.
 *
 * Programme structure, course codes, titles, credit hours and prerequisites come
 * from supabase/seed/dsai-catalogue.json, which is generated from the official
 * UAEU catalogue feed (https://www.uaeu.ac.ae/en/catalog/summary/colleges.xml).
 * Recommended semesters come from the official model study plan PDF
 * (2026-2027 cohort).
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-dsai-cohort.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const catalogue = JSON.parse(await readFile(new URL("../supabase/seed/dsai-catalogue.json", import.meta.url), "utf8"));

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

/* ------------------------------------------------------------------ college */
const university = must(await db.from("universities").select("id").limit(1).single());
const college = must(
  await db
    .from("colleges")
    .upsert(
      {
        university_id: university.id,
        code: "CCAI",
        name_en: "College of Computing and Artificial Intelligence",
        name_ar: "كلية الحوسبة والذكاء الاصطناعي",
        is_active: true,
      },
      { onConflict: "code" },
    )
    .select("id")
    .single(),
);
const department = must(await db.from("departments").select("id").eq("code", "DSAI").single());

/* ----------------------------------------------------------------- programme */
const program = must(
  await db
    .from("academic_programs")
    .update({
      college_id: college.id,
      department_id: department.id,
      name_en: "BSc Data Science and Artificial Intelligence",
      name_ar: catalogue.program.title_ar,
      total_credit_hours: 120,
      internship_required: true,
      internship_minimum_credits: 6,
      is_active: true,
    })
    .eq("code", "BSDSAI")
    .select("id")
    .single(),
);

/* --------------------------------------------------------------------- terms */
const termSpec = [
  ["2023SP", "Spring 2023", "ربيع 2023", "2023-01-15", "2023-05-18"],
  ["2023FA", "Fall 2023", "خريف 2023", "2023-08-27", "2023-12-21"],
  ["2024SP", "Spring 2024", "ربيع 2024", "2024-01-14", "2024-05-16"],
  ["2024FA", "Fall 2024", "خريف 2024", "2024-08-25", "2024-12-19"],
  ["2025SP", "Spring 2025", "ربيع 2025", "2025-01-12", "2025-05-15"],
];
for (const [code, en, ar, start, end] of termSpec) {
  must(
    await db
      .from("academic_terms")
      .upsert(
        { university_id: university.id, code, name_en: en, name_ar: ar, start_date: start, end_date: end, is_current: false, is_active: true },
        { onConflict: "code" },
      )
      .select("id"),
  );
}
// Fall 2026 is the live term (today falls inside it).
must(await db.from("academic_terms").update({ is_current: false }).neq("code", "2026FA"));
must(await db.from("academic_terms").update({ is_current: true, registration_start: "2026-07-15", registration_end: "2026-09-17" }).eq("code", "2026FA"));
const terms = Object.fromEntries(must(await db.from("academic_terms").select("id, code")).map((t) => [t.code, t.id]));

/* ------------------------------------------------------------------- courses */
const deptByPrefix = Object.fromEntries(
  must(await db.from("departments").select("id, code")).map((d) => [d.code, d.id]),
);
const departmentFor = (code) => {
  if (/^(CSBP|SWEB|ITBP|ISEC|CENG)/.test(code)) return deptByPrefix.DSAI ?? null;
  if (/^(MATH|STAT)/.test(code)) return deptByPrefix.MATH ?? null;
  if (/^GE/.test(code)) return deptByPrefix.GENED ?? null;
  return null;
};
must(
  await db.from("courses").upsert(
    catalogue.courses.map((c) => ({
      code: c.code,
      title_en: c.title_en,
      title_ar: c.title_ar || c.title_en,
      credit_hours: c.credit_hours,
      course_level: Number(c.code.replace(/\D/g, "").slice(0, 1)) * 100 || null,
      department_id: departmentFor(c.code),
      is_active: true,
    })),
    { onConflict: "code" },
  ),
);
const courseId = Object.fromEntries(must(await db.from("courses").select("id, code")).map((c) => [c.code, c.id]));

/* ------------------------------------------------------------- prerequisites */
const prereqRows = catalogue.prerequisites
  .filter((p) => courseId[p.course] && courseId[p.prerequisite])
  .map((p) => ({
    course_id: courseId[p.course],
    prerequisite_course_id: courseId[p.prerequisite],
    minimum_grade: p.min_grade || "D",
    prerequisite_type: p.condition === "or" ? "alternative" : "required",
    is_active: true,
  }));
must(await db.from("course_prerequisites").upsert(prereqRows, { onConflict: "course_id,prerequisite_course_id" }));

/* ---------------------------------------------- programme requirement mapping */
// Official model study plan (2026-2027 cohort): [recommended_year, semester].
const planSlot = {
  GEAE101: [1, 1], MATH105: [1, 1], CSBP119: [1, 1], GESU121: [1, 1],
  CHEM111: [1, 1], BIOC100: [1, 1], PHYS105: [1, 1],
  STAT210: [1, 2], MATH110: [1, 2], CSBP219: [1, 2], CSBP270: [1, 2], MATH140: [1, 2],
  CSBP323: [2, 1], MATH240: [2, 1], MATH290: [2, 1], STAT240: [2, 1],
  CSBP340: [2, 2], SWEB450: [2, 2], STAT470: [2, 2], CSBP224: [2, 2], CENG202: [2, 2],
  CSBP301: [3, 1], GEEM110: [3, 1], ITBP218: [3, 1],
  ITBP324: [3, 2], CSBP411: [3, 2], ISEC411: [3, 2],
  MATH350: [4, 1], ITBP480: [4, 1],
  ITBP481: [4, 2], CSBP320: [4, 2],
  CSBP495: [5, 1],
};
const requirementFor = (area, cluster, code) => {
  if (area.startsWith("General Education")) return { type: "general_education", required: true };
  if (area.startsWith("Students shall register 9 CH")) return { type: "general_education_elective", required: false };
  if (area.startsWith("Major Requirements"))
    // CHEM111 / BIOC100 / PHYS105 is a "choose one" science slot (54 CH = 17 x 3 + 3).
    return ["CHEM111", "BIOC100", "PHYS105"].includes(code)
      ? { type: "major_science_choice", required: false }
      : { type: "major_required", required: true };
  if (area.startsWith("Internship")) return { type: "internship", required: true };
  if (area.startsWith("Advanced Computing Thinking")) return { type: "advanced_computing_required", required: true };
  if (area.startsWith("Specialization Electives")) return { type: "specialization_elective", required: false };
  if (area.startsWith("Supporting Requirements"))
    return cluster.startsWith("Group (1)")
      ? { type: "supporting_required", required: true }
      : { type: "supporting_elective", required: false };
  return { type: "elective", required: false };
};
const programRows = [];
for (const area of catalogue.areas) {
  for (const c of area.courses) {
    const r = requirementFor(area.area, area.cluster, c.code);
    const slot = planSlot[c.code] ?? [null, null];
    programRows.push({
      program_id: program.id,
      course_id: courseId[c.code],
      requirement_type: r.type,
      is_required: r.required,
      recommended_year: slot[0],
      recommended_semester: slot[1],
    });
  }
}
must(await db.from("program_courses").delete().eq("program_id", program.id));
must(await db.from("program_courses").insert(programRows));

/* ------------------------------------------------------------------ students */
const GRADE_POINTS = { A: 4, "A-": 3.7, "B+": 3.3, B: 3, "B-": 2.7, "C+": 2.3, C: 2, "C-": 1.7 };

const S1 = [["GEAE101", "A-"], ["MATH105", "B+"], ["CSBP119", "A"], ["GESU121", "B"], ["PHYS105", "B+"]];
const S2 = [["STAT210", "B+"], ["MATH110", "B"], ["CSBP219", "A-"], ["CSBP270", "A"], ["MATH140", "B+"]];
const S3 = [["PHI180", "A"], ["CSBP323", "A-"], ["MATH240", "B+"], ["MATH290", "B"], ["STAT240", "A-"]];
const S4 = [["CSBP340", "A-"], ["SWEB450", "B+"], ["STAT470", "A"], ["CSBP224", "A-"], ["CENG202", "B+"]];
const S5 = [["CSBP325", "A"], ["CSBP301", "A-"], ["GEEM110", "A"], ["MGMT201", "B+"], ["ITBP218", "A-"]];
const S6 = [["GEIS101", "A"], ["ITBP324", "A-"], ["CSBP411", "A"], ["ISEC411", "B+"], ["CSBP441", "A-"]];
const S7 = [["MATH350", "B+"], ["MKTG200", "A-"], ["PSYC100", "A"], ["ITBP480", "A"], ["CSBP477", "A-"]];

/** Per-student grade profile: each student earns their own grades for a course. */
const grades = (list, overrides = {}) => list.map(([c, g]) => [c, overrides[c] ?? g]);

/** Initial password for seeded students. Must come from the environment; never hard-coded. */
const STUDENT_INITIAL_PASSWORD = process.env.STUDENT_INITIAL_PASSWORD;
if (!STUDENT_INITIAL_PASSWORD || STUDENT_INITIAL_PASSWORD.length < 12) {
  console.error("Set STUDENT_INITIAL_PASSWORD (12+ characters).");
  process.exit(1);
}

const students = [
  {
    email: "202113@uaeu.ac.ae",
    password: STUDENT_INITIAL_PASSWORD,
    studentNumber: "202113",
    nameEn: "Mariam Al Nuaimi",
    nameAr: "مريم النعيمي",
    level: "Year 1",
    admission: "2026SP",
    history: [["2026SP", grades(S1, { GEAE101: "B+", MATH105: "B", GESU121: "B-", PHYS105: "B" })]],
    registered: ["STAT210", "MATH110", "CSBP219", "CSBP270", "MATH140"],
    graduation: "2030-05-16",
  },
  {
    email: "202114@uaeu.ac.ae",
    password: STUDENT_INITIAL_PASSWORD,
    studentNumber: "202114",
    nameEn: "Omar Al Mansoori",
    nameAr: "عمر المنصوري",
    level: "Year 3",
    admission: "2024FA",
    history: [
      ["2024FA", grades(S1, { GEAE101: "B", MATH105: "B", PHYS105: "B" })],
      ["2025SP", grades(S2, { CSBP219: "B" })],
      ["2025FA", grades(S3, { CSBP323: "B", STAT240: "B" })],
      ["2026SP", S4],
    ],
    registered: ["CSBP301", "GEEM110", "CSBP325", "MGMT201", "GEIS101"],
    graduation: "2028-12-21",
  },
  {
    email: "202115@uaeu.ac.ae",
    password: STUDENT_INITIAL_PASSWORD,
    studentNumber: "202115",
    nameEn: "Fatima Al Kaabi",
    nameAr: "فاطمة الكعبي",
    level: "Year 4",
    admission: "2023SP",
    history: [
      ["2023SP", grades(S1, { MATH105: "A" })],
      ["2023FA", S2],
      ["2024SP", grades(S3, { MATH240: "A" })],
      ["2024FA", S4],
      ["2025SP", S5],
      ["2025FA", grades(S6, { ISEC411: "A" })],
      ["2026SP", S7],
    ],
    registered: ["ITBP481", "CSBP320", "BANA200"],
    graduation: "2027-05-14",
  },
];


/* Fall 2026 sections for every registered course. */
const registeredCodes = [...new Set(students.flatMap((s) => s.registered))];
must(
  await db.from("course_sections").upsert(
    registeredCodes.map((code, i) => ({
      course_id: courseId[code],
      academic_term_id: terms["2026FA"],
      section_number: "01",
      instructor_name: ["Dr. Khalid Al Ameri", "Dr. Noura Al Shamsi", "Dr. Salem Al Hosani", "Dr. Reem Al Zaabi", "Dr. Yousef Al Blooshi"][i % 5],
      capacity: 40,
      enrolled_count: 20 + (i % 10),
      meeting_schedule: i % 2 === 0 ? "Sun/Tue 10:00-11:15" : "Mon/Wed 12:30-13:45",
      room: `F1-${200 + i}`,
      status: "open",
    })),
    { onConflict: "course_id,academic_term_id,section_number" },
  ),
);
const sections = Object.fromEntries(
  must(await db.from("course_sections").select("id, course_id").eq("academic_term_id", terms["2026FA"])).map((s) => [s.course_id, s.id]),
);

const report = [];
for (const s of students) {
  let userId;
  const created = await db.auth.admin.createUser({
    email: s.email,
    password: s.password,
    email_confirm: true,
    user_metadata: { full_name: s.nameEn },
  });
  if (created.error) {
    const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
    const existing = data?.users.find((u) => u.email?.toLowerCase() === s.email);
    if (!existing) throw created.error;
    userId = existing.id;
    await db.auth.admin.updateUserById(userId, { password: s.password, email_confirm: true });
  } else {
    userId = created.data.user.id;
  }

  must(await db.from("profiles").upsert({ id: userId, email: s.email, full_name: s.nameEn, preferred_language: "en" }));
  must(await db.from("user_roles").upsert({ user_id: userId, role: "student" }, { onConflict: "user_id,role" }));

  // Course history
  must(await db.from("student_course_history").delete().eq("student_id", userId));
  const rows = [];
  for (const [termCode, list] of s.history) {
    for (const [code, grade] of list) {
      const ch = catalogue.courses.find((c) => c.code === code)?.credit_hours ?? 3;
      rows.push({
        student_id: userId,
        course_id: courseId[code],
        academic_term_id: terms[termCode],
        grade,
        grade_points: GRADE_POINTS[grade],
        credits_attempted: ch,
        credits_earned: ch,
        completion_status: "completed",
      });
    }
  }
  must(await db.from("student_course_history").insert(rows));

  // Current enrolments
  must(await db.from("student_current_enrollments").delete().eq("student_id", userId));
  must(
    await db.from("student_current_enrollments").insert(
      s.registered.map((code) => ({
        student_id: userId,
        course_section_id: sections[courseId[code]],
        enrollment_status: "registered",
        registration_date: new Date("2026-08-10T08:00:00Z").toISOString(),
      })),
    ),
  );

  const completed = rows.reduce((t, r) => t + r.credits_earned, 0);
  const registered = s.registered.reduce((t, c) => t + (catalogue.courses.find((x) => x.code === c)?.credit_hours ?? 3), 0);
  const gpa =
    Math.round((rows.reduce((t, r) => t + r.grade_points * r.credits_attempted, 0) / rows.reduce((t, r) => t + r.credits_attempted, 0)) * 100) / 100;

  must(
    await db.from("student_profiles").upsert(
      {
        user_id: userId,
        student_number: s.studentNumber,
        college: "College of Computing and Artificial Intelligence",
        program: "BSc Data Science and Artificial Intelligence",
        college_id: college.id,
        department_id: department.id,
        program_id: program.id,
        admission_term_id: terms[s.admission],
        current_academic_term_id: terms["2026FA"],
        academic_level: s.level,
        year_of_study: Number(s.level.replace(/\D/g, "")) || 1,
        completed_credit_hours: completed,
        registered_credit_hours: registered,
        cumulative_gpa: gpa,
        academic_standing: "Good Standing",
        account_status: "active",
        expected_graduation_date: s.graduation,
        preferred_language: "en",
        is_demo_record: false,
      },
      { onConflict: "user_id" },
    ),
  );

  report.push({ student: s.studentNumber, userId, completed, registered, remaining: 120 - completed - registered, gpa, progress: `${Math.round((completed / 120) * 1000) / 10}%` });
}

console.log("Programme courses:", programRows.length, "| catalogue courses:", catalogue.courses.length, "| prerequisites:", prereqRows.length);
console.table(report);
