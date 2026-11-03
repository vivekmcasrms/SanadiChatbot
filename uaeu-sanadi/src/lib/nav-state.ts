import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BadgeKey } from "@/lib/nav";

const FAVORITES_KEY = "uaeu.nav.favorites";
const PREVIEW_KEY = "uaeu.nav.studentPreview";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Pinned navigation item codes. Only rendered when non-empty. */
export function useFavorites() {
  const [codes, setCodes] = useState<string[]>([]);

  useEffect(() => {
    setCodes(read<string[]>(FAVORITES_KEY, []));
  }, []);

  const toggle = useCallback((code: string) => {
    setCodes((prev) => {
      const next = prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code];
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { codes, toggle };
}

/** Student-preview mode is a UI affordance only; it never grants or bypasses authorization. */
export function useStudentPreview() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(read<boolean>(PREVIEW_KEY, false));
  }, []);

  const set = useCallback((next: boolean) => {
    setActive(next);
    window.localStorage.setItem(PREVIEW_KEY, JSON.stringify(next));
  }, []);

  return { active, set };
}

export type BadgeCounts = Partial<Record<BadgeKey, number>>;

/** All counts run through the user's own RLS-scoped session, so nothing unauthorized leaks. */
export function useNavBadges(enabled: boolean) {
  return useQuery<BadgeCounts>({
    queryKey: ["nav-badges"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const [ops, approvals, knowledge, integrations] = await Promise.all([
        supabase
          .from("cases")
          .select("id", { count: "exact", head: true })
          .in("status", ["submitted", "acknowledged", "assigned", "in_review", "escalated"]),
        supabase
          .from("approval_requests")
          .select("id", { count: "exact", head: true })
          .eq("approval_status", "pending"),
        supabase
          .from("knowledge_approval_requests")
          .select("id", { count: "exact", head: true })
          .eq("approval_status", "pending"),
        supabase
          .from("integration_connectors")
          .select("id", { count: "exact", head: true })
          .in("health_status", ["error", "failed", "offline", "degraded"]),
      ]);
      return {
        operations: ops.count ?? 0,
        approvals: approvals.count ?? 0,
        knowledge: knowledge.count ?? 0,
        integrations: integrations.count ?? 0,
      };
    },
  });
}
