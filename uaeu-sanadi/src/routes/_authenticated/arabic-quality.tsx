import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toastError } from "@/lib/errors/toast";
import { useI18n } from "@/lib/i18n";
import { ARABIC_STYLES, ARABIC_STYLE_LABELS, type ArabicStyle } from "@/lib/arabic/emirati";
import {
  getArabicLanguageConfig,
  runArabicReview,
  updateArabicLanguageConfig,
  type ArabicReviewRow,
} from "@/lib/arabic/review.functions";

export const Route = createFileRoute("/_authenticated/arabic-quality")({
  head: () => ({
    meta: [
      { title: "Arabic Language Quality — Sanadi | UAEU" },
      { name: "description", content: "Choose Sanadi's Arabic style and review how it understands and answers Emirati student language." },
      { property: "og:title", content: "Arabic Language Quality — Sanadi | UAEU" },
      { property: "og:description", content: "Emirati Arabic style settings and a review sheet for UAEU students and staff." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ArabicQualityPage,
});

function StylePicker({ value, onChange, ar }: { value: ArabicStyle; onChange: (v: ArabicStyle) => void; ar: boolean }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ArabicStyle)}>
      <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
      <SelectContent>
        {ARABIC_STYLES.map((s) => (
          <SelectItem key={s} value={s}>{ar ? ARABIC_STYLE_LABELS[s].ar : ARABIC_STYLE_LABELS[s].en}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ArabicQualityPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ["arabic-config"], queryFn: () => getArabicLanguageConfig() });
  const [text, setText] = useState<ArabicStyle>("uae_professional");
  const [voice, setVoice] = useState<ArabicStyle>("uae_conversational");
  const [extra, setExtra] = useState("");
  const [rows, setRows] = useState<ArabicReviewRow[]>([]);
  useEffect(() => {
    if (config.data) { setText(config.data.arabicStyle); setVoice(config.data.voiceArabicStyle); }
  }, [config.data]);

  const save = useMutation({
    mutationFn: () => updateArabicLanguageConfig({ data: { arabicStyle: text, voiceArabicStyle: voice } }),
    onSuccess: () => { toast.success(ar ? "تم حفظ أسلوب اللغة" : "Language style saved"); void qc.invalidateQueries({ queryKey: ["arabic-config"] }); },
    onError: toastError,
  });
  const review = useMutation({
    mutationFn: () => runArabicReview({ data: { extra: extra || undefined } }),
    onSuccess: (r) => setRows(r.rows),
    onError: toastError,
  });
  const passed = rows.filter((r) => r.status === "pass").length;

  return (
    <div className="space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{ar ? "جودة اللغة العربية" : "Arabic Language Quality"}</h1>
        <p className="text-muted-foreground">{ar ? "محلي بما يكفي ليكون مألوفاً، ومهني بما يليق بجامعة الإمارات." : "Local enough to feel familiar. Professional enough for UAEU."}</p>
      </header>

      <section className="space-y-4 rounded-lg border bg-card p-4">
        <h2 className="font-medium">{ar ? "إعدادات الأسلوب" : "Style settings"}</h2>
        <div className="flex flex-wrap items-center gap-6">
          <label className="space-y-1"><span className="block text-sm text-muted-foreground">{ar ? "الردود المكتوبة" : "Written replies"}</span><StylePicker value={text} onChange={setText} ar={ar} /></label>
          <label className="space-y-1"><span className="block text-sm text-muted-foreground">{ar ? "الردود الصوتية" : "Spoken replies"}</span><StylePicker value={voice} onChange={setVoice} ar={ar} /></label>
          <Button onClick={() => save.mutate()} disabled={save.isPending || config.isLoading}>{ar ? "حفظ" : "Save"}</Button>
        </div>
        <p className="text-sm text-muted-foreground">{ar ? "الإجراءات الرسمية (الشكاوى، التحويل، حجز السكن، الموافقات) تبقى دائماً بعربية مهنية واضحة." : "Official actions (complaints, transfers, hostel booking, approvals) always stay in clear professional Arabic."}</p>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input dir="rtl" className="max-w-md" placeholder={ar ? "أضف عبارة للاختبار (اختياري)" : "Add a phrase to test (optional)"} value={extra} onChange={(e) => setExtra(e.target.value)} />
          <Button onClick={() => review.mutate()} disabled={review.isPending}>{review.isPending ? (ar ? "جارٍ التشغيل…" : "Running…") : (ar ? "تشغيل المراجعة" : "Run review")}</Button>
          {rows.length > 0 && <Badge variant="secondary">{passed}/{rows.length} {ar ? "ناجحة" : "pass"}</Badge>}
        </div>
        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-start">
                <tr>{(ar ? ["المدخل","اللغة / اللهجة","النية","الرد المعروض","الرد المنطوق","المعادل الإنجليزي","النتيجة"] : ["Input","Language / dialect","Intent","Displayed reply","Spoken reply","English equivalent","Result"]).map((h) => <th key={h} className="p-2 text-start font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.input} className="border-t align-top">
                    <td className="p-2" dir="auto">{r.input}<div className="text-xs text-muted-foreground" dir="rtl">{r.gloss}</div></td>
                    <td className="p-2">{r.language} / {r.dialect}{r.markers.length > 0 && <div className="text-xs text-muted-foreground" dir="rtl">{r.markers.join("، ")}</div>}</td>
                    <td className="p-2">{r.intent}{r.expected && r.expected !== r.intent && <div className="text-xs text-destructive">{ar ? "المتوقع" : "expected"}: {r.expected}</div>}</td>
                    <td className="p-2" dir="rtl">{r.display}</td>
                    <td className="p-2" dir="rtl">{r.spoken}</td>
                    <td className="p-2">{r.english}</td>
                    <td className="p-2"><Badge variant={r.status === "pass" ? "default" : "destructive"}>{r.status === "pass" ? (ar ? "ناجح" : "Pass") : (ar ? "يحتاج مراجعة" : "Needs review")}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
