/**
 * Course Textbook Agent: "Where can I get the textbook for my course?"
 *
 * The Course Textbook service is PROACTIVE: textbooks (or the available
 * digital learning material) are added to the corresponding Blackboard
 * course automatically. So the primary answer is never a catalogue dump:
 *
 *   - Course named ("Where is my textbook for STAT210?") → short proactive
 *     Blackboard answer for that course, nothing else.
 *   - Course not named → one concise clarification ("Which course do you
 *     mean?") plus the student's current registered courses as options.
 *     Ask Once: the student is authenticated, so the courses come from the
 *     enrollment record — the only open question is which one they mean.
 *   - Library catalogue is searched ONLY when the student explicitly asks
 *     for additional/alternative resources ("Find me another book for
 *     STAT210") — a separate LIBRARY_SEARCH intent handled elsewhere.
 *
 * No Blackboard URL is ever invented: a deep link is shown only when one
 * is actually available from a verified source.
 */
import type { Db } from "./tools.server";
import type { Citation, Lang, LibraryResultsCard } from "../agent-types";

/* ------------------------------------------------------------------ */
/* Intent                                                              */
/* ------------------------------------------------------------------ */

const TEXTBOOK_EN_RE =
  /\btext ?books?\b.*\b(course|class|subject|module|syllabus|my)\b|\b(course|class|subject)\b.*\btext ?books?\b|\btext ?books?\s+for\b|\bmy text ?books?\b|\brequired (text|reading|book|materials?)\b|\bcourse (materials?|readings?)\b|\bwhere (can|do) i (get|find|buy|order) (the |a |my )?(text ?book|course book)/i;
const TEXTBOOK_AR_RE =
  /كتاب المقرر|الكتاب المقرر|كتب المقرر|الكتب المقررة|كتاب المادة|كتب المواد|الكتاب الدراسي|الكتب الدراسية|مقرر.*كتاب|كتاب.*مقرر|أين أجد كتاب|وين كتاب/;

/** True when the student asks about the textbook of a course they take. */
export function detectTextbookIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return TEXTBOOK_EN_RE.test(t) || TEXTBOOK_AR_RE.test(t);
}

/* ------------------------------------------------------------------ */
/* Enrolled courses (authenticated context — Ask Once)                 */
/* ------------------------------------------------------------------ */

const MAX_COURSES = 5;

export type EnrolledCourse = { code: string; titleEn: string; titleAr: string };

export async function loadEnrolledCourses(db: Db, userId: string): Promise<EnrolledCourse[] | null> {
  const { data } = await db
    .from("student_current_enrollments")
    .select(
      "enrollment_status, course_sections:course_section_id (courses:course_id (code, title_en, title_ar))",
    )
    .eq("student_id", userId);
  if (!data) return null;
  const seen = new Set<string>();
  const courses: EnrolledCourse[] = [];
  for (const row of data as {
    enrollment_status: string | null;
    course_sections: { courses: { code: string; title_en: string; title_ar: string } | null } | null;
  }[]) {
    if (row.enrollment_status && ["dropped", "withdrawn"].includes(row.enrollment_status)) continue;
    const c = row.course_sections?.courses;
    if (!c || seen.has(c.code)) continue;
    seen.add(c.code);
    courses.push({ code: c.code, titleEn: c.title_en, titleAr: c.title_ar });
    if (courses.length >= MAX_COURSES) break;
  }
  return courses;
}

/* ------------------------------------------------------------------ */
/* Course resolution from the student's message                        */
/* ------------------------------------------------------------------ */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ء-ي]+/g, " ").trim();

/**
 * Matches the student's message against their enrolled courses: exact course
 * code first ("STAT210", "stat 210"), then title word overlap ("my AI
 * course", "probability course"). Returns null when nothing matches.
 */
export function resolveEnrolledCourse(
  text: string,
  courses: EnrolledCourse[],
): EnrolledCourse | null {
  const t = text.trim();
  if (!t) return null;
  const squashed = t.toUpperCase().replace(/\s+/g, "");
  for (const c of courses) {
    if (squashed.includes(c.code.toUpperCase())) return c;
  }
  const words = new Set(norm(t).split(" ").filter((w) => w.length > 2));
  // Short alias: "my AI course" should match "Responsible Artificial Intelligence".
  if (/\b(ai|a\.i\.)\b/i.test(t)) words.add("artificial");
  let best: { course: EnrolledCourse; score: number } | null = null;
  let tied = false;
  for (const c of courses) {
    const titleWords = [...new Set([...norm(c.titleEn).split(" "), ...norm(c.titleAr).split(" ")])].filter(
      (w) => w.length > 2,
    );
    const score = titleWords.filter((w) => words.has(w)).length;
    if (score > (best?.score ?? 0)) {
      best = { course: c, score };
      tied = false;
    } else if (best && score === best.score) {
      tied = true;
    }
  }
  // One shared word is enough when exactly one course matches; a tie or a
  // multi-course overlap needs at least two words to avoid guessing.
  if (!best || best.score === 0) return null;
  if (tied && best.score < 2) return null;
  return best.course;
}

/* ------------------------------------------------------------------ */
/* Proactive answers                                                   */
/* ------------------------------------------------------------------ */

export type TextbookResult = {
  answer: string;
  /** Courses offered as clarification options; null when one was resolved. */
  clarificationCourses: EnrolledCourse[] | null;
  /** The course the answer is about; null when clarifying. */
  course: EnrolledCourse | null;
  /** Awaiting a course selection from the student. */
  awaitingCourse: boolean;
};

/** Short proactive Blackboard answer for one named course. */
export function proactiveTextbookAnswer(course: EnrolledCourse, lang: Lang): string {
  const name = lang === "ar" ? course.titleAr || course.titleEn : course.titleEn;
  return lang === "ar"
    ? `**خبر سار — تم توفير كتاب المقرر أو المادة التعليمية الرقمية لك بشكل استباقي.**\n\nيمكنك الوصول إلى النسخة الرقمية المتاحة من خلال مقرر **${course.code} — ${name}** على Blackboard.\n\n**لا تحتاج إلى تقديم أي طلب منفصل.**`
    : `**Good news — your textbook is already taken care of.**\n\nThe textbook or available digital learning material for **${course.code} — ${name}** is proactively added to the corresponding Blackboard course.\n\nSimply open **${course.code} in Blackboard** to access the available soft copy or course material.\n\n**No separate request is needed.**`;
}

/**
 * Handles a course-textbook question:
 *  - course resolved from the message (or from a pending clarification turn)
 *    → proactive Blackboard answer;
 *  - otherwise → one concise clarification listing the student's current
 *    registered courses.
 * Returns null only when the enrollment record is unreadable (never guess).
 */
export async function buildCourseTextbookResult(
  db: Db,
  userId: string,
  lang: Lang,
  text: string,
): Promise<TextbookResult | null> {
  const courses = await loadEnrolledCourses(db, userId);
  if (courses === null) return null;

  const named = resolveEnrolledCourse(text, courses);
  if (named) {
    return {
      answer: proactiveTextbookAnswer(named, lang),
      clarificationCourses: null,
      course: named,
      awaitingCourse: false,
    };
  }

  if (!courses.length) {
    return {
      answer:
        lang === "ar"
          ? "**تم توفير كتب المقررات بشكل استباقي عبر Blackboard.**\n\nلكن لا أرى مقررات مسجلة لك حالياً في سجلك الأكاديمي، لذا لا أستطيع تحديد مقرر معين. إذا كنت مسجلاً حديثاً، يظهر مقررك على Blackboard فور اكتمال التسجيل.\n\n**لا حاجة إلى تقديم أي طلب.**"
          : "**Textbooks are proactively provided through Blackboard.**\n\nHowever, I don't see any courses registered on your record right now, so I can't point to a specific one. If you registered recently, your course appears on Blackboard as soon as registration completes.\n\n**No request is needed.**",
      clarificationCourses: null,
      course: null,
      awaitingCourse: false,
    };
  }

  const list = courses
    .map((c) => `- ${c.code} — ${lang === "ar" ? c.titleAr || c.titleEn : c.titleEn}`)
    .join("\n");
  return {
    answer:
      lang === "ar"
        ? `**بالتأكيد. أي مقرر تقصد؟**\n\nمقرراتك المسجلة حالياً:\n${list}`
        : `**Of course. Which course do you mean?**\n\nYour current courses:\n${list}`,
    clarificationCourses: courses,
    course: null,
    awaitingCourse: true,
  };
}

/* ------------------------------------------------------------------ */
/* Explicit catalogue follow-up ("find another book for STAT210")      */
/* ------------------------------------------------------------------ */

const RESULTS_PER_COURSE = 3;

function catalogueCitation(provider: string | null, lang: Lang): Citation {
  return {
    documentId: null,
    sourceTitle:
      lang === "ar"
        ? `فهرس المكتبة (${provider ?? "مكتبة الجامعة"})`
        : `Library catalogue (${provider ?? "UAEU Library"})`,
    owningUnit: lang === "ar" ? "خدمات المكتبة" : "Library Services",
    documentVersion: null,
    effectiveDate: new Date().toISOString().slice(0, 10),
    citationUrl: null,
    confidence: "high",
  };
}

const typeLabel = (t: string, ar: boolean) =>
  ar
    ? ({ book: "كتاب", ebook: "كتاب إلكتروني" } as Record<string, string>)[t] ?? t
    : ({ book: "Book", ebook: "E-book" } as Record<string, string>)[t] ?? t;

const availabilityLabel = (a: string, ar: boolean) =>
  ar
    ? ({ available: "متاح", on_loan: "معار", reference_only: "للاطلاع الداخلي", electronic: "متاح إلكترونياً", in_processing: "قيد المعالجة", unavailable: "غير متاح", unknown: "غير معروف" } as Record<string, string>)[a] ?? a
    : ({ available: "Available", on_loan: "Checked out", reference_only: "Reference only", electronic: "Online", in_processing: "In processing", unavailable: "Unavailable", unknown: "Unknown" } as Record<string, string>)[a] ?? a;

export type TextbookReport = {
  answer: string;
  card: LibraryResultsCard | null;
  citations: Citation[];
  coursesChecked: number;
  matchesFound: number;
  catalogueOk: boolean;
};

/**
 * Explicit-request catalogue check for one course — only invoked when the
 * student asks for additional resources beyond the proactive Blackboard
 * material. Never runs on a plain textbook question.
 */
export async function buildTextbookCatalogueReport(
  db: Db,
  userId: string,
  lang: Lang,
  text: string,
): Promise<TextbookReport | null> {
  const ar = lang === "ar";
  const courses = await loadEnrolledCourses(db, userId);
  if (courses === null) return null;
  const course = resolveEnrolledCourse(text, courses) ?? null;
  const targets = course ? [course] : courses.slice(0, 3);

  const { searchCatalogue } = await import("../library/provider.server");
  const searches = await Promise.all(
    targets.map(async (c) => {
      const res = await searchCatalogue({
        db,
        params: { title: c.titleEn, query: c.titleEn, limit: 6 },
        recordHealth: false,
      }).catch(() => null);
      return { course: c, res };
    }),
  );

  const catalogueOk = searches.some(
    (s) => s.res && (s.res.status === "ok" || s.res.status === "empty"),
  );
  const cardResults: LibraryResultsCard["results"] = [];
  let totalMatches = 0;
  let provider: string | null = null;
  const lines: string[] = [];

  for (const { course: c, res } of searches) {
    if (res?.provider) provider = res.provider;
    const hits =
      res && (res.status === "ok" || res.status === "empty")
        ? res.results.slice(0, RESULTS_PER_COURSE)
        : [];
    totalMatches += res?.total ?? 0;

    const courseName = ar ? c.titleAr || c.titleEn : c.titleEn;
    lines.push(`**${c.code} — ${courseName}**`);
    if (!res || (res.status !== "ok" && res.status !== "empty")) {
      lines.push(
        ar
          ? "تعذر الوصول إلى الفهرس لهذا المقرر الآن."
          : "The catalogue could not be checked for this course right now.",
      );
    } else if (!hits.length) {
      lines.push(
        ar
          ? "لا يوجد تطابق مباشر في فهرس المكتبة — أرسل لي عنوان الكتاب من المنهج وسأتحقق من توفره."
          : "No direct match in the library catalogue — send me the title from your syllabus and I'll check availability.",
      );
    } else {
      for (const h of hits) {
        const loc = h.holdings[0]
          ? [h.holdings[0].library, h.holdings[0].shelf, h.holdings[0].callNumber]
              .filter(Boolean)
              .join(" · ")
          : null;
        const bits = [
          availabilityLabel(h.availability, ar),
          loc,
          h.onlineUrl ? (ar ? "وصول إلكتروني" : "Online access") : null,
        ].filter(Boolean);
        lines.push(`• ${h.title} (${bits.join(" · ")})`);
        cardResults.push({
          id: h.id,
          title: h.title,
          authors: h.authors ?? [],
          year: h.year ?? null,
          type: h.type,
          typeLabel: typeLabel(h.type, ar),
          availability: h.availability,
          availabilityLabel: availabilityLabel(h.availability, ar),
          library: h.holdings[0]?.library ?? null,
          floor: h.holdings[0]?.floor ?? null,
          shelf: h.holdings[0]?.shelf ?? null,
          callNumber: h.holdings[0]?.callNumber ?? null,
          onlineUrl: h.onlineUrl ?? null,
          catalogueUrl: h.catalogueUrl ?? null,
          subjects: (h.subjects ?? []).slice(0, 4),
          courseCode: c.code,
        });
      }
    }
  }

  const header = ar
    ? "هذه نتائج إضافية من فهرس المكتبة لمقررك — تذكّر أن كتاب المقرر الأساسي متاح لك مسبقاً عبر Blackboard:"
    : "Here are additional library catalogue results for your course — remember your main textbook is already available to you on Blackboard:";

  return {
    answer: `${header}\n\n${lines.join("\n")}`,
    card: cardResults.length
      ? {
          query: ar ? "مراجع إضافية لمقرراتك" : "Additional resources for your courses",
          provider,
          totalMatches,
          retrievedAt: new Date().toISOString(),
          results: cardResults,
        }
      : null,
    citations: catalogueOk ? [catalogueCitation(provider, lang)] : [],
    coursesChecked: targets.length,
    matchesFound: cardResults.length,
    catalogueOk,
  };
}
