/**
 * Shared document ingestion: validate → extract → chunk → index → quality
 * check. Used by both first upload and replacement uploads. Server only.
 */
import type { Db } from "../agent/tools.server";
import {
  checksum,
  chunkText,
  detectInjection,
  detectLanguage,
  malwareScan,
  runQualityChecks,
  SUPPORTED_MIME,
  validateFile,
  type QualityIssue,
} from "./processing.server";

export type IngestInput = {
  title: string;
  documentType: string;
  categoryId?: string | null | undefined;
  ownerUnitId?: string | null | undefined;
  language: "en" | "ar";
  version: string;
  effectiveDate: string;
  reviewDate?: string | null | undefined;
  expiryDate?: string | null | undefined;
  confidentialityLevel: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  textContent?: string | undefined;
  storagePath?: string | null | undefined;
  structuredKind?: string | null | undefined;
  supersedesDocumentId?: string | null | undefined;
  knowledgeDomain?: string | null | undefined;
  notes?: string | null | undefined;
};

export type IngestResult = {
  id: string;
  chunks: number;
  issues: QualityIssue[];
  processingStatus: "ready_for_review" | "processing_failed";
};

export async function ingestDocument(db: Db, userId: string, data: IngestInput): Promise<IngestResult> {
  const validation = validateFile({ mimeType: data.mimeType, sizeBytes: data.sizeBytes, fileName: data.fileName });
  if (!validation.ok) throw new Error(validation.error);
  const scan = await malwareScan(data.sizeBytes);
  if (!scan.clean) throw new Error("The file failed the malware scan.");

  const spec = SUPPORTED_MIME[data.mimeType]!;
  let text = (data.textContent ?? "").trim();
  let extractionError: string | null = null;
  if (!text && data.storagePath) {
    const { data: file, error: dlError } = await (db as unknown as {
      storage: { from: (b: string) => { download: (p: string) => Promise<{ data: Blob | null; error: { message: string } | null }> } };
    }).storage.from("knowledge-files").download(data.storagePath);
    if (dlError || !file) {
      extractionError = dlError?.message ?? "The uploaded file could not be read.";
    } else {
      const { extractDocumentText } = await import("./extract.server");
      const extracted = await extractDocumentText(await file.arrayBuffer(), data.mimeType);
      text = extracted.text.replace(/\u0000/g, "").trim();
      extractionError = extracted.error;
      if (!text && !extractionError)
        extractionError = `No selectable text was found in this ${spec.ext.toUpperCase()} file; it may be a scan. Paste the text instead.`;
    }
  }

  const extractionOk = text.length > 0;
  const detected = detectLanguage(text);
  const chunks = extractionOk ? chunkText(text) : [];
  const sum = await checksum(text || data.fileName);

  const { data: dupe } = await db.from("knowledge_documents").select("id, title").eq("checksum", sum).is("deleted_at", null).limit(1).maybeSingle();
  const issues = runQualityChecks({
    text,
    chunks,
    detectedLanguage: detected,
    declaredLanguage: data.language,
    effectiveDate: data.effectiveDate,
    expiryDate: data.expiryDate ?? null,
    version: data.version,
    duplicateOfTitle: dupe?.title ?? null,
    duplicateChunkCount: 0,
  });
  const injection = detectInjection(text);
  if (injection.length)
    issues.push({ code: "prompt_injection", severity: "warning", message: `Instruction-like text detected and neutralised (${injection.length} pattern(s)).` });

  const blocking = issues.some((i) => i.severity === "blocking");
  const { data: doc, error } = await db
    .from("knowledge_documents")
    .insert({
      title: data.title,
      description: text.slice(0, 400) || null,
      document_type: data.documentType,
      category_id: data.categoryId ?? null,
      owner_unit_id: data.ownerUnitId ?? null,
      service_unit_id: data.ownerUnitId ?? null,
      knowledge_domain: data.knowledgeDomain ?? null,
      language: data.language,
      authoritative_language: data.language,
      version: data.version,
      effective_date: data.effectiveDate,
      review_date: data.reviewDate ?? null,
      expiry_date: data.expiryDate ?? null,
      confidentiality_level: data.confidentialityLevel,
      file_name: data.fileName,
      file_size_bytes: data.sizeBytes,
      mime_type: data.mimeType,
      storage_path: data.storagePath ?? null,
      checksum: sum,
      detected_language: detected,
      extraction_status: extractionOk ? "completed" : "failed",
      extraction_error: extractionOk
        ? null
        : (extractionError ?? `No text could be extracted from this ${spec.ext.toUpperCase()} file; paste the document text instead.`),
      chunking_status: chunks.length ? "completed" : "failed",
      embedding_status: chunks.length ? "completed" : "pending",
      indexing_status: chunks.length ? "completed" : "failed",
      quality_status: blocking ? "failed" : issues.length ? "flagged" : "passed",
      quality_issues: issues as never,
      processing_status: extractionOk && chunks.length ? "ready_for_review" : "processing_failed",
      approval_status: "draft",
      is_active: false,
      is_current: false,
      notes: data.notes ?? null,
      supersedes_document_id: data.supersedesDocumentId ?? null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (chunks.length) {
    const { data: inserted } = await db
      .from("document_chunks")
      .insert(
        chunks.map((c) => ({
          document_id: doc.id,
          chunk_index: c.chunkNumber,
          content: c.content,
          token_count: c.tokenCount,
          section_title: c.sectionTitle,
          section_path: c.sectionPath,
          page_number: c.pageNumber,
          source_locator: c.sourceLocator,
          metadata: { structured_kind: data.structuredKind ?? null } as never,
          is_active: true,
        })),
      )
      .select("id, content, section_title");
    const { embedChunkRows } = await import("./embeddings.server");
    await embedChunkRows(
      db,
      "document_chunks",
      ((inserted ?? []) as { id: string; content: string; section_title: string | null }[]).map((r) => ({
        id: r.id,
        content: r.content,
        sectionTitle: r.section_title,
        title: data.title,
      })),
    ).catch(() => 0);
  }


  return {
    id: doc.id,
    chunks: chunks.length,
    issues,
    processingStatus: extractionOk && chunks.length ? "ready_for_review" : "processing_failed",
  };
}
