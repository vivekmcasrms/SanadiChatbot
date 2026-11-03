/**
 * Compact Career Counselling result shown inside the chat.
 *
 * Everything rendered here comes from the deterministic career engine and is
 * passed through unchanged — this component never derives or rounds a score.
 * Career counselling is chat-first: the CV is uploaded here, the ATS result
 * appears here, and the Career page is only an optional deep dive.
 */
import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Briefcase, FileUp, Gauge, LineChart, Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { uploadMyCv } from "@/lib/career.functions";
import type { CareerInsightCard as CareerInsight } from "@/lib/agent-types";

const MAX_CV_BYTES = 5 * 1024 * 1024;

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function CareerInsightCard({
  insight,
  onAsk,
}: {
  insight: CareerInsight;
  /** Sends a follow-up message in the same chat. */
  onAsk?: (message: string) => void;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const gaps = insight.skillGaps;
  // Cards persisted before these fields existed are reopened from history, so
  // every list is read defensively rather than assumed present.
  const ats = insight.ats
    ? { ...insight.ats, strengths: insight.ats.strengths ?? [], improvements: insight.ats.improvements ?? [] }
    : null;
  const recommended = insight.recommendedActions ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_CV_BYTES) {
      toast.error(ar ? "يجب أن يكون الملف أصغر من 5 ميغابايت." : "The CV must be smaller than 5 MB.");
      return;
    }
    setUploading(true);
    try {
      const content = toBase64(await file.arrayBuffer());
      await uploadMyCv({
        data: { fileName: file.name, mimeType: file.type || "application/pdf", content },
      });
      toast.success(ar ? "تم حفظ سيرتك الذاتية وتحليلها." : "Your CV was saved and analysed.");
      // The analysis is already persisted; asking again in the same chat brings
      // the fresh, CV-based result back into this conversation.
      onAsk?.(ar ? "ما هي درجة سيرتي الذاتية في أنظمة الفرز؟" : "What is my ATS score?");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : ar ? "تعذر رفع السيرة الذاتية." : "The CV could not be uploaded.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const uploadLabel = insight.cv.hasCv
    ? ar
      ? "استبدال السيرة الذاتية"
      : "Replace CV"
    : ar
      ? "رفع السيرة الذاتية"
      : "Upload CV";

  return (
    <div className="rounded-xl border bg-card p-4 text-xs card-shadow">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Briefcase className="size-4 text-primary" aria-hidden />
        {ar ? "ملخص الإرشاد المهني" : "Career snapshot"}
      </p>

      {ats ? (
        <div className="mb-3 rounded-lg border bg-background p-3">
          <p className="flex items-baseline gap-2">
            <span className="font-medium">{ar ? "درجة الفرز الآلي" : "ATS score"}</span>
            <span className="text-2xl font-semibold tabular-nums">{ats.overall}</span>
            <span className="text-muted-foreground">/ 100</span>
          </p>
          <p className="mt-1 text-muted-foreground">{ats.band}</p>
          {ats.strengths.length ? (
            <div className="mt-2">
              <p className="font-medium text-success">{ar ? "أبرز نقاط القوة" : "Main strengths"}</p>
              <ul className="list-disc space-y-0.5 ps-4 text-muted-foreground">
                {ats.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {ats.improvements.length ? (
            <div className="mt-2">
              <p className="font-medium text-warning-foreground">{ar ? "أبرز الفجوات" : "Main gaps"}</p>
              <ul className="list-disc space-y-0.5 ps-4 text-muted-foreground">
                {ats.improvements.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {recommended.length ? (
            <div className="mt-2">
              <p className="font-medium">{ar ? "الإجراءات الموصى بها" : "Recommended next actions"}</p>
              <ul className="list-disc space-y-0.5 ps-4 text-muted-foreground">
                {recommended.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border bg-background p-3">
          <p className="flex items-center gap-1.5 font-medium">
            <Gauge className="size-3.5" aria-hidden />
            {ar ? "السيرة الذاتية" : "CV"}
          </p>
          {insight.cv.hasCv ? (
            <>
              <p className="mt-1 text-muted-foreground">{insight.cv.fileName}</p>
              {!ats ? (
                <p className="mt-1 text-muted-foreground">
                  {ar ? "لم يتم استخراج نص قابل للتحليل." : "No readable text could be extracted."}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-1 text-muted-foreground">
              {ar
                ? "لا توجد سيرة ذاتية محفوظة. ارفعها هنا وسأحللها في هذه المحادثة."
                : "No CV on file. Upload it here and I will analyse it in this chat."}
            </p>
          )}
        </div>

        <div className="rounded-lg border bg-background p-3">
          <p className="flex items-center gap-1.5 font-medium">
            <LineChart className="size-3.5" aria-hidden />
            {ar ? "أفضل المسارات" : "Best-fit roles"}
          </p>
          {insight.matches.length ? (
            <ul className="mt-1 space-y-1">
              {insight.matches.map((m) => (
                <li key={m.roleCode} className="flex items-center justify-between gap-2">
                  <span className="truncate">{m.title}</span>
                  <span className="shrink-0 font-semibold">{m.fitScore}%</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-muted-foreground">{ar ? "لا توجد نتائج بعد." : "No results yet."}</p>
          )}
        </div>
      </div>

      {gaps && (gaps.strong.length || gaps.missing.length) ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {gaps.strong.length ? (
            <p>
              <span className="font-medium text-success">{ar ? "نقاط قوة" : "Strengths"}: </span>
              <span className="text-muted-foreground">{gaps.strong.join(", ")}</span>
            </p>
          ) : null}
          {gaps.missing.length ? (
            <p>
              <span className="font-medium text-warning-foreground">{ar ? "مهارات ناقصة" : "Missing"}: </span>
              <span className="text-muted-foreground">{gaps.missing.join(", ")}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {insight.counsellingRequest ? (
        <p className="mt-3 flex items-center gap-1.5 text-muted-foreground">
          <UserRound className="size-3.5" aria-hidden />
          {ar ? "طلب إرشاد قائم" : "Open counselling request"}:{" "}
          <span className="font-mono">{insight.counsellingRequest.reference}</span>
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
        <Button
          size="sm"
          variant={insight.cv.hasCv ? "secondary" : "default"}
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <FileUp className="size-3.5" aria-hidden />
          )}
          {uploading ? (ar ? "جارٍ التحليل…" : "Analysing…") : uploadLabel}
        </Button>
        {onAsk && insight.cv.hasCv ? (
          <>
            <Button size="sm" variant="outline" onClick={() => onAsk(ar ? "راجع سيرتي الذاتية." : "Review my CV")}>
              {ar ? "مراجعة سيرتي" : "Review my CV"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAsk(ar ? "ما المهارات الناقصة لدي؟" : "What skills am I missing?")}
            >
              {ar ? "المهارات الناقصة" : "View skill gaps"}
            </Button>
          </>
        ) : null}
        {onAsk && !insight.counsellingRequest ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onAsk(ar ? "أريد التحدث إلى مرشد مهني." : "I would like to speak to a career counsellor.")
            }
          >
            {ar ? "طلب مرشد مهني" : "Request a counsellor"}
          </Button>
        ) : null}
        <Button asChild size="sm" variant="ghost">
          <Link to="/career">{ar ? "التحليل الكامل" : "Full analysis"}</Link>
        </Button>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        {ar ? "تحليل سندي" : "Sanadi analysis"} v{insight.analysisVersion} ·{" "}
        {new Date(insight.calculatedAt).toLocaleDateString()}
        {insight.cv.cvId ? ` · CV ${insight.cv.cvId.slice(0, 8)}` : ""}
      </p>
    </div>
  );
}
