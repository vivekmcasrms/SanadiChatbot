import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "@/components/AuthPage";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): { sso_error?: string } => {
    const error = search["sso_error"];
    return typeof error === "string" ? { sso_error: error } : {};
  },
  head: () => ({ meta: [{ title: "Signing in — Sanadi | UAEU" }] }),
  component: AuthPage,
});
