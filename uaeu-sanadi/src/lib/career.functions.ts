import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const MAX_CV_BYTES = 5 * 1024 * 1024;

const UploadSchema = z.object({
  fileName: z.string().min(1).max(200),
  mimeType: z.string().min(3).max(120),
  /** base64 encoded file contents */
  content: z.string().min(10),
});

const PreferencesSchema = z.object({
  preferredRoles: z.array(z.string().max(120)).max(10).optional(),
  preferredFields: z.array(z.string().max(120)).max(10).optional(),
  preferredSectors: z.array(z.string().max(120)).max(10).optional(),
  preferredLocations: z.array(z.string().max(120)).max(10).optional(),
  workMode: z.enum(["onsite", "hybrid", "remote", "any"]).optional(),
  workOrientation: z.enum(["industry", "research", "government", "entrepreneurship", "undecided"]).optional(),
});

/** Career dashboard state: CV, verified record, matches, ATS and plan. */
export const getMyCareerState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { analyseCareer, loadPreferences } = await import("./career/career.server");
    const [analysis, prefs] = await Promise.all([
      analyseCareer(context.supabase, context.userId, { persist: false }),
      loadPreferences(context.supabase, context.userId),
    ]);
    return { analysis, preferences: prefs };
  });

/** Stores the CV securely, extracts its text and runs the deterministic analysis. */
export const uploadMyCv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UploadSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const bytes = Uint8Array.from(atob(data.content), (c) => c.charCodeAt(0));
    if (bytes.byteLength > MAX_CV_BYTES) throw new Error("The CV must be smaller than 5 MB.");

    const allowed = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "text/plain",
    ];
    if (!allowed.includes(data.mimeType)) throw new Error("Please upload the CV as a PDF, Word document or plain text file.");

    const safeName = data.fileName.replace(/[^\w.-]+/g, "_");

    // Malware and active-content screening before anything is stored or parsed.
    const { scanUploadedCv, safetyMessage } = await import("./career/file-safety.server");
    const report = await scanUploadedCv(bytes, data.mimeType, data.fileName);

    if (report.status !== "clean") {
      let quarantinePath: string | null = null;
      if (report.status === "quarantined") {
        const path = `quarantine/${userId}/${Date.now()}-${safeName}`;
        const q = await supabase.storage
          .from("student-cvs")
          .upload(path, bytes, { contentType: "application/octet-stream", upsert: false });
        if (!q.error) quarantinePath = path;
      }

      await supabase.from("cv_upload_scans").insert({
        student_id: userId,
        file_name: data.fileName,
        mime_type: data.mimeType,
        size_bytes: bytes.byteLength,
        sha256: report.sha256,
        scan_status: report.status,
        verdict: report.verdict,
        findings: JSON.parse(JSON.stringify(report.findings)),
        quarantine_path: quarantinePath,
      });

      await supabase.from("career_counselling_events").insert({
        student_id: userId,
        event_type: report.status === "rejected" ? "cv_upload_rejected" : "cv_upload_quarantined",
        actor_id: userId,
        details: { verdict: report.verdict, findings: report.findings, sha256: report.sha256 },
      });

      throw new Error(safetyMessage(report, false));
    }

    // Idempotency: re-uploading the exact same file (double click, retry) must
    // not create a second active copy — reuse the already parsed version.
    const { data: existing } = await supabase
      .from("student_cv_documents")
      .select("id, parsing_status, parsing_error, discrepancies, is_current")
      .eq("student_id", userId)
      .eq("content_sha256", report.sha256)
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Only reuse a version that actually parsed; a failed/partial one is re-processed.
    if (existing && existing.parsing_status === "parsed") {
      if (!existing.is_current) {
        await supabase
          .from("student_cv_documents")
          .update({ is_current: false })
          .eq("student_id", userId)
          .eq("is_current", true);
        await supabase.from("student_cv_documents").update({ is_current: true }).eq("id", existing.id);
      }
      const { analyseCareer } = await import("./career/career.server");
      const analysis = await analyseCareer(supabase, userId);
      return {
        cvId: existing.id,
        parsingStatus: existing.parsing_status,
        parsingError: existing.parsing_error,
        discrepancies: ((existing.discrepancies as string[] | null) ?? []).map(String),
        analysis,
      };
    }

    const path = `${userId}/${Date.now()}-${safeName}`;
    const upload = await supabase.storage.from("student-cvs").upload(path, bytes, { contentType: data.mimeType, upsert: false });
    if (upload.error) throw new Error(upload.error.message);


    const { parseCvFile } = await import("./career/cv-parser.server");
    const { analyseCareer, loadStudentEvidence, findDiscrepancies } = await import("./career/career.server");

    const outcome = await parseCvFile(supabase, bytes.buffer as ArrayBuffer, data.mimeType);
    const evidence = await loadStudentEvidence(supabase, userId);
    const discrepancies = outcome.status === "failed" ? [] : findDiscrepancies(outcome.parsed, evidence);

    // The existing CV stays the current one until the replacement is stored
    // successfully: the new row is inserted inactive, then promoted.
    const { data: row, error } = await supabase
      .from("student_cv_documents")
      .insert({
        student_id: userId,
        file_name: data.fileName,
        mime_type: data.mimeType,
        size_bytes: bytes.byteLength,
        original_file_path: path,
        parsed_text: outcome.text,
        parsed_profile_json: JSON.parse(JSON.stringify(outcome.parsed)),
        detected_language: outcome.language,
        parsing_status: outcome.status,
        parsing_error: outcome.error,
        injection_flags: outcome.injectionFlags,
        discrepancies,
        is_current: false,
        scan_status: "clean",
        // Content fingerprint: the stable version identifier every ATS score is tied to.
        content_sha256: report.sha256,

      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // Promote: archive the previous current CV, then activate the new one.
    await supabase.from("student_cv_documents").update({ is_current: false }).eq("student_id", userId).eq("is_current", true);
    const { error: promoteError } = await supabase
      .from("student_cv_documents")
      .update({ is_current: true })
      .eq("id", row.id)
      .eq("student_id", userId);
    if (promoteError) throw new Error(promoteError.message);


    await supabase.from("cv_upload_scans").insert({
      student_id: userId,
      cv_id: row.id,
      file_name: data.fileName,
      mime_type: data.mimeType,
      size_bytes: bytes.byteLength,
      sha256: report.sha256,
      scan_status: "clean",
      verdict: report.verdict,
      findings: [],
    });

    await supabase.from("career_counselling_events").insert({
      student_id: userId,
      cv_id: row.id,
      event_type: "cv_uploaded",
      actor_id: userId,
      details: { status: outcome.status, language: outcome.language, injectionFlags: outcome.injectionFlags.length },
    });



    const analysis = await analyseCareer(supabase, userId);
    return { cvId: row.id, parsingStatus: outcome.status, parsingError: outcome.error, discrepancies, analysis };
  });

/** Saves the student's stated career preferences and re-scores. */
export const saveMyCareerPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PreferencesSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("student_career_profiles").upsert(
      {
        student_id: userId,
        preferred_roles: data.preferredRoles ?? [],
        preferred_fields: data.preferredFields ?? [],
        preferred_sectors: data.preferredSectors ?? [],
        preferred_locations: data.preferredLocations ?? [],
        work_mode: data.workMode ?? "any",
        work_orientation: data.workOrientation ?? "undecided",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id" },
    );
    if (error) throw new Error(error.message);
    const { analyseCareer } = await import("./career/career.server");
    return analyseCareer(supabase, userId);
  });

/** Re-runs the deterministic analysis, optionally against a chosen target role. */
export const analyseMyCareerFit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ targetRoleCode: z.string().max(60).nullable().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { analyseCareer } = await import("./career/career.server");
    return analyseCareer(context.supabase, context.userId, { targetRoleCode: data.targetRoleCode ?? null });
  });

/** Full catalogue of career roles for the explorer view. */
export const listCareerRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("career_roles")
      .select("id, role_code, title_en, title_ar, career_family, industry_sectors, required_hard_skills, certifications")
      .eq("active", true)
      .order("title_en");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** The signed-in student's live career counselling request, if one is open. */
export const getMyCounsellingRequest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { findOpenCounsellingRequest } = await import("./career/counselling.server");
    return findOpenCounsellingRequest(context.supabase, context.userId);
  });

/**
 * Creates a real, routed and SLA-tracked career counselling request for the
 * student. Reuses the single institutional intake pipeline so the request is
 * assigned to the Career service owner, notified, and tracked like any case.
 */
export const requestCareerCounsellor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ note: z.string().max(1000).optional(), lang: z.enum(["en", "ar"]).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { createCounsellingRequest } = await import("./career/counselling.server");
    return createCounsellingRequest({
      supabase: context.supabase,
      studentId: context.userId,
      note: data.note ?? null,
      lang: data.lang ?? "en",
    });
  });

/** Short-lived signed link so the student can re-download their own CV. */
export const getMyCvDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ cvId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: cv } = await supabase
      .from("student_cv_documents")
      .select("original_file_path")
      .eq("id", data.cvId)
      .eq("student_id", userId)
      .maybeSingle();
    if (!cv) throw new Error("CV not found.");
    const { data: signed, error } = await supabase.storage.from("student-cvs").createSignedUrl(cv.original_file_path, 300);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

/**
 * Permanently removes the student's current CV: the stored file is deleted,
 * the record is tombstoned and every CV-derived result is invalidated so the
 * page returns to academic-profile-only mode.
 */
export const deleteMyCv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: cvs } = await supabase
      .from("student_cv_documents")
      .select("id, original_file_path, file_name, is_current")
      .eq("student_id", userId)
      .is("deleted_at", null);
    const cv = cvs?.find((c) => c.is_current) ?? null;
    if (!cv) throw new Error("No CV to delete.");

    // Remove the current file and any archived earlier versions still stored.
    const paths = (cvs ?? []).map((c) => c.original_file_path).filter((p): p is string => Boolean(p));
    if (paths.length) {
      const { error: rmError } = await supabase.storage.from("student-cvs").remove(paths);
      if (rmError) console.error("[career] cv file removal failed", { cvId: cv.id, stage: "storage", code: rmError.message });
    }

    // CV-derived analysis must not outlive the CV.
    await supabase.from("cv_ats_scores").delete().eq("student_id", userId);
    await supabase.from("career_role_matches").delete().eq("student_id", userId);
    // CV-based analysis versions go too, so nothing from a deleted CV can
    // resurface as history; an academic-only version is regenerated below.
    await supabase
      .from("career_analysis_versions")
      .delete()
      .eq("student_id", userId)
      .not("cv_id", "is", null);

    await supabase
      .from("student_career_profiles")
      .update({ latest_cv_id: null, updated_at: new Date().toISOString() })
      .eq("student_id", userId);

    const { error } = await supabase
      .from("student_cv_documents")
      .update({ is_current: false, deleted_at: new Date().toISOString(), parsed_text: null })
      .eq("student_id", userId)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);


    await supabase.from("career_counselling_events").insert({
      student_id: userId,
      event_type: "cv_deleted",
      actor_id: userId,
      details: { cvId: cv.id },
    });

    const { analyseCareer } = await import("./career/career.server");
    const analysis = await analyseCareer(supabase, userId);
    return { ok: true, analysis };
  });
