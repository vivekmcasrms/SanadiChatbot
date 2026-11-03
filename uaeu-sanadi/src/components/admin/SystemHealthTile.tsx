import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { getSystemHealthFn } from "@/lib/admin/system-health.functions";
import type { HealthItem, HealthLevel } from "@/lib/admin/system-health";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LABELS: Record<HealthItem["key"], { en: string; ar: string; to: string; search?: Record<string, string> }> = {
  jobs: { en: "Background jobs", ar: "المهام الخلفية", to: "/job-runs" },
  ai: { en: "AI response time", ar: "زمن استجابة الذكاء الاصطناعي", to: "/ai-ops", search: { tab: "quality" } },
  rag: { en: "Knowledge search", ar: "البحث في المعرفة", to: "/knowledge-center", search: { tab: "health" } },
  email: { en: "Email", ar: "البريد الإلكتروني", to: "/notifications" },
  voice: { en: "Voice", ar: "الصوت", to: "/ai-ops", search: { tab: "quality" } },
  demo: { en: "Sample data", ar: "البيانات التجريبية", to: "/data-audit" },
  cleanup: { en: "Failed file cleanups", ar: "عمليات حذف ملفات فاشلة", to: "/job-runs" },
  errors: { en: "Unresolved system errors", ar: "أخطاء نظام غير محلولة", to: "/evaluation" },
};

const TONE: Record<HealthLevel, string> = {
  ok: "bg-success",
  warning: "bg-warning",
  critical: "bg-destructive",
  unknown: "bg-muted-foreground/40",
};
const LEVEL_TEXT: Record<HealthLevel, { en: string; ar: string }> = {
  ok: { en: "Healthy", ar: "سليم" },
  warning: { en: "Needs attention", ar: "يحتاج انتباه" },
  critical: { en: "Action required", ar: "إجراء مطلوب" },
  unknown: { en: "Not enough data", ar: "بيانات غير كافية" },
};

export function SystemHealthTile({ ar }: { ar: boolean }) {
  const fn = useServerFn(getSystemHealthFn);
  const q = useQuery({ queryKey: ["system-health"], queryFn: () => fn(), refetchInterval: 60_000 });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="size-4 text-primary" aria-hidden />
          {ar ? "صحة النظام" : "System Health"}
        </CardTitle>
        {q.data ? (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className={cn("size-2 rounded-full", TONE[q.data.overall])} aria-hidden />
            {ar ? LEVEL_TEXT[q.data.overall].ar : LEVEL_TEXT[q.data.overall].en}
          </span>
        ) : null}
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : q.isError ? (
          <div className="flex items-center justify-between gap-3 text-sm text-destructive">
            {ar ? "تعذّر تحميل صحة النظام." : "Couldn't load system health."}
            <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
              {ar ? "إعادة المحاولة" : "Retry"}
            </Button>
          </div>
        ) : (
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {q.data!.items.map((item) => {
              const l = LABELS[item.key];
              return (
                <li key={item.key}>
                  <Link
                    to={l.to}
                    search={l.search ?? {}}
                    className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-secondary"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn("size-2 shrink-0 rounded-full", TONE[item.level])}
                        aria-label={ar ? LEVEL_TEXT[item.level].ar : LEVEL_TEXT[item.level].en}
                      />
                      {ar ? l.ar : l.en}
                    </span>
                    <span className="text-end text-xs text-muted-foreground">{ar ? item.valueAr : item.valueEn}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
