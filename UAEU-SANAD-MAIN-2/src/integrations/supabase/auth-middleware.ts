/**
 * Server-fn middleware: validates the Bearer JWT against SANADIAPI /auth/v1/user.
 */
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const API_BASE_URL = (
  process.env["VITE_API_BASE_URL"] ||
  import.meta.env["VITE_API_BASE_URL"]
).replace(/\/$/, "");

// Required only by the compatibility SDK; never sent as an API credential.
const SDK_PLACEHOLDER_KEY = "sanadi-sdk-placeholder";

function createApiFetch(bearer: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    headers.delete("apikey");
    headers.set("Authorization", `Bearer ${bearer}`);
    return fetch(input, { ...init, headers });
  };
}

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();
    if (!request?.headers) {
      throw new Error("Unauthorized: No request headers available");
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      throw new Error("Unauthorized: No authorization header provided");
    }
    if (!authHeader.startsWith("Bearer ")) {
      throw new Error("Unauthorized: Only Bearer tokens are supported");
    }
    const token = authHeader.replace("Bearer ", "");
    if (!token || token.split(".").length !== 3) {
      throw new Error("Unauthorized: Invalid token");
    }

    const client = createClient<Database>(API_BASE_URL, SDK_PLACEHOLDER_KEY, {
      global: {
        fetch: createApiFetch(token),
        headers: { Authorization: `Bearer ${token}` },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) {
      // Fallback: trust JWT shape when /auth/v1/user is reached via getUser
      const userRes = await fetch(`${API_BASE_URL}/auth/v1/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!userRes.ok) {
        throw new Error("Unauthorized: Invalid token");
      }
      const user = (await userRes.json()) as { id: string; email?: string };
      return next({
        context: {
          supabase: client,
          user: { id: user.id, email: user.email ?? "" },
        },
      });
    }

    return next({
      context: {
        supabase: client,
        user: data.user,
      },
    });
  },
);
