import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SanadiLogo } from "@/components/SanadiLogo";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — Sanadi | UAEU" },
      { name: "description", content: "Choose a new password for your Sanadi account." },
      { property: "og:title", content: "Reset password — Sanadi | UAEU" },
      { property: "og:description", content: "Choose a new password for your Sanadi account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The recovery link signs the user in with a short-lived recovery session.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    void supabase.auth.getSession().then(({ data: s }) => {
      if (s.session) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { toast.error(ar ? "يجب أن تكون كلمة المرور 8 أحرف على الأقل." : "Password must be at least 8 characters."); return; }
    if (password !== confirm) { toast.error(ar ? "كلمتا المرور غير متطابقتين." : "Passwords do not match."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { toast.error(ar ? "تعذّر تحديث كلمة المرور. اطلب رابطاً جديداً." : "Could not update the password. Request a new link."); return; }
    toast.success(ar ? "تم تحديث كلمة المرور." : "Password updated.");
    void navigate({ to: "/" });
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border bg-card p-6 card-shadow">
        <SanadiLogo className="mx-auto h-12" />
        <h1 className="text-center text-xl font-semibold">{ar ? "تعيين كلمة مرور جديدة" : "Set a new password"}</h1>
        {!ready ? (
          <p className="text-center text-sm text-muted-foreground">
            {ar ? "افتح هذه الصفحة من رابط إعادة التعيين في بريدك الإلكتروني." : "Open this page from the reset link in your email."}
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">{ar ? "كلمة المرور الجديدة" : "New password"}</Label>
              <div className="relative">
                <Input id="new-password" type={show ? "text" : "password"} className="pe-10" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <button
                  type="button"
                  className="absolute inset-y-0 end-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                  aria-label={show ? (ar ? "إخفاء كلمة المرور" : "Hide password") : ar ? "إظهار كلمة المرور" : "Show password"}
                  aria-pressed={show}
                  onClick={() => setShow((v) => !v)}
                >
                  {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">{ar ? "تأكيد كلمة المرور" : "Confirm password"}</Label>
              <Input id="confirm-password" type={show ? "text" : "password"} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {ar ? "حفظ كلمة المرور" : "Save password"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
