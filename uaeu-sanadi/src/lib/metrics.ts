import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Live, database-derived aggregates. Every row is RLS-scoped to the caller. */

const CLOSED_STATUSES = ["resolved", "closed"];

export type StaffMetrics = {
  total: number;
  open: number;
  unassigned: number;
  overdue: number;
  escalated: number;
  awaitingStudent: number;
  resolvedLast7: number;
  avgFirstResponseHours: number | null;
  avgResolutionHours: number | null;
  satisfactionAvg: number | null;
  byStatus: { status: string; count: number }[];
  byType: { type: string; count: number }[];
  suggestionsOpen: number;
};

function hoursBetween(a: string, b: string) {
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000);
}

function average(values: number[]) {
  if (!values.length) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
}

export function useStaffMetrics(enabled: boolean) {
  return useQuery({
    queryKey: ["metrics", "staff"],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<StaffMetrics> => {
      const [{ data: cases, error }, { data: suggestions, error: sErr }] = await Promise.all([
        supabase
          .from("cases")
          .select(
            "id, status, case_type, urgency, assigned_to, due_at, created_at, first_response_at, resolved_at, satisfaction_rating",
          )
          .limit(1000),
        supabase.from("suggestions").select("id, status").limit(1000),
      ]);
      if (error) throw error;
      if (sErr) throw sErr;

      const rows = cases ?? [];
      const now = Date.now();
      const weekAgo = now - 7 * 86_400_000;
      const openRows = rows.filter((c) => !CLOSED_STATUSES.includes(c.status));

      const statusMap = new Map<string, number>();
      const typeMap = new Map<string, number>();
      for (const c of rows) {
        statusMap.set(c.status, (statusMap.get(c.status) ?? 0) + 1);
        typeMap.set(c.case_type, (typeMap.get(c.case_type) ?? 0) + 1);
      }

      return {
        total: rows.length,
        open: openRows.length,
        unassigned: openRows.filter((c) => !c.assigned_to).length,
        overdue: openRows.filter((c) => c.due_at && new Date(c.due_at).getTime() < now).length,
        escalated: rows.filter((c) => c.status === "escalated").length,
        awaitingStudent: rows.filter((c) => c.status === "awaiting_student").length,
        resolvedLast7: rows.filter((c) => c.resolved_at && new Date(c.resolved_at).getTime() >= weekAgo).length,
        avgFirstResponseHours: average(
          rows.filter((c) => c.first_response_at).map((c) => hoursBetween(c.created_at, c.first_response_at!)),
        ),
        avgResolutionHours: average(
          rows.filter((c) => c.resolved_at).map((c) => hoursBetween(c.created_at, c.resolved_at!)),
        ),
        satisfactionAvg: average(
          rows.filter((c) => typeof c.satisfaction_rating === "number").map((c) => c.satisfaction_rating!),
        ),
        byStatus: [...statusMap.entries()]
          .map(([status, count]) => ({ status, count }))
          .sort((a, b) => b.count - a.count),
        byType: [...typeMap.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
        suggestionsOpen: (suggestions ?? []).filter((s) => !["implemented", "closed", "not_proceeding"].includes(s.status))
          .length,
      };
    },
  });
}

export type StudentMetrics = {
  openCases: number;
  awaitingStudent: number;
  resolvedCases: number;
  suggestions: number;
  unreadAlerts: number;
  avgResolutionHours: number | null;
};

export function useStudentMetrics(userId: string | undefined) {
  return useQuery({
    queryKey: ["metrics", "student", userId],
    enabled: Boolean(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<StudentMetrics> => {
      const [{ data: cases, error }, { count: suggestionCount }, { count: alertCount }] = await Promise.all([
        supabase
          .from("cases")
          .select("status, created_at, resolved_at")
          .eq("student_id", userId!)
          .is("student_hidden_at", null),
        supabase
          .from("suggestions")
          .select("id", { count: "exact", head: true })
          .eq("student_id", userId!)
          .is("student_hidden_at", null),
        supabase
          .from("student_alerts")
          .select("id", { count: "exact", head: true })
          .eq("student_id", userId!)
          .eq("is_read", false)
          .eq("status", "active"),
      ]);
      if (error) throw error;
      const rows = cases ?? [];
      return {
        openCases: rows.filter((c) => !CLOSED_STATUSES.includes(c.status)).length,
        awaitingStudent: rows.filter((c) => c.status === "awaiting_student").length,
        resolvedCases: rows.filter((c) => CLOSED_STATUSES.includes(c.status)).length,
        suggestions: suggestionCount ?? 0,
        unreadAlerts: alertCount ?? 0,
        avgResolutionHours: average(
          rows.filter((c) => c.resolved_at).map((c) => hoursBetween(c.created_at, c.resolved_at!)),
        ),
      };
    },
  });
}

export function formatDuration(hours: number | null) {
  if (hours === null) return "—";
  if (hours < 48) return `${hours}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}