#!/usr/bin/env node
/**
 * Copy Sanadi reference/configuration data from production into the TEST
 * duplicate. Production is opened READ-ONLY: this script never issues an
 * insert, update or delete against the source project.
 *
 *   SOURCE_SUPABASE_URL=... SOURCE_SERVICE_ROLE_KEY=... \
 *   TARGET_SUPABASE_URL=... TARGET_SERVICE_ROLE_KEY=... \
 *   SANADI_ENV=TEST node scripts/clone/copy-reference-data.mjs
 *
 * Options: --tables=a,b   copy only these   --dry-run   report, write nothing
 */
import { createClient } from "@supabase/supabase-js";
import { REFERENCE_TABLES } from "./reference-tables.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const only = (args.find((a) => a.startsWith("--tables=")) ?? "").replace("--tables=", "");

const SOURCE_URL = need("SOURCE_SUPABASE_URL");
const SOURCE_KEY = need("SOURCE_SERVICE_ROLE_KEY");
const TARGET_URL = need("TARGET_SUPABASE_URL");
const TARGET_KEY = need("TARGET_SERVICE_ROLE_KEY");

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return v;
}

// --- Safety gates -----------------------------------------------------------
if ((process.env.SANADI_ENV ?? "").toUpperCase() !== "TEST") {
  console.error("Refusing to run: set SANADI_ENV=TEST to confirm the target is the duplicate.");
  process.exit(1);
}
if (new URL(SOURCE_URL).host === new URL(TARGET_URL).host) {
  console.error("Refusing to run: source and target point at the SAME backend.");
  process.exit(1);
}

const source = createClient(SOURCE_URL, SOURCE_KEY, { auth: { persistSession: false } });
const target = createClient(TARGET_URL, TARGET_KEY, { auth: { persistSession: false } });

const tables = only ? only.split(",").map((t) => t.trim()).filter(Boolean) : REFERENCE_TABLES;
const PAGE = 500;
const report = [];

for (const table of tables) {
  let from = 0;
  let copied = 0;
  let note = "";
  for (;;) {
    const { data, error } = await source.from(table).select("*").range(from, from + PAGE - 1);
    if (error) {
      note = `source: ${error.message}`;
      break;
    }
    if (!data || data.length === 0) break;
    if (!dryRun) {
      const { error: writeError } = await target.from(table).upsert(data, { onConflict: "id" });
      if (writeError) {
        note = `target: ${writeError.message}`;
        break;
      }
    }
    copied += data.length;
    if (data.length < PAGE) break;
    from += PAGE;
  }
  report.push({ table, rows: copied, note });
  console.log(`${note ? "!" : "✓"} ${table.padEnd(36)} ${String(copied).padStart(6)} rows ${note}`);
}

const failed = report.filter((r) => r.note);
console.log(
  `\n${dryRun ? "[dry run] " : ""}${report.length - failed.length}/${report.length} tables copied, ` +
    `${report.reduce((n, r) => n + r.rows, 0)} rows total.`,
);
if (failed.length) {
  console.log("Tables needing attention:");
  for (const f of failed) console.log(`  - ${f.table}: ${f.note}`);
}
console.log(
  "\nEmbeddings: if document_chunks copied without vectors, run scripts/rebuild-embeddings.mjs against the duplicate.",
);
