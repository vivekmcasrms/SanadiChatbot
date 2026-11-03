import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  effects: [] as (() => unknown)[], navigate: vi.fn(), apply: vi.fn(), redeem: vi.fn(), clear: vi.fn(), restart: vi.fn(),
  trace: vi.fn(),
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(), useEffect: (fn: () => unknown) => state.effects.push(fn),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => state.navigate, Link: () => null,
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ applySsoSession: state.apply }) }));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ lang: "en" }) }));
vi.mock("@/lib/nav", () => ({ landingFor: (roles: string[]) => ({ to: roles.includes("system_admin") ? "/admin" : "/assistant" }) }));
vi.mock("@/lib/sso", () => ({ redeemSsoTicket: state.redeem, startSsoLogin: state.restart }));
vi.mock("@/lib/auth-trace", async original => ({
  ...await original<typeof import("@/lib/auth-trace")>(), authTrace: state.trace,
}));
import { SsoCallbackPage } from "@/components/SsoCallbackPage";

beforeEach(() => {
  vi.clearAllMocks(); state.effects = [];
  vi.stubGlobal("window", {
    location: { search: "?ssoTicket=opaque-ticket", pathname: "/auth/callback" },
    history: { state: {}, replaceState: state.clear },
    sessionStorage: { removeItem: vi.fn(), getItem: vi.fn(), setItem: vi.fn() },
  });
});
afterEach(() => vi.unstubAllGlobals());
function render() {
  const html = renderToString(createElement(SsoCallbackPage));
  expect(html).not.toMatch(/<form|<input|type="password"/);
  state.effects.forEach(effect => effect());
}
describe("ticket callback page", () => {
  it("restarts SSO once for an invalid ticket without granting access", async () => {
    state.redeem.mockRejectedValue(Object.assign(new Error("expired"), { code: "sso_invalid_ticket" }));
    state.restart.mockResolvedValue(undefined);
    render();
    await vi.waitFor(() => expect(state.restart).toHaveBeenCalledTimes(1));
    expect(state.apply).not.toHaveBeenCalled();
  });
  it.each(["student", "system_admin"])("loads %s content after applying SQL roles", async role => {
    const session = { access_token: "access", user: { id: "id", app_metadata: { roles: [role] } } };
    state.redeem.mockResolvedValue(session);
    render();
    expect(state.clear).toHaveBeenCalledWith({}, "", "/auth/callback");
    expect(state.trace).toHaveBeenCalledWith("AUTH_CALLBACK_RECEIVED", { code: "sso_callback_received", stage: "callback" });
    expect(state.clear.mock.invocationCallOrder[0]).toBeLessThan(state.trace.mock.invocationCallOrder[0]!);
    await vi.waitFor(() => expect(state.navigate).toHaveBeenCalledWith({ to: role === "student" ? "/assistant" : "/admin", search: {}, replace: true }));
    expect(state.apply).toHaveBeenCalledWith(session);
    expect(state.apply.mock.invocationCallOrder[0]).toBeLessThan(state.navigate.mock.invocationCallOrder[0]!);
  });
  it("does not grant access after ticket rejection", async () => {
    state.redeem.mockRejectedValue(new Error("expired"));
    render();
    await Promise.resolve(); await Promise.resolve();
    expect(state.apply).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
  });
});
