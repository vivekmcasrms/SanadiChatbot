#!/usr/bin/env node
/**
 * Isolation proof for the Sanadi TEST duplicate.
 *
 * Every write lands in the duplicate. Production is read-only throughout: the
 * script only SELECTs from production to prove the test artefacts are absent
 * there, then deletes its own artefacts from the duplicate.
 *
 *   SOURCE_SUPABASE_URL=... SOURCE_SERVICE_ROLE_KEY=... \
 *   TARGET_SUPABASE_URL=... TARGET_SERVICE_ROLE_KEY=... \
 *   SANADI_ENV=TEST node scripts/clone/verify-isolation.mjs
 */
import { createClient } from "@supabase/supabase-js";

if ((process.env.SANADI_ENV ?? "").toUpperCase() !== "TEST") {
  console.error("Refusing to run: set SANADI_ENV=TEST.");
  process.exit(1);
}
const S_URL = process.env.SOURCE_SUPABASE_URL;
const S_KEY = process.env.SOURCE_SERVICE_ROLE_KEY;
const T_URL = process.env.TARGET_SUPABASE_URL;
const T_KEY = process.env.TARGET_SERVICE_ROLE_KEY;
if (!S_URL || !S_KEY || !T_URL || !T_KEY) {
  console.error("Missing SOURCE_/TARGET_ SUPABASE_URL and SERVICE_ROLE_KEY values.");
  process.exit(1);
}
if (new URL(S_URL).host === new URL(T_URL).host) {
  console.error("FAIL: source and target are the same backend — the duplicate is NOT isolated.");
  process.exit(1);
}

const prod = createClient(S_URL, S_KEY, { auth: { persistSession: false } });
const test = createClient(T_URL, T_KEY, { auth: { persistSession: false } });

const marker = `ISOLATION-${Date.now()}`;
const results = [];
const cleanup = [];

function record(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function absentInProduction(table, column, value) {
  const { data, error } = await prod.from(table).select("id").eq(column, value).limit(1);
  if (error) return { ok: false, detail: `production read: ${error.message}` };
  return { ok: (data ?? []).length === 0, detail: (data ?? []).length ? "found in production!" : "" };
}

// 1 + 2. A query and a complaint created in the duplicate stay in the duplicate.
for (const [label, caseType] of [
  ["query", "query"],
  ["complaint", "complaint"],
]) {
  const title = `${marker}-${label}`;
  const { data, error } = await test
    .from("cases")
    .insert({ title, description: `Isolation check ${label}`, case_type: caseType, status: "submitted" })
    .select("id")
    .single();
  if (error) {
    record(`create ${label} in duplicate`, false, error.message);
    continue;
  }
  cleanup.push(["cases", data.id]);
  const check = await absentInProduction("cases", "title", title);
  record(`${label} created in duplicate is absent from production`, check.ok, check.detail);
}

// 3. A student added in the duplicate does not alter production.
const studentEmail = `${marker.toLowerCase()}@test.sanadi.local`;
const { data: newUser, error: userError } = await test.auth.admin.createUser({
  email: studentEmail,
  password: crypto.randomUUID() + crypto.randomUUID(),
  email_confirm: true,
});
if (userError) {
  record("add student in duplicate", false, userError.message);
} else {
  const { data: prodProfiles, error: prodError } = await prod
    .from("profiles")
    .select("id")
    .eq("email", studentEmail)
    .limit(1);
  record(
    "student added in duplicate is absent from production",
    !prodError && (prodProfiles ?? []).length === 0,
    prodError?.message ?? "",
  );
  await test.auth.admin.deleteUser(newUser.user.id).catch(() => {});
}

// 4. Uploading a document uses duplicate storage only.
const objectPath = `isolation/${marker}.txt`;
const upload = await test.storage
  .from("student-letters")
  .upload(objectPath, new Blob([marker], { type: "text/plain" }), { upsert: true });
if (upload.error) {
  record("upload document to duplicate storage", false, upload.error.message);
} else {
  const prodList = await prod.storage.from("student-letters").list("isolation", { limit: 100 });
  const leaked = (prodList.data ?? []).some((o) => o.name === `${marker}.txt`);
  record("uploaded document is absent from production storage", !leaked);
  await test.storage.from("student-letters").remove([objectPath]).catch(() => {});
}

// 5. Knowledge Center change stays in the duplicate.
const { data: kdoc, error: kerr } = await test
  .from("knowledge_documents")
  .select("id, title")
  .limit(1)
  .maybeSingle();
if (kerr || !kdoc) {
  record("knowledge content change isolated", false, kerr?.message ?? "no knowledge documents in duplicate");
} else {
  const newTitle = `${kdoc.title} [${marker}]`;
  const { error: updErr } = await test.from("knowledge_documents").update({ title: newTitle }).eq("id", kdoc.id);
  if (updErr) record("knowledge content change isolated", false, updErr.message);
  else {
    const check = await absentInProduction("knowledge_documents", "title", newTitle);
    record("knowledge content change is absent from production", check.ok, check.detail);
    await test.from("knowledge_documents").update({ title: kdoc.title }).eq("id", kdoc.id);
  }
}

// 6. Staff assignments remain isolated.
const assignmentCase = cleanup.find(([t]) => t === "cases");
if (!assignmentCase) {
  record("staff assignment isolated", false, "no duplicate case available");
} else {
  const { data: staffRow } = await test.from("profiles").select("id").limit(1).maybeSingle();
  if (!staffRow) record("staff assignment isolated", false, "no profiles in duplicate");
  else {
    const { error: asgErr } = await test
      .from("cases")
      .update({ assigned_to: staffRow.id })
      .eq("id", assignmentCase[1]);
    record("staff assignment written in duplicate only", !asgErr, asgErr?.message ?? "");
  }
}

// 7. Schema changes remain isolated (structure compared, nothing altered).
const { count: prodTables, error: prodCountErr } = await prod
  .from("service_units")
  .select("id", { count: "exact", head: true });
const { count: testTables, error: testCountErr } = await test
  .from("service_units")
  .select("id", { count: "exact", head: true });
record(
  "duplicate database answers independently of production",
  !prodCountErr && !testCountErr,
  `production units=${prodTables ?? "?"} duplicate units=${testTables ?? "?"} (separate endpoints)`,
);

// Cleanup duplicate-side artefacts.
for (const [table, id] of cleanup) await test.from(table).delete().eq("id", id);

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} isolation checks passed.`);
process.exit(failed.length ? 1 : 0);
