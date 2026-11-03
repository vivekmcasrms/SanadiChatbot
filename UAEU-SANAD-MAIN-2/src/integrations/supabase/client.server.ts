/**
 * Server-side data client for SANADIAPI (service-role).
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const API_BASE_URL = (
  process.env["VITE_API_BASE_URL"] ||
  import.meta.env["VITE_API_BASE_URL"]
).replace(/\/$/, "");

const SERVICE_KEY =
  process.env["SANADI_SERVICE_ROLE_KEY"] ||
  process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
  "SKHFC-@#NCDS-7566CB-ENCHS-DHS*D";

function createApiFetch(apiKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    headers.set("apikey", apiKey);
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${apiKey}`);
    }
    return fetch(input, { ...init, headers });
  };
}

function createSanadiAdminClient() {
  return createClient<Database>(API_BASE_URL, SERVICE_KEY, {
    global: { fetch: createApiFetch(SERVICE_KEY) },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storage: undefined,
    },
  });
}

let _admin: ReturnType<typeof createSanadiAdminClient> | undefined;

/** @deprecated Name kept for call-site compatibility — backs onto SANADIAPI. */
export const supabaseAdmin = new Proxy({} as ReturnType<typeof createSanadiAdminClient>, {
  get(_, prop, receiver) {
    if (!_admin) _admin = createSanadiAdminClient();
    return Reflect.get(_admin, prop, receiver);
  },
});
