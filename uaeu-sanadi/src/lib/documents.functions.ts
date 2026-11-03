import { checked } from "@/lib/exceptions/handle.server";
import { auditInsert } from "@/lib/exceptions/handle.server";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const FieldsSchema = z.object({
  includeProgramme: z.boolean().optional(),
  includeCollege: z.boolean().optional(),
  includeTerm: z.boolean().optional(),
  includeExpectedGraduation: z.boolean().optional(),
});

const IssueSchema = z.object({
  // "bilingual" issues one English page and one Arabic page under a single
  // reference number and verification record.
  language: z.enum(["en", "ar", "bilingual"]).default("en"),

  purpose: z
    .enum(["general", "embassy_visa", "bank", "employer", "scholarship", "government", "other"])
    .default("general"),
  fields: FieldsSchema.optional(),
  conversationId: z.string().uuid().nullable().optional(),
});

/** Verified record preview plus the student's previously issued documents. */
export const getMyDocumentState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        search: z.string().max(60).optional(),
        page: z.number().int().min(1).max(1000).catch(1),
        pageSize: z.number().int().min(5).max(50).catch(10),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { loadLetterContext, listMyDocuments } = await import("./documents/letters.server");
    const { supabase, userId } = context;
    const [letterContext, page] = await Promise.all([
      loadLetterContext(supabase, userId),
      listMyDocuments(supabase, userId, {
        search: data.search ?? null,
        page: data.page,
        pageSize: data.pageSize,
      }),
    ]);
    return {
      letterContext,
      documents: page.items,
      total: page.total,
      page: data.page,
      pageSize: data.pageSize,
      pageCount: Math.max(1, Math.ceil(page.total / data.pageSize)),
    };
  });

/** Issues the To Whom It May Concern letter for the signed-in student. */
export const issueMyEnrollmentLetter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IssueSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { issueEnrollmentLetter } = await import("./documents/letters.server");
    const { supabase, userId } = context;
    return issueEnrollmentLetter({
      db: supabase,
      userId,
      language: data.language,
      purpose: data.purpose,
      fields: data.fields,
      conversationId: data.conversationId ?? null,
      generatedBy: "student",
    });
  });

/** Short-lived signed download link for a document the student owns. */
export const getDocumentDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        documentId: z.string().uuid(),
        mode: z.enum(["view", "download"]).default("download"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { createDownloadUrl } = await import("./documents/letters.server");
    return createDownloadUrl(context.supabase, context.userId, data.documentId, data.mode);
  });

/** Student withdrawal of their own document: soft-delete plus verification revocation. */
export const deleteMyDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ documentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { deleteMyDocument: remove } = await import("./documents/letters.server");
    return remove(context.supabase, context.userId, data.documentId);
  });

/** Retention configuration, readable by staff and editable by administrators. */
export const getDocumentRetentionPolicies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("document_retention_policies")
      .select("document_type, retention_days, label_en, label_ar")
      .order("document_type");
    return data ?? [];
  });

export const updateDocumentRetentionPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ documentType: z.string().min(2).max(64), retentionDays: z.number().int().min(1).max(365) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "system_admin" });
    if (!isAdmin) throw new Error("Only administrators can change document retention.");

    const { error } = await supabase
      .from("document_retention_policies")
      .update({ retention_days: data.retentionDays })
      .eq("document_type", data.documentType);
    if (error) throw new Error("The retention policy could not be updated.");

    await auditInsert(supabase, {
      actor_id: userId,
      action: "document.retention_updated",
      entity_type: "document_retention_policy",
      entity_id: null,
      metadata: { documentType: data.documentType, retentionDays: data.retentionDays },
    });
    return { ok: true };
  });

export type DocumentVerification = {
  found: boolean;
  /** valid · withdrawn (revoked or deleted by the student) · expired */
  status?: string | null;
  reference?: string | null;
  documentType?: string | null;
  titleEn?: string | null;
  titleAr?: string | null;
  language?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  studentName?: string | null;
  studentNameAr?: string | null;
  programme?: string | null;
  programmeAr?: string | null;
  college?: string | null;
  collegeAr?: string | null;
  isDemoDocument?: boolean | null;
  documentHash?: string | null;
  digitallySigned?: boolean | null;
  rateLimited?: boolean | null;
};

/**
 * Public, read-only authenticity check used by the QR verification page.
 * The database function rate limits per caller, logs every attempt and burns a
 * token permanently once its document is withdrawn or expired.
 */
export const verifyDocumentToken = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ token: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/) }).parse(input),
  )
  .handler(async ({ data }): Promise<DocumentVerification> => {
    const { getRequest } = await import("@tanstack/react-start/server");

    const req = getRequest();
    const ip =
      req.headers.get("cf-connecting-ip") ??
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${ip}|${req.headers.get("user-agent") ?? ""}`),
    );
    const clientHash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 40);

    // The verification RPC is not callable by anon/authenticated roles; it is
    // reached only through this rate-limited server endpoint.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc("verify_student_document", {
      _token: data.token,
      _client_hash: clientHash,
    });
    if (error || !result) return { found: false };
    return result as DocumentVerification;
  });




/** Administrator oversight of automated document issuance. */
export const getDocumentAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "system_admin" });
    const { data: isAuditor } = await supabase.rpc("has_role", { _user_id: userId, _role: "auditor" });
    if (!isAdmin && !isAuditor) throw new Error("Not authorised to view document issuance.");

    const [{ data: docs }, { data: events }] = await Promise.all([
      supabase
        .from("issued_documents")
        .select(
          "id, reference_number, document_type, language, purpose, document_status, template_version, issued_at, expires_at, download_count, verification_count, is_demo_document, digitally_signed",
        )
        .order("issued_at", { ascending: false })
        .limit(200),
      supabase
        .from("document_events")
        .select("id, reference_number, event_type, actor_type, created_at, details")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    const list = docs ?? [];
    return {
      documents: list,
      events: events ?? [],
      totals: {
        issued: list.length,
        valid: list.filter((d) => d.document_status === "valid").length,
        revoked: list.filter((d) => d.document_status === "revoked").length,
        downloads: list.reduce((n, d) => n + (d.download_count ?? 0), 0),
        verifications: list.reduce((n, d) => n + (d.verification_count ?? 0), 0),
        failures: (events ?? []).filter((e) => e.event_type === "generation_failed").length,
      },
    };
  });

/** Administrator revocation. The audit history is preserved. */
export const revokeIssuedDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ documentId: z.string().uuid(), reason: z.string().min(5).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "system_admin" });
    if (!isAdmin) throw new Error("Only administrators can revoke an issued document.");

    const { data: row, error } = await supabase
      .from("issued_documents")
      .update({
        document_status: "revoked",
        revoked_at: new Date().toISOString(),
        revoked_by: userId,
        revocation_reason: data.reason,
      })
      .eq("id", data.documentId)
      .select("id, reference_number")
      .maybeSingle();
    if (error || !row) throw new Error("The document could not be revoked.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await checked(supabaseAdmin.from("document_events").insert({
      document_id: row.id,
      reference_number: row.reference_number,
      event_type: "revoked",
      actor_type: "human",
      actor_id: userId,
      details: { reason: data.reason },
    }), "document_generation", "document_events", false);
    return { ok: true, reference: row.reference_number };
  });

// ---------------------------------------------------------------------------
// Administrator template management (English and Arabic letter templates)
// ---------------------------------------------------------------------------

const TemplateDraftSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(2).max(200),
  headerText: z.string().max(2000).nullable().optional(),
  bodyTemplate: z.string().min(20).max(8000),
  footerText: z.string().max(2000).nullable().optional(),
  signatoryBlock: z.string().max(2000).nullable().optional(),
  disclaimer: z.string().max(2000).nullable().optional(),
  validityDays: z.number().int().min(1).max(365).nullable().optional(),
  isActive: z.boolean().optional(),
});

/** All letter templates, newest version first, for the administrator editor. */
export const listDocumentTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "system_admin" });
    if (!isAdmin) throw new Error("Only administrators can manage document templates.");
    const { data, error } = await supabase
      .from("document_templates")
      .select(
        "id, document_type, language, version, status, is_active, title, header_text, body_template, footer_text, signatory_block, disclaimer, validity_days, updated_at",
      )
      .order("language")
      .order("version", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Renders a draft with sample student data, without saving it. */
export const previewDocumentTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        language: z.enum(["en", "ar"]),
        title: z.string().max(200),
        headerText: z.string().max(2000).nullable().optional(),
        bodyTemplate: z.string().max(8000),
        footerText: z.string().max(2000).nullable().optional(),
        signatoryBlock: z.string().max(2000).nullable().optional(),
        disclaimer: z.string().max(2000).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "system_admin",
    });
    if (!isAdmin) throw new Error("Only administrators can manage document templates.");
    const { renderTemplatePreview } = await import("./documents/template-admin.server");
    return renderTemplatePreview(
      {
        title: data.title,
        headerText: data.headerText ?? null,
        bodyTemplate: data.bodyTemplate,
        footerText: data.footerText ?? null,
        signatoryBlock: data.signatoryBlock ?? null,
        disclaimer: data.disclaimer ?? null,
        validityDays: null,
      },
      data.language,
    );
  });

/** Saves an edited template and records the change in the audit log. */
export const saveDocumentTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TemplateDraftSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "system_admin" });
    if (!isAdmin) throw new Error("Only administrators can manage document templates.");

    const { error } = await supabase
      .from("document_templates")
      .update({
        title: data.title,
        header_text: data.headerText ?? null,
        body_template: data.bodyTemplate,
        footer_text: data.footerText ?? null,
        signatory_block: data.signatoryBlock ?? null,
        disclaimer: data.disclaimer ?? null,
        validity_days: data.validityDays ?? null,
        ...(data.isActive === undefined ? {} : { is_active: data.isActive }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error("The template could not be saved.");

    await auditInsert(supabase, {
      actor_id: userId,
      action: "document.template_updated",
      entity_type: "document_template",
      entity_id: data.id,
      metadata: { title: data.title, isActive: data.isActive ?? null },
    });
    return { ok: true };
  });
