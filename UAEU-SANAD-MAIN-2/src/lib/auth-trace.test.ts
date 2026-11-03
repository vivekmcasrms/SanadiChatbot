import { afterEach, expect, it, vi } from "vitest";
import { authTrace, authTraceHeaders } from "./auth-trace";

vi.mock("@/lib/auth-token", () => ({ apiUrl: (path: string) => path }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("posts only safe milestone fields and retains the flow ID across redirects", () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", { sessionStorage: {
    getItem: (key: string) => storage.get(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
  const send = vi.fn().mockResolvedValue({});
  vi.stubGlobal("fetch", send);
  const info = vi.spyOn(console, "info");
  const warn = vi.spyOn(console, "warn");
  authTrace("AUTH_SUBMIT", { code: "sso_start", token: "must-not-be-sent" });
  authTrace("AUTH_COMPLETE", { code: "role_content_mounted" });
  authTrace("AUTH_FAILED", { code: "test_failure" });
  expect(info).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  const first = JSON.parse(send.mock.calls[0]![1].body);
  const second = JSON.parse(send.mock.calls[1]![1].body);
  expect(first).toEqual({ step: "AUTH_SUBMIT", code: "sso_start", flowId: expect.any(String) });
  expect(second.flowId).toBe(first.flowId);
  expect(send.mock.calls[0]![1].body).not.toContain("must-not-be-sent");
  expect(send.mock.calls[0]![1].referrerPolicy).toBe("no-referrer");
  expect(authTraceHeaders()).toEqual({ "X-Sanadi-Sso-Flow-Id": first.flowId });
});

it("never sends arbitrary error codes, stages, URLs, or secret-shaped detail fields", () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", { sessionStorage: {
    getItem: (key: string) => storage.get(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
  const send = vi.fn().mockResolvedValue({});
  vi.stubGlobal("fetch", send);
  authTrace("AUTH_SUBMIT", { code: "sso_start" });
  authTrace("AUTH_FAILED", {
    code: "secret-token-value", stage: "https://idp.test/?code=private",
    token: "private", password: "private", ms: Infinity,
  });
  expect(JSON.parse(send.mock.calls[1]![1].body)).toEqual({
    step: "AUTH_FAILED", code: "unclassified", flowId: expect.any(String),
  });
  authTrace("AUTH_REDIRECT", { code: "/auth/callback?ssoTicket=private", stage: "redirect", ms: -5 });
  expect(JSON.parse(send.mock.calls[2]![1].body)).toMatchObject({ code: "application_redirect", stage: "redirect", ms: 0 });
  expect(JSON.stringify(send.mock.calls)).not.toContain("private");
});

it("can report blocked session storage and never throws on diagnostic network failures", () => {
  vi.stubGlobal("window", { sessionStorage: {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
  } });
  const send = vi.fn().mockRejectedValue(new TypeError("offline"));
  vi.stubGlobal("fetch", send);
  expect(() => authTrace("AUTH_SUBMIT", { code: "sso_start" })).not.toThrow();
  expect(() => authTrace("AUTH_FAILED", { code: "network_error", stage: "authorize" })).not.toThrow();
  expect(send).toHaveBeenCalledTimes(2);
  expect(authTraceHeaders()["X-Sanadi-Sso-Flow-Id"]).toMatch(/^[0-9a-f-]{36}$/);
});
