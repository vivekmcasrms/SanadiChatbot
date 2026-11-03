import { createFileRoute } from "@tanstack/react-router";
import { toastError } from "@/lib/errors/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  BadgeCheck,
  CircleAlert,
  Download,
  FileText,
  Loader2,
  QrCode,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format-date";
import {
  deleteMyDocument,
  getDocumentDownloadUrl,
  getMyDocumentState,
  issueMyEnrollmentLetter,
} from "@/lib/documents.functions";
import { useListParams } from "@/lib/use-list-params";
import { ListEmpty, ListSearch, Pagination as ListPagination } from "@/components/list/ListControls";

export const Route = createFileRoute("/_authenticated/documents")({
  // Search and page are URL-backed so a document view can be shared/bookmarked.
  validateSearch: (search: Record<string, unknown>) => search,
  head: () => ({
    meta: [
      { title: "My Documents — Sanadi | UAEU" },
      {
        name: "description",
        content:
          "Request an official To Whom It May Concern enrollment letter, download it instantly and share its QR verification link.",
      },
      { property: "og:title", content: "My Documents — Sanadi | UAEU" },
      {
        property: "og:description",
        content: "Instant, verifiable UAEU enrollment letters issued by Sanadi.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DocumentsPage,
});

const PURPOSES = [
  { value: "general", en: "General purposes", ar: "أغراض عامة" },
  { value: "embassy_visa", en: "Embassy / visa", ar: "سفارة / تأشيرة" },
  { value: "bank", en: "Bank", ar: "بنك" },
  { value: "employer", en: "Employer", ar: "جهة عمل" },
  { value: "scholarship", en: "Scholarship / sponsor", ar: "منحة / جهة ابتعاث" },
  { value: "government", en: "Government entity", ar: "جهة حكومية" },
  { value: "other", en: "Other", ar: "أخرى" },
] as const;

const LANGUAGES = [
  { value: "en", en: "English", ar: "English" },
  { value: "ar", en: "العربية (Arabic)", ar: "العربية" },
  { value: "bilingual", en: "Bilingual (English + Arabic)", ar: "ثنائية اللغة (إنجليزي + عربي)" },
] as const;


const STATUS_LABEL: Record<string, { en: string; ar: string; tone: string }> = {
  valid: { en: "Valid", ar: "سارية", tone: "bg-primary/10 text-primary" },
  revoked: { en: "Revoked", ar: "ملغاة", tone: "bg-destructive/10 text-destructive" },
  deleted_by_student: {
    en: "Deleted by you",
    ar: "محذوفة بطلبك",
    tone: "bg-muted text-muted-foreground",
  },
  expired: { en: "Expired", ar: "منتهية", tone: "bg-muted text-muted-foreground" },
};

function DocumentsPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();

  const fetchState = useServerFn(getMyDocumentState);
  const issueLetter = useServerFn(issueMyEnrollmentLetter);
  const download = useServerFn(getDocumentDownloadUrl);
  const deleteDocument = useServerFn(deleteMyDocument);

  const params = useListParams({ q: "", pageSize: 10 }, "d_");
  const { q } = params.values;

  const state = useQuery({
    queryKey: ["my-documents", q, params.page, params.pageSize],
    placeholderData: (prev) => prev,
    queryFn: () =>
      fetchState({ data: { search: q || undefined, page: params.page, pageSize: params.pageSize } }),
  });
  const ctx = state.data?.letterContext ?? null;
  const documents = state.data?.documents ?? [];

  const [language, setLanguage] = useState<"en" | "ar" | "bilingual">("en");
  const [purpose, setPurpose] = useState<string>("general");
  const [includeGraduation, setIncludeGraduation] = useState(false);

  const issue = useMutation({
    mutationFn: () =>
      issueLetter({
        data: {
          language,
          purpose: purpose as "general",
          fields: { includeExpectedGraduation: includeGraduation },
        },
      }),
    onSuccess: (r) => {
      toast.success(
        r.replayed
          ? ar
            ? `تم استخدام الشهادة الصادرة قبل قليل: ${r.letter.referenceNumber}`
            : `Reused the letter just issued: ${r.letter.referenceNumber}`
          : ar
            ? `تم إصدار الشهادة ${r.letter.referenceNumber}`
            : `Letter ${r.letter.referenceNumber} issued`,
      );
      void qc.invalidateQueries({ queryKey: ["my-documents"] });
    },
    onError: (e: Error) => toastError(e, lang),
  });

  const startDownload = useMutation({
    mutationFn: (documentId: string) => download({ data: { documentId } }),
    onSuccess: (r) => {
      window.open(r.url, "_blank", "noopener,noreferrer");
      void qc.invalidateQueries({ queryKey: ["my-documents"] });
    },
    onError: (e: Error) => toastError(e, lang),
  });

  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const removeDocument = useMutation({
    mutationFn: (documentId: string) => deleteDocument({ data: { documentId } }),
    onSuccess: (r) => {
      setPendingDelete(null);
      toast.success(
        ar ? `تم حذف الشهادة ${r.reference} نهائياً` : `Letter ${r.reference} permanently deleted`,
      );
      void qc.invalidateQueries({ queryKey: ["my-documents"] });
    },

    onError: (e: Error) => toastError(e, lang),
  });

  const missing = ar ? "غير متوفرة" : "Unavailable";

  const fact = (label: string, value: string | null | undefined, fallback?: string) => {
    const shown = value && value.trim() ? value.trim() : null;
    if (!shown && typeof console !== "undefined") {
      // Data-quality signal: an authoritative field is missing on the student record.
      console.warn(`[my-documents] missing student field: ${label}`);
    }
    return (
      <div className="min-w-0">
        <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
        <dd
          className={`break-words text-sm ${shown ? "font-medium" : "italic text-muted-foreground"}`}
        >
          {shown ?? fallback ?? missing}
        </dd>
      </div>
    );
  };

  const enrollment = ctx?.enrollmentStatus?.trim() ?? "";
  const enrollmentLabel = !enrollment
    ? null
    : ar
      ? ({ active: "منتظم", inactive: "غير منتظم", suspended: "موقوف", graduated: "متخرج" }[
          enrollment.toLowerCase()
        ] ?? enrollment)
      : enrollment.charAt(0).toUpperCase() + enrollment.slice(1);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">{ar ? "وثائقي" : "My Documents"}</h1>
        <p className="text-sm text-muted-foreground">
          {ar
            ? "اطلب شهادة «إلى من يهمه الأمر» من سجلك المعتمد، ونزّلها فوراً مع رمز تحقق إلكتروني."
            : "Request a To Whom It May Concern letter from your verified record, and download it instantly with an online verification code."}
        </p>
      </header>

      {state.isLoading ? (
        <p className="text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>
      ) : (
        <>
          <section
            className="rounded-xl border bg-card p-4 card-shadow sm:p-5"
            aria-label={ar ? "بيانات الطالب" : "Student information"}
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="min-w-0 break-words text-base font-semibold">
                {(ar ? (ctx?.studentNameAr ?? ctx?.studentName) : ctx?.studentName) ?? missing}
              </p>
              <p className="font-mono text-xs text-muted-foreground">
                {ar ? "الرقم الجامعي" : "Student No"}: {ctx?.studentNumber?.trim() || missing}
              </p>
            </div>
            <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {fact(
                ar ? "الكلية" : "College",
                ar ? (ctx?.collegeAr ?? ctx?.collegeEn) : ctx?.collegeEn,
                ar ? "بيانات الكلية غير متوفرة" : "College information unavailable",
              )}
              {fact(
                ar ? "البرنامج" : "Programme",
                ar ? (ctx?.programmeAr ?? ctx?.programmeEn) : ctx?.programmeEn,
                ar ? "بيانات البرنامج غير متوفرة" : "Programme information unavailable",
              )}
              {fact(ar ? "حالة القيد" : "Enrollment", enrollmentLabel)}
              {fact(
                ar ? "الفصل الدراسي" : "Academic term",
                ar ? (ctx?.termAr ?? ctx?.termEn) : ctx?.termEn,
              )}
            </dl>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border bg-card p-5 card-shadow">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" aria-hidden />
              <h2 className="text-sm font-semibold">
                {ar ? "إصدار شهادة جديدة" : "Issue a new letter"}
              </h2>
            </div>

            {ctx?.eligible === false ? (
              <div className="mb-4 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                <p className="text-sm">{(ar ? ctx.blockingReasonAr : ctx.blockingReason) ?? ""}</p>
              </div>
            ) : null}


            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="doc-language">{ar ? "لغة الشهادة" : "Letter language"}</Label>
                <Select
                  value={language}
                  onValueChange={(v) => setLanguage(v as "en" | "ar" | "bilingual")}
                >
                  <SelectTrigger id="doc-language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {ar ? l.ar : l.en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>


              <div className="space-y-1.5">
                <Label htmlFor="doc-purpose">{ar ? "الغرض من الشهادة" : "What is it for?"}</Label>
                <Select value={purpose} onValueChange={setPurpose}>
                  <SelectTrigger id="doc-purpose">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PURPOSES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {ar ? p.ar : p.en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <Label htmlFor="doc-grad" className="text-sm font-normal">
                  {ar
                    ? "إضافة تاريخ التخرج المتوقع (تقديري)"
                    : "Include expected graduation date (estimate)"}
                </Label>
                <Switch id="doc-grad" checked={includeGraduation} onCheckedChange={setIncludeGraduation} />
              </div>

              <Button
                className="w-full"
                disabled={!ctx?.eligible || issue.isPending}
                onClick={() => issue.mutate()}
              >
                {issue.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <FileText className="size-4" aria-hidden />
                )}
                {ar ? "إصدار الشهادة الآن" : "Issue letter now"}
              </Button>
              <p className="text-xs text-muted-foreground">
                {ar
                  ? "تصدر الشهادة من سجلك المعتمد وتحمل رقماً مرجعياً ورمز استجابة سريعة للتحقق. هذه بيئة توضيحية، لذا تُعلَّم الوثيقة كوثيقة عرض."
                  : "The letter is generated from your verified record with a reference number and a QR verification code."}
              </p>
            </div>
          </section>

          <section className="rounded-xl border bg-card p-5 card-shadow">
            <div className="mb-3 flex items-center gap-2">
              <BadgeCheck className="size-4 text-primary" aria-hidden />
              <h2 className="text-sm font-semibold">{ar ? "الوثائق الصادرة" : "Issued documents"}</h2>
            </div>

            <div className="mb-3">
              <ListSearch
                value={q}
                onChange={(next) => params.setFilter({ q: next })}
                placeholder={ar ? "ابحث برقم المرجع أو العنوان" : "Search by reference or title"}
              />
            </div>

            {documents.length === 0 && q ? (
              <ListEmpty />
            ) : documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {ar ? "لم تصدر أي وثيقة بعد." : "You have not issued any document yet."}
              </p>
            ) : (
              <ul className="space-y-3">
                {documents.map((d) => {
                  const badge = STATUS_LABEL[d.status] ?? STATUS_LABEL["valid"]!;
                  // Badge describes verification, not file availability.
                  return (
                    <li key={d.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{ar ? d.titleAr : d.titleEn}</p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2">
                            <p className="font-mono text-xs text-muted-foreground"><bdi dir="ltr">{d.referenceNumber}</bdi></p>
                            <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                              {d.language === "bilingual"
                                ? ar ? "ثنائية اللغة" : "Bilingual"
                                : d.language === "ar"
                                  ? ar ? "العربية" : "Arabic"
                                  : ar ? "الإنجليزية" : "English"}
                            </span>
                          </div>

                          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                            <dt className="text-muted-foreground">{ar ? "تاريخ الإصدار" : "Issued"}</dt>
                            <dd>{formatDateTime(d.issuedAt, lang)}</dd>
                            <dt className="text-muted-foreground">{ar ? "الملف" : "File"}</dt>
                            <dd>
                              {d.fileState === "available"
                                ? `${ar ? "متاح حتى" : "Available until"} ${d.availableUntil ? formatDateTime(d.availableUntil, lang) : "—"}`
                                : d.fileState === "revoked"
                                  ? ar ? "ملغى — غير متاح" : "Revoked — not available"
                                  : ar ? "منتهي — لم يعد متاحاً" : "Expired / no longer available"}
                            </dd>
                            <dt className="text-muted-foreground">{ar ? "التحقق" : "Verification"}</dt>
                            <dd>
                              {d.status === "revoked"
                                ? ar ? "ملغى" : "Revoked"
                                : d.verificationValid && d.verificationValidUntil
                                  ? `${ar ? "صالح حتى" : "Valid until"} ${formatDateTime(d.verificationValidUntil, lang)}`
                                  : `${ar ? "انتهى في" : "Ended"} ${d.verificationValidUntil ? formatDateTime(d.verificationValidUntil, lang) : "—"}`}
                            </dd>
                          </dl>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${badge.tone}`}>
                          {ar ? badge.ar : badge.en}
                        </span>
                      </div>

                      <p className="mt-2 text-xs text-muted-foreground">
                        {ar
                          ? "يبقى ملف PDF متاحاً للتنزيل لمدة ٣٠ يوماً من الإصدار. أما رمز التحقق فيبقى صالحاً حتى تاريخ صلاحية الشهادة، حتى بعد حذف الملف، فيمكن للجهات التحقق منها."
                          : "The PDF can be downloaded for 30 days after issue. Verification is separate: the QR code stays valid until the letter's validity date, even after the file is removed, so organisations can still confirm it."}
                      </p>

                      {d.daysRemaining !== null && d.daysRemaining <= 7 ? (
                        <p className="mt-2 flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
                          <CircleAlert className="size-3.5 shrink-0" aria-hidden />
                          {ar
                            ? `سيتم حذف هذه الشهادة نهائياً خلال ${d.daysRemaining} يوم. يمكنك إصدار نسخة جديدة في أي وقت.`
                            : `This letter will be permanently deleted in ${d.daysRemaining} day${d.daysRemaining === 1 ? "" : "s"}. You can issue a new one at any time.`}
                        </p>
                      ) : null}

                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!d.downloadable || startDownload.isPending}
                          onClick={() => startDownload.mutate(d.id)}
                        >
                          <Download className="size-3.5" aria-hidden />
                          {ar ? "تنزيل PDF" : "Download PDF"}
                        </Button>
                        {d.verifyPath ? (
                          <Button size="sm" variant="ghost" asChild>
                            <a href={d.verifyPath} target="_blank" rel="noreferrer">
                              <QrCode className="size-3.5" aria-hidden />
                              {ar ? "رابط التحقق" : "Verify"}
                            </a>
                          </Button>
                        ) : null}
                        {d.deletable ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setPendingDelete(d.id)}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                            {ar ? "حذف" : "Delete"}
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}

              </ul>
            )}

            <ListPagination
              page={params.page}
              pageSize={params.pageSize}
              pageCount={state.data?.pageCount ?? 1}
              total={state.data?.total ?? null}
              onPage={params.setPage}
              onPageSize={params.setPageSize}
              busy={state.isFetching}
            />
          </section>

          </div>
        </>
      )}


      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent dir={ar ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <CircleAlert className="size-4 shrink-0" aria-hidden />
              {ar ? "حذف هذه الشهادة نهائياً؟" : "Delete this letter permanently?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {ar
                    ? "سيتم حذف المستند وملف PDF وإمكانية التحقق منه نهائياً، ولن تعود الشهادة قابلة للتنزيل أو التحقق."
                    : "The document, its PDF and its verification access will be permanently removed. The letter will no longer be downloadable or verifiable."}
                </p>
                <p className="font-medium text-destructive">
                  {ar ? "لا يمكن التراجع عن هذا الإجراء." : "This action cannot be undone."}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeDocument.isPending}>
              {ar ? "إلغاء" : "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={removeDocument.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (pendingDelete) removeDocument.mutate(pendingDelete);
              }}
            >
              {removeDocument.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="size-3.5" aria-hidden />
              )}
              {ar ? "حذف نهائياً" : "Delete Permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>

        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
