/**
 * Unified knowledge-source registry: documents, web pages and data connections
 * presented as one managed library with lifecycle actions. Server only.
 */
import type { Db } from "../agent/tools.server";
import { retrievalBlockers } from "./reprocess.server";
import { invalidateKnowledgeCache } from "./retrieval.server";

export type SourceKind = "document" | "web" | "api";

export type SourceStatus =
  | "processing"
  | "indexed"
  | "active"
  | "needs_review"
  | "failed"
  | "replaced"
  | "disabled"
  | "deleted";

export type SourceRow = {
  key: string;
  kind: SourceKind;
  id: string;
  name: string;
  format: string;
  domain: string | null;
  language: string;
  status: SourceStatus;
  version: string | null;
  addedBy: string | null;
  addedAt: string | null;
  updatedAt: string | null;
  lastIndexedAt: string | null;
  units: number | null;
  unitLabel: string;
  retrievable: boolean;
  retrievalNote: string;
  enabled: boolean;
};

type DocRow = {
  id: string;
  title: string;
  document_type: string | null;
  knowledge_domain: string | null;
  language: string | null;
  version: string | null;
  approval_status: string | null;
  processing_status: string | null;
  extraction_status: string | null;
  indexing_status: string | null;
  quality_status: string | null;
  is_active: boolean | null;
  is_current: boolean | null;
  deleted_at: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  superseded_by_document_id: string | null;
  mime_type: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  owner_unit_id: string | null;
};

const FORMAT: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "text/csv": "CSV",
  "text/markdown": "MD",
  "text/plain": "TXT",
};

/** Lifecycle status of one document, derived from its processing + governance state. */
export function documentStatus(doc: DocRow): SourceStatus {
  if (doc.deleted_at) return "deleted";
  if (doc.superseded_by_document_id) return "replaced";
  if (doc.extraction_status === "failed" || doc.indexing_status === "failed" || doc.quality_status === "failed") return "failed";
  if (doc.processing_status === "processing" || doc.processing_status === "reprocessing") return "processing";
  if (doc.approval_status === "retired") return "disabled";
  if (doc.approval_status === "approved" || doc.approval_status === "published") {
    if (!doc.is_active || !doc.is_current) return "disabled";
    return retrievalBlockers(doc).length === 0 ? "active" : "needs_review";
  }
  return doc.indexing_status === "completed" ? "needs_review" : "indexed";
}

function webStatus(s: { is_active: boolean | null; health_status: string | null; change_detected: boolean | null; approval_status: string | null }): SourceStatus {
  if (s.health_status === "failed" || s.health_status === "removed") return "failed";
  if (!s.is_active) return "disabled";
  if (s.change_detected) return "needs_review";
  return s.approval_status === "approved" ? "active" : "needs_review";
}

function apiStatus(c: { is_active: boolean | null; health_status: string | null }): SourceStatus {
  if (!c.is_active) return "disabled";
  if (["offline", "authentication_failed", "failed"].includes(String(c.health_status))) return "failed";
  if (["degraded", "schema_changed"].includes(String(c.health_status))) return "needs_review";
  return "active";
}

async function actorNames(db: Db, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  if (!unique.length) return new Map();
  const { data } = await db.from("profiles").select("id, full_name, email").in("id", unique);
  const map = new Map<string, string>();
  for (const row of (data ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
    map.set(row.id, row.full_name || row.email || "—");
  }
  return map;
}

export type SourceFilters = {
  search?: string | undefined;
  kind?: string | undefined;
  status?: string | undefined;
  language?: string | undefined;
  domain?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
};

export type AuditRow = { id: string; action: string; summary: string | null; created_at: string };
type VersionRow = {
  id: string; version: string | null; approval_status: string | null; is_active: boolean | null;
  is_current: boolean | null; effective_date: string | null; expiry_date: string | null;
  created_at: string | null; retirement_reason: string | null;
  superseded_by_document_id: string | null; supersedes_document_id: string | null;
};
type WebChangeRow = {
  id: string; change_type: string | null; change_summary: string | null;
  change_percentage: number | null; detected_at: string; review_status: string | null;
};
type ToolRow = { id: string; tool_name: string; display_name_en: string | null; operation_type: string | null; risk_level: string | null; enabled: boolean | null };
type TestRow = { id: string; status: string | null; latency_ms: number | null; error_message: string | null; started_at: string };
type HealthRow = { id: string; health_status: string | null; latency_ms: number | null; error_message: string | null; detected_at: string };

/**
 * One paginated list across all three source kinds. Only metadata is loaded —
 * chunk text and extraction output stay behind the detail view.
 */
export async function listSources(db: Db, filters: SourceFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(50, Math.max(5, filters.pageSize ?? 20));
  const wantKind = filters.kind && filters.kind !== "all" ? filters.kind : null;

  const [docsRes, webRes, apiRes, units] = await Promise.all([
    wantKind && wantKind !== "document"
      ? Promise.resolve({ data: [] as DocRow[] })
      : db
          .from("knowledge_documents")
          .select(
            "id, title, document_type, knowledge_domain, language, version, approval_status, processing_status, extraction_status, indexing_status, quality_status, is_active, is_current, deleted_at, effective_date, expiry_date, superseded_by_document_id, mime_type, created_by, created_at, updated_at, owner_unit_id",
          )
          .order("updated_at", { ascending: false })
          .limit(500),
    wantKind && wantKind !== "web"
      ? Promise.resolve({ data: [] as Record<string, unknown>[] })
      : db
          .from("web_knowledge_sources")
          .select(
            "id, title, url, language, source_category, is_active, health_status, change_detected, approval_status, last_checked_at, last_changed_at, last_successful_fetch_at, created_by, created_at, updated_at, owner_unit_id",
          )
          .order("updated_at", { ascending: false })
          .limit(300),
    wantKind && wantKind !== "api"
      ? Promise.resolve({ data: [] as Record<string, unknown>[] })
      : db
          .from("integration_connectors")
          .select(
            "id, connector_name, display_name_en, source_system, connector_type, data_classification, is_active, health_status, last_health_check_at, created_at, updated_at",
          )
          .order("source_system")
          .limit(300),
    db.from("service_units").select("id, code, name_en").limit(200),
  ]);

  const unitCode = new Map<string, string>();
  for (const u of ((units.data ?? []) as { id: string; code: string | null; name_en: string | null }[]))
    unitCode.set(u.id, u.code ?? u.name_en ?? "");

  const rows: SourceRow[] = [];

  for (const d of (docsRes.data ?? []) as DocRow[]) {
    const status = documentStatus(d);
    rows.push({
      key: `document:${d.id}`,
      kind: "document",
      id: d.id,
      name: d.title,
      format: FORMAT[d.mime_type ?? ""] ?? (d.document_type ?? "DOC").replace(/_/g, " ").toUpperCase(),
      domain: d.knowledge_domain ?? (d.owner_unit_id ? unitCode.get(d.owner_unit_id) ?? null : null),
      language: (d.language ?? "en").toUpperCase(),
      status,
      version: d.version,
      addedBy: d.created_by,
      addedAt: d.created_at,
      updatedAt: d.updated_at,
      lastIndexedAt: d.updated_at,
      units: null,
      unitLabel: "chunks",
      retrievable: retrievalBlockers(d).length === 0,
      retrievalNote: retrievalBlockers(d)[0] ?? "Searchable by the assistant",
      enabled: !!d.is_active && !d.deleted_at,
    });
  }

  for (const raw of (webRes.data ?? []) as Record<string, unknown>[]) {
    const s = raw as unknown as {
      id: string; title: string; url: string; language: string | null; source_category: string | null;
      is_active: boolean | null; health_status: string | null; change_detected: boolean | null; approval_status: string | null;
      last_checked_at: string | null; last_successful_fetch_at: string | null; created_by: string | null;
      created_at: string | null; updated_at: string | null; owner_unit_id: string | null;
    };
    const status = webStatus(s);
    rows.push({
      key: `web:${s.id}`,
      kind: "web",
      id: s.id,
      name: s.title,
      format: "URL",
      domain: s.owner_unit_id ? unitCode.get(s.owner_unit_id) ?? s.source_category : s.source_category,
      language: (s.language ?? "en").toUpperCase(),
      status,
      version: null,
      addedBy: s.created_by,
      addedAt: s.created_at,
      updatedAt: s.updated_at,
      lastIndexedAt: s.last_successful_fetch_at,
      units: null,
      unitLabel: "pages",
      retrievable: status === "active",
      retrievalNote: status === "active" ? "Searchable by the assistant" : `Web source is ${status.replace(/_/g, " ")}`,
      enabled: !!s.is_active,
    });
  }

  for (const raw of (apiRes.data ?? []) as Record<string, unknown>[]) {
    const c = raw as unknown as {
      id: string; connector_name: string; display_name_en: string | null; source_system: string | null;
      connector_type: string | null; data_classification: string | null; is_active: boolean | null;
      health_status: string | null; last_health_check_at: string | null; created_at: string | null; updated_at: string | null;
    };
    const status = apiStatus(c);
    rows.push({
      key: `api:${c.id}`,
      kind: "api",
      id: c.id,
      name: c.display_name_en || c.connector_name,
      format: (c.connector_type ?? "API").toUpperCase(),
      domain: c.source_system,
      language: "—",
      status,
      version: null,
      addedBy: null,
      addedAt: c.created_at,
      updatedAt: c.updated_at,
      lastIndexedAt: c.last_health_check_at,
      units: null,
      unitLabel: "tools",
      retrievable: status === "active",
      retrievalNote: status === "active" ? "Available to the assistant at request time" : `Connection is ${status.replace(/_/g, " ")}`,
      enabled: !!c.is_active,
    });
  }

  const search = (filters.search ?? "").trim().toLowerCase();
  let filtered = rows.filter((r) => {
    if (search && !`${r.name} ${r.domain ?? ""} ${r.format}`.toLowerCase().includes(search)) return false;
    if (filters.status && filters.status !== "all" && r.status !== filters.status) return false;
    if (filters.language && filters.language !== "all" && r.language !== filters.language.toUpperCase()) return false;
    if (filters.domain && filters.domain !== "all" && (r.domain ?? "") !== filters.domain) return false;
    return true;
  });
  filtered = filtered.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));

  const summary = {
    total: rows.length,
    documents: rows.filter((r) => r.kind === "document").length,
    web: rows.filter((r) => r.kind === "web").length,
    apis: rows.filter((r) => r.kind === "api").length,
    active: rows.filter((r) => r.status === "active").length,
    needsReview: rows.filter((r) => r.status === "needs_review").length,
    failed: rows.filter((r) => r.status === "failed").length,
    disabled: rows.filter((r) => r.status === "disabled").length,
  };

  const total = filtered.length;
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Counts and people are resolved only for the rows actually shown.
  const [names] = await Promise.all([actorNames(db, pageRows.map((r) => r.addedBy))]);
  await Promise.all(
    pageRows.map(async (r) => {
      if (r.kind === "document") {
        const { count } = await db.from("document_chunks").select("id", { count: "exact", head: true }).eq("document_id", r.id).eq("is_active", true);
        r.units = count ?? 0;
      } else if (r.kind === "api") {
        const { count } = await db.from("integration_tools").select("id", { count: "exact", head: true }).eq("connector_id", r.id).eq("enabled", true);
        r.units = count ?? 0;
      } else {
        r.units = r.lastIndexedAt ? 1 : 0;
      }
      r.addedBy = r.addedBy ? names.get(r.addedBy) ?? "—" : null;
    }),
  );

  return { rows: pageRows, total, page, pageSize, summary, domains: [...new Set(rows.map((r) => r.domain).filter(Boolean))] as string[] };
}

/* --------------------------------------------------------------------- detail */

export async function getDocumentDetail(db: Db, id: string) {
  const { data: doc, error } = await db.from("knowledge_documents").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!doc) throw new Error("Source not found.");
  const d = doc as unknown as DocRow & Record<string, unknown>;

  const [{ data: chunks, count }, { data: logs }, { data: trail }, { data: versions }] = await Promise.all([
    db
      .from("document_chunks")
      .select("chunk_index, section_title, section_path, page_number, token_count, content, is_active", { count: "exact" })
      .eq("document_id", id)
      .order("chunk_index")
      .limit(80),
    db
      .from("knowledge_retrieval_logs")
      .select("query_text, retrieval_score, selected_for_response, retrieved_at, section_title")
      .eq("source_id", id)
      .order("retrieved_at", { ascending: false })
      .limit(10),
    db.from("knowledge_audit_log").select("id, action, summary, created_at").eq("entity_id", id).order("created_at", { ascending: false }).limit(25),
    db
      .from("knowledge_documents")
      .select("id, version, approval_status, is_active, is_current, effective_date, expiry_date, created_at, retirement_reason, superseded_by_document_id, supersedes_document_id")
      .or(`id.eq.${id},supersedes_document_id.eq.${id},superseded_by_document_id.eq.${id}`)
      .order("created_at"),
  ]);

  const rows = (chunks ?? []) as { chunk_index: number; section_title: string | null; page_number: number | null; token_count: number | null; content: string; is_active: boolean }[];
  const headings = [...new Set(rows.map((c) => c.section_title).filter(Boolean))] as string[];

  return {
    kind: "document" as const,
    id,
    title: String(d.title),
    documentType: d.document_type,
    fileName: (d as Record<string, unknown>)["file_name"] as string | null,
    storagePath: (d as Record<string, unknown>)["storage_path"] as string | null,
    mimeType: d.mime_type,
    language: d.language,
    detectedLanguage: (d as Record<string, unknown>)["detected_language"] as string | null,
    knowledgeDomain: d.knowledge_domain,
    ownerUnitId: d.owner_unit_id,
    version: d.version,
    effectiveDate: d.effective_date,
    expiryDate: d.expiry_date,
    reviewDate: (d as Record<string, unknown>)["review_date"] as string | null,
    approvalStatus: d.approval_status,
    processingStatus: d.processing_status,
    extractionStatus: d.extraction_status,
    extractionError: (d as Record<string, unknown>)["extraction_error"] as string | null,
    indexingStatus: d.indexing_status,
    qualityStatus: d.quality_status,
    qualityIssues: ((d as Record<string, unknown>)["quality_issues"] ?? []) as { code: string; severity: string; message: string }[],
    confidentiality: (d as Record<string, unknown>)["confidentiality_level"] as string | null,
    status: documentStatus(d),
    blockers: retrievalBlockers(d),
    chunkCount: count ?? rows.length,
    pages: Math.max(0, ...rows.map((c) => c.page_number ?? 0)) || null,
    headings,
    chunks: rows.map((c) => ({
      index: c.chunk_index,
      sectionTitle: c.section_title,
      pageNumber: c.page_number,
      tokens: c.token_count,
      active: c.is_active,
      preview: c.content.slice(0, 600),
    })),
    extractedText: rows.map((c) => c.content).join("\n\n").slice(0, 40_000),
    retrieval: (logs ?? []) as { query_text: string; retrieval_score: number | null; selected_for_response: boolean | null; retrieved_at: string; section_title: string | null }[],
    audit: (trail ?? []) as AuditRow[],
    versions: (versions ?? []) as unknown as VersionRow[],
    updatedAt: d.updated_at,
    createdAt: d.created_at,
  };
}

export async function getWebDetail(db: Db, id: string) {
  const { data: s } = await db.from("web_knowledge_sources").select("*").eq("id", id).maybeSingle();
  if (!s) throw new Error("Source not found.");
  const row = s as Record<string, unknown>;
  const [{ data: changes }, { data: trail }] = await Promise.all([
    db.from("web_source_changes").select("id, change_type, change_summary, change_percentage, detected_at, review_status").eq("web_source_id", id).order("detected_at", { ascending: false }).limit(20),
    db.from("knowledge_audit_log").select("id, action, summary, created_at").eq("entity_id", id).order("created_at", { ascending: false }).limit(25),
  ]);
  const text = String(row["extracted_text"] ?? "");
  return {
    kind: "web" as const,
    id,
    title: String(row["title"] ?? ""),
    url: String(row["url"] ?? ""),
    domain: (() => { try { return new URL(String(row["url"])).hostname; } catch { return null; } })(),
    language: row["language"] as string | null,
    category: row["source_category"] as string | null,
    refreshFrequency: row["refresh_frequency"] as string | null,
    trustedAutoRefresh: !!row["trusted_auto_refresh"],
    contentHash: row["content_hash"] as string | null,
    lastCheckedAt: row["last_checked_at"] as string | null,
    lastChangedAt: row["last_changed_at"] as string | null,
    lastFetchAt: row["last_successful_fetch_at"] as string | null,
    healthStatus: row["health_status"] as string | null,
    approvalStatus: row["approval_status"] as string | null,
    changeDetected: !!row["change_detected"],
    isActive: !!row["is_active"],
    status: webStatus(row as never),
    extractedText: text.slice(0, 20_000),
    textLength: text.length,
    changes: (changes ?? []) as unknown as WebChangeRow[],
    audit: (trail ?? []) as unknown as AuditRow[],
  };
}

export async function getApiDetail(db: Db, id: string) {
  const { data: c } = await db.from("integration_connectors").select("*").eq("id", id).maybeSingle();
  if (!c) throw new Error("Source not found.");
  const row = c as Record<string, unknown>;
  const [{ data: tools }, { data: tests }, { data: health }, { data: trail }] = await Promise.all([
    db.from("integration_tools").select("id, tool_name, display_name_en, operation_type, risk_level, enabled").eq("connector_id", id).order("tool_name"),
    db.from("integration_test_runs").select("id, status, latency_ms, error_message, started_at").eq("connector_id", id).order("started_at", { ascending: false }).limit(10),
    db.from("integration_health_events").select("id, health_status, latency_ms, error_message, detected_at").eq("connector_id", id).order("detected_at", { ascending: false }).limit(10),
    db.from("knowledge_audit_log").select("id, action, summary, created_at").eq("entity_id", id).order("created_at", { ascending: false }).limit(25),
  ]);
  const lastSuccess = (tests ?? []).find((t) => (t as { status: string }).status === "passed") as { started_at: string } | undefined;
  const lastError = (tests ?? []).find((t) => (t as { error_message: string | null }).error_message) as { error_message: string; started_at: string } | undefined;
  return {
    kind: "api" as const,
    id,
    name: String(row["display_name_en"] ?? row["connector_name"] ?? ""),
    connectorName: String(row["connector_name"] ?? ""),
    sourceSystem: row["source_system"] as string | null,
    connectorType: row["connector_type"] as string | null,
    // Knowledge connections feed the index; operational ones answer live.
    usage: (row["connector_type"] === "knowledge_api" || row["data_classification"] === "reference") ? "knowledge" : "live_operational",
    environment: row["environment"] as string | null,
    baseUrl: row["base_url"] as string | null,
    authenticationType: row["authentication_type"] as string | null,
    // The secret itself is never read or returned; only whether one is configured.
    credentialMask: row["credential_configured"] ? "••••••••" : null,
    credentialLastTestedAt: row["credential_last_tested_at"] as string | null,
    dataClassification: row["data_classification"] as string | null,
    readEnabled: !!row["read_enabled"],
    writeEnabled: !!row["write_enabled"],
    isActive: !!row["is_active"],
    healthStatus: row["health_status"] as string | null,
    lastHealthCheckAt: row["last_health_check_at"] as string | null,
    lastSuccessAt: lastSuccess?.started_at ?? null,
    lastError: lastError ? { message: lastError.error_message, at: lastError.started_at } : null,
    status: apiStatus(row as never),
    tools: (tools ?? []) as unknown as ToolRow[],
    tests: (tests ?? []) as unknown as TestRow[],
    health: (health ?? []) as unknown as HealthRow[],
    audit: (trail ?? []) as unknown as AuditRow[],
  };
}

/* -------------------------------------------------------------------- actions */

/** Temporarily stop (or resume) the assistant using a source, without deleting it. */
export async function setSourceEnabled(db: Db, kind: SourceKind, id: string, enabled: boolean): Promise<void> {
  if (kind === "document") {
    await db.from("knowledge_documents").update({
      is_active: enabled,
      is_current: enabled,
      approval_status: enabled ? "approved" : "retired",
      retired_at: enabled ? null : new Date().toISOString(),
      retirement_reason: enabled ? null : "Disabled by an administrator",
    }).eq("id", id);
    await db.from("document_chunks").update({ is_active: enabled }).eq("document_id", id);
  } else if (kind === "web") {
    await db.from("web_knowledge_sources").update({ is_active: enabled }).eq("id", id);
  } else {
    await db.from("integration_connectors").update({ is_active: enabled, read_enabled: enabled }).eq("id", id);
  }
  invalidateKnowledgeCache(`source_${enabled ? "enable" : "disable"}`);
}

/**
 * Remove a source from the assistant's reach for good. Searchable chunks are
 * physically deleted so nothing orphaned can be retrieved; the row keeps only
 * the metadata an audit needs.
 */
export async function deleteSource(db: Db, kind: SourceKind, id: string): Promise<{ removedChunks: number }> {
  let removedChunks = 0;
  if (kind === "document") {
    const { count } = await db.from("document_chunks").select("id", { count: "exact", head: true }).eq("document_id", id);
    removedChunks = count ?? 0;
    await db.from("document_chunks").delete().eq("document_id", id);
    const { data: doc } = await db.from("knowledge_documents").select("storage_path").eq("id", id).maybeSingle();
    const path = (doc as { storage_path: string | null } | null)?.storage_path;
    if (path) {
      try {
        await (db as unknown as { storage: { from: (b: string) => { remove: (p: string[]) => Promise<unknown> } } }).storage
          .from("knowledge-files")
          .remove([path]);
      } catch {
        /* the record is still removed from retrieval even if the file lingers */
      }
    }
    await db.from("knowledge_documents").update({
      deleted_at: new Date().toISOString(),
      is_active: false,
      is_current: false,
      approval_status: "retired",
      retirement_reason: "Deleted from the knowledge centre",
      storage_path: null,
    }).eq("id", id);
  } else if (kind === "web") {
    await db.from("web_source_changes").delete().eq("web_source_id", id);
    const { error } = await db.from("web_knowledge_sources").delete().eq("id", id);
    if (error) await db.from("web_knowledge_sources").update({ is_active: false, approval_status: "rejected", health_status: "removed" }).eq("id", id);
  } else {
    await db.from("integration_tools").update({ enabled: false }).eq("connector_id", id);
    await db.from("integration_connectors").update({
      is_active: false,
      read_enabled: false,
      write_enabled: false,
      health_status: "offline",
    }).eq("id", id);
  }
  invalidateKnowledgeCache("source_delete");
  return { removedChunks };
}
