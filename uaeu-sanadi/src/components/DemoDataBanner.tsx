import { FlaskConical } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/** Persistent, unmissable disclosure that the figures come from demo data. */
export function DemoDataBanner({ share }: { share?: number }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const pct = typeof share === "number" ? Math.round(share * 100) : null;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-400/50 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="text-xs leading-relaxed sm:text-sm">
        <p className="font-semibold">
          {ar ? "بيانات عرض توضيحي — ليست نتائج تشغيلية" : "Demonstration data — not operational results"}
        </p>
        <p className="mt-0.5">
          {ar
            ? "جميع السجلات التاريخية والمقارنات المعروضة هنا افتراضية وأُنشئت لأغراض العرض فقط، ومصنّفة داخلياً كبيانات تجريبية."
            : "The historical records and before/after comparisons shown here are hypothetical, generated for demonstration only, and flagged internally as demo data."}
          {pct !== null ? (
            <span className="ms-1 font-medium">
              {ar ? `(${pct}٪ من الحالات في هذه النافذة تجريبية)` : `(${pct}% of cases in this window are demo records)`}
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}
