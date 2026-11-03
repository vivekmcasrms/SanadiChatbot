/**
 * Re-index an already uploaded document with the current chunking rules and
 * explain why a given question does (or does not) retrieve its sections.
 * Server only.
 */
import type { Db } from "../agent/tools.server";
import { chunkText, detectLanguage, runQualityChecks } from "./processing.server";
import { sectionTermsFor } from "./retrieval.server";

export type ReprocessResult = {
  documentId: string;
  title: string;
  source: "storage" | "existing_chunks";
  chunks: number;
  sections: string[];
  pages: number | null;
  searchable: boolean;
  blockers: string[];
};

/** Rebuild the text of a document from its stored chunks (no file needed). */
async function textFromChunks(db: Db, documentId: string): Promise<string> {
  const { data } = await db
    .from("document_chunks")
    .select("chunk_index, content")
    .eq("document_id", documentId)
    .order("chunk_index");
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const row of data ?? []) {
    const body = String((row as { content: string }).content ?? "").trim();
    if (!body || seen.has(body)) continue;
    seen.add(body);
    parts.push(body);
  }
  return parts.join("\n\n");
}

/** Why a document cannot appear in assistant answers right now. */
export function retrievalBlockers(doc: {
  approval_status: string | null;
  is_active: boolean | null;
  is_current: boolean | null;
  deleted_at: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  superseded_by_document_id: string | null;
}): string[] {
  const today = new Date().toISOString().slice(0, 10);
  const blockers: string[] = [];
  if (doc.approval_status !== "approved") blockers.push(`Approval status is "${doc.approval_status ?? "unknown"}" — only approved documents are searchable.`);
  if (!doc.is_active) blockers.push("The document is not active.");
  if (!doc.is_current) blockers.push("The document is not marked as the current version.");
  if (doc.deleted_at) blockers.push("The document is deleted.");
  if (doc.superseded_by_document_id) blockers.push("The document has been superseded by a newer version.");
  if (doc.effective_date && doc.effective_date > today) blockers.push(`The effective date (${doc.effective_date}) is in the future.`);
  if (doc.expiry_date && doc.expiry_date < today) blockers.push(`The document expired on ${doc.expiry_date}.`);
  return blockers;
}

/**
 * Re-extract (from the stored file when available) and re-chunk a document
 * in place — no manual re-upload required.
 */
export async function reprocessDocument(db: Db, documentId: string): Promise<ReprocessResult> {
  const { data: doc, error } = await db
    .from("knowledge_documents")
    .select("id, title, language, version, effective_date, expiry_date, storage_path, mime_type, approval_status, is_active, is_current, deleted_at, superseded_by_document_id")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!doc) throw new Error("Document not found.");

  let text = "";
  let source: ReprocessResult["source"] = "existing_chunks";
  if (doc.storage_path && doc.mime_type) {
    const { data: file } = await (db as unknown as {
      storage: { from: (b: string) => { download: (p: string) => Promise<{ data: Blob | null }> } };
    }).storage.from("knowledge-files").download(doc.storage_path);
    if (file) {
      const { extractDocumentText } = await import("./extract.server");
      const extracted = await extractDocumentText(await file.arrayBuffer(), doc.mime_type);
      text = extracted.text.replace(/\u0000/g, "").trim();
      if (text) source = "storage";
    }
  }
  if (!text) text = await textFromChunks(db, documentId);
  if (!text.trim()) throw new Error("No text is available for this document; re-upload the file.");

  const chunks = chunkText(text);
  if (!chunks.length) throw new Error("Re-processing produced no chunks.");

  await db.from("document_chunks").delete().eq("document_id", documentId);
  const { data: inserted, error: insertError } = await db
    .from("document_chunks")
    .insert(
      chunks.map((c) => ({
        document_id: documentId,
        chunk_index: c.chunkNumber,
        content: c.content,
        token_count: c.tokenCount,
        section_title: c.sectionTitle,
        section_path: c.sectionPath,
        page_number: c.pageNumber,
        source_locator: c.sourceLocator,
        is_active: true,
      })),
    )
    .select("id, content, section_title");
  if (insertError) throw new Error(insertError.message);

  const { embedChunkRows } = await import("./embeddings.server");
  await embedChunkRows(
    db,
    "document_chunks",
    ((inserted ?? []) as { id: string; content: string; section_title: string | null }[]).map((r) => ({
      id: r.id,
      content: r.content,
      sectionTitle: r.section_title,
      title: String(doc.title ?? ""),
    })),
  ).catch(() => 0);


  const detected = detectLanguage(text);
  const issues = runQualityChecks({
    text,
    chunks,
    detectedLanguage: detected,
    declaredLanguage: String(doc.language ?? "en"),
    effectiveDate: doc.effective_date ?? null,
    expiryDate: doc.expiry_date ?? null,
    version: doc.version ?? null,
    duplicateOfTitle: null,
    duplicateChunkCount: 0,
  });
  const blocking = issues.some((i) => i.severity === "blocking");

  await db
    .from("knowledge_documents")
    .update({
      detected_language: detected,
      extraction_status: "completed",
      chunking_status: "completed",
      indexing_status: "completed",
      embedding_status: "completed",
      quality_status: blocking ? "failed" : issues.length ? "flagged" : "passed",
      quality_issues: issues as never,
      processing_status: blocking ? "processing_failed" : "ready_for_review",
      extraction_error: null,
    })
    .eq("id", documentId);

  const sections = [...new Set(chunks.map((c) => c.sectionTitle).filter((s): s is string => Boolean(s)))];
  return {
    documentId,
    title: String(doc.title ?? ""),
    source,
    chunks: chunks.length,
    sections,
    pages: chunks.reduce((max, c) => Math.max(max, c.pageNumber ?? 0), 0) || null,
    searchable: retrievalBlockers(doc as never).length === 0,
    blockers: retrievalBlockers(doc as never),
  };
}

export type ChunkDiagnostic = {
  chunkIndex: number;
  sectionTitle: string | null;
  sectionPath: string | null;
  pageNumber: number | null;
  score: number;
  headingMatch: boolean;
  preview: string;
};

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/**
 * Explain retrieval for one document: which of its chunks match a question,
 * how strongly, and whether the document is searchable at all.
 */
export async function diagnoseDocumentRetrieval(
  db: Db,
  documentId: string,
  query: string,
): Promise<{
  title: string;
  searchable: boolean;
  blockers: string[];
  sectionTerms: string[];
  totalChunks: number;
  matches: ChunkDiagnostic[];
}> {
  const { data: doc } = await db
    .from("knowledge_documents")
    .select("id, title, approval_status, is_active, is_current, deleted_at, effective_date, expiry_date, superseded_by_document_id")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) throw new Error("Document not found.");

  const { data: rows } = await db
    .from("document_chunks")
    .select("chunk_index, section_title, section_path, page_number, content")
    .eq("document_id", documentId)
    .order("chunk_index");

  const words = tokens(query);
  const terms = sectionTermsFor(query);
  const matches: ChunkDiagnostic[] = (rows ?? []).map((r) => {
    const row = r as { chunk_index: number; section_title: string | null; section_path: string | null; page_number: number | null; content: string };
    const body = String(row.content ?? "");
    const haystack = `${row.section_title ?? ""} ${body}`.toLowerCase();
    const heading = (row.section_title ?? "").toLowerCase();
    const hits = words.filter((w) => haystack.includes(w)).length;
    const headingMatch =
      terms.some((t) => heading.includes(t)) || words.some((w) => heading.includes(w));
    const score = (words.length ? hits / words.length : 0) * 0.7 + (headingMatch ? 0.3 : 0);
    return {
      chunkIndex: row.chunk_index,
      sectionTitle: row.section_title,
      sectionPath: row.section_path,
      pageNumber: row.page_number,
      score: Number(score.toFixed(3)),
      headingMatch,
      preview: body.slice(0, 240),
    };
  });

  matches.sort((a, b) => b.score - a.score);
  return {
    title: String(doc.title ?? ""),
    searchable: retrievalBlockers(doc as never).length === 0,
    blockers: retrievalBlockers(doc as never),
    sectionTerms: terms,
    totalChunks: matches.length,
    matches: matches.filter((m) => m.score > 0).slice(0, 8),
  };
}
