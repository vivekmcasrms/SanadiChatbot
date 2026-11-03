import { createFileRoute, redirect } from "@tanstack/react-router";

/** Merged into the unified staff case workspace; old links keep working. */
export const Route = createFileRoute("/_authenticated/owner-console")({
  validateSearch: (s: Record<string, unknown>) => ({
    tab: typeof s["tab"] === "string" ? (s["tab"] as string) : undefined,
    unit: typeof s["unit"] === "string" ? (s["unit"] as string) : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/cases", search: { tab: search.tab ?? "dashboard", unit: search.unit }, replace: true });
  },
});
