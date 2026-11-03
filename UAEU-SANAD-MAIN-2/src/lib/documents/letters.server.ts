/**
 * To Whom It May Concern / enrollment letter service. Server only.
 *
 * Sanadi verifies the student's record, renders the approved template into a
 * PDF, hashes it, stores it privately, registers an immutable issuance record
 * with a secure verification token, and writes the audit trail.
 */
import type { Db } from "../agent/tools.server";
import { runOnce } from "../quality/idempotency.server";
import type { LetterSection } from "./pdf.server";
import { currentRequestOrigin, verificationPath, verificationUrl } from "./verification-url";

export const DOCUMENT_TYPE = "to_whom_it_may_concern";
export const DOCUMENT_CODE = "TWIMC";
const BUCKET = "student-letters";

export type LetterLanguage = "en" | "ar" | "bilingual";
export type LetterPurpose =
  | "general"
  | "embassy_visa"
  | "bank"
  | "employer"
  | "scholarship"
  | "government"
  | "other";

export type LetterFields = {
  includeProgramme: boolean;
  includeCollege: boolean;
  includeTerm: boolean;
  includeExpectedGraduation: boolean;
};

export type PartialLetterFields = { [K in keyof LetterFields]?: boolean | undefined };

export const DEFAULT_FIELDS: LetterFields = {
  includeProgramme: true,
  includeCollege: true,
  includeTerm: true,
  includeExpectedGraduation: false,
};

export type LetterContext = {
  eligible: boolean;
  blockingReason: string | null;
  blockingReasonAr: string | null;
  studentName: string;
  studentNameAr: string | null;
  studentNumber: string | null;
  programmeEn: string | null;
  programmeAr: string | null;
  collegeEn: string | null;
  collegeAr: string | null;
  degreeLevel: string | null;
  enrollmentStatus: string;
  academicStanding: string | null;
  termEn: string | null;
  termAr: string | null;
  expectedGraduation: string | null;
  registeredCredits: number;
  campusEn: string | null;
  campusAr: string | null;
};

const PURPOSE_LABELS: Record<LetterPurpose, { en: string; ar: string }> = {
  general: { en: "General purposes", ar: "أغراض عامة" },
  embassy_visa: { en: "Embassy / visa application", ar: "سفارة / طلب تأشيرة" },
  bank: { en: "Banking purposes", ar: "أغراض مصرفية" },
  employer: { en: "Employer", ar: "جهة عمل" },
  scholarship: { en: "Scholarship or sponsorship", ar: "منحة أو جهة ابتعاث" },
  government: { en: "Government entity", ar: "جهة حكومية" },
  other: { en: "Other", ar: "أخرى" },
};

export function resolveFields(partial?: PartialLetterFields | undefined): LetterFields {
  const out: LetterFields = { ...DEFAULT_FIELDS };
  for (const key of Object.keys(DEFAULT_FIELDS) as (keyof LetterFields)[]) {
    const value = partial?.[key];
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

export const purposeLabel = (p: string, ar: boolean) =>
  (PURPOSE_LABELS[p as LetterPurpose] ?? PURPOSE_LABELS.general)[ar ? "ar" : "en"];

/* ------------------------------------------------------------------ */
/* Verified student record                                             */
/* ------------------------------------------------------------------ */

export async function loadLetterContext(db: Db, userId: string): Promise<LetterContext> {
  const [{ data: profile }, { data: sp }, { data: currentTerm }] = await Promise.all([
    db.from("profiles").select("full_name, email").eq("id", userId).maybeSingle(),
    db
      .from("student_profiles")
      .select(
        // The campus is joined here instead of a second dependent query.
        "student_number, account_status, academic_level, academic_standing, expected_graduation_date, registered_credit_hours, current_academic_term_id, academic_programs:program_id (name_en, name_ar, degree_level), colleges:college_id (name_en, name_ar, campus_id, campuses:campus_id (name_en, name_ar))",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    db.from("academic_terms").select("id, name_en, name_ar").eq("is_current", true).maybeSingle(),
  ]);

  const prog = (sp?.academic_programs ?? null) as
    | { name_en: string; name_ar: string; degree_level?: string | null }
    | null;
  const college = (sp?.colleges ?? null) as {
    name_en: string;
    name_ar: string;
    campus_id: string | null;
    campuses?: { name_en: string; name_ar: string } | null;
  } | null;

  let term = currentTerm as { id: string; name_en: string; name_ar: string } | null;
  if (sp?.current_academic_term_id && sp.current_academic_term_id !== term?.id) {
    const { data } = await db
      .from("academic_terms")
      .select("id, name_en, name_ar")
      .eq("id", sp.current_academic_term_id)
      .maybeSingle();
    if (data) term = data;
  }

  const campusEn: string | null = college?.campuses?.name_en ?? null;
  const campusAr: string | null = college?.campuses?.name_ar ?? null;

  const status = sp?.account_status ?? "unknown";
  let blockingReason: string | null = null;
  let blockingReasonAr: string | null = null;
  if (!sp) {
    blockingReason = "No academic record is linked to this account, so an enrollment letter cannot be issued.";
    blockingReasonAr = "لا يوجد سجل أكاديمي مرتبط بهذا الحساب، لذلك لا يمكن إصدار شهادة قيد.";
  } else if (status !== "active") {
    blockingReason = `Your enrollment status is recorded as "${status}", so a letter confirming active enrollment cannot be issued.`;
    blockingReasonAr = `حالة قيدك مسجلة كـ "${status}"، لذلك لا يمكن إصدار شهادة تفيد بأنك مقيد حالياً.`;
  } else if (!prog) {
    blockingReason =
      "Your academic programme is missing from the student record, so the letter cannot state your programme.";
    blockingReasonAr = "بيانات البرنامج الأكاديمي غير مكتملة في سجلك، لذلك لا يمكن إصدار الشهادة.";
  }

  return {
    eligible: blockingReason === null,
    blockingReason,
    blockingReasonAr,
    studentName: profile?.full_name ?? profile?.email ?? "UAEU student",
    studentNameAr: profile?.full_name ?? null,
    studentNumber: sp?.student_number ?? null,
    programmeEn: prog?.name_en ?? null,
    programmeAr: prog?.name_ar ?? null,
    collegeEn: college?.name_en ?? null,
    collegeAr: college?.name_ar ?? null,
    degreeLevel: prog?.degree_level ?? sp?.academic_level ?? null,
    enrollmentStatus: status,
    academicStanding: sp?.academic_standing ?? null,
    termEn: term?.name_en ?? null,
    termAr: term?.name_ar ?? null,
    expectedGraduation: sp?.expected_graduation_date ?? null,
    registeredCredits: sp?.registered_credit_hours ?? 0,
    campusEn,
    campusAr,
  };
}

/* ------------------------------------------------------------------ */
/* Template rendering                                                  */
/* ------------------------------------------------------------------ */

type TemplateRow = {
  id: string;
  language: string;
  version: number;
  title: string;
  header_text: string | null;
  body_template: string;
  footer_text: string | null;
  signatory_block: string | null;
  disclaimer: string | null;
  validity_days: number | null;
};

async function loadTemplate(db: Db, language: "en" | "ar"): Promise<TemplateRow> {
  const { data } = await db
    .from("document_templates")
    .select("id, language, version, title, header_text, body_template, footer_text, signatory_block, disclaimer, validity_days")
    .eq("document_type", DOCUMENT_TYPE)
    .eq("language", language)
    .eq("is_active", true)
    .eq("status", "approved")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) throw new Error("No approved template is configured for this document.");
  return data as TemplateRow;
}

const fmtDate = (iso: string, ar: boolean) =>
  new Intl.DateTimeFormat(ar ? "ar-AE" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    calendar: "gregory",
    numberingSystem: "latn",
  }).format(new Date(iso));

function fillTemplate(
  template: TemplateRow,
  ctx: LetterContext,
  fields: LetterFields,
  ar: boolean,
): string {
  const programme = ar ? (ctx.programmeAr ?? ctx.programmeEn) : ctx.programmeEn;
  const collegeName = ar ? (ctx.collegeAr ?? ctx.collegeEn) : ctx.collegeEn;
  const term = ar ? (ctx.termAr ?? ctx.termEn) : ctx.termEn;

  let body = template.body_template
    .replace(/\{\{student_name\}\}/g, ctx.studentName)
    .replace(/\{\{student_id\}\}/g, ctx.studentNumber ?? "—")
    .replace(/\{\{programme\}\}/g, fields.includeProgramme && programme ? programme : "")
    .replace(/\{\{college\}\}/g, fields.includeCollege && collegeName ? collegeName : "")
    .replace(
      /\{\{academic_term\}\}/g,
      fields.includeTerm && term ? term : ar ? "الفصل الدراسي الحالي" : "current academic term",
    );

  body = body
    .split("\n")
    .filter((line, i, all) => line.trim() !== "" || (all[i - 1]?.trim() ?? "") !== "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  const extras: string[] = [];
  if (fields.includeExpectedGraduation && ctx.expectedGraduation) {
    extras.push(
      ar
        ? `تاريخ التخرج المتوقع: ${fmtDate(ctx.expectedGraduation, true)} (تقديري وفق الخطة الدراسية الحالية).`
        : `Expected graduation date: ${fmtDate(ctx.expectedGraduation, false)} (estimated on the current study plan).`,
    );
  }
  if (extras.length) body += `\n\n${extras.join("\n")}`;
  return body.trim();
}

/* ------------------------------------------------------------------ */
/* Issuance                                                            */
/* ------------------------------------------------------------------ */

export type IssuedLetter = {
  id: string;
  referenceNumber: string;
  language: LetterLanguage;
  purpose: string;
  status: string;
  issuedAt: string;
  expiresAt: string | null;
  retentionExpiresAt: string | null;
  retentionDays: number;
  verifyUrl: string;
  /** Raw QR token; the public share link is always built from this. */
  verifyToken: string;
  documentHash: string;
  templateVersion: string;
  isDemoDocument: boolean;
  fileName: string;
};

export const DEFAULT_RETENTION_DAYS = 30;

/** Retention window is configuration, never a literal sprinkled through the code. */
export async function retentionDaysFor(db: Db, documentType = DOCUMENT_TYPE): Promise<number> {
  const { data } = await db
    .from("document_retention_policies")
    .select("retention_days")
    .eq("document_type", documentType)
    .maybeSingle();
  return data?.retention_days ?? DEFAULT_RETENTION_DAYS;
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}


export type IssueLetterInput = {
  db: Db;
  userId: string;
  language: LetterLanguage;
  purpose: LetterPurpose;
  fields?: PartialLetterFields | undefined;
  conversationId?: string | null;
  generatedBy?: "agent" | "student";
};

export async function issueEnrollmentLetter(
  input: IssueLetterInput,
): Promise<{ letter: IssuedLetter; replayed: boolean }> {
  const { db, userId } = input;
  const fields = resolveFields(input.fields);
  const ctx = await loadLetterContext(db, userId);
  if (!ctx.eligible) throw new Error(ctx.blockingReason ?? "This document cannot be issued.");

  const outcome = await runOnce<IssuedLetter>(
    db,
    {
      operationType: `document:${DOCUMENT_TYPE}`,
      userId,
      payload: { language: input.language, purpose: input.purpose, fields },
      entityType: "issued_document",
      windowMinutes: 5,
    },
    async () => {
      const letter = await generateAndStore({ ...input, fields }, ctx);
      return { entityId: letter.id, snapshot: letter };
    },
  );

  if (!outcome.snapshot) throw new Error("The document could not be generated.");
  return { letter: outcome.snapshot, replayed: outcome.replayed };
}

async function generateAndStore(
  input: IssueLetterInput & { fields: LetterFields },
  ctx: LetterContext,
): Promise<IssuedLetter> {
  const { db, userId, fields } = input;
  const languages: ("en" | "ar")[] = input.language === "bilingual" ? ["en", "ar"] : [input.language];
  const templates = await Promise.all(languages.map((l) => loadTemplate(db, l)));
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: reference, error: refError } = await supabaseAdmin.rpc("next_document_reference", {
    _doc_code: DOCUMENT_CODE,
  });
  if (refError || !reference) throw new Error("A document reference number could not be generated.");
  const referenceNumber = reference as string;

  const token = randomToken();
  // One canonical URL for the QR code, the printed link and My Documents.
  const verifyUrl = verificationUrl(token, await currentRequestOrigin());
  const issuedAt = new Date();
  const validityDays = templates[0]?.validity_days ?? null;
  const expiresAt = validityDays ? new Date(issuedAt.getTime() + validityDays * 86_400_000) : null;
  const retentionDays = await retentionDaysFor(db);
  const retentionExpiresAt = new Date(issuedAt.getTime() + retentionDays * 86_400_000);

  const sections: LetterSection[] = templates.map((template, index) => {
    const ar = template.language === "ar";
    const programme = ar ? (ctx.programmeAr ?? ctx.programmeEn) : ctx.programmeEn;
    const college = ar ? (ctx.collegeAr ?? ctx.collegeEn) : ctx.collegeEn;
    const term = ar ? (ctx.termAr ?? ctx.termEn) : ctx.termEn;
    const enrollment =
      ctx.enrollmentStatus === "active"
        ? ar
          ? "مقيد / منتظم"
          : "Active"
        : ctx.enrollmentStatus;

    const studentFacts = [
      { label: ar ? "اسم الطالب" : "Name", value: (ar ? (ctx.studentNameAr ?? ctx.studentName) : ctx.studentName) },
      { label: ar ? "الرقم الجامعي" : "Student number", value: ctx.studentNumber ?? "—" },
      ...(fields.includeCollege && college ? [{ label: ar ? "الكلية" : "College", value: college }] : []),
      ...(fields.includeProgramme && programme ? [{ label: ar ? "البرنامج" : "Programme", value: programme }] : []),
      { label: ar ? "حالة القيد" : "Enrollment status", value: enrollment },
      ...(fields.includeTerm && term ? [{ label: ar ? "الفصل الدراسي" : "Academic term", value: term }] : []),
    ];

    return {
      language: ar ? "ar" : "en",
      header: template.header_text ?? (ar ? "جامعة الإمارات العربية المتحدة" : "United Arab Emirates University"),
      subHeader: ar ? "شؤون الطلبة — خدمة سندي الرقمية" : "Student Affairs — issued through Sanadi",
      title: template.title,
      body: fillTemplate(template, ctx, fields, ar),
      footer: template.footer_text ?? "",
      signatory: template.signatory_block ?? "",
      disclaimer: template.disclaimer,
      issuedLabel: ar ? "تاريخ الإصدار" : "Issued on",
      issuedValue: fmtDate(issuedAt.toISOString(), ar),
      referenceLabel: ar ? "الرقم المرجعي للوثيقة" : "Document reference",
      referenceValue: referenceNumber,
      verifyLabel: ar ? "التحقق من الوثيقة" : "Document verification",
      verifyHint: ar
        ? "امسح رمز الاستجابة السريعة أو استخدم الرابط أدناه للتحقق من صحة الوثيقة وحالتها الحالية."
        : "Scan the QR code or use the link below to verify the authenticity and current status of this document.",
      verifyUrl,
      // Retention and "verifiable online" belong to Sanadi, not to the printed
      // certificate: the verification block already tells the recipient
      // everything they need, so nothing is repeated on the page.
      retentionNote: null,
      demoBadge: null,
      pageLabel: ar
        ? `صفحة ${index + 1} من ${templates.length}`
        : `Page ${index + 1} of ${templates.length}`,
      metaFacts: [
        { label: ar ? "الرقم المرجعي" : "Reference", value: referenceNumber },
        { label: ar ? "تاريخ الإصدار" : "Issue date", value: fmtDate(issuedAt.toISOString(), ar) },
      ],
      panelTitle: ar ? "بيانات الطالب المعتمدة" : "Student information",
      studentFacts,
      trustBadge: null,

    };
  });


  let pdfBytes: Uint8Array;
  try {
    const { renderLetterPdf } = await import("./pdf.server");
    // Recovery ladder for document_generation_failure: one silent retry before
    // the student is told anything, and never a half-written record.
    try {
      pdfBytes = await renderLetterPdf(sections);
    } catch (first) {
      if (first instanceof Error && first.message === "ARABIC_FONT_UNAVAILABLE") throw first;
      const { logException } = await import("@/lib/exceptions/handle.server");
      await logException("document_generation_failure", {
        userId,
        detail: String(first),
        recovered: false,
        recoveryAction: "retry_once",
      });
      pdfBytes = await renderLetterPdf(sections);
    }
  } catch (err) {
    await supabaseAdmin.from("document_events").insert({
      document_id: null,
      reference_number: referenceNumber,
      event_type: "generation_failed",
      actor_type: input.generatedBy ?? "agent",
      actor_id: userId,
      details: { error: err instanceof Error ? err.message : "unknown", language: input.language },
    });
    if (err instanceof Error && err.message === "ARABIC_FONT_UNAVAILABLE") {
      throw new Error(
        "The Arabic document typeface could not be loaded in this environment, so the Arabic letter was not issued. Please try the English letter.",
      );
    }
    const { exceptionMessage } = await import("@/lib/exceptions/catalogue");
    throw new Error(exceptionMessage("document_generation_failure", input.language === "ar" ? "ar" : "en"));
  }

  const documentHash = await sha256(pdfBytes);
  const fileName = `${referenceNumber}.pdf`;
  const filePath = `${userId}/${fileName}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(filePath, pdfBytes as unknown as ArrayBuffer, { contentType: "application/pdf", upsert: true });
  if (uploadError) {
    await supabaseAdmin.from("document_events").insert({
      reference_number: referenceNumber,
      event_type: "generation_failed",
      actor_type: input.generatedBy ?? "agent",
      actor_id: userId,
      details: { error: uploadError.message, stage: "storage" },
    });
    throw new Error("The document could not be stored. No document record was issued; you can safely retry.");
  }

  const snapshot = {
    studentName: ctx.studentName,
    studentNameAr: ctx.studentNameAr,
    studentNumber: ctx.studentNumber,
    programmeEn: ctx.programmeEn,
    programmeAr: ctx.programmeAr,
    collegeEn: ctx.collegeEn,
    collegeAr: ctx.collegeAr,
    termEn: ctx.termEn,
    termAr: ctx.termAr,
    enrollmentStatus: ctx.enrollmentStatus,
    degreeLevel: ctx.degreeLevel,
    expectedGraduation: fields.includeExpectedGraduation ? ctx.expectedGraduation : null,
  };

  const templateVersion = templates.map((t) => `${t.language}.v${t.version}`).join("+");

  const { data: row, error: insertError } = await supabaseAdmin
    .from("issued_documents")
    .insert({
      student_id: userId,
      document_type: DOCUMENT_TYPE,
      reference_number: referenceNumber,
      language: input.language,
      purpose: input.purpose,
      document_status: "valid",
      file_path: filePath,
      file_size_bytes: pdfBytes.byteLength,
      secure_verification_token: token,
      document_hash: documentHash,
      template_id: templates[0]?.id ?? null,
      template_version: templateVersion,
      included_fields: fields as never,
      snapshot: snapshot as never,
      generated_by_type: input.generatedBy ?? "agent",
      conversation_id: input.conversationId ?? null,
      issued_at: issuedAt.toISOString(),
      expires_at: expiresAt?.toISOString() ?? null,
      retention_expires_at: retentionExpiresAt.toISOString(),
      is_demo_document: false,
      digitally_signed: false,
    })
    .select("id")
    .single();

  if (insertError || !row) {
    await supabaseAdmin.storage.from(BUCKET).remove([filePath]);
    throw new Error("The document record could not be registered. You can safely retry.");
  }

  await Promise.all([
    supabaseAdmin.from("document_events").insert([
      {
        document_id: row.id,
        reference_number: referenceNumber,
        event_type: "generated",
        actor_type: input.generatedBy ?? "agent",
        actor_id: userId,
        details: {
          language: input.language,
          purpose: input.purpose,
          templateVersion,
          documentHash,
          fieldsUsed: Object.keys(snapshot),
          conversationId: input.conversationId ?? null,
        },
      },
      {
        document_id: row.id,
        reference_number: referenceNumber,
        event_type: "verification_token_created",
        actor_type: "system",
        actor_id: userId,
        details: { tokenLength: token.length },
      },
    ]),
    db.from("audit_logs").insert({
      actor_id: userId,
      action: "document.issued",
      entity_type: "issued_document",
      entity_id: row.id,
      metadata: {
        reference: referenceNumber,
        documentType: DOCUMENT_TYPE,
        language: input.language,
        templateVersion,
        documentHash,
      },
    }),
  ]);

  // The student must be able to find the letter later without re-asking.
  {
    const { emitNotification } = await import("../ops/notify.server");
    await emitNotification({
      eventType: "document_ready",
      entityType: "issued_document",
      entityId: row.id,
      recipientId: userId,
      language: input.language === "ar" ? "ar" : "en",
      vars: { reference: referenceNumber },
      actionUrl: "/documents",
      dedupeKey: `document:${row.id}`,
    });
  }


  return {
    id: row.id,
    referenceNumber,
    language: input.language,
    purpose: input.purpose,
    status: "valid",
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt?.toISOString() ?? null,
    retentionExpiresAt: retentionExpiresAt.toISOString(),
    retentionDays,
    verifyUrl,
    verifyToken: token,
    documentHash,
    templateVersion,
    isDemoDocument: false,
    fileName,
  };
}

/* ------------------------------------------------------------------ */
/* Reading and downloading                                             */
/* ------------------------------------------------------------------ */

export type DocumentLifecycle = "valid" | "revoked" | "deleted_by_student" | "expired";

export type DocumentListItem = {
  id: string;
  referenceNumber: string;
  documentType: string;
  titleEn: string;
  titleAr: string;
  language: string;
  purpose: string;
  status: DocumentLifecycle;
  issuedAt: string;
  expiresAt: string | null;
  availableUntil: string | null;
  daysRemaining: number | null;
  downloadable: boolean;
  deletable: boolean;
  verifyPath: string | null;
  isDemoDocument: boolean;
};

export async function listMyDocuments(
  db: Db,
  userId: string,
  opts: { search?: string | null; page?: number; pageSize?: number } = {},
): Promise<{ items: DocumentListItem[]; total: number }> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const pageSize = Math.min(50, Math.max(5, Math.floor(opts.pageSize ?? 10)));
  const from = (page - 1) * pageSize;

  let query = db
    .from("issued_documents")
    .select(
      "id, reference_number, document_type, title_en, title_ar, language, purpose, document_status, issued_at, expires_at, retention_expires_at, deleted_at, file_path, secure_verification_token, is_demo_document",
      { count: "exact" },
    )
    .eq("student_id", userId)
    .eq("document_status", "valid")
    .is("deleted_at", null);

  // Reference numbers and titles are what students actually search by.
  const term = (opts.search ?? "").trim().replace(/[%_,]/g, " ").slice(0, 60);
  if (term) {
    const like = `%${term}%`;
    query = query.or(
      `reference_number.ilike.${like},title_en.ilike.${like},title_ar.ilike.${like}`,
    );
  }

  const { data, count } = await query
    .order("issued_at", { ascending: false })
    .range(from, from + pageSize - 1);

  const now = Date.now();
  const items = (data ?? []).map((d) => {
      const retention = d.retention_expires_at ? new Date(d.retention_expires_at) : null;
      const live = !!retention && retention.getTime() > now;
      return {
        id: d.id,
        referenceNumber: d.reference_number,
        documentType: d.document_type,
        titleEn: d.title_en,
        titleAr: d.title_ar,
        language: d.language,
        purpose: d.purpose,
        // The lifecycle is Created → Active → Permanently deleted: nothing lingers.
        status: "valid" as DocumentLifecycle,
        issuedAt: d.issued_at,
        expiresAt: d.expires_at,
        availableUntil: d.retention_expires_at,
        daysRemaining: retention && live ? Math.max(0, Math.ceil((retention.getTime() - now) / 86_400_000)) : 0,
        downloadable: live && !!d.file_path,
        deletable: true,
        // Browser navigation must stay on the host currently serving Sanadi.
        // An absolute localhost URL would open the user's own machine.
        verifyPath: live && d.secure_verification_token ? verificationPath(d.secure_verification_token) : null,
        isDemoDocument: d.is_demo_document,
      };
    });

  return { items, total: count ?? items.length };
}

/**
 * Student-initiated PERMANENT deletion of a letter.
 *
 * The database function verifies ownership under the caller's own identity, writes
 * the minimal deletion audit record and removes the document row (which drops the
 * verification token with it). The stored PDF is then deleted from storage, so no
 * downloadable or verifiable copy survives.
 */
export async function deleteMyDocument(db: Db, userId: string, documentId: string): Promise<{ reference: string }> {
  const { data, error } = await db.rpc("purge_my_issued_document", { _document_id: documentId });
  if (error) throw new Error("This document is not available.");

  const result = (data ?? {}) as { reference?: string; filePath?: string | null };
  if (result.filePath) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.storage.from(BUCKET).remove([result.filePath]);
  }
  void userId;
  return { reference: result.reference ?? "" };
}


/** Signed, short-lived download link. The caller must own the document. */
export async function createDownloadUrl(
  db: Db,
  userId: string,
  documentId: string,
  /** "view" opens the PDF inline; "download" saves it under its reference. */
  mode: "view" | "download" = "download",
): Promise<{ url: string; fileName: string }> {
  const { data: doc } = await db
    .from("issued_documents")
    .select("id, student_id, file_path, reference_number, document_status, deleted_at, retention_expires_at")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc || doc.student_id !== userId || !doc.file_path || doc.deleted_at) {
    throw new Error("This document is no longer available for download.");
  }
  if (doc.document_status === "revoked") throw new Error("This document has been revoked.");
  if (doc.retention_expires_at && new Date(doc.retention_expires_at) < new Date()) {
    throw new Error("This document has passed its availability period and can no longer be downloaded.");
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // The stored file is the issued artefact: it is served as-is, never regenerated.
  const { data: signed, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(
    doc.file_path,
    300,
    mode === "download" ? { download: `${doc.reference_number}.pdf` } : {},
  );
  if (error || !signed?.signedUrl) throw new Error("The download link could not be created.");

  await Promise.all([
    supabaseAdmin
      .from("issued_documents")
      .update({ download_count: (await currentDownloads(db, documentId)) + 1 })
      .eq("id", documentId),
    supabaseAdmin.from("document_events").insert({
      document_id: documentId,
      reference_number: doc.reference_number,
      event_type: "downloaded",
      actor_type: "student",
      actor_id: userId,
      details: {},
    }),
  ]);

  return { url: signed.signedUrl, fileName: `${doc.reference_number}.pdf` };
}

async function currentDownloads(db: Db, documentId: string): Promise<number> {
  const { data } = await db.from("issued_documents").select("download_count").eq("id", documentId).maybeSingle();
  return data?.download_count ?? 0;
}
