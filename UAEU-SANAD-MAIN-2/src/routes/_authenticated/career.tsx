import { createFileRoute, Link } from "@tanstack/react-router";
import { toastError } from "@/lib/errors/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  BadgeCheck,
  Briefcase,
  CircleAlert,
  Download,
  FileUp,
  Loader2,
  ShieldAlert,
  Target,
  Trash2,
  UserRoundCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format-date";
import {
  analyseMyCareerFit,
  getMyCareerState,
  getMyCvDownloadUrl,
  requestCareerCounsellor,
  getMyCounsellingRequest,
  uploadMyCv,
  deleteMyCv,
} from "@/lib/career.functions";

export const Route = createFileRoute("/_authenticated/career")({
  head: () => ({
    meta: [
      { title: "Career Counselling — Sanadi | UAEU" },
      {
        name: "description",
        content:
          "Upload your CV and get deterministic career fit scores, ATS feedback, skill-gap analysis and a personalised action plan based on your verified UAEU record.",
      },
      { property: "og:title", content: "Career Counselling — Sanadi | UAEU" },
      {
        property: "og:description",
        content: "Personalised, record-backed career guidance for UAEU students.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CareerPage,
});

const SKILL_SOURCE: Record<string, { en: string; ar: string }> = {
  cv: { en: "Demonstrated in CV", ar: "موثقة في السيرة الذاتية" },
  coursework: { en: "Supported by coursework", ar: "مدعومة بالمقررات" },
  recommended: { en: "Recommended to develop", ar: "يُنصح بتطويرها" },
};

const HORIZONS: Record<string, { en: string; ar: string }> = {
  "30_days": { en: "Next 30 days", ar: "خلال 30 يوماً" },
  "90_days": { en: "Next 90 days", ar: "خلال 90 يوماً" },
  before_graduation: { en: "Before graduation", ar: "قبل التخرج" },
};

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function CareerPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [targetRoleCode, setTargetRoleCode] = useState<string | null>(null);

  const fetchState = getMyCareerState;
  const upload = uploadMyCv;
  const analyse = analyseMyCareerFit;
  const requestCounsellor = requestCareerCounsellor;
  const downloadCv = getMyCvDownloadUrl;

  const state = useQuery({ queryKey: ["career-state"], queryFn: () => fetchState() });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const content = toBase64(await file.arrayBuffer());
      return upload({
        data: { fileName: file.name, mimeType: file.type || "application/pdf", content },
      });
    },
    onSuccess: (r) => {
      toast.success(
        r.parsingStatus === "failed"
          ? ar
            ? "تم رفع السيرة الذاتية لكن تعذّرت قراءة نصها."
            : "CV uploaded, but its text could not be read."
          : ar
            ? "تم تحليل سيرتك الذاتية. حدّثت مطابقاتك المهنية باستخدام ملفك الأكاديمي ومشاريعك وخبراتك ومهاراتك."
            : "Your CV has been analyzed. I’ve updated your career matches using your academic profile, projects, experience and skills.",
      );
      qc.invalidateQueries({ queryKey: ["career-state"] });
    },

    onError: (e: Error) => toastError(e, lang),
  });

  const analyseMutation = useMutation({
    mutationFn: (code: string | null) => analyse({ data: { targetRoleCode: code } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["career-state"] }),
    onError: (e: Error) => toastError(e, lang),
  });

  const removeCv = deleteMyCv;
  const deleteMutation = useMutation({
    mutationFn: () => removeCv({ data: undefined }),
    onSuccess: () => {
      toast.success(ar ? "تم حذف سيرتك الذاتية." : "Your CV has been deleted.");
      qc.invalidateQueries({ queryKey: ["career-state"] });
    },
    onError: (e: Error) => toastError(e, lang),
  });

  const fetchCounsellingRequest = getMyCounsellingRequest;
  const counsellingRequest = useQuery({
    queryKey: ["counselling-request"],
    queryFn: () => fetchCounsellingRequest(),
  });
  const openRequest = counsellingRequest.data ?? null;

  const counsellorMutation = useMutation({
    mutationFn: () => requestCounsellor({ data: { lang } }),
    onSuccess: (r) => {
      toast.success(
        r.created
          ? ar
            ? `تم إرسال طلب الإرشاد المهني بنجاح. الرقم المرجعي ${r.request.reference}.`
            : `Your counselling request has been submitted successfully. Reference ${r.request.reference}.`
          : r.acknowledgement,
      );
      qc.invalidateQueries({ queryKey: ["counselling-request"] });
      qc.invalidateQueries({ queryKey: ["career-state"] });
    },
    onError: (e: Error) => toastError(e, lang),
  });

  const analysis = state.data?.analysis;
  const matches = analysis?.matches ?? [];
  const ats = analysis?.ats ?? null;
  const gaps = analysis?.skillGaps ?? null;
  const cvEnhanced = analysis?.profileSource === "academic_cv";

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6" dir={ar ? "rtl" : "ltr"}>
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
          <Briefcase className="size-6 text-primary" aria-hidden />
          {ar ? "الإرشاد المهني" : "Career Counselling"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {ar
            ? "يبدأ سندي بسجلك الأكاديمي المعتمد، ويصبح التحليل أدق عند رفع سيرتك الذاتية."
            : "Sanadi starts from your verified academic record, and gets more accurate once you upload your CV."}
        </p>
      </header>

      {/* Upload */}
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-medium text-foreground">
              {ar ? "الملف المهني" : "Career profile"}
            </h2>
            {state.isLoading ? (
              <Skeleton className="h-4 w-48" />
            ) : (
              <div className="space-y-0.5 text-sm text-muted-foreground">
                <p className="flex items-center gap-1.5">
                  <BadgeCheck className="size-4 text-primary" aria-hidden />
                  {ar ? "السجل الأكاديمي معتمد" : "Academic profile verified"}
                </p>
                {uploadMutation.isPending ? (
                  <p className="flex items-center gap-1.5">
                    <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                    {ar ? "جارٍ رفع سيرتك الذاتية…" : "Uploading your CV…"}
                  </p>
                ) : analysis?.hasCv ? (
                  <div className="space-y-0.5">
                    <p className="font-medium text-foreground">
                      {ar ? "السيرة الذاتية الحالية" : "Current CV"}
                    </p>
                    <p>
                      {analysis.cvFileName}
                      {analysis.cvUploadedAt
                        ? ` · ${formatDateTime(analysis.cvUploadedAt, lang)}`
                        : ""}
                    </p>
                    <p>
                      {analysis.parsingStatus === "pending" || analysis.parsingStatus === "processing"
                        ? ar
                          ? "جارٍ تحليل سيرتك الذاتية."
                          : "Your CV is being analysed."
                        : analysis.cvAnalyzed
                          ? ar
                            ? "الحالة: تم التحليل ✓"
                            : "Status: Processed ✓"
                          : ar
                            ? "الحالة: تعذّر تحليل هذه السيرة الذاتية بشكل موثوق."
                            : "Status: We could not analyze this CV reliably."}
                    </p>

                  </div>
                ) : (
                  <p>
                    {ar
                      ? "السيرة الذاتية: لم تُرفع بعد (PDF أو Word، حتى 5 ميجابايت)."
                      : "CV: not uploaded yet (PDF or Word, up to 5 MB)."}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadMutation.mutate(f);
                e.target.value = "";
              }}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={uploadMutation.isPending}>
              {uploadMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileUp className="size-4" />
              )}
              {analysis?.hasCv
                ? ar
                  ? "استبدال السيرة الذاتية"
                  : "Replace CV"
                : ar
                  ? "رفع السيرة الذاتية"
                  : "Upload CV"}
            </Button>

            {analysis?.cvId ? (
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    const r = await downloadCv({ data: { cvId: analysis.cvId! } });
                    window.open(r.url, "_blank", "noopener");
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                <Download className="size-4" />
                {ar ? "عرض السيرة الذاتية" : "View CV"}
              </Button>
            ) : null}

            {analysis?.hasCv ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" disabled={deleteMutation.isPending}>
                    {deleteMutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                    {ar ? "حذف السيرة الذاتية" : "Delete CV"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent dir={ar ? "rtl" : "ltr"}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {ar ? "حذف سيرتك الذاتية؟" : "Delete your CV?"}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {ar
                        ? "سيؤدي هذا إلى إزالة سيرتك الذاتية الحالية والتحليل المهني المبني عليها. يمكنك رفع سيرة ذاتية أخرى لاحقاً."
                        : "This will remove your current CV and its CV-based Career Counselling analysis. You can upload another CV later."}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{ar ? "إلغاء" : "Cancel"}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteMutation.mutate()}>
                      {ar ? "حذف السيرة الذاتية" : "Delete CV"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </div>
        </div>

        {analysis?.injectionFlagged ? (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {ar
              ? "احتوى ملف السيرة الذاتية على نص يحاول توجيه النظام، وقد تم تجاهله. التحليل مبني على بياناتك فقط."
              : "The CV contained text that tried to instruct the system. It was ignored — the analysis uses your data only."}
          </p>
        ) : null}

        {analysis?.discrepancies?.length ? (
          <ul className="mt-3 space-y-1 rounded-md bg-muted p-3 text-sm text-muted-foreground">
            {analysis.discrepancies.map((d) => (
              <li key={d} className="flex items-start gap-2">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                {d}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* Verified record */}
      {analysis?.evidence ? (
        <section className="grid gap-3 rounded-xl border border-border bg-card p-5 shadow-sm sm:grid-cols-4">
          {[
            {
              label: ar ? "البرنامج" : "Programme",
              value: (ar ? analysis.evidence.programmeAr : analysis.evidence.programmeEn) ?? "—",
            },
            {
              label: ar ? "المعدل التراكمي" : "GPA",
              value: analysis.evidence.gpa != null ? String(analysis.evidence.gpa) : "—",
            },
            {
              label: ar ? "الساعات المنجزة" : "Credits completed",
              value: String(analysis.evidence.completedCredits),
            },
            {
              label: ar ? "تدريب عملي" : "Internship",
              value: analysis.evidence.hasInternship ? (ar ? "مسجل" : "On record") : "—",
            },
          ].map((f) => (
            <div key={f.label}>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{f.label}</p>
              <p className="font-medium text-foreground">{f.value}</p>
            </div>
          ))}
        </section>
      ) : null}

      {/* Matches */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-medium text-foreground">
            <Target className="size-5 text-primary" aria-hidden />
            {cvEnhanced
              ? ar
                ? "مساراتك المهنية المحدّثة"
                : "Your updated career matches"
              : ar
                ? "أفضل المسارات المهنية"
                : "Best-fit career paths"}
          </h2>
          {analysis ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {ar ? "المصدر: " : "Profile used: "}
                {cvEnhanced
                  ? ar
                    ? "السجل الأكاديمي + السيرة الذاتية"
                    : "Academic record + CV"
                  : ar
                    ? "السجل الأكاديمي فقط"
                    : "Academic record only"}
              </span>
              {cvEnhanced ? (
                <Badge variant="secondary" className="gap-1">
                  <BadgeCheck className="size-3.5" aria-hidden />
                  {ar ? "معزّز بالسيرة الذاتية" : "CV Enhanced"}
                </Badge>
              ) : null}
            </div>
          ) : null}
        </div>

        {analysis?.rankingChange ? (
          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            {ar ? analysis.rankingChange.ar : analysis.rankingChange.en}
          </p>
        ) : null}

        {state.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : matches.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {ar ? "لا توجد مطابقات متاحة بعد." : "No career matches available yet."}
          </p>
        ) : (
          matches.map((m) => (
            <article
              key={m.roleCode}
              className="rounded-xl border border-border bg-card p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-foreground">{ar ? m.titleAr : m.titleEn}</h3>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {ar ? `التوافق ${m.fitScore}%` : `${m.fitScore}% fit`}
                  </Badge>
                  <Badge variant="outline">
                    {ar ? `الجاهزية ${m.jobReadinessScore}%` : `${m.jobReadinessScore}% ready`}
                  </Badge>
                </div>
              </div>
              <Progress
                aria-label={ar ? `نسبة التوافق مع ${m.titleAr}` : `Fit score for ${m.titleEn}`}
                value={m.fitScore}
                className="mt-3"
              />
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {ar ? "لماذا يناسبك" : "Why this fits you"}
                  </p>
                  <ul className="mt-1 space-y-1 text-sm text-foreground">
                    {(m.evidenceItems?.length
                      ? m.evidenceItems
                      : m.matchedEvidence.map((t) => ({
                          textEn: t,
                          textAr: t,
                          source: "university" as const,
                        }))
                    ).map((e) => (
                      <li key={e.textEn} className="flex items-start gap-2">
                        <BadgeCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                        <span>
                          {ar ? e.textAr : e.textEn}{" "}
                          <span className="text-[11px] text-muted-foreground">
                            {e.source === "cv"
                              ? ar
                                ? "(السيرة الذاتية)"
                                : "(CV)"
                              : ar
                                ? "(سجل الجامعة)"
                                : "(University record)"}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {ar ? "الفجوات" : "Main gaps"}
                  </p>
                  <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                    {m.missingRequirements.map((g) => (
                      <li key={g}>• {g}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-3"
                disabled={analyseMutation.isPending}
                onClick={() => {
                  setTargetRoleCode(m.roleCode);
                  analyseMutation.mutate(m.roleCode);
                }}
              >
                {targetRoleCode === m.roleCode && analyseMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                {ar ? "استهدف هذه الوظيفة" : "Target this role"}
              </Button>
            </article>
          ))
        )}

        {!analysis?.hasCv && matches.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-5">
            <p className="text-sm text-foreground">
              {ar
                ? "تريد تقييماً مهنياً أدق؟ ارفع سيرتك الذاتية لأضيف مهاراتك ومشاريعك وخبراتك وشهاداتك."
                : "Want a more accurate career assessment? Upload your CV and I’ll include your skills, projects, experience and certifications."}
            </p>
            <Button onClick={() => fileRef.current?.click()} disabled={uploadMutation.isPending}>
              {uploadMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileUp className="size-4" />
              )}
              {ar ? "ارفع سيرتك الذاتية وحسّن مطابقاتك" : "Upload CV & improve my career matches"}
            </Button>
          </div>
        ) : null}
      </section>

      {/* Skill gaps */}
      {gaps && ((gaps.strong?.length ?? 0) || (gaps.developing?.length ?? 0) || (gaps.missing?.length ?? 0)) ? (
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium text-foreground">
              {ar ? "تحليل الفجوة المهارية" : "Skill gap analysis"}
              {gaps.targetRoleEn ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {ar ? gaps.targetRoleAr : gaps.targetRoleEn}
                </span>
              ) : null}
            </h2>
            {gaps.preliminary ? (
              <Badge variant="outline">{ar ? "أولي" : "Preliminary"}</Badge>
            ) : null}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {[
              { key: "strong", title: ar ? "مهارات قوية" : "Strong skills", items: gaps.strong ?? [] },
              {
                key: "developing",
                title: ar ? "مهارات قيد التطوير" : "Developing skills",
                items: gaps.developing ?? [],
              },
              {
                key: "missing",
                title: ar ? "مهارات مطلوب تطويرها" : "Missing / recommended",
                items: gaps.missing ?? [],
              },
            ].map((col) => (
              <div key={col.key}>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {col.title}
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {col.items.length === 0 ? (
                    <li className="text-muted-foreground">—</li>
                  ) : (
                    col.items.slice(0, 8).map((s) => (
                      <li key={s.skill} className="flex flex-wrap items-center gap-1.5">
                        <span className="text-foreground">{s.skill}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {SKILL_SOURCE[s.source]?.[ar ? "ar" : "en"]}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ATS */}
      {!analysis?.hasCv || uploadMutation.isPending ? (
        <section className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            {ar ? "تقييم أنظمة الفرز الآلي (ATS)" : "ATS score"}
          </p>
          <p className="mt-1">
            {uploadMutation.isPending
              ? ar
                ? "جارٍ تحليل سيرتك الذاتية…"
                : "Analyzing your CV…"
              : ar
                ? "ارفع سيرتك الذاتية لاحتساب درجة ATS."
                : "Upload your CV to calculate your ATS score."}
          </p>
        </section>
      ) : !analysis.cvAnalyzed || !ats ? (
        <section className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            {ar ? "تقييم أنظمة الفرز الآلي (ATS)" : "ATS score"}
          </p>
          <p className="mt-1">
            {ar
              ? "تم رفع السيرة الذاتية، لكن تعذّر تحليلها بشكل موثوق. يرجى استبدالها بملف PDF أو Word نصي."
              : "CV uploaded, but we could not analyze it reliably. Please replace it with a text-based PDF or Word document."}
          </p>
        </section>
      ) : ats ? (
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium text-foreground">
              {ar ? "تقييم أنظمة الفرز الآلي (ATS)" : "ATS readiness"}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {analysis.atsHistory ? (
                <span className="text-xs text-muted-foreground">
                  {ar ? "التغير عن التقييم السابق: " : "Change vs previous CV: "}
                  {analysis.atsHistory.delta > 0 ? "+" : ""}
                  {analysis.atsHistory.delta}
                </span>
              ) : null}
              <Badge variant={ats.overall >= 75 ? "default" : "secondary"}>{ats.overall}/100</Badge>
            </div>
          </div>
          <Progress
            aria-label={ar ? "درجة توافق السيرة الذاتية مع أنظمة الفرز" : "Overall CV ATS score"}
            value={ats.overall}
            className="mt-3"
          />
          <p className="mt-2 text-sm text-muted-foreground">
            {typeof ats.band === "string"
              ? ats.band
              : ar
                ? (ats.band?.labelAr ?? "")
                : (ats.band?.labelEn ?? "")}
            <span className="text-[11px]">
              {" "}
              · {ats.engineVersion} / {ats.weightsVersion}
            </span>
          </p>
          {ats.confidenceNote ? (
            <p className="mt-2 flex items-start gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              {typeof ats.confidenceNote === "string"
                ? ats.confidenceNote
                : ar
                  ? (ats.confidenceNote.ar ?? "")
                  : (ats.confidenceNote.en ?? "")}
            </p>
          ) : null}

          <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
            {ats.categories.map((c) => (
              <div key={c.key} className="rounded-md bg-muted px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{ar ? c.labelAr : c.labelEn}</span>
                  <span className="font-medium text-foreground">
                    {c.score}/{c.max ?? 100}
                  </span>
                </div>
                {c.notes?.length ? (
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    {ar ? c.notes[0]?.ar : c.notes[0]?.en}
                  </p>
                ) : null}
              </div>
            ))}
          </div>

          {ats.improvements.length ? (
            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {ar ? "تحسينات مقترحة" : "How to improve"}
              </p>
              <ul className="mt-1 space-y-1 text-sm text-foreground">
                {ats.improvements.map((i) => (
                  <li key={i.en}>• {ar ? i.ar : i.en}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {ats.evidence.length ? (
            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {ar ? "الأدلة المستخرجة من سيرتك" : "Evidence found in your CV"}
              </p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {ats.evidence.slice(0, 12).map((e) => (
                  <li key={e.skill}>
                    <Badge
                      variant={
                        e.strength === "strong"
                          ? "default"
                          : e.strength === "demonstrated"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {e.skill}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="mt-4 text-[11px] leading-snug text-muted-foreground">
            {ar ? ats.disclaimer.ar : ats.disclaimer.en}
          </p>
        </section>
      ) : null}

      {/* Role-specific ATS */}
      {analysis?.roleAts?.length ? (
        <section className="space-y-3">
          <h2 className="font-medium text-foreground">
            {ar ? "التوافق مع الوظائف المستهدفة" : "Role-specific ATS match"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {analysis.roleAts.map((r) => (
              <article
                key={r.roleCode}
                className="rounded-xl border border-border bg-card p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium text-foreground">{ar ? r.titleAr : r.titleEn}</h3>
                  <Badge variant="secondary">{r.overall}/100</Badge>
                </div>
                <Progress
                  aria-label={
                    ar ? `درجة السيرة الذاتية لوظيفة ${r.titleAr}` : `CV ATS score for ${r.titleEn}`
                  }
                  value={r.overall}
                  className="mt-2"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {ar ? r.band.labelAr : r.band.labelEn}
                </p>
                <div className="mt-3 grid gap-1 text-xs">
                  {r.categories.map((c) => (
                    <div key={c.key} className="flex items-center justify-between">
                      <span className="text-muted-foreground">{ar ? c.labelAr : c.labelEn}</span>
                      <span className="text-foreground">
                        {c.score}/{c.max}
                      </span>
                    </div>
                  ))}
                </div>
                {r.missingEvidence.length ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {ar ? "أدلة ناقصة: " : "Missing evidence: "}
                    {r.missingEvidence.slice(0, 5).join(ar ? "، " : ", ")}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {/* Action plan */}
      {analysis?.actionPlan?.length ? (
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-medium text-foreground">
            {ar ? "خطة العمل الشخصية" : "Your action plan"}
          </h2>
          <ol className="mt-3 space-y-3">
            {analysis.actionPlan.map((p) => (
              <li key={p.titleEn} className="rounded-md border border-border p-3">
                <Badge variant="outline" className="mb-1">
                  {ar ? HORIZONS[p.horizon]?.ar : HORIZONS[p.horizon]?.en}
                </Badge>
                <p className="font-medium text-foreground">{ar ? p.titleAr : p.titleEn}</p>
                <p className="text-sm text-muted-foreground">{ar ? p.detailAr : p.detailEn}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="space-y-3 rounded-xl border border-border bg-muted/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {ar
              ? "تحتاج إلى مناقشة النتائج مع مرشد مهني؟"
              : "Want to discuss these results with a human career counsellor?"}
          </p>
          <Button
            variant="outline"
            onClick={() => counsellorMutation.mutate()}
            disabled={counsellorMutation.isPending || Boolean(openRequest)}
          >
            <UserRoundCheck className="size-4" />
            {openRequest
              ? ar
                ? "الطلب قيد المتابعة"
                : "Request in progress"
              : counsellorMutation.isPending
                ? ar
                  ? "جارٍ الإرسال…"
                  : "Submitting…"
                : ar
                  ? "طلب مقابلة مرشد مهني"
                  : "Request a counsellor"}
          </Button>
        </div>
        {openRequest ? (
          <div className="rounded-lg border border-border bg-background p-3 text-sm">
            <p className="font-medium">
              {ar ? "طلب الإرشاد المهني" : "Counselling request"} · {openRequest.reference}
            </p>
            <p className="text-muted-foreground">
              {ar ? "الحالة" : "Status"}: {openRequest.status.replace(/_/g, " ")}
              {openRequest.firstResponseDueAt
                ? ` · ${ar ? "الرد المتوقع" : "Expected response"}: ${new Date(openRequest.firstResponseDueAt).toLocaleString()}`
                : ""}
            </p>
            <Link to="/requests" className="text-primary underline">
              {ar ? "عرض في طلباتي" : "View in My Requests"}
            </Link>
          </div>
        ) : null}
      </section>
    </div>
  );
}
