import { createFileRoute, Outlet, redirect, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";
import { authTrace } from "@/lib/auth-trace";
import { apiCurrentUser } from "@/lib/api-auth";
import { apiFetch } from "@/lib/auth-token";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // Use the locally persisted session first: it is instant and avoids a
    // network round-trip (and a redirect race) on every navigation.
    const user = await apiCurrentUser();
    if (!user) throw redirect({ to: "/auth" });
    const access = await apiFetch<{ allowed: boolean; landing: string }>(
      `/api/route-access?path=${encodeURIComponent(location.pathname)}`,
    );
    if (!access.allowed) {
      authTrace("AUTH_REDIRECT", { code: "role_access_redirect" });
      throw redirect({ href: access.landing, replace: true });
    }
    return { user };
  },
  component: AuthenticatedContent,
});

function AuthenticatedContent() {
  const pathname = useLocation({ select: location => location.pathname });
  useEffect(() => {
    // The protected route has passed the API's role check and mounted.
    authTrace("AUTH_COMPLETE", { code: "role_content_mounted" });
  }, [pathname]);
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
