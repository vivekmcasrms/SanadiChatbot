import { afterEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";

const auth = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("@/lib/auth-token", () => ({ getAuthToken: () => auth.token }));

afterEach(() => {
  auth.token = null;
  vi.unstubAllGlobals();
});

describe("API data client without an anonymous API key", () => {
  it.each([null, "user-session-token"])("preserves session authentication for %s", async (token) => {
    auth.token = token;
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { error } = await supabase.from("profiles").select("id");

    expect(error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.has("apikey")).toBe(false);
    expect(headers.get("Authorization")).toBe(token ? `Bearer ${token}` : null);
    expect(init.credentials).toBe("include");
  });
});
