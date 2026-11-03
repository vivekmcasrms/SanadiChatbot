import { useEffect, useRef, useState } from "react";
import { toastError } from "@/lib/errors/toast";
import { authTimer, authTrace, safeAuthCode } from "@/lib/auth-trace";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SanadiLogo } from "@/components/SanadiLogo";
import { useI18n } from "@/lib/i18n";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { landingFor } from "@/lib/nav";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Sanadi | UAEU" },
      {
        name: "description",
        content: "Sign in with your university email to use the Sanadi assistant.",
      },
      { property: "og:title", content: "Sign in — Sanadi | UAEU" },
      { property: "og:description", content: "Access your student service assistant." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { t, lang } = useI18n();
  const { session, roles, loading, rolesLoaded, profile } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const isAr = lang === "ar";
  async function sendReset() {
    if (!email) {
      toast.error(isAr ? "أدخل بريدك الإلكتروني أولاً." : "Enter your email first.");
      return;
    }
    setBusy(true);
    // The response is the same whether or not the account exists (no account enumeration).
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    setBusy(false);
    setResetSent(true);
  }
  // Set once a provider session exists: drives the redirect watchdog so a slow
  // or failed profile/role lookup can never strand the user on this screen.
  const signedInAt = useRef<number | null>(null);
  const redirected = useRef(false);
  const [rolesTimedOut, setRolesTimedOut] = useState(false);

  // Watchdog: roles usually resolve in well under a second. If the lookup is
  // blocked (RLS, network) we still redirect with whatever we have.
  useEffect(() => {
    if (!session || rolesLoaded) return;
    const timer = setTimeout(() => setRolesTimedOut(true), 4000);
    return () => clearTimeout(timer);
  }, [session, rolesLoaded]);

  useEffect(() => {
    if (!session || loading || redirected.current) return;
    if (!rolesLoaded && !rolesTimedOut) return;
    redirected.current = true;
    const elapsed = signedInAt.current ? Date.now() - signedInAt.current : undefined;
    if (rolesLoaded) {
      authTrace("AUTH_PROFILE_LOADED", { ms: elapsed, code: profile ? "ok" : "no_profile_row" });
      authTrace("AUTH_ROLE_RESOLVED", { ms: elapsed, roles: roles.length, code: roles[0] ?? "none" });
    } else {
      authTrace("AUTH_ROLE_RESOLVED", { ms: elapsed, code: "role_lookup_timeout" });
    }
    const target = landingFor(roles);
    authTrace("AUTH_REDIRECT", { ms: elapsed, code: target.to });
    setBusy(false);
    navigate({ to: target.to, search: target.search ?? {}, replace: true }).then(() => {
      authTrace("AUTH_COMPLETE", { ms: signedInAt.current ? Date.now() - signedInAt.current : undefined, code: target.to });
    });
  }, [session, loading, rolesLoaded, rolesTimedOut, roles, profile, navigate]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || password.length < 6) {
      toast.error(t("required_field"));
      return;
    }
    const elapsed = authTimer();
    authTrace("AUTH_SUBMIT", { mode });
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: fullName.trim() },
          },
        });
        authTrace("AUTH_PROVIDER_RESPONSE", { ms: elapsed(), code: error ? safeAuthCode(error) : "signup_ok" });
        if (error) throw error;
        toast.success(t("auth_check_email"));
        setMode("signin");
        setBusy(false);
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        authTrace("AUTH_PROVIDER_RESPONSE", { ms: elapsed(), code: error ? safeAuthCode(error) : "ok" });
        if (error) throw error;
        if (!data.session) throw new Error("No session returned by the authentication provider");
        signedInAt.current = Date.now();
        authTrace("AUTH_SESSION_CREATED", { ms: elapsed(), code: "session_ok" });
        // `busy` stays true until the redirect effect runs, but a hard safety
        // net releases the button so the user is never stuck on a spinner.
        setTimeout(() => setBusy(false), 6000);
      }
    } catch (error) {
      authTrace("AUTH_FAILED", { ms: elapsed(), code: safeAuthCode(error) });
      toastError(error, lang);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="mx-auto flex h-16 w-full max-w-lg items-center justify-between px-4">
        <Link
          to="/"
          aria-label="Go to Sanadi home"
          className="inline-flex rounded-md transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <SanadiLogo />
        </Link>
        <LanguageSwitcher compact />
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
        <div className="card-shadow rounded-2xl border bg-card p-6">
          <p className="text-xs font-medium uppercase tracking-wide text-primary">{t("app_tagline")}</p>
          <h1 className="text-xl font-semibold">{t("auth_title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("auth_subtitle")}</p>

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            {mode === "signup" ? (
              <div className="space-y-2">
                <Label htmlFor="fullName">{t("full_name")}</Label>
                <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="email">{t("email")}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t("password")}</Label>
                {mode === "signin" ? (
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => void sendReset()} disabled={busy}>
                    {isAr ? "نسيت كلمة المرور؟" : "Forgot password?"}
                  </button>
                ) : null}
              </div>
              <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                className="pe-10"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
              <button
                type="button"
                className="absolute inset-y-0 end-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? (isAr ? "إخفاء كلمة المرور" : "Hide password") : (isAr ? "إظهار كلمة المرور" : "Show password")}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              </button>
              </div>
              {resetSent ? (
                <p role="status" className="text-xs text-muted-foreground">
                  {isAr
                    ? "إذا كان هذا البريد مسجلاً، فستصلك رسالة لإعادة تعيين كلمة المرور."
                    : "If this email is registered, you will receive a password reset link."}
                </p>
              ) : null}
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? t("loading") : mode === "signup" ? t("sign_up") : t("sign_in")}
            </Button>
          </form>

          <button
            type="button"
            className="mt-4 w-full text-sm text-primary underline-offset-4 hover:underline"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? t("auth_switch_signup") : t("auth_switch_signin")}
          </button>

        </div>
      </main>
    </div>
  );
}