import { createFileRoute } from "@tanstack/react-router";
import { toastError } from "@/lib/errors/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { getDemoAccountStatus, openDemoPersona } from "@/lib/demo-accounts.functions";
import { provisionDemoEnvironment } from "@/lib/demo-seed.functions";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/demo-accounts")({
  head: () => ({
    meta: [
      { title: "Demo accounts — Sanadi | UAEU" },
      { name: "description", content: "Inspect the fictional demo personas, their service units and last sign-in." },
      { property: "og:title", content: "Demo accounts — Sanadi | UAEU" },
      { property: "og:description", content: "Administrative view of the demonstration personas." },
    ],
  }),
  component: DemoAccountsPage,
});

function DemoAccountsPage() {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const { roles } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [rebuildCode, setRebuildCode] = useState("");
  const isAdmin = roles.includes("system_admin");

  const { data, isLoading, error } = useQuery({
    queryKey: ["demo-account-status"],
    enabled: isAdmin,
    queryFn: () => getDemoAccountStatus(),
  });

  const rebuild = useMutation({
    mutationFn: () => provisionDemoEnvironment({ data: { accessCode: rebuildCode } }),
    onSuccess: () => {
      toast.success(ar ? "تم إعادة بناء البيئة التجريبية" : "Demo environment rebuilt");
      void queryClient.invalidateQueries({ queryKey: ["demo-account-status"] });
    },
    onError: (err: unknown) => toastError(err, lang),
  });

  async function openPersona(email: string, staff: boolean) {
    if (!data) return;
    if (busy) return;
    setBusy(email);
    try {
      await supabase.auth.signOut({ scope: "local" });
      const { tokenHash } = await openDemoPersona({ data: { email } });
      const { data: signIn, error: signInError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
      if (signInError) throw signInError;
      if (!signIn.session) throw new Error("No session returned");
      navigate({ to: staff ? "/cases" : "/assistant", replace: true });
    } catch (err) {
      toastError(err, lang);
    } finally {
      setBusy(null);
    }
  }

  if (!isAdmin)
    return (
      <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        {t("staff_only")}
      </p>
    );

  const staff = (data?.accounts ?? []).filter((a) => a.kind === "staff");
  const students = (data?.accounts ?? []).filter((a) => a.kind === "student");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{ar ? "الحسابات التجريبية" : "Demo accounts"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
          {ar
            ? "شخصيات خيالية لأغراض العرض فقط. لا تحتوي على بيانات حقيقية لأي طالب أو موظف."
            : "Fictional personas for demonstration only. No real student or employee data is used."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="password"
            aria-label={ar ? "رمز الوصول التجريبي" : "Demo access code"}
            placeholder={ar ? "رمز الوصول" : "Access code"}
            value={rebuildCode}
            onChange={(e) => setRebuildCode(e.target.value)}
            className="w-40"
            autoComplete="off"
          />
          <Button onClick={() => rebuild.mutate()} disabled={rebuild.isPending || !rebuildCode.trim()}>
            {rebuild.isPending
              ? ar
                ? "جارٍ إعادة البناء…"
                : "Rebuilding…"
              : ar
                ? "إعادة بناء البيئة التجريبية"
                : "Rebuild demo environment"}
          </Button>
        </div>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
      {error ? <p className="text-sm text-destructive">{(error as Error).message}</p> : null}

      {[
        { title: ar ? "مالكو الخدمات والموظفون" : "Service owners and staff", rows: staff, isStaff: true },
        { title: ar ? "الطلبة" : "Students", rows: students, isStaff: false },
      ].map((group) => (
        <section key={group.title} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</h2>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3 text-start">{ar ? "الاسم" : "Name"}</th>
                  <th className="p-3 text-start">{ar ? "الدور" : "Role"}</th>
                  <th className="p-3 text-start">{ar ? "الوحدة" : "Unit"}</th>
                  <th className="p-3 text-start">{ar ? "البريد" : "Email"}</th>
                  <th className="p-3 text-start">{ar ? "الحالة" : "Status"}</th>
                  <th className="p-3 text-start">{ar ? "آخر دخول" : "Last sign-in"}</th>
                  <th className="p-3 text-end" />
                </tr>
              </thead>
              <tbody>
                {group.rows.map((a) => (
                  <tr key={a.email} className="border-t">
                    <td className="p-3">
                      <span className="font-medium">{ar ? a.nameAr : a.nameEn}</span>
                      {a.isOwner ? (
                        <span className="ms-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          {ar ? "مالك الخدمة" : "Service Owner"}
                        </span>
                      ) : null}
                      <span className="block text-xs text-muted-foreground">{ar ? a.jobAr : a.jobEn}</span>
                    </td>
                    <td className="p-3 text-xs">{a.role.replace(/_/g, " ")}</td>
                    <td className="p-3 text-xs">{a.unit ?? "—"}</td>
                    <td className="p-3 text-xs break-all">{a.email}</td>
                    <td className="p-3 text-xs">
                      {a.provisioned ? (ar ? "جاهز" : "Provisioned") : ar ? "غير منشأ" : "Not created"}
                    </td>
                    <td className="p-3 text-xs tabular-nums">
                      {a.lastSignInAt ? new Date(a.lastSignInAt).toLocaleString(ar ? "ar-AE" : "en-GB") : "—"}
                    </td>
                    <td className="p-3 text-end">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!a.provisioned || busy !== null}
                        onClick={() => openPersona(a.email, group.isStaff)}
                      >
                        {busy === a.email ? t("loading") : ar ? "فتح الشخصية" : "Open persona"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

    </div>
  );
}
