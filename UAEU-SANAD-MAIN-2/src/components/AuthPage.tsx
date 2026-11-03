import { useEffect, useRef, useState } from "react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { landingFor } from "@/lib/nav";
import { startSsoLogin } from "@/lib/sso";
import { authTrace } from "@/lib/auth-trace";
import { SsoTransition } from "@/components/SsoTransition";
import { isSignedOut } from "@/lib/logout-state";

// University credentials are entered only on the identity provider's page.
export function AuthPage() {
  const { session, roles, loading, rolesLoaded } = useAuth();
  const { lang } = useI18n();
  const { sso_error: ssoError } = useSearch({ from: "/auth" });
  const navigate = useNavigate();
  const redirected = useRef(false);
  const [rolesTimedOut, setRolesTimedOut] = useState(false);

  useEffect(() => {
    if (!session || rolesLoaded) return;
    const timer = setTimeout(() => setRolesTimedOut(true), 4000);
    return () => clearTimeout(timer);
  }, [session, rolesLoaded]);

  useEffect(() => {
    if (redirected.current) return;
    if (ssoError) {
      redirected.current = true;
      authTrace("AUTH_FAILED", { code: "sso_callback_rejected" });
      toast.error(lang === "ar"
        ? "تعذر إكمال تسجيل الدخول الجامعي. يرجى المحاولة مجدداً عبر ابدأ مع سندي، أو التواصل مع الدعم إذا استمرت المشكلة."
        : "University sign-in could not be completed. Please try Start with Sanadi again, or contact support if the problem continues.");
      // Return home rather than automatically repeat a rejected SSO flow.
      authTrace("AUTH_REDIRECT", { code: "home_after_sso_failure" });
      void navigate({ to: "/", replace: true });
      return;
    }
    if (loading) return;
    // Keep the signed-out marker until a new browser-bound SSO ticket is redeemed.
    // An old in-memory session must not redirect back into the application.
    if (!session || isSignedOut()) {
      redirected.current = true;
      authTrace("AUTH_REDIRECT", { code: "sso_login_no_session" });
      window.sessionStorage.removeItem("sanadi-force-sso");
      void startSsoLogin().catch(() => {
        authTrace("AUTH_FAILED", { code: "sso_start_failed" });
        toast.error("University sign-in is unavailable. Please try again.");
        void navigate({ to: "/", replace: true });
      });
      return;
    }
    if (!rolesLoaded && !rolesTimedOut) return;
    redirected.current = true;
    const target = landingFor(roles);
    authTrace("AUTH_REDIRECT", { code: target.to });
    void navigate({ to: target.to, search: target.search ?? {}, replace: true });
  }, [ssoError, lang, loading, session, rolesLoaded, rolesTimedOut, roles, navigate]);

  return <SsoTransition />;
}
