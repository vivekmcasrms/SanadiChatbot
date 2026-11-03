#!/usr/bin/env node
/**
 * Uploads ./storage-export back into the buckets of a TARGET project
 * (local Supabase or a new hosted project):
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/import-storage.mjs
 * Buckets must already exist (supabase/bootstrap/00_storage_buckets.sql).
 */
import { createClient } from "@supabase/supabase-js";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });
const ROOT = process.env.STORAGE_EXPORT_DIR ?? "storage-export";

async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(full)));
    else out.push(full);
  }
  return out;
}

for (const bucketDir of await readdir(ROOT, { withFileTypes: true })) {
  if (!bucketDir.isDirectory()) continue;
  const bucket = bucketDir.name;
  for (const file of await files(join(ROOT, bucket))) {
    const path = relative(join(ROOT, bucket), file).split(sep).join("/");
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, await readFile(file), { upsert: true });
    console.log(error ? `FAIL ${bucket}/${path}: ${error.message}` : `uploaded ${bucket}/${path}`);
  }
}
