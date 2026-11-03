import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UaeuLogo } from "@/components/UaeuLogo";
import { useAuth, type AppRole } from "@/lib/auth";
import { landingFor } from "@/lib/nav";
import { redeemSsoTicket, startSsoLogin } from "@/lib/sso";
import { authTrace, safeAuthCode } from "@/lib/auth-trace";

export function SsoCallbackPage() {
  const { applySsoSession } = useAuth();
  const navigate = useNavigate();
  const handled = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const query = new URLSearchParams(window.location.search);
    const ticket = query.get("ssoTicket");
    const error = query.get("ssoError");
    const restartExpiredSso = async (code: string) => {
      if (!["sso_expired", "sso_invalid_ticket", "sso_invalid_state", "sso_invalid_nonce", "sso_invalid_token", "sso_invalid_code"].includes(code)) return false;
      // One fresh login, never an automatic loop if the provider keeps failing.
      if (window.sessionStorage.getItem("sanadi-sso-restarted") === "1") return false;
      window.sessionStorage.setItem("sanadi-sso-restarted", "1");
      try { await startSsoLogin(); return true; } catch { return false; }
    };
    // Remove the short-lived ticket before requesting resources or navigating.
    window.history.replaceState(window.history.state, "", window.location.pathname);
    authTrace("AUTH_CALLBACK_RECEIVED", { code: "sso_callback_received", stage: "callback" });
    if (error || !ticket) {
      authTrace("AUTH_FAILED", { code: "sso_callback_rejected" });
      void restartExpiredSso(error ?? "").then(restarted => { if (!restarted) setFailed(true); });
      return;
    }
    void (async () => {
      try {
        const session = await redeemSsoTicket(ticket);
        window.sessionStorage.removeItem("sanadi-sso-restarted");
        applySsoSession(session);
        authTrace("AUTH_SESSION_APPLIED", { code: "sso_session_applied", stage: "session_install" });
        for (const role of session.user.app_metadata?.roles ?? []) authTrace("AUTH_ROLE_RESOLVED", { code: role });
        const target = landingFor((session.user.app_metadata?.roles ?? []) as AppRole[]);
        authTrace("AUTH_REDIRECT", { code: target.to });
        await navigate({ to: target.to, search: target.search ?? {}, replace: true });
        authTrace("AUTH_COMPLETE", { code: target.to });
      } catch (error) {
        authTrace("AUTH_FAILED", { code: safeAuthCode(error), stage: "sso_ticket" });
        if (!await restartExpiredSso(safeAuthCode(error))) setFailed(true);
      }
    })();
  }, [applySsoSession, navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-secondary via-background to-background px-4 py-10">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border bg-card text-center shadow-lg shadow-primary/10">
        <div className="h-2 w-full bg-[linear-gradient(to_bottom,#dc4d58,#c01d2a)]" aria-hidden />
        <div className="px-6 py-8">
          <UaeuLogo className="mx-auto" />
          {failed ? (
            <>
              <span className="mt-6 inline-flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <ShieldAlert className="size-6" aria-hidden />
              </span>
              <h1 className="mt-4 text-lg font-semibold text-secondary-foreground">Unable to continue with SSO</h1>
              <p role="alert" className="mt-2 text-sm text-muted-foreground">University sign-in could not be completed. Please start a new sign-in from Sanadi home.</p>
              <Button asChild className="mt-6 w-full">
                <Link to="/">Return to Sanadi home</Link>
              </Button>
            </>
          ) : (
            <>
              <span className="mt-6 inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Loader2 className="size-6 animate-spin" aria-hidden />
              </span>
              <h1 className="mt-4 text-lg font-semibold text-secondary-foreground">UAEU SSO</h1>
              <p role="status" className="mt-2 text-sm text-muted-foreground">Completing UAEU SSO sign-in…</p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
