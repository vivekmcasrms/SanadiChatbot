import { Brain, ShieldCheck, BookOpen, ListChecks, Zap, CheckCircle2, FileText, Bell } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STEPS = [
  { icon: Brain, en: "Understand", ar: "الفهم", dEn: "Reads the question in Arabic or English", dAr: "يقرأ السؤال بالعربية أو الإنجليزية" },
  { icon: ShieldCheck, en: "Verify", ar: "التحقق", dEn: "Checks the student's official records", dAr: "يتحقق من سجلات الطالب الرسمية" },
  { icon: BookOpen, en: "Retrieve", ar: "الاسترجاع", dEn: "Grounds the answer in approved policy", dAr: "يستند إلى السياسات المعتمدة" },
  { icon: ListChecks, en: "Plan", ar: "التخطيط", dEn: "Chooses the shortest lawful path", dAr: "يختار أقصر مسار نظامي" },
  { icon: Zap, en: "Act", ar: "التنفيذ", dEn: "Executes the service transaction", dAr: "ينفّذ المعاملة الخدمية" },
  { icon: CheckCircle2, en: "Confirm", ar: "التأكيد", dEn: "Confirms with the student, human only by exception", dAr: "يؤكد مع الطالب، والبشر عند الاستثناء" },
  { icon: FileText, en: "Record", ar: "التوثيق", dEn: "Writes a full auditable trail", dAr: "يوثّق أثراً كاملاً قابلاً للتدقيق" },
  { icon: Bell, en: "Follow up", ar: "المتابعة", dEn: "Tracks the outcome to closure", dAr: "يتابع حتى الإغلاق" },
];

export function AgenticJourney() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {ar ? "كيف ينجز سندي الخدمة" : "How Sanadi completes a service"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {ar
            ? "الذكاء الاصطناعي يعمل افتراضياً، والإشراف البشري عند الاستثناء."
            : "AI operates by default; humans supervise by exception."}
        </p>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.en} className="rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <s.icon className="size-4" aria-hidden />
                </span>
                <span className="text-sm font-medium">
                  {i + 1}. {ar ? s.ar : s.en}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{ar ? s.dAr : s.dEn}</p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
