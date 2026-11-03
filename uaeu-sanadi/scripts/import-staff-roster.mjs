#!/usr/bin/env node
/**
 * Replaces the staff directory with the official roster in
 * supabase/seed/staff-roster.json (ManageEngine support-group export).
 *
 * - Every roster member gets a confirmed account with the shared temporary
 *   password, a service_officer role, a home unit and unit memberships.
 * - Any other staff account (service_officer / owner / manager / knowledge
 *   manager) is removed. Their open cases and suggestions are handed to a
 *   colleague in the same unit first; historical references are detached so the
 *   audit trail survives the deletion.
 * - Students and the protected administrator accounts are never touched.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-staff-roster.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

/** Initial password for imported staff. Must come from the environment; never hard-coded. */
const PASSWORD = process.env.STAFF_INITIAL_PASSWORD;
if (!PASSWORD || PASSWORD.length < 12) {
  console.error("Set STAFF_INITIAL_PASSWORD (12+ characters). Staff should change it on first sign-in.");
  process.exit(1);
}
/** Accounts that must survive the cleanup whatever roles they hold. */
const PROTECTED = new Set(["nzaki@uaeu.ac.ae"]);
const STAFF_ROLES = ["service_officer", "service_owner", "service_manager", "knowledge_manager", "system_admin"];

const roster = JSON.parse(await readFile(new URL("../supabase/seed/staff-roster.json", import.meta.url), "utf8"));
const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

/* ------------------------------------------------------------------- units */
const units = must(await db.from("service_units").select("id, code, name_en"));
const unitId = (code) => units.find((u) => u.code === code)?.id ?? null;
for (const person of roster) {
  for (const code of person.units) if (!unitId(code)) throw new Error(`Unknown service unit ${code}`);
}

/* --------------------------------------------------------------- auth users */
const authByEmail = new Map();
for (let page = 1; page <= 20; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  for (const u of data.users) if (u.email) authByEmail.set(u.email.toLowerCase(), u.id);
  if (data.users.length < 200) break;
}

async function ensureAccount(email, fullName) {
  const existing = authByEmail.get(email);
  if (existing) {
    const { error } = await db.auth.admin.updateUserById(existing, {
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw error;
    return existing;
  }
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  authByEmail.set(email, data.user.id);
  return data.user.id;
}

/* ------------------------------------------------------------------ import */
const keep = new Set();
for (const person of roster) {
  const id = await ensureAccount(person.email, person.fullName);
  keep.add(id);

  must(
    await db.from("profiles").upsert({
      id,
      full_name: person.fullName,
      email: person.email,
      is_demo_account: false,
      deleted_at: null,
      access_revoked_at: null,
      access_revoked_by: null,
      access_revoked_reason: null,
    }),
  );

  await db.from("user_roles").upsert({ user_id: id, role: "service_officer" }, { onConflict: "user_id,role", ignoreDuplicates: true });
  await db.from("user_roles").delete().eq("user_id", id).neq("role", "service_officer");

  const home = unitId(person.units[0]);
  must(
    await db.from("staff_profiles").upsert({
      user_id: id,
      service_unit_id: home,
      job_title_en: `Service Officer - ${units.find((u) => u.id === home)?.name_en ?? ""}`.trim(),
      job_title_ar: "موظف خدمة",
      is_active: true,
    }),
  );

  const memberships = person.units.map((code) => unitId(code));
  for (const serviceUnitId of memberships) {
    const found = must(
      await db.from("service_staff").select("id").eq("staff_profile_id", id).eq("service_unit_id", serviceUnitId).limit(1),
    );
    const row = {
      staff_profile_id: id,
      service_unit_id: serviceUnitId,
      role_type: "officer",
      can_receive_cases: true,
      is_active: true,
      is_demo_record: false,
    };
    if (found.length) must(await db.from("service_staff").update(row).eq("id", found[0].id));
    else must(await db.from("service_staff").insert(row));
  }
  await db.from("service_staff").delete().eq("staff_profile_id", id).not("service_unit_id", "in", `(${memberships.join(",")})`);
}
console.log(`Roster imported: ${keep.size} staff accounts.`);

/* ----------------------------------------------------------------- cleanup */
const staffRoleRows = must(await db.from("user_roles").select("user_id, role").in("role", STAFF_ROLES));
const staffIds = [...new Set(staffRoleRows.map((r) => r.user_id))];
const profiles = must(await db.from("profiles").select("id, email").in("id", staffIds));
const doomed = profiles.filter((p) => !keep.has(p.id) && !PROTECTED.has((p.email ?? "").toLowerCase()));

/** Roster colleagues available to take over work, grouped by unit. */
const successors = new Map();
for (const person of roster) {
  const id = authByEmail.get(person.email);
  for (const code of person.units) {
    const list = successors.get(code) ?? [];
    if (list.length < 25) list.push(id);
    successors.set(code, list);
  }
}
const unitCode = (id) => units.find((u) => u.id === id)?.code ?? null;
let handoverIndex = 0;
const successorFor = (serviceUnitId) => {
  const list = successors.get(unitCode(serviceUnitId)) ?? [];
  if (!list.length) return null;
  return list[handoverIndex++ % list.length];
};

let reassigned = 0;
for (const person of doomed) {
  const cases = must(await db.from("cases").select("id, service_unit_id").eq("assigned_to", person.id));
  for (const kase of cases) {
    const next = successorFor(kase.service_unit_id);
    must(await db.from("cases").update({ assigned_to: next }).eq("id", kase.id));
    if (next) reassigned++;
  }
  const sugg = must(await db.from("suggestions").select("id, service_unit_id").eq("assigned_staff_id", person.id));
  for (const s of sugg) {
    must(await db.from("suggestions").update({ assigned_staff_id: successorFor(s.service_unit_id) }).eq("id", s.id));
  }
}
console.log(`Reassigned ${reassigned} case(s) to colleagues in the same unit.`);

/** Historical references that block deletion are detached, not erased. */
const DETACH = [
  ["approval_requests", ["assigned_approver_id", "requested_by", "decided_by"]],
  ["case_reopen_requests", ["reviewed_by"]],
  ["case_resolutions", ["prepared_by", "approved_by"]],
  ["case_sla_events", ["acknowledged_by"]],
  ["escalation_actions", ["previous_assignee_id", "new_assignee_id", "triggered_by"]],
  ["operational_insights", ["reviewed_by"]],
  ["routing_decisions", ["final_staff_id", "recommended_staff_id"]],
  ["routing_rules", ["target_staff_id"]],
  ["service_improvements", ["owner_profile_id"]],
  ["suggestion_assessments", ["reviewer_id"]],
  ["internship_assignments", ["government_clearance_approved_by"]],
  ["case_assignments", ["assigned_to", "assigned_by"]],
  ["service_units", ["primary_service_owner_id"]],
  ["student_profiles", ["advisor_staff_id"]],
  ["appointment_slots", ["staff_profile_id"]],
];
const PURGE = [
  ["case_conflicts_of_interest", "profile_id"],
  ["case_access_restrictions", "created_by"],
  ["case_information_requests", "requested_by"],
];

const doomedIds = doomed.map((p) => p.id);
if (doomedIds.length) {
  for (const [table, cols] of DETACH) {
    for (const col of cols) {
      const { error } = await db.from(table).update({ [col]: null }).in(col, doomedIds);
      if (error) console.warn(`  detach ${table}.${col}: ${error.message}`);
    }
  }
  for (const [table, col] of PURGE) {
    const { error } = await db.from(table).delete().in(col, doomedIds);
    if (error) console.warn(`  purge ${table}.${col}: ${error.message}`);
  }
}

let deleted = 0;
const failed = [];
for (const person of doomed) {
  await db.from("service_staff").delete().eq("staff_profile_id", person.id);
  await db.from("service_unit_owners").delete().eq("staff_profile_id", person.id);
  await db.from("service_owner_ai_preferences").delete().eq("staff_profile_id", person.id);
  await db.from("staff_profiles").delete().eq("user_id", person.id);
  await db.from("user_roles").delete().eq("user_id", person.id);
  const { error } = await db.auth.admin.deleteUser(person.id);
  if (error) {
    failed.push(`${person.email}: ${error.message}`);
    await db.from("profiles").update({ deleted_at: new Date().toISOString(), access_revoked_at: new Date().toISOString(), access_revoked_reason: "Not on the official staff roster" }).eq("id", person.id);
  } else deleted++;
}
console.log(`Removed ${deleted} staff account(s) not on the roster.`);
if (failed.length) {
  console.log(`Could not hard-delete ${failed.length} account(s); sign-in and roles were removed instead:`);
  for (const f of failed) console.log(`  ${f}`);
}
