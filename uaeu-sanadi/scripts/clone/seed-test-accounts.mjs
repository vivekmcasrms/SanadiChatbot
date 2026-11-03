#!/usr/bin/env node
/**
 * Create the duplicate's OWN login accounts. Production accounts and password
 * hashes are never exported: staff and students are recreated as fresh test
 * users in the duplicate's authentication system.
 *
 *   TARGET_SUPABASE_URL=... TARGET_SERVICE_ROLE_KEY=... SANADI_ENV=TEST \
 *   node scripts/clone/seed-test-accounts.mjs
 *
 * Staff come from supabase/seed/staff-roster.json (the approved SD roster).
 * The three DSAI test students are recreated with their academic records by
 * scripts/seed-dsai-cohort.mjs — run it afterwards against the duplicate.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const STAFF_PASSWORD = process.env.TEST_STAFF_PASSWORD;
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? "admin@test.sanadi.local";
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;
if (!STAFF_PASSWORD || !ADMIN_PASSWORD || STAFF_PASSWORD.length < 12 || ADMIN_PASSWORD.length < 12) {
  console.error("Set TEST_STAFF_PASSWORD and TEST_ADMIN_PASSWORD (12+ characters each); no default passwords are used.");
  process.exit(1);
}

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
const db = createClient(url, key, { auth: { persistSession: false } });

async function upsertUser(email, password, fullName, role) {
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, sanadi_env: "TEST" },
  });
  let userId = data?.user?.id ?? null;
  if (error && /already/i.test(error.message)) {
    const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
  } else if (error) {
    return { email, error: error.message };
  }
  if (!userId) return { email, error: "user id unavailable" };

  await db.from("profiles").upsert({ id: userId, email, full_name: fullName }, { onConflict: "id" });
  await db.from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id,role" });
  return { email, userId };
}

const roster = JSON.parse(readFileSync(new URL("../../supabase/seed/staff-roster.json", import.meta.url), "utf8"));
const staff = Array.isArray(roster) ? roster : (roster.staff ?? []);

let created = 0;
const failures = [];
for (const person of staff) {
  const email = (person.email ?? "").trim().toLowerCase();
  if (!email) continue;
  const result = await upsertUser(email, STAFF_PASSWORD, person.full_name ?? person.name ?? email, "service_officer");
  if (result.error) failures.push(result);
  else created += 1;
}

const admin = await upsertUser(ADMIN_EMAIL, ADMIN_PASSWORD, "Sanadi Test Administrator", "system_admin");
if (admin.error) failures.push(admin);

console.log(`✓ staff accounts ready: ${created}`);
console.log(`✓ test administrator: ${ADMIN_EMAIL}`);
if (failures.length) {
  console.log("! accounts needing attention:");
  for (const f of failures) console.log(`  - ${f.email}: ${f.error}`);
}
console.log("\nNext: run scripts/seed-dsai-cohort.mjs against the duplicate to create the three test students.");
