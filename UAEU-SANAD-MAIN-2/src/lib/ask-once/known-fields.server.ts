/**
 * "Ask once" registry. Server only.
 *
 * Everything Sanadi is already authorised to know about the signed-in student,
 * with the source it came from and when it was last verified. The assistant
 * receives this as context so it never asks a student for a value the
 * university already holds, and the provenance is recorded internally so any
 * reused value can be traced back to its source.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Lang } from "../agent-types";
import type { Db } from "../agent/tools.server";
import { OPEN_STATUSES } from "../lists/case-status";
import { loadStudentSnapshot } from "../student-context.server";

export type KnownField = {
  key: string;
  labelEn: string;
  labelAr: string;
  value: string;
  /** Authorised origin of the value. */
  source: string;
  verifiedAt: string;
};

function push(
  out: KnownField[],
  key: string,
  labelEn: string,
  labelAr: string,
  value: unknown,
  source: string,
  verifiedAt: string,
) {
  if (value === null || value === undefined || value === "") return;
  out.push({ key, labelEn, labelAr, value: String(value), source, verifiedAt });
}

export async function collectKnownFields(db: Db, userId: string): Promise<KnownField[]> {
  const now = new Date().toISOString();
  const fields: KnownField[] = [];

  const [snapshot, profileRes, cvRes, casesRes, docsRes] = await Promise.all([
    loadStudentSnapshot(db, userId).catch(() => null),
    db.from("profiles").select("full_name, email, phone, preferred_language, updated_at").eq("id", userId).maybeSingle(),
    db
      .from("student_cv_documents")
      .select("file_name, uploaded_at, created_at")
      .eq("student_id", userId)
      .eq("is_current", true)
      .is("deleted_at", null)
      .maybeSingle()
      .then((r) => r, () => ({ data: null })),
    db
      .from("cases")
      .select("case_number, title, status, updated_at")
      .eq("student_id", userId)
      .in("status", OPEN_STATUSES as never[])
      .order("last_activity_at", { ascending: false, nullsFirst: false })
      .limit(3),
    db
      .from("issued_documents")
      .select("reference_number, document_type, issued_at")
      .eq("student_id", userId)
      .order("issued_at", { ascending: false })
      .limit(2)
      .then((r) => r, () => ({ data: null })),
  ]);

  const profile = profileRes.data as
    | { full_name: string | null; email: string | null; phone: string | null; preferred_language: string | null; updated_at: string | null }
    | null;
  if (profile) {
    const at = profile.updated_at ?? now;
    push(fields, "full_name", "Full name", "الاسم الكامل", profile.full_name, "authenticated profile", at);
    push(fields, "email", "University email", "البريد الجامعي", profile.email, "authenticated profile", at);
    push(fields, "phone", "Phone", "الهاتف", profile.phone, "authenticated profile", at);
    push(fields, "preferred_language", "Preferred language", "اللغة المفضلة", profile.preferred_language, "authenticated profile", at);
  }

  if (snapshot?.hasProfile) {
    push(fields, "student_number", "Student number", "الرقم الجامعي", snapshot.studentNumber, "academic record", now);
    push(fields, "programme", "Programme", "البرنامج", snapshot.programNameEn, "academic record", now);
    push(fields, "college", "College", "الكلية", snapshot.collegeNameEn, "academic record", now);
    push(fields, "academic_level", "Academic level", "المستوى الدراسي", snapshot.level, "academic record", now);
    push(fields, "gpa", "Cumulative GPA", "المعدل التراكمي", snapshot.gpa, "academic record", now);
    push(fields, "completed_credits", "Completed credit hours", "الساعات المكتملة", snapshot.completedCredits, "academic record", now);
    push(fields, "registered_credits", "Registered credit hours", "الساعات المسجلة", snapshot.registeredCredits, "academic record", now);
    push(fields, "enrollment_status", "Enrolment status", "حالة القيد", snapshot.enrollmentStatus, "academic record", now);
    push(fields, "current_term", "Current term", "الفصل الحالي", snapshot.currentTermEn, "academic record", now);
    push(fields, "expected_graduation", "Expected graduation", "التخرج المتوقع", snapshot.expectedGraduation, "academic record", now);
  }

  const cv = (cvRes as { data: { file_name: string | null; uploaded_at: string | null; created_at: string | null } | null }).data;
  if (cv) {
    push(fields, "cv", "CV on file", "السيرة الذاتية المحفوظة", cv.file_name ?? "uploaded CV", "current CV", cv.uploaded_at ?? cv.created_at ?? now);
  }

  for (const c of (casesRes.data ?? []) as { case_number: string; title: string; status: string; updated_at: string | null }[]) {
    push(fields, `case_${c.case_number}`, "Open request", "طلب مفتوح", `${c.case_number} — ${c.title} (${c.status})`, "existing request data", c.updated_at ?? now);
  }

  const docs = (docsRes as { data: { reference_number: string; document_type: string; issued_at: string }[] | null }).data;
  for (const d of docs ?? []) {
    push(fields, `document_${d.reference_number}`, "Issued document", "مستند صادر", `${d.document_type} — ${d.reference_number}`, "previously issued document", d.issued_at);
  }

  return fields;
}

/** Records where each reused value came from and when it was last verified. */
export async function recordFieldProvenance(userId: string, fields: KnownField[]): Promise<void> {
  if (!fields.length) return;
  try {
    await supabaseAdmin.from("student_field_provenance").upsert(
      fields.map((f) => ({
        student_id: userId,
        field_key: f.key,
        field_value: f.value.slice(0, 500),
        source: f.source,
        verified_at: f.verifiedAt,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "student_id,field_key" },
    );
  } catch {
    // Provenance is an internal record; it must never break a student turn.
  }
}

/** Prompt block: what is already known, so it is never asked for again. */
export function renderKnownFieldsBlock(fields: KnownField[], lang: Lang): string {
  if (!fields.length) return "";
  const lines = fields
    .slice(0, 24)
    .map((f) => `- ${lang === "ar" ? f.labelAr : f.labelEn}: ${f.value} (source: ${f.source})`)
    .join("\n");
  return `\n\nALREADY KNOWN — NEVER ASK FOR THESE\nThese values come from the student's authorised records and are verified. Use them silently; never ask the student to supply, confirm or repeat any of them, and never read the whole list back.\n${lines}\n`;
}

export async function buildAskOnceBlock(db: Db, userId: string, lang: Lang): Promise<string> {
  const fields = await collectKnownFields(db, userId).catch(() => [] as KnownField[]);
  if (!fields.length) return "";
  void recordFieldProvenance(userId, fields);
  return renderKnownFieldsBlock(fields, lang);
}
