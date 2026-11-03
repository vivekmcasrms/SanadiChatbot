import { ArrowRight, Star } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { JourneyImpact } from "@/lib/leadership";

function pct(before: number, after: number) {
  if (before <= 0) return 0;
  return Math.max(0, Math.round(((before - after) / before) * 100));
}

function dur(h: number, ar: boolean) {
  if (h < 1) return ar ? `${Math.max(1, Math.round(h * 60))} دقيقة` : `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return ar ? `${Math.round(h)} ساعة` : `${Math.round(h)} h`;
  return ar ? `${Math.round(h / 24)} يوم` : `${Math.round(h / 24)} days`;
}

/** Before vs after "Zero Bureaucracy" model for a single student journey. */
export function ImpactModel({ journey }: { journey: JourneyImpact }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const rows = [
    { label: ar ? "الخطوات" : "Steps", b: journey.before.steps, a: journey.after.steps },
    { label: ar ? "الحقول المطلوبة" : "Fields to fill", b: journey.before.fields, a: journey.after.fields },
    { label: ar ? "الموافقات" : "Approvals", b: journey.before.approvals, a: journey.after.approvals },
    { label: ar ? "زيارات المكاتب" : "Office visits", b: journey.before.visits, a: journey.after.visits },
    { label: ar ? "تدخلات الموظفين" : "Staff touches", b: journey.before.touches, a: journey.after.touches },
  ];
  return (
    <Card className={journey.highlight ? "border-primary/40" : undefined}>
      <CardHeader className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{ar ? journey.nameAr : journey.nameEn}</CardTitle>
          {journey.highlight ? (
            <Badge variant="secondary" className="gap-1">
              <Star className="size-3" aria-hidden />
              {ar ? "قصة رئيسية" : "Flagship"}
            </Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {ar ? `${journey.cases} حالة خلال آخر ٣٠ يوماً` : `${journey.cases} cases in the last 30 days`}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="font-medium text-muted-foreground">{ar ? "قبل سندي" : "Before Sanadi"}</p>
            <p className="mt-1 leading-relaxed">{ar ? journey.before.flowAr : journey.before.flowEn}</p>
          </div>
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="font-medium text-primary">{ar ? "مع سندي" : "With Sanadi"}</p>
            <p className="mt-1 leading-relaxed">{ar ? journey.after.flowAr : journey.after.flowEn}</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b last:border-0">
                  <td className="px-3 py-2 text-muted-foreground">{r.label}</td>
                  <td className="px-2 py-2 text-end tabular-nums line-through opacity-60">{r.b}</td>
                  <td className="px-1 py-2 text-muted-foreground">
                    <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
                  </td>
                  <td className="px-3 py-2 font-semibold tabular-nums text-primary">{r.a}</td>
                </tr>
              ))}
              <tr>
                <td className="px-3 py-2 text-muted-foreground">{ar ? "زمن الإنجاز" : "Processing time"}</td>
                <td className="px-2 py-2 text-end tabular-nums line-through opacity-60">
                  {dur(journey.before.hours, ar)}
                </td>
                <td className="px-1 py-2 text-muted-foreground">
                  <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
                </td>
                <td className="px-3 py-2 font-semibold tabular-nums text-primary">{dur(journey.after.hours, ar)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground">
          {ar
            ? `تقليل الخطوات ${pct(journey.before.steps, journey.after.steps)}٪ • تقليل زمن الإنجاز ${pct(journey.before.hours, journey.after.hours)}٪`
            : `${pct(journey.before.steps, journey.after.steps)}% fewer steps • ${pct(journey.before.hours, journey.after.hours)}% faster`}
        </p>
      </CardContent>
    </Card>
  );
}
