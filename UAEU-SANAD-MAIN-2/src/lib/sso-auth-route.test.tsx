import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: { session: null as null | object, loading: false, roles: [] as string[], rolesLoaded: true },
  search: {} as { sso_error?: string },
  effects: [] as (() => unknown)[],
  navigate: vi.fn(), replace: vi.fn(), error: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: (effect: () => unknown) => { state.effects.push(effect); },
}));
vi.mock("@tanstack/react-router", () => ({
  useSearch: () => state.search,
  useNavigate: () => state.navigate,
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => state.auth }));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ lang: "en" }) }));
vi.mock("@/lib/nav", () => ({ landingFor: () => ({ to: "/assistant" }) }));
vi.mock("@/lib/sso", () => ({ startSsoLogin: async () => state.replace("sso-authorize") }));
vi.mock("sonner", () => ({ toast: { error: state.error } }));
import { AuthPage } from "@/components/AuthPage";

beforeEach(() => {
  vi.clearAllMocks();
  state.auth = { session: null, loading: false, roles: [], rolesLoaded: true };
  state.search = {};
  state.effects = [];
  vi.stubGlobal("window", { location: { replace: state.replace }, sessionStorage: { removeItem: vi.fn(), getItem: vi.fn() } });
});
afterEach(() => vi.unstubAllGlobals());

function renderAndRunEffects() {
  const html = renderToString(createElement(AuthPage));
  expect(html).not.toMatch(/<form|<input|type="password"/);
  state.effects.forEach(effect => effect());
  return html;
}

describe("SSO-only auth route", () => {
  it("starts SSO for signed-out visitors", () => {
    renderAndRunEffects();
    expect(state.replace).toHaveBeenCalledWith("sso-authorize");
  });
  it("waits for the existing session check", () => {
    state.auth.loading = true;
    renderAndRunEffects();
    expect(state.replace).not.toHaveBeenCalled();
  });
  it("sends callback failures home without restarting the failed flow", () => {
    state.search = { sso_error: "sso_invalid_identity" };
    renderAndRunEffects();
    expect(state.navigate).toHaveBeenCalledWith({ to: "/", replace: true });
    expect(state.error).toHaveBeenCalledOnce();
    expect(state.replace).not.toHaveBeenCalled();
  });
  it("continues to the application after a successful session", () => {
    state.auth.session = { user: { id: "student" } };
    renderAndRunEffects();
    expect(state.navigate).toHaveBeenCalledWith({ to: "/assistant", search: {}, replace: true });
    expect(state.replace).not.toHaveBeenCalled();
  });
});

it("starts a fresh SSO login after explicit logout instead of using a stale session", () => {
  // Matches AuthPage: signed-out marker blocks protected landing; /auth begins SSO again.
  vi.mocked(window.sessionStorage.getItem).mockReturnValue("1");
  renderAndRunEffects();
  expect(state.replace).toHaveBeenCalledWith("sso-authorize");
  expect(state.navigate).not.toHaveBeenCalled();
});
