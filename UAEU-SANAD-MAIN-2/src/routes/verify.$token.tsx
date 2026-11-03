import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, CircleAlert, Loader2, ShieldQuestion } from "lucide-react";
import { UaeuLogo } from "@/components/UaeuLogo";
import { verifyDocumentToken, type DocumentVerification } from "@/lib/documents.functions";

/**
 * PUBLIC document verification page.
 *
 * No sign-in, no Supabase session and no authenticated middleware: an employer,
 * embassy or bank scans the QR code and lands here. The verification token in
 * the URL is a document reference only — it is never an authentication token.
 */
export const Route = createFileRoute("/verify/$token")({
  head: () => ({
    meta: [
      { title: "Verify a UAEU document — Sanadi" },
      {
        name: "description",
        content:
          "Check the authenticity of a UAEU student document issued through Sanadi using its QR code or verification link.",
      },
      { property: "og:title", content: "Verify a UAEU document — Sanadi" },
      { property: "og:description", content: "Authenticity check for UAEU student letters issued by Sanadi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VerifyDocumentPage,
});

const fmt = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(iso),
  );

function VerifyDocumentPage() {
  const { token } = Route.useParams();
  const verify = verifyDocumentToken;
  const q = useQuery({
    queryKey: ["verify-document", token],
    // Public endpoint: any failure is presented as a neutral outcome, never a
    // raw backend or authentication message.
    queryFn: (): Promise<DocumentVerification> =>
      verify({ data: { token } }).catch((): DocumentVerification => ({ found: false })),
    retry: false,
  });

  const d = q.data ?? null;
  const state: "loading" | "rate_limited" | "valid" | "unavailable" | "invalid" = q.isLoading
    ? "loading"
    : d?.rateLimited
      ? "rate_limited"
      : d?.found && d.status === "valid"
        ? "valid"
        : d?.found
          ? "unavailable"
          : "invalid";

  const row = (label: string, value: string | null | undefined) =>
    value ? (
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b py-2.5 last:border-0">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-sm font-medium">{value}</span>
      </div>
    ) : null;

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col justify-center gap-6 p-6">
      <div className="flex items-center gap-3">
        <UaeuLogo className="h-9" />
        <div>
          <p className="text-sm font-semibold">United Arab Emirates University</p>
          <p className="text-xs text-muted-foreground">جامعة الإمارات العربية المتحدة</p>
        </div>
      </div>

      <section className="rounded-xl border bg-card p-6 card-shadow">
        <h1 className="text-lg font-semibold">Document verification · التحقق من الوثيقة</h1>

        {state === "loading" ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Checking this document…
          </p>
        ) : state === "rate_limited" ? (
          <div className="mt-4 flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
            <div>
              <p className="text-sm font-medium">Too many verification attempts</p>
              <p className="text-sm">Please wait a minute and try again.</p>
              <p className="mt-1 text-sm text-muted-foreground">عدد كبير من محاولات التحقق. يرجى المحاولة بعد قليل.</p>
            </div>
          </div>
        ) : state === "invalid" ? (
          <div className="mt-4 flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <ShieldQuestion className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
            <div>
              <p className="text-sm font-medium">Document could not be verified</p>
              <p className="text-sm">The verification reference is invalid.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                تعذر التحقق من الوثيقة · مرجع التحقق غير صالح.
              </p>
            </div>
          </div>
        ) : state === "unavailable" ? (
          <div className="mt-4 flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
            <div>
              <p className="text-sm font-medium">Document unavailable</p>
              <p className="text-sm">This document is no longer available for verification.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                الوثيقة غير متاحة · لم تعد هذه الوثيقة متاحة للتحقق.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-4 flex gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <BadgeCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <div>
                <p className="text-sm font-medium">Document verified</p>
                <p className="text-sm">This document is authentic and currently valid.</p>
                <p className="mt-1 text-sm text-muted-foreground">تم التحقق · هذه الوثيقة صحيحة وسارية المفعول.</p>
              </div>
            </div>

            <div className="mt-4 rounded-lg border bg-muted/30 px-3">
              {row("Document", d?.titleEn)}
              {row("Student name", d?.studentName)}
              {row("Programme", d?.programme)}
              {row("College", d?.college)}
              {row("Issue date", d?.issuedAt ? fmt(d.issuedAt) : null)}
              {row("Reference number", d?.reference)}
              {row("Verification status", "Valid")}
            </div>

          </>
        )}

        {state !== "loading" && state !== "valid" ? (
          <p className="mt-4 text-xs text-muted-foreground">
            For a current document, please ask the student to issue a new letter through Sanadi. لطلب وثيقة حديثة،
            يرجى الطلب من الطالب إصدار شهادة جديدة عبر سندي.
          </p>
        ) : null}
      </section>
    </main>
  );
}
