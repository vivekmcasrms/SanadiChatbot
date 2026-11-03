/** Knowledge & Integrations Center server functions. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Db } from "./agent/tools.server";
import { audit, assert, loadPermissions, type CenterPermissions } from "./knowledge/permissions.server";
import {
  checksum,
  chunkText,
  detectInjection,
  detectLanguage,
  malwareScan,
  runQualityChecks,
  SUPPORTED_MIME,
  validateFile,
} from "./knowledge/processing.server";
import { classifyChange, fetchWebSource, validateSourceUrl } from "./knowledge/web.server";
import { describeShape, runConnectorTool, schemaHash } from "./knowledge/connectors.server";
import { detectConflicts, invalidateKnowledgeCache, retrieveKnowledge } from "./knowledge/retrieval.server";
import { seedKnowledgeCenter } from "./knowledge/seed.server";

async function ctx(context: { supabase: Db; userId: string }): Promise<{ db: Db; userId: string; perms: CenterPermissions }> {
  const perms = await loadPermissions(context.supabase, context.userId);
  assert(perms.canViewCenter, "You do not have access to the Knowledge & Integrations Center.");
  return { db: context.supabase, userId: context.userId, perms };
}

/* ------------------------------------------------------------------ overview */

export const getCenterOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db, perms } = await ctx(context);
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);

    const count = async (table: string, apply: (q: any) => any) => {
      const { count: c } = await apply((db as any).from(table).select("id", { count: "exact", head: true }));
      return c ?? 0;
    };

    const [
      activeDocs, publishedDocs, pendingDocs, dueReview, expiredDocs, supersededDocs,
      failedExtraction, failedIndexing, conflicts, criticalConflicts, activeFaqs,
      webSources, webChanged, healthy, degraded, offline, gaps,
    ] = await Promise.all([
      count("knowledge_documents", (q) => q.eq("is_active", true)),
      count("knowledge_documents", (q) => q.in("approval_status", ["published", "approved"])),
      count("knowledge_documents", (q) => q.eq("approval_status", "pending_review")),
      count("knowledge_documents", (q) => q.lte("review_date", soon).eq("is_active", true)),
      count("knowledge_documents", (q) => q.lt("expiry_date", today)),
      count("knowledge_documents", (q) => q.not("superseded_by_document_id", "is", null)),
      count("knowledge_documents", (q) => q.eq("extraction_status", "failed")),
      count("knowledge_documents", (q) => q.eq("indexing_status", "failed")),
      count("knowledge_conflicts", (q) => q.neq("resolution_status", "resolved")),
      count("knowledge_conflicts", (q) => q.eq("severity", "critical").neq("resolution_status", "resolved")),
      count("faq_items", (q) => q.eq("is_active", true).eq("approval_status", "approved")),
      count("web_knowledge_sources", (q) => q.eq("is_active", true)),
      count("web_knowledge_sources", (q) => q.eq("change_detected", true)),
      count("integration_connectors", (q) => q.eq("health_status", "healthy")),
      count("integration_connectors", (q) => q.eq("health_status", "degraded")),
      count("integration_connectors", (q) => q.eq("health_status", "offline")),
      count("knowledge_gaps", (q) => q.neq("status", "resolved")),
    ]);

    const [{ data: activity }, { data: approvals }, { data: failures }, { data: recentSources }, { data: latency }] = await Promise.all([
      db.from("knowledge_audit_log").select("id, action, entity_type, summary, created_at").order("created_at", { ascending: false }).limit(25),
      db.from("knowledge_approval_requests").select("id, entity_type, entity_label, approval_status, requested_at, due_at").eq("approval_status", "pending").order("requested_at").limit(25),
      db.from("knowledge_documents").select("id, title, extraction_status, extraction_error, indexing_status").or("extraction_status.eq.failed,indexing_status.eq.failed").limit(15),
      db.from("web_knowledge_sources").select("id, title, url, last_checked_at, change_detected, health_status").order("updated_at", { ascending: false }).limit(10),
      db.from("integration_test_runs").select("latency_ms").not("latency_ms", "is", null).order("started_at", { ascending: false }).limit(50),
    ]);

    const latencies = (latency ?? []).map((r) => r.latency_ms ?? 0).filter(Boolean);
    const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

    return {
      permissions: perms,
      metrics: {
        activeDocs, publishedDocs, pendingDocs, dueReview, expiredDocs, supersededDocs,
        failedExtraction, failedIndexing, conflicts, criticalConflicts, activeFaqs,
        webSources, webChanged, healthy, degraded, offline, gaps, avgLatency,
      },
      activity: activity ?? [],
      approvals: approvals ?? [],
      failures: failures ?? [],
      recentSources: recentSources ?? [],
    };
  });

/* ----------------------------------------------------------------- documents */

export const listDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { search?: string; status?: string }) =>
    z.object({ search: z.string().max(200).optional(), status: z.string().max(40).optional() }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const { db } = await ctx(context);
    let q = db
      .from("knowledge_documents")
      .select("id, title, document_type, language, version, effective_date, review_date, expiry_date, approval_status, processing_status, extraction_status, indexing_status, quality_status, quality_issues, confidentiality_level, is_current, is_active, usage_count, owner_unit_id, category_id, supersedes_document_id, superseded_by_document_id, created_at")
      .order("created_at", { ascending: false })
      .limit(300);
    if (data.status && data.status !== "all") q = q.eq("approval_status", data.status);
    if (data.search) q = q.ilike("title", `%${data.search}%`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const [{ data: categories }, { data: units }] = await Promise.all([
      db.from("knowledge_document_categories").select("id, code, name_en, name_ar").eq("is_active", true).order("sort_order"),
      db.from("service_units").select("id, code, name_en, name_ar").order("code"),
    ]);
    return { documents: rows ?? [], categories: categories ?? [], units: units ?? [] };
  });

const uploadSchema = z.object({
  title: z.string().trim().min(3).max(300),
  documentType: z.string().min(2).max(50),
  categoryId: z.string().uuid().nullable().optional(),
  ownerUnitId: z.string().uuid().nullable().optional(),
  language: z.enum(["en", "ar"]),
  version: z.string().max(30),
  effectiveDate: z.string(),
  reviewDate: z.string().nullable().optional(),
  expiryDate: z.string().nullable().optional(),
  confidentialityLevel: z.enum(["public", "student_authenticated", "staff_only", "restricted", "highly_restricted"]),
  fileName: z.string().max(300),
  mimeType: z.string().max(120),
  sizeBytes: z.number().int().nonnegative(),
  textContent: z.string().max(400_000).default(""),
  storagePath: z.string().max(400).nullable().optional(),
  structuredKind: z.string().max(40).nullable().optional(),
  supersedesDocumentId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

/**
 * Upload → validate → extract → detect language → chunk → index → quality
 * checks → ready for review. Never published automatically.
 */
export const uploadDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => uploadSchema.parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.canManageKnowledge, "Only knowledge managers may upload documents.");
    const { ingestDocument } = await import("./knowledge/ingest.server");
    const result = await ingestDocument(db, userId, data);
    await audit(db, userId, "document.upload", "knowledge_document", result.id, `Uploaded "${data.title}" (v${data.version})`, {
      chunks: result.chunks,
      issues: result.issues.length,
      structuredKind: data.structuredKind ?? null,
    });
    return result;
  });


export const requestDocumentApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { documentId: string }) => z.object({ documentId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.canManageKnowledge, "Only knowledge managers may submit documents for approval.");
    const { data: doc } = await db.from("knowledge_documents").select("id, title, quality_status").eq("id", data.documentId).maybeSingle();
    if (!doc) throw new Error("Document not found.");
    if (doc.quality_status === "failed") throw new Error("This document failed material quality checks and cannot be submitted.");
    await db.from("knowledge_documents").update({ approval_status: "pending_review" }).eq("id", data.documentId);
    await db.from("knowledge_approval_requests").insert({
      entity_type: "knowledge_document",
      entity_id: data.documentId,
      entity_label: doc.title,
      requested_by: userId,
      assigned_approver_role: "knowledge_approver",
      approval_status: "pending",
      due_at: new Date(Date.now() + 5 * 864e5).toISOString(),
    });
    await audit(db, userId, "document.submit_for_approval", "knowledge_document", data.documentId, `Submitted "${doc.title}" for approval`);
    return { ok: true };
  });

export const decideDocumentApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { documentId: string; decision: string; notes?: string }) =>
    z.object({
      documentId: z.string().uuid(),
      decision: z.enum(["approved", "rejected", "returned_for_revision"]),
      notes: z.string().max(2000).optional(),
    }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.canApproveKnowledge, "Only knowledge approvers may decide approvals.");
    const now = new Date().toISOString();
    const { data: doc } = await db.from("knowledge_documents").select("id, title, effective_date, supersedes_document_id").eq("id", data.documentId).maybeSingle();
    if (!doc) throw new Error("Document not found.");

    if (data.decision === "approved") {
      const effectiveNow = !doc.effective_date || doc.effective_date <= now.slice(0, 10);
      await db.from("knowledge_documents").update({
        approval_status: effectiveNow ? "published" : "approved",
        approved_by: userId,
        approved_at: now,
        published_at: effectiveNow ? now : null,
        is_active: effectiveNow,
        is_current: effectiveNow,
      }).eq("id", data.documentId);
      // A future-dated version must not override the current one prematurely.
      if (effectiveNow && doc.supersedes_document_id) {
        await db.from("knowledge_documents").update({
          is_current: false,
          approval_status: "superseded",
          superseded_by_document_id: data.documentId,
        }).eq("id", doc.supersedes_document_id);
      }
    } else {
      await db.from("knowledge_documents").update({
        approval_status: data.decision === "rejected" ? "rejected" : "needs_revision",
      }).eq("id", data.documentId);
    }

    await db.from("knowledge_approval_requests").update({
      approval_status: data.decision === "approved" ? "approved" : data.decision === "rejected" ? "rejected" : "returned_for_revision",
      decided_at: now,
      decided_by: userId,
      review_notes: data.notes ?? null,
    }).eq("entity_id", data.documentId).eq("approval_status", "pending");

    invalidateKnowledgeCache("document_decision");
    await audit(db, userId, `document.${data.decision}`, "knowledge_document", data.documentId, `${data.decision} "${doc.title}"`, { notes: data.notes ?? null });
    return { ok: true };
  });

export const retireDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { documentId: string; reason: string; replacementId?: string | null }) =>
    z.object({ documentId: z.string().uuid(), reason: z.string().min(3).max(500), replacementId: z.string().uuid().nullable().optional() }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.canManageKnowledge, "Only knowledge managers may retire content.");
    // Historical record and citations are preserved; only retrieval is stopped.
    await db.from("knowledge_documents").update({
      approval_status: "retired",
      is_active: false,
      is_current: false,
      retired_at: new Date().toISOString(),
      retirement_reason: data.reason,
      superseded_by_document_id: data.replacementId ?? null,
    }).eq("id", data.documentId);
    await db.from("document_chunks").update({ is_active: false }).eq("document_id", data.documentId);
    await audit(db, userId, "document.retire", "knowledge_document", data.documentId, "Retired document", { reason: data.reason });
    return { ok: true };
  });

export const rollbackDocumentVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { currentId: string; previousId: string }) =>
    z.object({ currentId: z.string().uuid(), previousId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.canApproveKnowledge, "Only knowledge approvers may roll back a version.");
    await db.from("knowledge_documents").update({ is_current: false, is_active: false, approval_status: "needs_revision" }).eq("id", data.currentId);
    await db.from("knowledge_documents").update({ is_current: true, is_active: true, approval_status: "published", superseded_by_document_id: null }).eq("id", data.previousId);
    await db.from("document_chunks").update({ is_active: true }).eq("document_id", data.previousId);
    await audit(db, userId, "document.rollback", "knowledge_document", data.previousId, "Rolled back to the previous approved version", { from: data.currentId });
    return { ok: true };
  });


/** Re-index an uploaded document with the current chunking rules. */
export const reprocessDocumentIndex = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { documentId: string }) => z.object({ documentId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.canManageKnowledge, "Only knowledge managers may re-index documents.");
    const { reprocessDocument } = await import("./knowledge/reprocess.server");
    const result = await reprocessDocument(db, data.documentId);
    invalidateKnowledgeCache("document_reprocess");
    await audit(db, userId, "document.reprocess", "knowledge_document", data.documentId, `Re-indexed "${result.title}"`, {
      chunks: result.chunks,
      sections: result.sections.length,
      source: result.source,
    });
    return result;
  });

/** Verify a document end to end and mark it Active only when it truly answers. */
export const activateKnowledgeSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { documentId: string; lang?: string }) =>
    z.object({ documentId: z.string().uuid(), lang: z.enum(["en", "ar"]).optional() }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.canManageKnowledge, "Only knowledge managers may activate sources.");
    const { activateDocument } = await import("./knowledge/activation.server");
    const result = await activateDocument(db, data.documentId, perms, data.lang ?? "en");
    await audit(
      db,
      userId,
      result.activated ? "document.activate" : "document.activate_failed",
      "knowledge_document",
      data.documentId,
      `${result.activated ? "Activated" : "Activation blocked for"} "${result.title}"`,
      { checks: result.checks, probes: result.probes },
    );
    return result;
  });

/** Retrieval diagnostics for one document and one question. */
export const diagnoseDocumentSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { documentId: string; query: string }) =>
    z.object({ documentId: z.string().uuid(), query: z.string().trim().min(2).max(300) }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, perms } = await ctx(context);
    const { diagnoseDocumentRetrieval } = await import("./knowledge/reprocess.server");
    const [local, live] = await Promise.all([
      diagnoseDocumentRetrieval(db, data.documentId, data.query),
      retrieveKnowledge(db, data.query, { lang: "en", perms, limit: 5, useCache: false }),
    ]);
    return {
      ...local,
      live: live.map((p) => ({
        title: p.title,
        sectionTitle: p.sectionTitle,
        pageNumber: p.pageNumber,
        score: Number((p.score ?? 0).toFixed(3)),
        lexical: Number((p.lexical ?? 0).toFixed(3)),
        fuzzy: Number((p.fuzzy ?? 0).toFixed(3)),
        snippet: p.snippet.slice(0, 220),
      })),
    };
  });

/* ---------------------------------------------------------------- web sources */

export const listWebSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db } = await ctx(context);
    const [{ data: sources }, { data: changes }] = await Promise.all([
      db.from("web_knowledge_sources").select("id, title, url, language, source_category, confidentiality_level, refresh_frequency, last_checked_at, last_successful_fetch_at, last_indexed_at, change_detected, health_status, approval_status, is_active, owner_unit_id, knowledge_domain, crawl_scope, max_depth, max_pages, seed_urls, allowed_paths, excluded_path_patterns, pages_discovered, pages_indexed, pages_failed, chunk_count, ingestion_status, last_error").order("updated_at", { ascending: false }).limit(200),
      db.from("web_source_changes").select("id, web_source_id, change_type, change_summary, change_percentage, detected_at, review_status").order("detected_at", { ascending: false }).limit(100),
    ]);
    return { sources: sources ?? [], changes: changes ?? [] };
  });

/** Crawled pages and their ingestion outcome for one website source. */
export const listWebSourcePages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { db } = await ctx(context);
    const { data: pages } = await db
      .from("web_source_pages")
      .select("id, url, title, language, depth, status, error_reason, text_length, chunk_count, fetched_at, indexed_at, is_active")
      .eq("web_source_id", data.id)
      .order("depth", { ascending: true })
      .order("url", { ascending: true })
      .limit(300);
    return { pages: pages ?? [] };
  });

const pathList = z
  .array(z.string().max(200))
  .max(30)
  .default([])
  .transform((v) => v.map((p) => p.trim()).filter(Boolean));

export const saveWebSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      title: z.string().min(3).max(200),
      url: z.string().url(),
      language: z.enum(["en", "ar"]),
      sourceCategory: z.string().max(50),
      confidentialityLevel: z.string().max(40),
      refreshFrequency: z.string().max(20),
      ownerUnitId: z.string().uuid().nullable().optional(),
      trustedAutoRefresh: z.boolean().default(false),
      knowledgeDomain: z.string().max(40).nullable().optional(),
      crawlScope: z.enum(["single_page", "selected_pages", "same_domain"]).default("single_page"),
      maxDepth: z.number().int().min(0).max(3).default(1),
      maxPages: z.number().int().min(1).max(300).default(25),
      seedUrls: z.array(z.string().max(500)).max(50).default([]).transform((v) => v.map((s) => s.trim()).filter(Boolean)),
      allowedPaths: pathList,
      excludedPaths: pathList,
    }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.canManageKnowledge, "Only knowledge managers may register web sources.");
    const check = validateSourceUrl(data.url);
    if (!check.ok) throw new Error(check.error);
    for (const seed of data.seedUrls) {
      const seedCheck = validateSourceUrl(new URL(seed, data.url).toString());
      if (!seedCheck.ok) throw new Error(`${seed}: ${seedCheck.error}`);
    }
    const payload = {
      title: data.title,
      url: data.url,
      language: data.language,
      source_category: data.sourceCategory,
      confidentiality_level: data.confidentialityLevel,
      refresh_frequency: data.refreshFrequency,
      owner_unit_id: data.ownerUnitId ?? null,
      trusted_auto_refresh: data.trustedAutoRefresh,
      knowledge_domain: data.knowledgeDomain ?? null,
      crawl_scope: data.crawlScope,
      max_depth: data.crawlScope === "same_domain" ? data.maxDepth : 0,
      max_pages: data.crawlScope === "single_page" ? 1 : data.maxPages,
      seed_urls: data.seedUrls,
      allowed_paths: data.allowedPaths,
      excluded_path_patterns: data.excludedPaths,
      created_by: userId,
    };
    if (data.id) {
      await db.from("web_knowledge_sources").update(payload as never).eq("id", data.id);
      await audit(db, userId, "web_source.update", "web_knowledge_source", data.id, `Updated web source ${data.title}`);
      return { id: data.id };
    }
    const { data: row, error } = await db.from("web_knowledge_sources").insert(payload as never).select("id").single();
    if (error) throw new Error(error.message);
    await audit(db, userId, "web_source.create", "web_knowledge_source", row.id, `Registered web source ${data.title}`, { url: data.url });
    return { id: row.id };
  });

/**
 * Crawls, extracts and indexes a website source so its pages become real,
 * citable knowledge instead of a registered link.
 */
export const refreshWebSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; revisionSeed?: string }) =>
    z.object({ id: z.string().uuid(), revisionSeed: z.string().max(60).optional() }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.canManageKnowledge, "Only knowledge managers may refresh web sources.");
    const { data: source } = await db
      .from("web_knowledge_sources")
      .select("id, url, title, content_hash, extracted_text, trusted_auto_refresh, source_category, knowledge_domain, crawl_scope, max_depth, max_pages, seed_urls, allowed_paths, excluded_path_patterns")
      .eq("id", data.id)
      .maybeSingle();
    if (!source) throw new Error("Web source not found.");

    const now = new Date().toISOString();
    await db.from("web_knowledge_sources").update({ ingestion_status: "crawling", last_checked_at: now } as never).eq("id", data.id);

    const { crawlAndIndexSource, refreshUniversityColleges } = await import("./knowledge/crawl.server");
    const asList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

    let report;
    try {
      report = await crawlAndIndexSource(
        db,
        { id: source.id, url: source.url, title: source.title, knowledgeDomain: source.knowledge_domain ?? null },
        {
          scope: (source.crawl_scope as "single_page" | "selected_pages" | "same_domain") ?? "single_page",
          maxDepth: source.max_depth ?? 1,
          maxPages: source.max_pages ?? 25,
          seedUrls: asList(source.seed_urls),
          allowedPaths: asList(source.allowed_paths),
          excludedPaths: asList(source.excluded_path_patterns),
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Crawl failed";
      await db.from("web_knowledge_sources").update({
        ingestion_status: "failed", health_status: "failed", last_error: message.slice(0, 500),
      } as never).eq("id", data.id);
      await audit(db, userId, "web_source.fetch_failed", "web_knowledge_source", data.id, `Crawl failed for ${source.title}`, { error: message });
      return { ok: false, error: message, changeType: "access_failed", indexed: 0, chunks: 0 };
    }

    const finishedAt = new Date().toISOString();
    if (!report.indexed) {
      const reason = report.error ?? report.pages.find((p) => p.error)?.error ?? "No page could be indexed.";
      await db.from("web_knowledge_sources").update({
        ingestion_status: "failed",
        health_status: report.pages.some((p) => p.status === "removed") ? "removed" : "failed",
        last_error: reason.slice(0, 500),
        pages_discovered: report.discovered,
        pages_indexed: 0,
        pages_failed: report.failed,
        last_checked_at: finishedAt,
      } as never).eq("id", data.id);
      await db.from("web_source_changes").insert({
        web_source_id: data.id,
        previous_content_hash: source.content_hash,
        change_type: "access_failed",
        change_summary: reason,
        detected_at: finishedAt,
      } as never);
      await audit(db, userId, "web_source.fetch_failed", "web_knowledge_source", data.id, `Crawl produced no content for ${source.title}`, { error: reason });
      return { ok: false, error: reason, changeType: "access_failed", indexed: 0, chunks: 0 };
    }

    const combined = report.pages.filter((p) => p.ok).map((p) => `${p.url}:${p.hash}`).sort().join("\n");
    const { checksum } = await import("./knowledge/processing.server");
    const corpusHash = await checksum(combined);
    const changed = source.content_hash !== corpusHash;
    const diff = classifyChange(source.extracted_text ?? "", combined);
    const policyLike = ["policy", "regulation"].includes(source.source_category ?? "");
    const autoPublish = source.trusted_auto_refresh && !policyLike && diff.changeType === "minor";

    await db.from("web_knowledge_sources").update({
      last_checked_at: finishedAt,
      last_successful_fetch_at: finishedAt,
      last_indexed_at: finishedAt,
      content_hash: corpusHash,
      extracted_text: combined.slice(0, 200_000),
      ingestion_status: report.truncated ? "partial" : "indexed",
      health_status: report.failed && !report.indexed ? "degraded" : "healthy",
      last_error: report.truncated ? "Crawl stopped at the time budget; run refresh again to continue." : null,
      pages_discovered: report.discovered,
      pages_indexed: report.indexed,
      pages_failed: report.failed,
      chunk_count: report.chunks,
      change_detected: changed && !autoPublish,
      approval_status: changed && !autoPublish ? "changed_pending_review" : "approved",
      ...(changed ? { last_changed_at: finishedAt } : {}),
      ...(autoPublish ? { is_active: true } : {}),
    } as never).eq("id", data.id);

    if (changed) {
      await db.from("web_source_changes").insert({
        web_source_id: data.id,
        previous_content_hash: source.content_hash,
        new_content_hash: corpusHash,
        change_type: diff.changeType,
        change_summary: `${report.indexed} page(s) indexed, ${report.chunks} passage(s). ${diff.summary}`,
        change_percentage: diff.percentage,
        review_status: autoPublish ? "auto_approved" : "pending",
        approved_at: autoPublish ? finishedAt : null,
      } as never);
    }

    // Stable institutional facts are stored as records so counts are exact.
    let colleges = 0;
    try {
      const facts = await refreshUniversityColleges(db, data.id, report.collegeNames);
      colleges = facts.stored;
    } catch {
      /* fact extraction is best-effort and must not fail the crawl */
    }

    invalidateKnowledgeCache("web_source_refresh");
    await audit(db, userId, "web_source.refresh", "web_knowledge_source", data.id, `Crawled ${source.title}`, {
      changed, indexed: report.indexed, failed: report.failed, chunks: report.chunks, colleges,
    });
    return {
      ok: true, changed, ...diff,
      discovered: report.discovered, indexed: report.indexed, failed: report.failed,
      chunks: report.chunks, removed: report.removed, truncated: report.truncated, colleges,
    };
  });


export const reviewWebChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { changeId: string; decision: string }) =>
    z.object({ changeId: z.string().uuid(), decision: z.enum(["approved", "rejected"]) }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.canApproveKnowledge || perms.canManageKnowledge, "Not authorised.");
    const now = new Date().toISOString();
    const { data: change } = await db.from("web_source_changes").select("web_source_id").eq("id", data.changeId).maybeSingle();
    await db.from("web_source_changes").update({ review_status: data.decision, reviewed_by: userId, approved_at: data.decision === "approved" ? now : null }).eq("id", data.changeId);
    if (change) {
      await db.from("web_knowledge_sources").update({
        change_detected: false,
        approval_status: data.decision === "approved" ? "approved" : "rejected",
        is_active: data.decision === "approved",
      }).eq("id", change.web_source_id);
    }
    invalidateKnowledgeCache("web_source_change");
    await audit(db, userId, `web_source.change_${data.decision}`, "web_source_change", data.changeId, `Web source change ${data.decision}`);
    return { ok: true };
  });

/* ---------------------------------------------------------------- connectors */

export const listConnectors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db } = await ctx(context);
    const [{ data: connectors }, { data: tools }, { data: mappings }, { data: tests }, { data: health }] = await Promise.all([
      db.from("integration_connectors").select("id, connector_name, display_name_en, display_name_ar, source_system, connector_type, environment, base_url, authentication_type, credential_configured, credential_last_tested_at, credential_expires_at, data_classification, is_demo, read_enabled, write_enabled, health_status, timeout_ms, last_health_check_at, is_active").order("source_system"),
      db.from("integration_tools").select("id, connector_id, tool_name, display_name_en, display_name_ar, operation_type, risk_level, confirmation_required, human_approval_required, allowed_roles, enabled").order("tool_name"),
      db.from("integration_field_mappings").select("id, connector_id, tool_id, external_field, internal_field, data_type, transformation_rule, sensitive, masking_rule, required").order("external_field"),
      db.from("integration_test_runs").select("id, connector_id, tool_id, test_type, status, latency_ms, schema_valid, authorization_valid, error_message, started_at, response_preview").order("started_at", { ascending: false }).limit(50),
      db.from("integration_health_events").select("id, connector_id, health_status, latency_ms, error_message, detected_at").order("detected_at", { ascending: false }).limit(50),
    ]);
    return { connectors: connectors ?? [], tools: tools ?? [], mappings: mappings ?? [], tests: tests ?? [], health: health ?? [] };
  });

export const updateConnector = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      isActive: z.boolean().optional(),
      readEnabled: z.boolean().optional(),
      writeEnabled: z.boolean().optional(),
      healthStatus: z.string().max(30).optional(),
      timeoutMs: z.number().int().min(500).max(60000).optional(),
    }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.canManageIntegrations, "Only integration administrators may change connectors.");
    const { data: connector } = await db.from("integration_connectors").select("connector_name, environment").eq("id", data.id).maybeSingle();
    if (!connector) throw new Error("Connector not found.");
    // Production write access requires an explicit system administrator action.
    if (data.writeEnabled === true && connector.environment === "production" && !perms.isAdmin)
      throw new Error("Enabling production write access requires a system administrator.");
    const patch: Record<string, unknown> = {};
    if (data.isActive !== undefined) patch["is_active"] = data.isActive;
    if (data.readEnabled !== undefined) patch["read_enabled"] = data.readEnabled;
    if (data.writeEnabled !== undefined) patch["write_enabled"] = data.writeEnabled;
    if (data.healthStatus !== undefined) patch["health_status"] = data.healthStatus;
    if (data.timeoutMs !== undefined) patch["timeout_ms"] = data.timeoutMs;
    await db.from("integration_connectors").update(patch as never).eq("id", data.id);
    if (data.healthStatus) {
      await db.from("integration_health_events").insert({ connector_id: data.id, health_status: data.healthStatus, error_message: "Set manually by an administrator" });
    }
    await audit(db, userId, "connector.update", "integration_connector", data.id, `Updated connector ${connector.connector_name}`, patch);
    return { ok: true };
  });

/** Register a new API / data connection. Secrets are referenced by name, never stored here. */
export const createConnector = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      displayNameEn: z.string().min(3).max(120),
      displayNameAr: z.string().max(120).optional(),
      sourceSystem: z.string().min(2).max(60),
      connectorType: z.string().min(2).max(40).default("rest_api"),
      environment: z.enum(["development", "staging", "production"]).default("development"),
      baseUrl: z.string().url(),
      authenticationType: z.string().min(2).max(40).default("none"),
      credentialSecretName: z.string().max(120).optional(),
      dataClassification: z.string().min(2).max(40).default("internal"),
      usage: z.enum(["knowledge", "live"]).default("live"),
    }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.canManageIntegrations, "Only integration administrators may add data connections.");
    const connectorName = data.displayNameEn.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
    const { data: row, error } = await db
      .from("integration_connectors")
      .insert({
        connector_name: connectorName || `connector_${Date.now()}`,
        display_name_en: data.displayNameEn,
        display_name_ar: data.displayNameAr || data.displayNameEn,
        source_system: data.sourceSystem,
        connector_type: data.connectorType,
        environment: data.environment,
        base_url: data.baseUrl,
        authentication_type: data.authenticationType,
        credential_secret_name: data.credentialSecretName || null,
        credential_configured: !!data.credentialSecretName,
        data_classification: data.dataClassification,
        cache_policy: { ttl_seconds: data.usage === "knowledge" ? 3600 : 60, usage: data.usage } as never,
        is_demo: false,
        is_active: true,
        read_enabled: true,
        write_enabled: false,
        health_status: "unknown",
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit(db, userId, "connector.create", "integration_connector", row.id, `Registered data connection ${data.displayNameEn}`, {
      source_system: data.sourceSystem,
      usage: data.usage,
    });
    return { id: row.id };
  });


export const updateTool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      enabled: z.boolean().optional(),
      confirmationRequired: z.boolean().optional(),
      humanApprovalRequired: z.boolean().optional(),
    }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.canManageIntegrations, "Only integration administrators may change connector tools.");
    const { data: tool } = await db.from("integration_tools").select("tool_name, operation_type, connector_id").eq("id", data.id).maybeSingle();
    if (!tool) throw new Error("Tool not found.");
    const patch: Record<string, unknown> = {};
    if (data.enabled !== undefined) patch["enabled"] = data.enabled;
    if (data.confirmationRequired !== undefined) patch["confirmation_required"] = data.confirmationRequired;
    if (data.humanApprovalRequired !== undefined) patch["human_approval_required"] = data.humanApprovalRequired;
    // Write tools always keep confirmation and approval requirements.
    if (tool.operation_type !== "read") {
      patch["confirmation_required"] = true;
      patch["human_approval_required"] = true;
    }
    await db.from("integration_tools").update(patch as never).eq("id", data.id);
    await audit(db, userId, "connector_tool.update", "integration_tool", data.id, `Updated tool ${tool.tool_name}`, patch);
    return { ok: true };
  });

export const saveFieldMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      connectorId: z.string().uuid(),
      toolId: z.string().uuid().nullable().optional(),
      externalField: z.string().min(1).max(100),
      internalField: z.string().min(1).max(100),
      dataType: z.string().max(30),
      transformationRule: z.string().max(60).nullable().optional(),
      sensitive: z.boolean().default(false),
      maskingRule: z.string().max(30).nullable().optional(),
    }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.canManageIntegrations, "Only integration administrators may change field mappings.");
    const payload = {
      connector_id: data.connectorId,
      tool_id: data.toolId ?? null,
      external_field: data.externalField,
      internal_field: data.internalField,
      data_type: data.dataType,
      transformation_rule: data.transformationRule ?? null,
      sensitive: data.sensitive,
      masking_rule: data.maskingRule ?? null,
    };
    if (data.id) await db.from("integration_field_mappings").update(payload).eq("id", data.id);
    else await db.from("integration_field_mappings").insert(payload);
    await audit(db, userId, "field_mapping.save", "integration_field_mapping", data.id ?? null, `Mapped ${data.externalField} → ${data.internalField}`, payload);
    return { ok: true };
  });

export const testConnector = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { connectorId: string; toolName?: string }) =>
    z.object({ connectorId: z.string().uuid(), toolName: z.string().max(80).optional() }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.canManageIntegrations, "Only integration administrators may test connectors.");
    const { data: connector } = await db.from("integration_connectors").select("id, connector_name, source_system, is_active").eq("id", data.connectorId).maybeSingle();
    if (!connector) throw new Error("Connector not found.");
    let toolName = data.toolName;
    if (!toolName) {
      const { data: firstTool } = await db.from("integration_tools").select("tool_name").eq("connector_id", data.connectorId).eq("enabled", true).limit(1).maybeSingle();
      toolName = firstTool?.tool_name;
    }
    if (!toolName) throw new Error("This connector has no enabled tool to test.");

    const result = await runConnectorTool({
      db, userId, roles: ["system_admin", ...(perms.roles ?? [])], toolName, params: {}, preview: true,
    });
    const snapshot = describeShape(result.data ?? {});
    const hash = await schemaHash(snapshot);
    const { data: current } = await db.from("integration_schema_versions").select("id, schema_hash").eq("connector_id", data.connectorId).eq("is_current", true).maybeSingle();
    let schemaChanged = false;
    if (!current) {
      await db.from("integration_schema_versions").insert({ connector_id: data.connectorId, schema_hash: hash, schema_snapshot: snapshot as never });
    } else if (current.schema_hash !== hash) {
      schemaChanged = true;
      await db.from("integration_schema_versions").update({ is_current: false }).eq("id", current.id);
      await db.from("integration_schema_versions").insert({ connector_id: data.connectorId, schema_hash: hash, schema_snapshot: snapshot as never });
    }

    const status = result.status === "success" ? (schemaChanged ? "schema_changed" : "passed") : "failed";
    const health = result.status === "success" ? (schemaChanged ? "schema_changed" : "healthy") : result.status === "denied" ? "authentication_failed" : "degraded";

    await db.from("integration_test_runs").insert({
      connector_id: data.connectorId,
      test_type: "tool_call",
      completed_at: new Date().toISOString(),
      status,
      latency_ms: result.latency_ms,
      schema_valid: !schemaChanged,
      authorization_valid: result.status !== "denied",
      error_message: result.error ?? null,
      // Preview never exposes sensitive values; only the field shape is stored.
      response_preview: snapshot as never,
      run_by: userId,
    });
    await db.from("integration_connectors").update({ health_status: health, last_health_check_at: new Date().toISOString(), credential_last_tested_at: new Date().toISOString() }).eq("id", data.connectorId);
    await db.from("integration_health_events").insert({ connector_id: data.connectorId, health_status: health, latency_ms: result.latency_ms, error_message: result.error ?? null });
    await audit(db, userId, "connector.test", "integration_connector", data.connectorId, `Tested ${connector.connector_name} via ${toolName}`, { status, latency: result.latency_ms });

    return {
      status,
      health,
      latencyMs: result.latency_ms,
      schemaChanged,
      maskedFields: result.masked_fields ?? [],
      freshness: result.data_freshness,
      error: result.error ?? null,
      shape: JSON.stringify(snapshot),
    };
  });

export const previewConnectorTool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { toolName: string }) => z.object({ toolName: z.string().min(2).max(80) }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.canManageIntegrations, "Only integration administrators may preview connector tools.");
    const result = await runConnectorTool({ db, userId, roles: perms.roles, toolName: data.toolName, params: {}, preview: true });
    return {
      status: result.status,
      source: result.source,
      freshness: result.data_freshness,
      latencyMs: result.latency_ms,
      maskedFields: result.masked_fields ?? [],
      fields: Object.keys(result.data ?? {}),
      normalised: { status: result.status, source: result.source, retrieved_at: result.retrieved_at, data_freshness: result.data_freshness, data: JSON.stringify(result.data ?? null) },
      error: result.error ?? null,
    };
  });

/* ------------------------------------------------------------ knowledge health */

export const getKnowledgeHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db } = await ctx(context);
    const [{ data: gaps }, { data: conflicts }, { data: issues }, { data: retrieval }, { data: coverage }, { data: services }] = await Promise.all([
      db.from("knowledge_gaps").select("id, normalized_topic, language, occurrence_count, average_confidence, human_handoff_count, negative_feedback_count, recommended_source_type, priority_score, status, sample_questions").order("priority_score", { ascending: false }).limit(100),
      db.from("knowledge_conflicts").select("id, conflict_type, affected_topic, severity, source_one_type, source_two_type, conflicting_statement_one, conflicting_statement_two, resolution_status, detected_at").order("detected_at", { ascending: false }).limit(100),
      db.from("knowledge_issue_reports").select("id, source_type, issue_type, description, priority, status, created_at").order("created_at", { ascending: false }).limit(50),
      db.from("knowledge_retrieval_logs").select("source_type, source_id, selected_for_response, citation_used").limit(1000),
      db.from("service_knowledge_health").select("service_id, coverage_score, topics_with_approved_source, total_known_topics, topics_with_ar_content, topics_with_en_content, unresolved_conflicts, knowledge_gaps, updated_at").order("coverage_score").limit(50),
      db.from("university_services").select("id, code, name_en, name_ar"),
    ]);

    const usage = new Map<string, { retrieved: number; cited: number }>();
    for (const r of retrieval ?? []) {
      const key = `${r.source_type}:${r.source_id}`;
      const entry = usage.get(key) ?? { retrieved: 0, cited: 0 };
      entry.retrieved += 1;
      if (r.citation_used) entry.cited += 1;
      usage.set(key, entry);
    }
    const topSources = [...usage.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.retrieved - a.retrieved).slice(0, 10);

    // Index-level health: how much of the corpus is genuinely retrievable.
    const count = async (table: string, apply: (q: any) => any) => {
      const { count: c } = await apply((db as any).from(table).select("id", { count: "exact", head: true }));
      return c ?? 0;
    };
    const [
      activeDocuments, needsReviewDocuments, failedDocuments, docChunks, docChunksEmbedded,
      activeWebSources, webPagesIndexed, webChunks, webChunksEmbedded,
      activeApis, failedApis, englishDocuments, arabicDocuments,
    ] = await Promise.all([
      count("knowledge_documents", (q) => q.eq("is_active", true).eq("approval_status", "approved")),
      count("knowledge_documents", (q) => q.in("approval_status", ["pending_review", "needs_revision", "draft"]).is("deleted_at", null)),
      count("knowledge_documents", (q) => q.or("extraction_status.eq.failed,indexing_status.eq.failed,quality_status.eq.failed")),
      count("document_chunks", (q) => q.eq("is_active", true)),
      count("document_chunks", (q) => q.eq("is_active", true).not("embedding", "is", null)),
      count("web_knowledge_sources", (q) => q.eq("is_active", true).eq("approval_status", "approved")),
      count("web_source_pages", (q) => q.eq("is_active", true).eq("status", "indexed")),
      count("web_page_chunks", (q) => q.eq("is_active", true)),
      count("web_page_chunks", (q) => q.eq("is_active", true).not("embedding", "is", null)),
      count("integration_connectors", (q) => q.eq("is_active", true)),
      count("integration_connectors", (q) => q.eq("health_status", "offline")),
      count("knowledge_documents", (q) => q.eq("is_active", true).eq("language", "en")),
      count("knowledge_documents", (q) => q.eq("is_active", true).eq("language", "ar")),
    ]);
    const { count: emptyRetrievals } = await (db as any)
      .from("knowledge_retrieval_logs")
      .select("id", { count: "exact", head: true })
      .eq("selected_for_response", false);

    const index = {
      activeSources: activeDocuments + activeWebSources + activeApis,
      activeDocuments,
      needsReviewDocuments,
      failedSources: failedDocuments + failedApis,
      activeWebSources,
      webPagesIndexed,
      activeApis,
      indexedChunks: docChunks + webChunks,
      embeddedChunks: docChunksEmbedded + webChunksEmbedded,
      unembeddedChunks: docChunks + webChunks - docChunksEmbedded - webChunksEmbedded,
      englishDocuments,
      arabicDocuments,
      unusedRetrievals: emptyRetrievals ?? 0,
    };

    return {
      index,
      gaps: gaps ?? [],
      conflicts: conflicts ?? [],
      issues: issues ?? [],
      coverage: coverage ?? [],
      services: services ?? [],
      topSources,
    };
  });

export const resolveConflict = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; notes: string }) => z.object({ id: z.string().uuid(), notes: z.string().min(3).max(1000) }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.canApproveKnowledge || perms.canManageKnowledge, "Not authorised.");
    await db.from("knowledge_conflicts").update({ resolution_status: "resolved", resolved_by: userId, resolved_at: new Date().toISOString(), resolution_notes: data.notes }).eq("id", data.id);
    await audit(db, userId, "conflict.resolve", "knowledge_conflict", data.id, "Resolved knowledge conflict", { notes: data.notes });
    return { ok: true };
  });

export const updateGapStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status: string }) =>
    z.object({ id: z.string().uuid(), status: z.enum(["detected", "under_review", "assigned", "content_requested", "content_added", "resolved", "dismissed"]) }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.canManageKnowledge, "Only knowledge managers may update gaps.");
    await db.from("knowledge_gaps").update({ status: data.status }).eq("id", data.id);
    await audit(db, userId, "gap.update", "knowledge_gap", data.id, `Gap marked ${data.status}`);
    return { ok: true };
  });

export const reportKnowledgeIssue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      sourceType: z.string().max(40),
      sourceId: z.string().uuid().nullable().optional(),
      issueType: z.enum(["incorrect_source", "outdated_source", "missing_information", "ambiguous_policy", "arabic_translation", "wrong_owner", "ai_interpretation", "missing_faq", "missing_api_data", "field_mapping", "routing"]),
      description: z.string().max(1000).optional(),
      relatedConversationId: z.string().uuid().nullable().optional(),
      priority: z.enum(["low", "medium", "high"]).default("medium"),
    }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.isStaff, "Only staff may report knowledge issues.");
    const { data: row, error } = await db.from("knowledge_issue_reports").insert({
      source_type: data.sourceType,
      source_id: data.sourceId ?? null,
      reported_by: userId,
      issue_type: data.issueType,
      description: data.description ?? null,
      related_conversation_id: data.relatedConversationId ?? null,
      priority: data.priority,
    }).select("id").single();
    if (error) throw new Error(error.message);
    await audit(db, userId, "knowledge_issue.report", "knowledge_issue_report", row.id, `Reported ${data.issueType}`);
    return { id: row.id };
  });

/* --------------------------------------------------------------- preview/test */

export const previewKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { question: string; lang?: string }) =>
    z.object({ question: z.string().min(3).max(400), lang: z.enum(["en", "ar"]).default("en") }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, perms } = await ctx(context);
    assert(perms.canManageKnowledge || perms.canManageIntegrations, "Not authorised.");
    // Read-only rehearsal: no state-changing tool may run from a preview.
    // Rehearsal always reads live — a cached passage would hide a just-approved change.
    // Same pipeline as the live assistant: retrieval + section filtering +
    // relevance floor, so what the admin sees is what a student would get.
    const { retrieveForGrounding } = await import("./knowledge/retrieval.server");
    const outcome = await retrieveForGrounding(db, data.question, { lang: data.lang, perms, limit: 8, log: false });
    const grounded = outcome.passages;
    const sources = grounded.length
      ? grounded
      : await retrieveKnowledge(db, data.question, { lang: data.lang, perms, limit: 8, useCache: false });
    const conflicts = detectConflicts(sources);
    const selected = grounded[0] ?? null;
    return {
      groundingStatus: outcome.groundingStatus,
      sources: sources.map((s, i) => ({ ...s, rank: i + 1, wouldBeSelected: grounded.includes(s) })),
      conflicts: conflicts.map((c) => ({ topic: c.topic, severity: c.severity, one: c.one.title, two: c.two.title, statementOne: c.statementOne, statementTwo: c.statementTwo })),
      expectedCitation: selected
        ? { title: selected.title, section: selected.sectionTitle, version: selected.version, effectiveDate: selected.effectiveDate, url: selected.citationUrl }
        : null,
      draftAnswer: selected
        ? `${selected.snippet.slice(0, 600)}\n\n_Source: ${selected.title}${selected.version ? ` v${selected.version}` : ""}_`
        : "No approved source currently answers this question — this is a knowledge gap.",
    };
  });

/* ------------------------------------------------------------- export & demo */

export const exportCenterConfiguration = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db, perms } = await ctx(context);
    assert(perms.canManageKnowledge || perms.canManageIntegrations, "Not authorised.");
    const [{ data: docs }, { data: faqs }, { data: connectors }, { data: tools }, { data: mappings }, { data: rules }] = await Promise.all([
      db.from("knowledge_documents").select("title, document_type, language, version, effective_date, review_date, expiry_date, approval_status, confidentiality_level"),
      db.from("faq_items").select("question_en, question_ar, answer_en, answer_ar, approval_status, effective_date, priority"),
      // Credentials and secret names are deliberately excluded from exports.
      db.from("integration_connectors").select("connector_name, source_system, connector_type, environment, authentication_type, data_classification, read_enabled, write_enabled, is_active"),
      db.from("integration_tools").select("tool_name, operation_type, risk_level, confirmation_required, human_approval_required, enabled"),
      db.from("integration_field_mappings").select("external_field, internal_field, data_type, transformation_rule, sensitive, masking_rule"),
      db.from("data_authority_rules").select("data_domain, primary_source_type, secondary_source_type, conflict_behavior, cache_allowed, maximum_staleness_minutes"),
    ]);
    return { exportedAt: new Date().toISOString(), documents: docs ?? [], faqs: faqs ?? [], connectors: connectors ?? [], tools: tools ?? [], fieldMappings: mappings ?? [], authorityRules: rules ?? [] };
  });

export const seedCenterDemoData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.isAdmin || (perms.canManageKnowledge && perms.canManageIntegrations), "Only a system administrator may seed demonstration data.");
    const result = await seedKnowledgeCenter(db, userId);
    await audit(db, userId, "center.seed_demo", "system", null, "Seeded Knowledge & Integrations Center demonstration data", result as unknown as Record<string, unknown>);
    return result;
  });

/* --------------------------------------------------------- unified source library */

export const listKnowledgeSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      search: z.string().max(200).optional(),
      kind: z.string().max(20).optional(),
      status: z.string().max(30).optional(),
      language: z.string().max(10).optional(),
      domain: z.string().max(80).optional(),
      page: z.number().int().min(1).max(500).default(1),
      pageSize: z.number().int().min(5).max(50).default(20),
    }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const { db } = await ctx(context);
    const { listSources } = await import("./knowledge/sources.server");
    return listSources(db, data);
  });

export const getKnowledgeSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { kind: string; id: string }) =>
    z.object({ kind: z.enum(["document", "web", "api"]), id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, perms } = await ctx(context);
    const mod = await import("./knowledge/sources.server");
    if (data.kind === "document") return { document: await mod.getDocumentDetail(db, data.id), web: null, api: null };
    if (data.kind === "web") return { document: null, web: await mod.getWebDetail(db, data.id), api: null };
    assert(perms.canManageIntegrations || perms.isStaff, "Not authorised.");
    return { document: null, web: null, api: await mod.getApiDetail(db, data.id) };
  });

/** Temporarily stop, or resume, the assistant's use of a source. */
export const setKnowledgeSourceEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { kind: string; id: string; enabled: boolean }) =>
    z.object({ kind: z.enum(["document", "web", "api"]), id: z.string().uuid(), enabled: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(data.kind === "api" ? perms.canManageIntegrations : perms.canManageKnowledge, "You are not authorised to change this source.");
    const { setSourceEnabled } = await import("./knowledge/sources.server");
    await setSourceEnabled(db, data.kind, data.id, data.enabled);
    await audit(db, userId, `source.${data.enabled ? "enable" : "disable"}`, data.kind, data.id, `${data.enabled ? "Enabled" : "Disabled"} ${data.kind} source`);
    return { ok: true };
  });

/** Permanent removal: chunks are deleted so nothing orphaned stays retrievable. */
export const deleteKnowledgeSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { kind: string; id: string; reason?: string }) =>
    z.object({ kind: z.enum(["document", "web", "api"]), id: z.string().uuid(), reason: z.string().max(300).optional() }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(data.kind === "api" ? perms.canManageIntegrations : perms.canManageKnowledge, "You are not authorised to delete this source.");
    const { deleteSource } = await import("./knowledge/sources.server");
    const result = await deleteSource(db, data.kind, data.id);
    await audit(db, userId, "source.delete", data.kind, data.id, `Deleted ${data.kind} source`, {
      reason: data.reason ?? null,
      removedChunks: result.removedChunks,
    });
    return result;
  });

const replaceSchema = uploadSchema.extend({ targetDocumentId: z.string().uuid() });

/**
 * Replace an existing document with a new version. The working version stays
 * live until the replacement has been extracted, chunked and indexed cleanly.
 */
export const replaceDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => replaceSchema.parse(d))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.canManageKnowledge, "Only knowledge managers may replace documents.");
    const { data: target } = await db
      .from("knowledge_documents")
      .select("id, title, version, is_active, approval_status")
      .eq("id", data.targetDocumentId)
      .maybeSingle();
    if (!target) throw new Error("The document being replaced no longer exists.");

    const { ingestDocument } = await import("./knowledge/ingest.server");
    const { targetDocumentId, ...rest } = data;
    const result = await ingestDocument(db, userId, { ...rest, supersedesDocumentId: targetDocumentId });

    const failed = result.processingStatus !== "ready_for_review" || result.issues.some((i) => i.severity === "blocking");
    if (failed) {
      // The previous version keeps serving answers; the failed upload stays as a draft.
      await audit(db, userId, "document.replace_failed", "knowledge_document", targetDocumentId,
        `Replacement of "${target.title}" failed validation — the previous version stays active`, { newDocumentId: result.id });
      return { ...result, activated: false, previousKeptActive: true };
    }

    const activate = perms.canApproveKnowledge;
    if (activate) {
      const now = new Date().toISOString();
      await db.from("knowledge_documents").update({
        approval_status: "approved",
        approved_by: userId,
        approved_at: now,
        published_at: now,
        is_active: true,
        is_current: true,
        processing_status: "published",
      }).eq("id", result.id);
      await db.from("knowledge_documents").update({
        is_active: false,
        is_current: false,
        approval_status: "superseded",
        superseded_by_document_id: result.id,
        retired_at: now,
        retirement_reason: `Replaced by version ${data.version}`,
      }).eq("id", targetDocumentId);
      await db.from("document_chunks").update({ is_active: false }).eq("document_id", targetDocumentId);
      invalidateKnowledgeCache("document_replace");
    }
    await audit(db, userId, "document.replace", "knowledge_document", result.id,
      `Replaced "${target.title}" v${target.version ?? "?"} with v${data.version}`, {
        previousDocumentId: targetDocumentId,
        activated: activate,
        chunks: result.chunks,
      });
    return { ...result, activated: activate, previousKeptActive: !activate };
  });

/** Retrieval rehearsal for one source, using the assistant's own search path. */
export const testKnowledgeSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { kind: string; id: string; question: string; lang?: string }) =>
    z.object({
      kind: z.enum(["document", "web", "api"]),
      id: z.string().uuid(),
      question: z.string().trim().min(3).max(400),
      lang: z.enum(["en", "ar"]).default("en"),
    }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, perms } = await ctx(context);
    const passages = await retrieveKnowledge(db, data.question, { lang: data.lang, perms, limit: 8, useCache: false });
    const ranked = passages.map((p, i) => ({
      rank: i + 1,
      fromThisSource: p.sourceId === data.id,
      title: p.title,
      sectionTitle: p.sectionTitle,
      pageNumber: p.pageNumber ?? null,
      score: Number((p.score ?? 0).toFixed(3)),
      snippet: p.snippet.slice(0, 300),
    }));
    const best = ranked.find((r) => r.fromThisSource) ?? null;
    const top = passages[0] ?? null;
    return {
      passages: ranked,
      retrievedFromSource: !!best,
      bestRank: best?.rank ?? null,
      answer: top
        ? `${top.snippet.slice(0, 600)}\n\n_Source: ${top.title}${top.version ? ` v${top.version}` : ""}${top.sectionTitle ? ` § ${top.sectionTitle}` : ""}_`
        : "No approved source currently answers this question.",
    };
  });


/* ------------------------------------------------------- semantic index repair */

/**
 * Fills missing chunk embeddings (documents and web pages) so semantic
 * retrieval covers sources indexed before the semantic layer existed.
 */
export const rebuildSemanticIndex = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { limit?: number } | undefined) => z.object({ limit: z.number().int().min(1).max(500).default(300) }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const { db, userId, perms } = await ctx(context);
    assert(perms.canManageKnowledge, "Only knowledge managers may rebuild the semantic index.");
    const { backfillEmbeddings } = await import("./knowledge/embeddings.server");
    const result = await backfillEmbeddings(db, data.limit);
    invalidateKnowledgeCache("semantic_index_rebuild");
    await audit(db, userId, "knowledge.rebuild_semantic_index", "knowledge_document", null, `Embedded ${result.documents + result.web} chunk(s)`, result);
    return result;
  });
