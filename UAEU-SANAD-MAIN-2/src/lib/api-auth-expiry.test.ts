import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRefresh, apiCurrentUser } from "@/lib/api-auth";
import { apiFetch } from "@/lib/auth-token";

afterEach(() => vi.unstubAllGlobals());

function setup(status: number, payload: object) {
  const assign = vi.fn();
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    location: { assign },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: status === 200, status, text: async () => JSON.stringify(payload),
  }));
  return assign;
}

describe("session expiry redirect", () => {
  it("restores a valid cookie session without refreshing", async () => {
    setup(200, { id: "student", email: "student@uaeu.ac.ae" });
    expect(await apiCurrentUser()).toMatchObject({ id: "student" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({ credentials: "include" });
  });

  it("attempts only one refresh after an unauthorized session check", async () => {
    setup(401, { code: "unauthorized" });
    expect(await apiCurrentUser()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not refresh on a network failure", async () => {
    setup(500, {});
    vi.mocked(fetch).mockRejectedValue(new TypeError("Network failure"));
    expect(await apiCurrentUser()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves the API error code for expiry handling", async () => {
    setup(401, { code: "session_expired", message: "Your session has expired." });
    await expect(apiFetch("/api/v1/auth/token")).rejects.toMatchObject({
      code: "session_expired", status: 401,
    });
  });

  it("navigates to SSO when refresh confirms expiry", async () => {
    const assign = setup(401, { code: "session_expired", message: "Your session has expired." });
    expect(await apiRefresh()).toBeNull();
    expect(assign).toHaveBeenCalledWith("/auth");
  });

  it.each(["unauthorized", "forbidden", "sso_unavailable"])(
    "does not restart SSO for %s", async (code) => {
      const assign = setup(401, { code, message: "Request failed" });
      expect(await apiRefresh()).toBeNull();
      expect(assign).not.toHaveBeenCalled();
    },
  );

  it("does not restart SSO for network failures", async () => {
    const assign = setup(500, {});
    vi.mocked(fetch).mockRejectedValue(new TypeError("Network failure"));
    expect(await apiRefresh()).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });
});
