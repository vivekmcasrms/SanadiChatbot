import { createFileRoute, redirect } from "@tanstack/react-router";

const VIEW_TO_TAB: Record<string, string> = {
  queue: "attention",
  suggestions: "suggestions",
  approvals: "manager",
  escalations: "manager",
  unit: "dashboard",
};

/** Merged into the unified staff case workspace; old links keep working. */
export const Route = createFileRoute("/_authenticated/staff")({
  validateSearch: (s: Record<string, unknown>) => ({
    view: typeof s["view"] === "string" ? (s["view"] as string) : undefined,
    case: typeof s["case"] === "string" ? (s["case"] as string) : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (search.case) throw redirect({ to: "/requests/$caseId", params: { caseId: search.case }, replace: true });
    throw redirect({ to: "/cases", search: { tab: VIEW_TO_TAB[search.view ?? ""] ?? "attention" }, replace: true });
  },
});
