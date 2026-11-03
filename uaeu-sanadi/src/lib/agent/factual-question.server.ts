/**
 * Factual, general and future-looking questions.
 *
 * A question is not a service request. This module decides, deterministically,
 * whether the student is simply ASKING — and, when the answer depends on
 * university records that do not exist yet (a future term, a future teaching
 * assignment), says so plainly instead of letting the model invent a name, a
 * schedule or a policy.
 *
 * Nothing here decides eligibility or performs an action; it only chooses
 * between "answer from the authoritative record" and "state that it is not
 * available yet".
 */
import type { Db } from "./tools.server";

export type TeachingQuestion = {
  /** Course code written by the student, e.g. CSBP220. */
  courseCode: string | null;
  /** Free-text subject when no code was given, e.g. "machine learning". */
  subject: string | null;
  /** Calendar year named in the question, when there is one. */
  year: number | null;
  /** True when the wording points at a future assignment ("who will teach"). */
  future: boolean;
};

const TEACHING_RE =
  /(who\s+(?:will|is going to|would|shall)?\s*(?:be\s+)?(?:teach|teaches|teaching|deliver|lecture|instruct)|who\s+(?:is|'s)\s+(?:the\s+)?(?:instructor|lecturer|professor|teacher)|instructor\s+(?:for|of)|lecturer\s+(?:for|of)|من\s+(?:سيدرس|سيدرّس|يدرس|يدرّس|يُدرّس)|من\s+هو\s+(?:أستاذ|محاضر|مدرس))/i;

const COURSE_CODE_RE = /\b([A-Za-z]{2,5})\s?-?\s?(\d{3}[A-Za-z]?)\b/;
const YEAR_RE = /\b(20\d{2})\b/;

const FUTURE_WORDING_RE =
  /\b(will|going to|next (year|semester|term)|in the future|upcoming|future)\b|(سي|سوف|العام القادم|الفصل القادم|المستقبل)/i;

/** Questions about facts of the world, not about the university or the student. */
const GENERAL_KNOWLEDGE_RE =
  /^(?:\s*(?:hi|hello|please)?[,\s]*)?(?:(?:what|what'?s|define|explain|tell me about|how does|how do|why (?:is|are|does|do))\b|(?:ما هو|ما هي|ماذا يعني|اشرح|عرّف|عرف|كيف يعمل))/i;

const PERSONAL_OR_SERVICE_RE =
  /\b(my|me|i |i'?m|mine|register|registration|complain|complaint|suggest|book|appointment|letter|certificate|case|request|hold|gpa|transcript)\b|(طلبي|حالتي|شكوى|اقتراح|موعد|خطاب|شهادة|معدلي|تسجيلي)/i;

/**
 * True for a definitional / world-knowledge question ("what is machine
 * learning?") that mentions nothing personal or transactional. Such a turn must
 * be answered as a question — never turned into a case, a career analysis or a
 * service card.
 */
export function isGeneralKnowledgeQuestion(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t || t.length > 200) return false;
  if (!GENERAL_KNOWLEDGE_RE.test(t)) return false;
  if (PERSONAL_OR_SERVICE_RE.test(t)) return false;
  return true;
}

/** Detects a "who teaches …" question and the course/subject/year in it. */
export function detectTeachingQuestion(text: string): TeachingQuestion | null {
  const t = (text ?? "").trim();
  if (!t || !TEACHING_RE.test(t)) return null;
  const codeMatch = t.match(COURSE_CODE_RE);
  const yearMatch = t.match(YEAR_RE);
  const courseCode = codeMatch ? `${(codeMatch[1] ?? "").toUpperCase()}${(codeMatch[2] ?? "").toUpperCase()}` : null;
  const subject = courseCode
    ? null
    : (t
        .replace(TEACHING_RE, " ")
        .replace(YEAR_RE, " ")
        .replace(/\b(in|the|a|an|at|for|on|uaeu|university|course|class|module|next|semester|term|year|will|who|is|are|be|teaching|\?|،|؟)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60) || null);
  return {
    courseCode,
    subject,
    year: yearMatch?.[1] ? Number(yearMatch[1]) : null,
    future: FUTURE_WORDING_RE.test(t),
  };
}

type TermRow = { name_en: string; name_ar: string | null; start_date: string; is_current: boolean };

async function loadTerms(db: Db): Promise<TermRow[]> {
  const { data } = await db
    .from("academic_terms")
    .select("name_en, name_ar, start_date, is_current")
    .order("start_date", { ascending: false })
    .limit(30);
  return (data ?? []) as TermRow[];
}

export type FactualAnswer = { answer: string; verified: boolean; sourceTitle: { en: string; ar: string } };

/**
 * Answers a teaching question from the authoritative course/section record, or
 * states clearly that the assignment does not exist yet. Never invents a name.
 */
export async function answerTeachingQuestion(
  db: Db,
  lang: "en" | "ar",
  q: TeachingQuestion,
): Promise<FactualAnswer | null> {
  const ar = lang === "ar";
  const terms = await loadTerms(db).catch(() => [] as TermRow[]);
  const latest = terms[0];
  if (!latest) return null;
  const latestYear = Number(latest.start_date.slice(0, 4));
  const current = terms.find((t) => t.is_current) ?? latest;
  const currentName = ar ? (current.name_ar ?? current.name_en) : current.name_en;

  // 1. A year beyond anything the university has published: not available yet.
  if (q.year && q.year > latestYear) {
    const subject = q.courseCode ?? q.subject ?? null;
    return {
      verified: true,
      sourceTitle: {
        en: "UAEU academic calendar and published course sections",
        ar: "التقويم الأكاديمي وشُعب المقررات المعتمدة في جامعة الإمارات",
      },
      answer: ar
        ? [
            `لا تتوفر بعد بيانات التدريس لعام ${q.year}.`,
            "يتم تأكيد إسناد أعضاء هيئة التدريس عادةً قبل بداية الفصل الدراسي المعني، ولا يمكنني ذكر اسم غير مسجل رسمياً.",
            `أحدث فصل منشور لدينا هو ${currentName}.`,
            subject
              ? `إذا كنت تقصد مقرراً محدداً${q.courseCode ? ` مثل ${q.courseCode}` : ""}، أرسل لي رمز المقرر وسأتحقق من المعلومات المتاحة حالياً.`
              : "إذا كنت تقصد مقرراً جامعياً محدداً، أرسل لي رمز المقرر وسأتحقق من المعلومات المتاحة حالياً.",
          ].join("\n\n")
        : [
            `Teaching assignments for ${q.year} are not available yet.`,
            "Faculty assignments are normally confirmed closer to the relevant semester, and I will not name an instructor that is not on record.",
            `The most recent published term on record is ${currentName}.`,
            subject
              ? `If you mean a specific UAEU course${q.courseCode ? ` such as ${q.courseCode}` : ""}, send me the course code and I can check whether any current information is available.`
              : "If you mean a specific UAEU course, send me the course code and I can check whether any current information is available.",
          ].join("\n\n"),
    };
  }

  // 2. A named course: answer from the published sections of the current term.
  if (q.courseCode) {
    const { data: course } = await db
      .from("courses")
      .select("id, code, title_en, title_ar")
      .eq("code", q.courseCode)
      .maybeSingle();
    if (!course) {
      return {
        verified: true,
        sourceTitle: {
          en: "UAEU course catalogue",
          ar: "دليل المقررات في جامعة الإمارات",
        },
        answer: ar
          ? `لا يوجد مقرر بالرمز ${q.courseCode} في دليل المقررات المتاح لي. تأكد من الرمز أو أرسل اسم المقرر وسأبحث عنه.`
          : `I could not find a course with the code ${q.courseCode} in the catalogue available to me. Check the code, or send the course title and I will look it up.`,
      };
    }
    const { data: sections } = await db
      .from("course_sections")
      .select("section_number, instructor_name, meeting_schedule, room, academic_terms:academic_term_id (name_en, name_ar, is_current)")
      .eq("course_id", course.id)
      .limit(20);
    const rows = (sections ?? []) as Array<{
      section_number: string;
      instructor_name: string | null;
      meeting_schedule: string | null;
      room: string | null;
      academic_terms: { name_en: string; name_ar: string | null; is_current: boolean } | null;
    }>;
    const currentRows = rows.filter((r) => r.academic_terms?.is_current && r.instructor_name);
    const title = ar ? (course.title_ar ?? course.title_en) : course.title_en;
    if (!currentRows.length) {
      return {
        verified: true,
        sourceTitle: {
          en: "UAEU published course sections",
          ar: "شُعب المقررات المعتمدة في جامعة الإمارات",
        },
        answer: ar
          ? `لا توجد شعبة منشورة للمقرر ${course.code} (${title}) في ${currentName}، لذلك لا يوجد أستاذ مسجل لها. سيظهر اسم المدرّس بمجرد نشر الشعب لهذا الفصل.`
          : `No section of ${course.code} (${title}) is published for ${currentName}, so no instructor is on record. The teaching staff appear once sections for the term are published.`,
      };
    }
    const lines = currentRows.map((r) =>
      ar
        ? `- شعبة ${r.section_number}: ${r.instructor_name}${r.meeting_schedule ? ` · ${r.meeting_schedule}` : ""}${r.room ? ` · ${r.room}` : ""}`
        : `- Section ${r.section_number}: ${r.instructor_name}${r.meeting_schedule ? ` · ${r.meeting_schedule}` : ""}${r.room ? ` · ${r.room}` : ""}`,
    );
    return {
      verified: true,
      sourceTitle: {
        en: "UAEU published course sections",
        ar: "شُعب المقررات المعتمدة في جامعة الإمارات",
      },
      answer: ar
        ? [`${course.code} — ${title} · ${currentName}`, ...lines].join("\n")
        : [`${course.code} — ${title} · ${currentName}`, ...lines].join("\n"),
    };
  }

  // 3. A subject with no code and no year: say what is known, ask once.
  if (q.subject) {
    return {
      verified: true,
      sourceTitle: {
        en: "UAEU published course sections",
        ar: "شُعب المقررات المعتمدة في جامعة الإمارات",
      },
      answer: ar
        ? `أستطيع التحقق من أستاذ أي مقرر منشور في ${currentName}، لكن لا يمكنني تخمين مدرّس مقرر غير محدد.\n\nإذا كنت تقصد مقرراً جامعياً محدداً، أرسل لي رمز المقرر (مثل CSBP220) وسأخبرك بالمسجل رسمياً.`
        : `I can check the instructor of any course published for ${currentName}, but I will not guess a teacher for an unnamed course.\n\nIf you mean a specific UAEU course, send me the course code (for example CSBP220) and I will tell you who is officially on record.`,
    };
  }
  return null;
}
