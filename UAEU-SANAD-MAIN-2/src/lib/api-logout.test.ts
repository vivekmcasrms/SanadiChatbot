import { afterEach, expect, it, vi } from "vitest";
import { apiSignOut, apiCurrentUser, apiRefresh } from "./api-auth";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const storage = new Map([["sanadi-api-refresh-token", "test-refresh"]]);
  const replace = vi.fn();
  const dispatchEvent = vi.fn();
  vi.stubGlobal("window", { location: { replace }, dispatchEvent, sessionStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } });
  return { replace, dispatchEvent, storage };
}

it("shows the transition immediately and waits for logout before leaving the application", async () => {
  const { replace, dispatchEvent, storage } = setup();
  let complete!: (value: unknown) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { complete = resolve; })));
  const result = apiSignOut(true);
  expect(dispatchEvent).toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/v1/auth/logout"), expect.objectContaining({
    method: "POST", credentials: "include", body: JSON.stringify({ refresh_token: "test-refresh" }),
  }));
  complete({ ok: true });
  await result;
  expect(storage.has("sanadi-api-refresh-token")).toBe(false);
  expect(storage.get("sanadi-signed-out")).toBe("1");
  expect(storage.get("sanadi-force-sso")).toBe("1");
  expect(replace).toHaveBeenCalledWith("/auth");
});

it("does not throw or leave the user stuck when logout cannot reach the API", async () => {
  const { replace, storage } = setup();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Network failure")));
  await expect(apiSignOut(true)).resolves.toBeUndefined();
  expect(storage.has("sanadi-api-refresh-token")).toBe(false);
  expect(storage.get("sanadi-signed-out")).toBe("1");
  expect(replace).toHaveBeenCalledWith("/auth");
});


it("does not restore cookies or refresh tokens after logout and page reload", async () => {
  const { storage } = setup();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 204 }));
  await apiSignOut(true);
  vi.mocked(fetch).mockClear();
  expect(storage.get("sanadi-signed-out")).toBe("1");
  expect(await apiCurrentUser()).toBeNull();
  expect(await apiRefresh()).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it("ignores a session check that finishes after logout", async () => {
  setup();
  let complete!: (value: unknown) => void;
  vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }))
    .mockResolvedValue({ ok: true, status: 204 }));
  const pending = apiCurrentUser();
  await apiSignOut(true);
  complete(new Response(JSON.stringify({ id: "old-user" }), { status: 200 }));
  expect(await pending).toBeNull();
});

it("ignores refresh credentials that arrive after logout", async () => {
  const { storage } = setup();
  let complete!: (value: unknown) => void;
  vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }))
    .mockResolvedValue({ ok: true, status: 204 }));
  const pending = apiRefresh();
  await apiSignOut(true);
  complete(new Response(JSON.stringify({ access_token: "old-access", refresh_token: "old-refresh", user: { id: "old" } }), { status: 200 }));
  expect(await pending).toBeNull();
  expect(storage.has("sanadi-api-refresh-token")).toBe(false);
});

it("returns to fresh SSO login even when the API supplies a provider logout URL", async () => {
  const { replace, storage } = setup();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ logoutUrl: "https://idp.test/logout?client_id=sanadi" }))));
  await apiSignOut(true);
  expect(replace).toHaveBeenCalledWith("/auth");
  expect(replace).not.toHaveBeenCalledWith("https://idp.test/logout?client_id=sanadi");
  expect(storage.get("sanadi-force-sso")).toBe("1");
  expect(storage.get("sanadi-signed-out")).toBe("1");
});

it("ignores an unsafe provider logout URL and still returns to fresh sign-in", async () => {
  const { replace, storage } = setup();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ logoutUrl: "javascript:alert(1)" }))));
  await apiSignOut(true);
  expect(replace).toHaveBeenCalledWith("/auth");
  expect(storage.get("sanadi-signed-out")).toBe("1");
});
