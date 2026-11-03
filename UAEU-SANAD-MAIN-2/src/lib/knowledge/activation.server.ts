/**
 * Verified activation for knowledge documents: a source only becomes "Active"
 * (retrievable by the assistant) after we prove, end to end, that its text is
 * extracted, chunked with headings, and actually returned by live retrieval.
 * Server only.
 */
import type { Db } from "../agent/tools.server";
import type { CenterPermissions } from "./permissions.server";
import { invalidateKnowledgeCache, retrieveKnowledge } from "./retrieval.server";
import { retrievalBlockers } from "./reprocess.server";

export type ActivationCheck = { label: string; ok: boolean; detail: string };

export type ActivationResult = {
  documentId: string;
  title: string;
  activated: boolean;
  checks: ActivationCheck[];
  probes: { question: string; hit: boolean; section: string | null; score: number }[];
};

/** Build realistic probe questions from the document's own headings. */
function probeQuestions(title: string, sections: string[]): string[] {
  const wanted = ["objective", "purpose", "scope", "eligibility", "responsibilit", "procedure"];
  const picked = sections.filter((s) => wanted.some((w) => s.toLowerCase().includes(w))).slice(0, 3);
  const base = picked.length ? picked : sections.slice(0, 2);
  return base.map((s) => `What is the ${s.toLowerCase()} of the ${title}?`);
}

/**
 * Verify a document and publish it when every check passes. Verification is
 * always run against live retrieval, so "Active" can never be a claim we have
 * not tested.
 */
export async function activateDocument(
  db: Db,
  documentId: string,
  perms: CenterPermissions,
  lang: "en" | "ar" = "en",
): Promise<ActivationResult> {
  const { data: doc, error } = await db
    .from("knowledge_documents")
    .select(
      "id, title, language, knowledge_domain, extraction_status, indexing_status, approval_status, is_active, is_current, deleted_at, effective_date, expiry_date, superseded_by_document_id",
    )
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!doc) throw new Error("Document not found.");

  const { data: chunkRows } = await db
    .from("document_chunks")
    .select("section_title, content")
    .eq("document_id", documentId)
    .order("chunk_index");
  const chunks = (chunkRows ?? []) as { section_title: string | null; content: string }[];
  const sections = [...new Set(chunks.map((c) => (c.section_title ?? "").trim()).filter(Boolean))];
  const characters = chunks.reduce((n, c) => n + String(c.content ?? "").length, 0);

  const title = String(doc.title ?? "");
  const lifecycle = retrievalBlockers({
    ...(doc as unknown as Record<string, never>),
    approval_status: "approved",
    is_active: true,
    is_current: true,
  } as never);
  const checks: ActivationCheck[] = [
    { label: "Text extracted", ok: characters > 200, detail: `${characters} characters of extracted text` },
    { label: "Indexed into chunks", ok: chunks.length > 0, detail: `${chunks.length} chunks` },
    { label: "Headings preserved", ok: sections.length > 0, detail: sections.slice(0, 8).join(", ") || "no headings detected" },
    {
      label: "Lifecycle clear",
      ok: lifecycle.length === 0,
      detail: lifecycle.join(" ") || "dates and versioning are valid",
    },
  ];

  const blocked = checks.some((c) => !c.ok);
  const previous = {
    approval_status: doc.approval_status,
    is_active: doc.is_active,
    is_current: doc.is_current,
  };

  if (blocked) {
    return { documentId, title, activated: false, checks, probes: [] };
  }

  // Publish first, then prove retrieval works against the live corpus.
  await db
    .from("knowledge_documents")
    .update({
      approval_status: "approved",
      is_active: true,
      is_current: true,
      processing_status: "published",
      published_at: new Date().toISOString(),
    })
    .eq("id", documentId);
  invalidateKnowledgeCache("document_activated");

  const probes: ActivationResult["probes"] = [];
  for (const question of probeQuestions(title, sections)) {
    const results = await retrieveKnowledge(db, question, { lang, perms, limit: 6, useCache: false });
    const hit = results.find((r) => r.sourceId === documentId) ?? null;
    probes.push({
      question,
      hit: Boolean(hit),
      section: hit?.sectionTitle ?? null,
      score: hit ? Number(hit.score.toFixed(3)) : 0,
    });
  }

  const retrieved = probes.length === 0 || probes.some((p) => p.hit);
  checks.push({
    label: "Retrieval verified",
    ok: retrieved,
    detail: probes.length
      ? `${probes.filter((p) => p.hit).length}/${probes.length} section probes returned this document`
      : "no headings available to probe",
  });

  if (!retrieved) {
    await db.from("knowledge_documents").update(previous).eq("id", documentId);
    invalidateKnowledgeCache("document_activation_reverted");
    return { documentId, title, activated: false, checks, probes };
  }

  return { documentId, title, activated: true, checks, probes };
}
