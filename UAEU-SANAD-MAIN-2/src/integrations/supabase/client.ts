/**
 * Browser data/storage client — talks to SANADIAPI (PostgREST + storage
 * compatible endpoints on SANADIAPI only.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { getAuthToken } from "@/lib/auth-token";

const API_BASE_URL =
  (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.replace(/\/$/, "") || "";

// The compatibility SDK requires a nonempty constructor value. It is not an
// API credential and is removed from requests before they reach SANADIAPI.
const SDK_PLACEHOLDER_KEY = "sanadi-sdk-placeholder";

function createApiFetch(): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    headers.delete("apikey");
    const token = getAuthToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    // The SDK mirrors its constructor value into Authorization by default.
    if (headers.get("Authorization") === `Bearer ${SDK_PLACEHOLDER_KEY}`) {
      headers.delete("Authorization");
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(input, { ...init, headers, credentials: "include" });
  };
}

function createSanadiDataClient() {
  if (!API_BASE_URL) {
    throw new Error("VITE_API_BASE_URL is not configured.");
  }
  return createClient<Database>(API_BASE_URL, SDK_PLACEHOLDER_KEY, {
    global: { fetch: createApiFetch() },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

let _client: ReturnType<typeof createSanadiDataClient> | undefined;

/** @deprecated Name kept for call-site compatibility — backs onto SANADIAPI. */
export const supabase = new Proxy({} as ReturnType<typeof createSanadiDataClient>, {
  get(_, prop, receiver) {
    if (!_client) _client = createSanadiDataClient();
    return Reflect.get(_client, prop, receiver);
  },
});
