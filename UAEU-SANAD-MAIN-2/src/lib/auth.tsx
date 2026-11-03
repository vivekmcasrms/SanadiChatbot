import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ApiSession, ApiUser } from "@/lib/api-auth";
import { apiCurrentUser } from "@/lib/api-auth";
import { apiFetch } from "@/lib/auth-token";
import { authTrace, safeAuthCode } from "@/lib/auth-trace";
import { SsoTransition } from "@/components/SsoTransition";

export type Session = ApiSession;
export type User = ApiUser;

export type AppRole =
  | "student"
  | "service_officer"
  | "service_owner"
  | "service_manager"
  | "knowledge_manager"
  | "system_admin"
  | "auditor"
  | "leadership_viewer"
  | "integration_admin"
  | "knowledge_approver";

export type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  preferred_language: "en" | "ar";
};

type AuthCtx = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  roles: AppRole[];
  loading: boolean;
  /** True once profile + roles have been fetched for the current session. */
  rolesLoaded: boolean;
  isStaff: boolean;
  refresh: () => Promise<void>;
  applySsoSession: (next: ApiSession) => void;
};

const Ctx = createContext<AuthCtx | null>(null);

const STAFF_ROLES: AppRole[] = [
  "service_officer",
  "service_owner",
  "service_manager",
  "knowledge_manager",
  "system_admin",
  "auditor",
  "leadership_viewer",
  "integration_admin",
  "knowledge_approver",
];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const leave = () => setLeaving(true);
    window.addEventListener("sanadi-signing-out", leave);
    return () => window.removeEventListener("sanadi-signing-out", leave);
  }, []);

  // The initial session arrives twice (getSession + INITIAL_SESSION event).
  // Without this guard every page bootstrap fetched profile + roles twice.
  const loadedFor = useRef<string | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  async function load(userId: string | undefined, force = false) {
    if (!force && userId && loadedFor.current === userId) {
      setRolesLoaded(true);
      return;
    }
    if (!force && inFlight.current) return inFlight.current;
    if (!userId) {
      loadedFor.current = null;
      setProfile(null);
      setRoles([]);
      setRolesLoaded(true);
      return;
    }
    const run = (async () => {
      try {
        const [p, r] = await Promise.all([
          apiFetch<Profile[]>(`/api/v1/data/profiles?id=eq.${encodeURIComponent(userId)}&select=id,full_name,email,phone,preferred_language`),
          apiFetch<{ role: AppRole }[]>(`/api/v1/data/user_roles?user_id=eq.${encodeURIComponent(userId)}&select=role`),
        ]);
        setProfile(p?.[0] ?? null);
        authTrace("AUTH_PROFILE_LOADED", { code: p?.[0] ? "profile_found" : "profile_missing" });
        setRoles((r ?? []).map((x) => x.role));
        for (const row of r ?? []) authTrace("AUTH_ROLE_RESOLVED", { code: row.role });
        loadedFor.current = userId;
      } catch (error) {
        authTrace("AUTH_FAILED", { code: safeAuthCode(error), stage: "profile_roles" });
        throw error;
      } finally {
        setRolesLoaded(true);
      }
    })();
    inFlight.current = run.finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }

  useEffect(() => {
    // The callback applies its redeemed session before requesting profile/roles.
    if (window.location.pathname.replace(/\/$/, "") === "/auth/callback" ||
        (window.location.pathname === "/auth" && window.sessionStorage.getItem("sanadi-force-sso") === "1")) {
      setLoading(false);
      return;
    }
    let active = true;
    void (async () => {
      const user = await apiCurrentUser();
      if (!active) return;
      const next = user ? { user, access_token: "active", refresh_token: "active", expires_at: 0 } : null;
      setSession(next);
      setLoading(false);
      setRolesLoaded(false);
      void load(user?.id);
    })();
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      roles,
      loading,
      rolesLoaded,
      isStaff: roles.some((r) => STAFF_ROLES.includes(r)),
      applySsoSession: (next: ApiSession) => {
        setSession(next);
        setRoles((next.user.app_metadata?.roles ?? []) as AppRole[]);
        setLoading(false);
        setRolesLoaded(true);
        // SQL roles arrived with the session. Profile loading must not undo it.
        void load(next.user.id, true).catch(() => { /* keep session roles */ });
      },
      refresh: async () => {
        const user = await apiCurrentUser();
        const next = user
          ? { user, access_token: "active", refresh_token: "active", expires_at: 0 }
          : null;
        setSession(next);
        setLoading(false);
        setRolesLoaded(false);
        await load(user?.id, true);
      },
    }),
    [session, profile, roles, loading, rolesLoaded],
  );

  return <Ctx.Provider value={value}>{leaving ? <SsoTransition message="Signing out…" /> : children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
