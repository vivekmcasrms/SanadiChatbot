import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AuthPage } from "./AuthPage";

const state = vi.hoisted(() => ({
  effects: [] as Array<() => void>,
  signedOut: true,
  session: null as unknown,
  error: undefined as string | undefined,
  navigate: vi.fn(), login: vi.fn(),
}));
vi.mock("react", () => ({
  useEffect: (effect: () => void) => { state.effects.push(effect); },
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [value, vi.fn()],
}));
vi.mock("@tanstack/react-router", () => ({ useSearch: () => ({ sso_error: state.error }), useNavigate: () => state.navigate }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ session: state.session, roles: ["student"], loading: false, rolesLoaded: true }) }));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ lang: "en" }) }));
vi.mock("@/lib/sso", () => ({ startSsoLogin: () => state.login() }));
vi.mock("@/lib/logout-state", () => ({ isSignedOut: () => state.signedOut }));
vi.mock("@/lib/nav", () => ({ landingFor: () => ({ to: "/assistant" }) }));
vi.mock("@/lib/auth-trace", () => ({ authTrace: vi.fn() }));
vi.mock("@/components/SsoTransition", () => ({ SsoTransition: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  state.effects = [];
  state.signedOut = true;
  state.session = null;
  state.error = undefined;
  state.login.mockResolvedValue(undefined);
  vi.stubGlobal("window", { sessionStorage: { removeItem: vi.fn() } });
});
afterEach(() => vi.unstubAllGlobals());

function mount() {
  AuthPage();
  state.effects.forEach(effect => effect());
}

it("starts fresh SSO authentication after logout rather than returning home", () => {
  mount();
  expect(state.login).toHaveBeenCalledOnce();
  expect(state.navigate).not.toHaveBeenCalled();
});

it("does not use an old in-memory session to enter a protected page after logout", () => {
  state.session = { user: { id: "old-session" } };
  mount();
  expect(state.login).toHaveBeenCalledOnce();
  expect(state.navigate).not.toHaveBeenCalled();
});

it("keeps the normal landing flow after a new successful login", () => {
  state.signedOut = false;
  state.session = { user: { id: "new-session" } };
  mount();
  expect(state.login).not.toHaveBeenCalled();
  expect(state.navigate).toHaveBeenCalledWith({ to: "/assistant", search: {}, replace: true });
});

it("does not loop back to the provider after a rejected SSO callback", () => {
  state.error = "sso_invalid_state";
  mount();
  expect(state.login).not.toHaveBeenCalled();
  expect(state.navigate).toHaveBeenCalledWith({ to: "/", replace: true });
});
