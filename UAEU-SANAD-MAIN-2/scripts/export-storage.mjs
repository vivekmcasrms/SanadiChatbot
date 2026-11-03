#!/usr/bin/env node
/**
 * Downloads every object from the Sanadi storage buckets into ./storage-export.
 * Run against the SOURCE project:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/export-storage.mjs
 * Nothing is written to source control (storage-export/ is git-ignored).
 */
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });
const OUT = process.env.STORAGE_EXPORT_DIR ?? "storage-export";

async function walk(bucket, prefix = "") {
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw error;
  for (const entry of data ?? []) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!entry.id) {
      await walk(bucket, path); // folder
      continue;
    }
    const file = await supabase.storage.from(bucket).download(path);
    if (file.error) {
      console.warn(`skip ${bucket}/${path}: ${file.error.message}`);
      continue;
    }
    const target = join(OUT, bucket, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(await file.data.arrayBuffer()));
    console.log(`saved ${bucket}/${path}`);
  }
}

const { data: buckets, error } = await supabase.storage.listBuckets();
if (error) throw error;
for (const b of buckets) await walk(b.name);
console.log(`Done. Files in ./${OUT}`);
