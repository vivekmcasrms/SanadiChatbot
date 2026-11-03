import { createFileRoute } from "@tanstack/react-router";
import { Bot, Clock, Gauge, HeartHandshake, Sparkles, UserCheck } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useLeadershipInsights } from "@/lib/leadership";
import { MetricCard } from "@/components/MetricCard";
import { AgenticJourney } from "@/components/AgenticJourney";
import { ImpactModel } from "@/components/ImpactModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CardListSkeleton } from "@/components/ListSkeleton";

export const Route = createFileRoute("/_authenticated/leadership")({
  head: () => ({
    meta: [
      { title: "Leadership Impact — Sanadi | UAEU" },
      {
        name: "description",
        content: "Measurable impact of agentic AI and zero bureaucracy across UAEU student services.",
      },
      { property: "og:title", content: "Leadership Impact — Sanadi | UAEU" },
      {
        property: "og:description",
        content: "Measurable impact of agentic AI and zero bureaucracy across UAEU student services.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LeadershipPage,
});

function pctText(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return `${Math.round(v * 100)}%`;
}

function LeadershipPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { isStaff } = useAuth();
  const q = useLeadershipInsights(isStaff);
  const d = q.data;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {ar ? "أثر سندي — لوحة القيادة" : "Sanadi impact — leadership view"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {ar
            ? "آخر ٣٠ يوماً: ما الذي أنجزه الذكاء الاصطناعي، وأين تدخّل الإنسان، وكم من البيروقراطية اختفت."
            : "Last 30 days: what AI completed, where humans stepped in, and how much bureaucracy disappeared."}
        </p>
      </header>


      {q.isLoading || !d ? (
        <CardListSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <MetricCard
              label={ar ? "الطلبات المعالجة" : "Requests handled"}
              value={d.total}
              hint={ar ? "خلال ٣٠ يوماً" : "over 30 days"}
              icon={<Sparkles className="size-4" aria-hidden />}
            />
            <MetricCard
              label={ar ? "أُنجزت بالكامل آلياً" : "Completed fully by AI"}
              value={pctText(d.autonomyRate)}
              hint={ar ? `${d.aiOnly} طلباً بدون تدخل بشري` : `${d.aiOnly} with no human touch`}
              tone="success"
              icon={<Bot className="size-4" aria-hidden />}
            />
            <MetricCard
              label={ar ? "متوسط زمن الإنجاز الآلي" : "Avg AI completion"}
              value={d.avgAiMinutes === null ? "—" : ar ? `${Math.round(d.avgAiMinutes)} دقيقة` : `${Math.round(d.avgAiMinutes)} min`}
              hint={
                d.avgHumanHours === null
                  ? ""
                  : ar
                    ? `مقابل ${Math.round(d.avgHumanHours)} ساعة عند الحاجة للبشر`
                    : `vs ${Math.round(d.avgHumanHours)} h when humans are needed`
              }
              icon={<Clock className="size-4" aria-hidden />}
            />
            <MetricCard
              label={ar ? "رضا الطلبة" : "Student satisfaction"}
              value={d.satisfaction === null ? "—" : `${d.satisfaction.toFixed(1)} / 5`}
              hint={
                d.feedbackCount < 5
                  ? ar
                    ? "عينة غير كافية"
                    : "Insufficient data"
                  : ar
                    ? `${d.feedbackCount} تقييماً`
                    : `${d.feedbackCount} ratings`
              }
              tone="success"
              icon={<HeartHandshake className="size-4" aria-hidden />}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <MetricCard
              label={ar ? "أول استجابة" : "First response"}
              value={
                d.avgFirstResponseSeconds === null
                  ? "—"
                  : ar
                    ? `${Math.round(d.avgFirstResponseSeconds)} ثانية`
                    : `${Math.round(d.avgFirstResponseSeconds)} s`
              }
              icon={<Gauge className="size-4" aria-hidden />}
            />
            <MetricCard
              label={ar ? "إشراف بشري" : "Human supervision"}
              value={pctText(d.total ? d.humanRequired / d.total : null)}
              hint={ar ? `${d.humanRequired} حالة استثناء` : `${d.humanRequired} exception cases`}
              icon={<UserCheck className="size-4" aria-hidden />}
            />
            <MetricCard
              label={ar ? "حُلّت من أول مرة" : "Resolved first time"}
              value={d.feedbackCount < 5 ? "—" : pctText(d.firstTimeResolution)}
              hint={d.feedbackCount < 5 ? (ar ? "عينة غير كافية" : "Insufficient data") : ""}
            />
            <MetricCard
              label={ar ? "أُعيد فتحها / تصعيد" : "Reopened / escalated"}
              value={`${d.reopened} / ${d.escalated}`}
              tone={d.escalated > 0 ? "warning" : "default"}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {ar ? "الذكاء الاصطناعي مقابل التدخل البشري" : "AI vs human intervention"}
                </CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={d.perDay} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(5)} fontSize={11} />
                    <YAxis allowDecimals={false} fontSize={11} />
                    <Tooltip />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="ai"
                      name={ar ? "آلي بالكامل" : "Fully automated"}
                      stackId="1"
                      stroke="hsl(var(--primary))"
                      fill="hsl(var(--primary) / 0.35)"
                    />
                    <Area
                      type="monotone"
                      dataKey="human"
                      name={ar ? "تدخل بشري" : "Human involved"}
                      stackId="1"
                      stroke="hsl(var(--muted-foreground))"
                      fill="hsl(var(--muted-foreground) / 0.25)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{ar ? "الأثر حسب الوحدة" : "Impact by service unit"}</CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.byUnit.slice(0, 8)} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="code" fontSize={11} />
                    <YAxis allowDecimals={false} fontSize={11} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="aiOnly" name={ar ? "آلي" : "AI only"} stackId="a" fill="hsl(var(--primary))" />
                    <Bar
                      dataKey="humanTouched"
                      name={ar ? "بمشاركة بشرية" : "Human touched"}
                      stackId="a"
                      fill="hsl(var(--muted-foreground) / 0.5)"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {ar ? "بيروقراطية أُزيلت (نموذج تقديري)" : "Bureaucracy removed (modelled)"}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {ar
                  ? "يُحتسب بضرب فرق الخطوات بين المسار التقليدي الافتراضي ومسار سندي في عدد الحالات التجريبية لكل وحدة."
                  : "Modelled by multiplying the step difference between the hypothetical traditional journey and the Sanadi journey by the number of cases per unit."}
              </p>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
              <MetricCard label={ar ? "خطوات أُلغيت" : "Steps eliminated"} value={d.savings.steps} tone="success" />
              <MetricCard label={ar ? "حقول لم تُملأ" : "Form fields avoided"} value={d.savings.fields} tone="success" />
              <MetricCard label={ar ? "موافقات أُلغيت" : "Approvals removed"} value={d.savings.approvals} tone="success" />
              <MetricCard
                label={ar ? "زيارات مكاتب وُفّرت" : "Office visits avoided"}
                value={d.savings.visits}
                tone="success"
              />
              <MetricCard
                label={ar ? "ساعات انتظار وُفّرت" : "Waiting hours saved"}
                value={Math.round(d.savings.hours).toLocaleString()}
                tone="success"
              />
              <MetricCard
                label={ar ? "تدخلات موظفين وُفّرت" : "Staff touches saved"}
                value={d.savings.staffTouches}
                tone="success"
              />
            </CardContent>
          </Card>

          <AgenticJourney />

          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">
              {ar ? "قبل وبعد: رحلات الطالب" : "Before and after: student journeys"}
            </h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {d.journeys.map((j) => (
                <ImpactModel key={j.code} journey={j} />
              ))}
            </div>
          </section>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{ar ? "القصة في ثلاث جمل" : "The story in three sentences"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm leading-relaxed">
              <p>
                {ar
                  ? `عالج سندي ${d.total} طلباً خلال ٣٠ يوماً، وأنجز ${pctText(d.autonomyRate)} منها بالكامل دون تدخل بشري.`
                  : `Sanadi handled ${d.total} requests in 30 days and completed ${pctText(d.autonomyRate)} of them end to end with no human touch.`}
              </p>
              <p>
                {ar
                  ? "تحوّل الإنسان من منفّذ للمعاملات إلى مشرف على الاستثناءات: الحالات الطبية، والتصاريح الحكومية، والقرارات التقديرية."
                  : "Humans moved from processing transactions to supervising exceptions: medical cases, government clearance, and judgement calls."}
              </p>
              <p>
                {ar
                  ? "النتيجة: خدمات بلا نماذج ورقية ولا زيارات مكاتب، مع أثر كامل قابل للتدقيق لكل قرار."
                  : "The result: services with no paper forms and no office visits, with a complete auditable trail behind every decision."}
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
