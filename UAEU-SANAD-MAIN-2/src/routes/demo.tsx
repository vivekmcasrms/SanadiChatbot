import { useState } from "react";
import { toastError } from "@/lib/errors/toast";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { LogIn, Users, Briefcase } from "lucide-react";
import { toast } from "sonner";
import { apiSignIn, apiSignOut } from "@/lib/api-auth";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n } from "@/lib/i18n";
import { listDemoAccounts, getDemoAccessState } from "@/lib/demo-seed.functions";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "Demo accounts — Sanadi | UAEU" },
      {
        name: "description",
        content:
          "Sign in instantly with fictional demo student and staff accounts to test the Sanadi assistant, cases, alerts and staff portal.",
      },
      { property: "og:title", content: "Demo accounts — Sanadi | UAEU" },
      { property: "og:description", content: "Test the assistant with fictional student and staff logins." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DemoPage,
});

const SCENARIOS: Record<string, { en: string; ar: string }> = {
  graduation_one_course: { en: "One course away from graduation", ar: "يتبقى مقرر واحد للتخرج" },
  missing_prerequisite: { en: "Blocked by a missing prerequisite", ar: "متطلب سابق ناقص" },
  financial_hold: { en: "Financial hold blocking registration", ar: "قيد مالي يمنع التسجيل" },
  advising_appointment: { en: "Advising appointment booked", ar: "موعد إرشاد محجوز" },
  low_gpa: { en: "Academic warning, low GPA", ar: "إنذار أكاديمي ومعدل منخفض" },
  missing_document: { en: "Missing required document", ar: "مستند مطلوب ناقص" },
  transport_complaint: { en: "Open transport complaint", ar: "شكوى نقل مفتوحة" },
  suggestion_lab_hours: { en: "Submitted a lab-hours suggestion", ar: "اقتراح بخصوص ساعات المختبر" },
  overdue_it_case: { en: "Overdue IT support case", ar: "حالة دعم تقني متأخرة" },
  graduation_ready: { en: "Ready to graduate", ar: "جاهزة للتخرج" },
  accessibility_support: { en: "Accessibility support needs", ar: "احتياجات إمكانية الوصول" },
};

function DemoPage() {
  const { lang, t } = useI18n();
  const ar = lang === "ar";
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [accessCode, setAccessCode] = useState<string | null>(null);

  const { data: access, isLoading: accessLoading } = useQuery({
    queryKey: ["demo-access"],
    queryFn: () => getDemoAccessState(),
  });

  const unlocked = Boolean(access?.enabled && (!access.requiresCode || accessCode !== null));

  const { data, isLoading, error } = useQuery({
    queryKey: ["demo-accounts", accessCode],
    enabled: unlocked,
    retry: false,
    queryFn: () => listDemoAccounts({ data: { accessCode } }),
  });

  async function signInAs(email: string, password: string, staff: boolean) {
    if (busy) return;
    setBusy(email);
    try {
      apiSignOut();
      await apiSignIn(email, password);
      navigate({ to: staff ? "/staff" : "/assistant", replace: true });
    } catch (error) {
      toastError(error, lang);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="w-full border-b bg-background pt-3">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
        <Link
          to="/"
          aria-label="Go to Sanadi home"
          className="rounded-md text-base font-semibold tracking-tight transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("app_name")}
        </Link>
        <LanguageSwitcher compact />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-16">
        <h1 className="text-2xl font-semibold tracking-tight">
          {ar ? "حسابات تجريبية" : "Demo accounts"}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {ar
            ? "جميع البيانات خيالية لأغراض الاختبار. اختر حساباً لتسجيل الدخول مباشرة وتجربة المساعد والحالات والتنبيهات."
            : "All records are fictional test data. Pick an account to sign in instantly and explore the assistant, cases and alerts."}
        </p>

        {accessLoading ? (
          <p className="mt-8 text-sm text-muted-foreground">{t("loading")}</p>
        ) : !access?.enabled ? (
          <div className="mt-8 rounded-xl border bg-card p-6 card-shadow">
            <h2 className="text-sm font-semibold">{ar ? "الوصول التجريبي غير متاح" : "Demo access unavailable"}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {ar
                ? "تم إيقاف تسجيل الدخول التجريبي في هذه البيئة. يرجى استخدام حسابك الجامعي لتسجيل الدخول."
                : "Demo sign-in is disabled in this environment. Please sign in with your university account."}
            </p>
            <Button asChild className="mt-4" size="sm">
              <Link to="/auth">{ar ? "تسجيل الدخول" : "Sign in"}</Link>
            </Button>
          </div>
        ) : access.requiresCode && accessCode === null ? (
          <form
            className="mt-8 max-w-sm rounded-xl border bg-card p-6 card-shadow"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              if (codeInput.trim()) setAccessCode(codeInput.trim());
            }}
          >
            <h2 className="text-sm font-semibold">{ar ? "رمز الوصول التجريبي" : "Demo access code"}</h2>
            <p className="mt-2 text-xs text-muted-foreground">
              {ar
                ? "هذه الحسابات متاحة للعروض التوضيحية المصرّح بها فقط."
                : "These accounts are available for authorised demonstrations only."}
            </p>
            <Input
              className="mt-3"
              type="password"
              autoComplete="off"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder={ar ? "أدخل الرمز" : "Enter code"}
              aria-label={ar ? "رمز الوصول التجريبي" : "Demo access code"}
            />
            <Button className="mt-3 w-full" size="sm" type="submit" disabled={!codeInput.trim()}>
              {ar ? "فتح" : "Unlock"}
            </Button>
          </form>
        ) : error ? (
          <div className="mt-8 rounded-xl border bg-card p-6 card-shadow">
            <p className="text-sm text-muted-foreground">
              {ar ? "رمز الوصول غير صحيح." : "That demo access code is not valid."}
            </p>
            <Button className="mt-3" size="sm" variant="secondary" onClick={() => setAccessCode(null)}>
              {ar ? "إعادة المحاولة" : "Try again"}
            </Button>
          </div>
        ) : isLoading ? (
          <p className="mt-8 text-sm text-muted-foreground">{t("loading")}</p>
        ) : (
          <>
            <section className="mt-8">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <Users className="size-4" aria-hidden />
                {ar ? "طلبة" : "Students"}
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data?.students.map((s) => (
                  <article key={s.email} className="card-shadow rounded-xl border bg-card p-4">
                    <h3 className="text-sm font-semibold">{ar ? s.nameAr : s.nameEn}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {s.program} · {ar ? SCENARIOS[s.scenario]?.ar ?? s.scenario : SCENARIOS[s.scenario]?.en ?? s.scenario}
                    </p>
                    <p className="mt-2 break-all text-xs text-muted-foreground">{s.email}</p>
                    <Button
                      className="mt-3 w-full"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => signInAs(s.email, data.studentPassword, false)}
                    >
                      <LogIn className="size-4" aria-hidden />
                      {busy === s.email ? t("loading") : ar ? "دخول كطالب" : "Sign in as student"}
                    </Button>
                  </article>
                ))}
              </div>
            </section>

            <section className="mt-10">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <Briefcase className="size-4" aria-hidden />
                {ar ? "موظفون" : "Staff"}
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data?.staff.map((s) => (
                  <article key={s.email} className="card-shadow rounded-xl border bg-card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold">{ar ? s.nameAr : s.nameEn}</h3>
                      {s.isOwner ? (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          {ar ? "مالك الخدمة" : "Service Owner"}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{ar ? s.jobAr : s.jobEn}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {s.unit} · {s.role.replace(/_/g, " ")}
                    </p>
                    {s.scenario ? (
                      <p className="mt-1 text-xs text-muted-foreground">{s.scenario}</p>
                    ) : null}
                    <p className="mt-2 break-all text-xs text-muted-foreground">{s.email}</p>
                    <Button
                      className="mt-3 w-full"
                      size="sm"
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() => signInAs(s.email, data.staffPassword, true)}
                    >
                      <LogIn className="size-4" aria-hidden />
                      {busy === s.email ? t("loading") : ar ? "دخول كموظف" : "Sign in as staff"}
                    </Button>
                  </article>
                ))}
              </div>
            </section>

            <p className="mt-10 text-xs text-muted-foreground">
              {ar
                ? "تُدار كلمات المرور التجريبية من الخادم ولا تُعرض هنا. استخدم أزرار الدخول أعلاه."
                : "Demo passwords are handled on the server and are not displayed. Use the sign-in buttons above."}
            </p>
          </>
        )}
      </main>
    </div>
  );
}