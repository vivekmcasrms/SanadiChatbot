#!/usr/bin/env node
/**
 * Create the duplicate's OWN private storage buckets. Nothing here touches
 * production storage: it only talks to TARGET_SUPABASE_URL.
 *
 *   TARGET_SUPABASE_URL=... TARGET_SERVICE_ROLE_KEY=... SANADI_ENV=TEST \
 *   node scripts/clone/setup-storage.mjs
 */
import { createClient } from "@supabase/supabase-js";

const BUCKETS = [
  { id: "student-cvs", purpose: "Student CV uploads", limit: 10 * 1024 * 1024 },
  { id: "student-letters", purpose: "Generated documents / letters", limit: 10 * 1024 * 1024 },
  { id: "knowledge-files", purpose: "Knowledge Center source files", limit: 50 * 1024 * 1024 },
  { id: "case-evidence", purpose: "Uploaded evidence and attachments", limit: 25 * 1024 * 1024 },
];

if ((process.env.SANADI_ENV ?? "").toUpperCase() !== "TEST") {
  console.error("Refusing to run: set SANADI_ENV=TEST to confirm the target is the duplicate.");
  process.exit(1);
}
const url = process.env.TARGET_SUPABASE_URL;
const key = process.env.TARGET_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing TARGET_SUPABASE_URL / TARGET_SERVICE_ROLE_KEY");
  process.exit(1);
}

const target = createClient(url, key, { auth: { persistSession: false } });

for (const bucket of BUCKETS) {
  const { error } = await target.storage.createBucket(bucket.id, {
    public: false,
    fileSizeLimit: bucket.limit,
  });
  if (error && !/already exists/i.test(error.message)) {
    console.log(`! ${bucket.id.padEnd(18)} ${error.message}`);
    continue;
  }
  console.log(`✓ ${bucket.id.padEnd(18)} private — ${bucket.purpose}${error ? " (existing)" : ""}`);
}

console.log(
  "\nBucket access rules live in the schema rebuild (policies on storage.objects); apply the schema first.",
);
