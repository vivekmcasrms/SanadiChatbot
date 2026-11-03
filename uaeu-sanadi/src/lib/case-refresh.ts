import type { QueryClient } from "@tanstack/react-query";

/** Queue/dashboard lists that show case rows and must update after any staff change. */
const LIST_KEYS = new Set([
  "owner-cases",
  "owner-workspace",
  "owner-unit-overview",
  "owner-dashboard",
  "staff-cases",
  "metrics",
  "my-notifications",
  "internship-owner-board",
]);

/**
 * Refresh every view of one case (detail, timeline, activity, dossier, hostel,
 * assignee picker) and every queue list, so staff never need a page reload.
 */
export function refreshCaseViews(qc: QueryClient, caseId: string): Promise<void> {
  return qc.invalidateQueries({
    predicate: (q) => q.queryKey.includes(caseId) || LIST_KEYS.has(String(q.queryKey[0])),
  });
}
