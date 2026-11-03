#!/usr/bin/env node
/**
 * Verifies that a local Sanadi database contains every object the application
 * code references (docs/db-dependencies.json, generated from src/**).
 *
 *   SUPABASE_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
 *     node scripts/verify-local-deployment.mjs
 *
 * Prints PASS/FAIL per object class and exits non-zero on any FAIL.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const DB = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
if (!DB) {
  console.error("Set SUPABASE_DB_URL to your local Postgres connection string.");
  process.exit(1);
}

const deps = JSON.parse(readFileSync(new URL("../docs/db-dependencies.json", import.meta.url)));

const q = (sql) =>
  execFileSync("psql", [DB, "-At", "-c", sql], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);

const present = {
  tables: new Set([
    ...q("select table_name from information_schema.tables where table_schema='public'"),
    ...q("select table_name from information_schema.views where table_schema='public'"),
  ]),
  functions: new Set(
    q("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'"),
  ),
  enums: new Set(
    q("select t.typname from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e'"),
  ),
  views: new Set(q("select table_name from information_schema.views where table_schema='public'")),
  extensions: new Set(q("select extname from pg_extension")),
  buckets: new Set(q("select id from storage.buckets")),
};

let failures = 0;
for (const [kind, names] of Object.entries(deps)) {
  if (!Array.isArray(names) || !present[kind]) continue;
  const missing = names.filter((n) => !present[kind].has(n));
  if (missing.length) {
    failures += missing.length;
    console.log(`FAIL ${kind}: missing ${missing.length} → ${missing.join(", ")}`);
  } else {
    console.log(`PASS ${kind}: all ${names.length} present`);
  }
}

const policies = Number(q("select count(*) from pg_policies where schemaname in ('public','storage')")[0]);
const triggers = Number(q("select count(*) from pg_trigger where not tgisinternal")[0]);
console.log(`${policies > 0 ? "PASS" : "FAIL"} RLS policies: ${policies}`);
console.log(`${triggers > 0 ? "PASS" : "FAIL"} triggers: ${triggers}`);
if (policies === 0 || triggers === 0) failures++;

console.log(failures ? `\n${failures} problem(s) found.` : "\nAll referenced database objects are present.");
process.exit(failures ? 1 : 0);
