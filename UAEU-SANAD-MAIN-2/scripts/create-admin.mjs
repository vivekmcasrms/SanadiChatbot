#!/usr/bin/env node
/**
 * Creates (or repairs) a local system administrator account.
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... \
 *   ADMIN_EMAIL=admin@example.edu ADMIN_PASSWORD='ChangeMe123!' \
 *   node scripts/create-admin.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!url || !key || !email || !password) {
  console.error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, ADMIN_PASSWORD.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

let userId;
const created = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: "System Administrator" },
});
if (created.error) {
  const { data } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const existing = data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!existing) throw created.error;
  userId = existing.id;
  await supabase.auth.admin.updateUserById(userId, { password, email_confirm: true });
} else {
  userId = created.data.user.id;
}

await supabase.from("profiles").upsert({ id: userId, email, full_name: "System Administrator" });
const { error } = await supabase
  .from("user_roles")
  .upsert({ user_id: userId, role: "system_admin" }, { onConflict: "user_id,role" });
if (error) throw error;
console.log(`Admin ready: ${email} (${userId})`);
