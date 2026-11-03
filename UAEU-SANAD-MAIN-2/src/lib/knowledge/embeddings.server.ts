/**
 * Semantic embeddings for the knowledge corpus.
 *
 * Every indexed chunk (document or web page) gets a vector so retrieval can
 * match meaning ("purpose", "aim") and not only wording. Embedding is
 * best-effort: if the AI gateway is unavailable the chunk is still indexed and
 * remains findable through the lexical/heading path, and a later reprocess or
 * backfill fills the vector in.
 */
import type { Db } from "../agent/tools.server";

const MAX_CHARS = 8000;
const BATCH = 64;

/** The C# API owns provider selection, credentials, and vector generation. */
async function embedBatch(inputs: string[]): Promise<(string | null)[] | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.functions.invoke("knowledge-embeddings", {
      body: { texts: inputs.map((text) => text.slice(0, MAX_CHARS)) },
    });
    if (error || !Array.isArray(data?.embeddings) || data.embeddings.length !== inputs.length)
      return null;
    return data.embeddings.every((value: unknown) => value === null || typeof value === "string")
      ? data.embeddings : null;
  } catch {
    return null;
  }
}

export async function embedQuery(query: string): Promise<string | null> {
  const batch = await embedBatch([query]);
  return batch?.[0] ?? null;
}

export async function embedTexts(texts: string[]): Promise<(string | null)[]> {
  const out: (string | null)[] = new Array(texts.length).fill(null);
  for (let i = 0; i < texts.length; i += BATCH) {
    const vectors = await embedBatch(texts.slice(i, i + BATCH));
    if (vectors) vectors.forEach((vector, j) => { out[i + j] = vector; });
  }
  return out;
}

/**
 * Fills embeddings for chunk rows just written. `table` is either
 * `document_chunks` or `web_page_chunks`.
 */
export async function embedChunkRows(
  db: Db,
  table: "document_chunks" | "web_page_chunks",
  rows: { id: string; content: string; sectionTitle?: string | null; title?: string | null }[],
): Promise<number> {
  if (!rows.length) return 0;
  const texts = rows.map((r) =>
    [r.title, r.sectionTitle, r.content].filter(Boolean).join("\n").trim(),
  );
  const vectors = await embedTexts(texts);
  let done = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const vec = vectors[i];
    const row = rows[i];
    if (!vec || !row) continue;
    const { error } = await (db as any).from(table).update({ embedding: vec }).eq("id", row.id);
    if (!error) done += 1;
  }
  return done;
}

/** Embeds every active chunk still missing a vector. Used by the backfill. */
export async function backfillEmbeddings(db: Db, limit = 400): Promise<{ documents: number; web: number }> {
  const result = { documents: 0, web: 0 };

  const { data: docRows } = await (db as any)
    .from("document_chunks")
    .select("id, content, section_title")
    .is("embedding", null)
    .eq("is_active", true)
    .limit(limit);
  result.documents = await embedChunkRows(
    db,
    "document_chunks",
    ((docRows ?? []) as { id: string; content: string; section_title: string | null }[]).map((r) => ({
      id: r.id,
      content: r.content,
      sectionTitle: r.section_title,
    })),
  );

  const { data: webRows } = await (db as any)
    .from("web_page_chunks")
    .select("id, content, section_title, page_title")
    .is("embedding", null)
    .eq("is_active", true)
    .limit(limit);
  result.web = await embedChunkRows(
    db,
    "web_page_chunks",
    ((webRows ?? []) as { id: string; content: string; section_title: string | null; page_title: string | null }[]).map((r) => ({
      id: r.id,
      content: r.content,
      sectionTitle: r.section_title,
      title: r.page_title,
    })),
  );

  return result;
}
