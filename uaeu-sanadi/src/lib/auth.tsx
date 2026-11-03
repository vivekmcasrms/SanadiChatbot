import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { setAuthToken } from "@/lib/auth-token";

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
      const [{ data: p }, { data: r }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, email, phone, preferred_language")
          .eq("id", userId)
          .maybeSingle(),
        // Effective roles: revoked/disabled accounts lose staff menus immediately.
        supabase.rpc("active_roles", { _user_id: userId }),
      ]);
      setProfile((p as Profile) ?? null);
      setRoles(((r ?? []) as AppRole[]).slice());
      setRolesLoaded(true);
      loadedFor.current = userId;
    })();
    inFlight.current = run.finally(() => {
      inFlight.current = null;
    });
    return run;
  }

  useEffect(() => {
    let active = true;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      setAuthToken(next?.access_token ?? null);
      setLoading(false);
      setRolesLoaded(false);
      // Never call other supabase methods synchronously inside this callback:
      // supabase-js holds an internal lock and the nested call can deadlock.
      const uid = next?.user?.id;
      setTimeout(() => {
        if (active) void load(uid);
      }, 0);
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setAuthToken(data.session?.access_token ?? null);
      setLoading(false);
      void load(data.session?.user?.id);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
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
      refresh: () => load(session?.user?.id, true),
    }),
    [session, profile, roles, loading, rolesLoaded],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}