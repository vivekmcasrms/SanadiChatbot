import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, setAuthToken } from "@/lib/auth-token";
import { redeemSsoTicket, startSsoLogin } from "@/lib/sso";
import { markSignedOut, isSignedOut } from "@/lib/logout-state";

vi.mock("@/lib/auth-token", () => ({ apiFetch: vi.fn(), setAuthToken: vi.fn(), apiUrl: (p: string) => p }));
const storage = new Map<string, string>();
const assign = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  storage.clear();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  vi.stubGlobal("window", {
    location: { assign },
    sessionStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("SSO authorization and ticket exchange", () => {
  it("rejects an old callback after logout without contacting the API", async () => {
    markSignedOut();
    await expect(redeemSsoTicket("old-ticket")).rejects.toThrow("Start a new sign-in");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("ignores a ticket response that arrives after logout", async () => {
    let complete!: (value: unknown) => void;
    vi.mocked(apiFetch).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const pending = redeemSsoTicket("old-ticket");
    markSignedOut();
    complete({ access_token: "old", refresh_token: "old", user: { id: "old-user" } });
    await expect(pending).rejects.toThrow("cancelled by logout");
    expect(setAuthToken).not.toHaveBeenCalled();
    expect(isSignedOut()).toBe(true);
  });

  it("allows a fresh explicit SSO login after logout", async () => {
    markSignedOut();
    vi.mocked(apiFetch).mockResolvedValueOnce({ authorizationUrl: "https://idp.test/authorize" });
    await startSsoLogin();
    vi.mocked(apiFetch).mockResolvedValueOnce({ access_token: "new", refresh_token: "new", user: { id: "new-user" } });
    await redeemSsoTicket("new-ticket");
    expect(isSignedOut()).toBe(false);
    expect(setAuthToken).toHaveBeenCalledWith("new");
  });
  it("asks the API for a provider URL with a hashed browser verifier", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ authorizationUrl: "https://idmt.uaeu.ac.ae/as/authorization.oauth2?state=test" });
    await startSsoLogin();
    const verifier = storage.get("sanadi-sso-verifier")!;
    expect(verifier).toHaveLength(43);
    const digest = Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
    expect(apiFetch).toHaveBeenCalledWith(`/api/v1/auth/sso/authorize?challenge=${digest}`, {
      cache: "no-store", headers: { "X-Sanadi-Sso-Flow-Id": storage.get("sanadi-sso-trace") },
    });
    expect(assign).toHaveBeenCalledWith("https://idmt.uaeu.ac.ae/as/authorization.oauth2?state=test");
  });

  it("does not navigate when authorization fails", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("unavailable"));
    await expect(startSsoLogin()).rejects.toThrow("unavailable");
    expect(assign).not.toHaveBeenCalled();
  });

  it("redeems by POST then installs the API session without relying on cookies", async () => {
    storage.set("sanadi-sso-verifier", "browser-verifier");
    const session = { access_token: "access", refresh_token: "refresh", user: { id: "student" } };
    vi.mocked(apiFetch).mockResolvedValue(session);
    expect(await redeemSsoTicket("opaque-ticket")).toEqual(session);
    expect(apiFetch).toHaveBeenCalledWith("/api/v1/auth/sso/session", {
      method: "POST", cache: "no-store",
      headers: {},
      body: JSON.stringify({ ticket: "opaque-ticket", verifier: "browser-verifier" }),
    });
    expect(setAuthToken).toHaveBeenCalledWith("access");
    expect(storage.get("sanadi-api-refresh-token")).toBe("refresh");
    expect(storage.has("sanadi-sso-verifier")).toBe(false);
  });

  it("never installs a session for a rejected ticket", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("sso_invalid_ticket"));
    await expect(redeemSsoTicket("expired-ticket")).rejects.toThrow("sso_invalid_ticket");
    expect(setAuthToken).not.toHaveBeenCalled();
  });

  it("records the authorize failure stage without recording browser proof or tokens", async () => {
    vi.mocked(apiFetch).mockRejectedValue(Object.assign(new Error("private server details"), { code: "internal" }));
    await expect(startSsoLogin()).rejects.toThrow("private server details");
    const events = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(init!.body as string));
    expect(events.map(event => event.step)).toEqual([
      "AUTH_SUBMIT", "AUTH_BROWSER_PROOF", "AUTH_BROWSER_PROOF", "AUTH_AUTHORIZE_REQUEST", "AUTH_FAILED",
    ]);
    expect(events.at(-1)).toMatchObject({ stage: "authorize", code: "internal" });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(storage.get("sanadi-sso-verifier")!);
    expect(serialized).not.toContain("private server details");
    expect(assign).not.toHaveBeenCalled();
  });

  it("continues sign-in when the diagnostic endpoint is unavailable", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("diagnostic endpoint unavailable"));
    vi.mocked(apiFetch).mockResolvedValueOnce({ authorizationUrl: "https://idp.test/authorize" });
    await expect(startSsoLogin()).resolves.toBeUndefined();
    expect(assign).toHaveBeenCalledWith("https://idp.test/authorize");
  });
});
