#!/usr/bin/env node
/**
 * Rebuilds knowledge embeddings locally when they were not part of the restore
 * (schema-only restore, or a changed embedding provider).
 *
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local key> \
 *   LOVABLE_API_KEY=<ai key> node scripts/rebuild-embeddings.mjs
 *
 * Required: EMBEDDING_ENDPOINT. Optional: EMBEDDING_MODEL.
 * Only rows with a NULL embedding are processed, so
 * the script is safe to re-run.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const aiKey = process.env.LOVABLE_API_KEY ?? process.env.OPENAI_API_KEY;
if (!url || !key || !aiKey) {
  console.error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and LOVABLE_API_KEY (or OPENAI_API_KEY).");
  process.exit(1);
}

const ENDPOINT = process.env.EMBEDDING_ENDPOINT?.trim();
if (!ENDPOINT) {
  console.error("Set EMBEDDING_ENDPOINT to an explicitly configured embedding service.");
  process.exit(1);
}
const MODEL = process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small";
const BATCH = 32;

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function embed(texts) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.LOVABLE_API_KEY
        ? { "Lovable-API-Key": process.env.LOVABLE_API_KEY }
        : { Authorization: `Bearer ${aiKey}` }),
    },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`embeddings ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const out = new Array(texts.length).fill(null);
  for (const row of json.data ?? []) out[row.index] = row.embedding;
  return out;
}

for (const table of ["document_chunks", "web_page_chunks"]) {
  let done = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select("id, content")
      .is("embedding", null)
      .limit(BATCH);
    if (error) throw error;
    if (!data?.length) break;

    const vectors = await embed(data.map((r) => r.content ?? ""));
    for (let i = 0; i < data.length; i++) {
      if (!vectors[i]) continue;
      const { error: upErr } = await supabase
        .from(table)
        .update({ embedding: vectors[i] })
        .eq("id", data[i].id);
      if (upErr) console.warn(`skip ${table}/${data[i].id}: ${upErr.message}`);
    }
    done += data.length;
    console.log(`${table}: ${done} chunks embedded`);
  }
  console.log(`${table}: complete`);
}
