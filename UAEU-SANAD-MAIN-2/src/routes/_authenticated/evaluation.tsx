/**
 * Testing & Measurement — baselines, live measurements, impact indicators,
 * pilot-testing evidence and an evaluation readiness dashboard.
 *
 * Every figure on this page comes from live records. Where the sample is too
 * small to defend a percentage, the page says "Insufficient data" instead of
 * printing a misleading number.
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Printer, Trash2 } from "lucide-react";
import {
  type Criterion,
  type EvaluationSnapshot,
  type Indicator,
  type ServiceRow,
} from "@/lib/admin/evaluation.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toastError } from "@/lib/errors/toast";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/auth-token";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

const MIN_SAMPLE = 5;

export const Route = createFileRoute("/_authenticated/evaluation")({
  head: () => ({
    meta: [
      { title: "Testing & Measurement — Sanadi | UAEU" },
      {
        name: "description",
        content:
          "Traditional-process baselines, live Sanadi measurements, impact indicators, pilot testing evidence and evaluation readiness.",
      },
      { property: "og:title", content: "Testing & Measurement — Sanadi | UAEU" },
      { property: "og:description", content: "Evidence-based measurement of Sanadi against the traditional student service process." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EvaluationPage,
});

const num = (v: number | null | undefined, digits = 0) => (v == null ? "—" : v.toFixed(digits));

function StatusBadge({ status, ar }: { status: Criterion["status"]; ar: boolean }) {
  const map: Record<Criterion["status"], { en: string; ar: string; cls: string }> = {
    complete: { en: "Complete", ar: "مكتمل", cls: "bg-success/15 text-success border-success/30" },
    partial: { en: "Partially complete", ar: "مكتمل جزئيًا", cls: "bg-warning/15 text-warning border-warning/30" },
    not_complete: { en: "Not complete", ar: "غير مكتمل", cls: "bg-destructive/10 text-destructive border-destructive/30" },
    not_applicable: { en: "Not applicable", ar: "لا ينطبق", cls: "bg-muted text-muted-foreground" },
  };
  const s = map[status];
  return <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{ar ? s.ar : s.en}</span>;
}

function IndicatorRow({ ind, ar }: { ind: Indicator; ar: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0">
      <div>
        <p className="text-sm font-medium">{ar ? ind.labelAr : ind.labelEn}</p>
        <p className="text-xs text-muted-foreground">
          {ar ? "عينة" : "Sample"}: {ind.sample}
          {ind.baselineValue != null && (
            <>
              {" · "}
              {ar ? "قبل" : "Before"}: {num(ind.baselineValue, 1)}
              {" · "}
              {ar ? "بعد" : "After"}: {num(ind.currentValue, 1)}
            </>
          )}
        </p>
      </div>
      {ind.value == null ? (
        <span className="text-sm text-muted-foreground">
          {ar ? "بيانات غير كافية" : "Insufficient data"}
          {ind.reasonEn && <span className="block text-xs">{ar ? ind.reasonAr : ind.reasonEn}</span>}
        </span>
      ) : (
        <span className="text-lg font-semibold">{ind.value.toFixed(1)}%</span>
      )}
    </div>
  );
}

function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(snap: EvaluationSnapshot): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows: string[][] = [["section", "item", "value", "sample"]];
  const m = snap.metrics;
  for (const [k, v] of Object.entries(m.volumes)) rows.push(["measurement", k, String(v), ""]);
  for (const [k, v] of Object.entries(m.handling)) rows.push(["measurement", k, String(v), ""]);
  for (const [k, v] of Object.entries(m.timing)) rows.push(["measurement", k, String(v ?? ""), ""]);
  for (const [k, v] of Object.entries(m.effort)) rows.push(["measurement", k, String(v), ""]);
  rows.push(["measurement", "sla_met", String(m.sla.met), String(m.sla.sample)]);
  for (const i of snap.indicators)
    rows.push(["indicator", i.labelEn, i.value == null ? "Insufficient data" : `${i.value}%`, String(i.sample)]);
  for (const s of snap.services.filter((s) => s.baseline))
    rows.push([
      "baseline",
      s.nameEn,
      `steps=${s.baseline?.steps ?? ""}; forms=${s.baseline?.forms ?? ""}; visits=${s.baseline?.visits ?? ""}; fields=${s.baseline?.fieldsRequested ?? ""}; hours=${s.baseline?.avgProcessingHours ?? ""}; staff=${s.baseline?.staffTouchpoints ?? ""}; channels=${(s.baseline?.channels ?? []).join("|")}`,
      String(s.cases),
    ]);
  for (const p of snap.pilots)
    rows.push([
      "pilot",
      `${p.testedOn} ${p.participantRole}`,
      `users=${p.participantCount}; completed=${p.completedSuccessfully}; minutes=${p.timeTakenMinutes ?? ""}; rating=${p.satisfactionRating ?? ""}; issues=${p.issues ?? ""}`,
      "",
    ]);
  for (const c of snap.readiness) rows.push(["readiness", c.labelEn, c.status, c.evidenceEn.join(" | ")]);
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

function EvaluationPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { roles, loading } = useAuth();
  const allowed = roles.some((r) => r === "system_admin" || r === "service_manager");
  const qc = useQueryClient();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["evaluation", from, to],
    queryFn: () =>
      apiFetch<EvaluationSnapshot>("/api/evaluation/snapshot", {
        method: "POST",
        body: JSON.stringify({ from: from || null, to: to || null }),
      }),
    enabled: allowed,
  });

  if (loading) return <p className="text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>;
  if (!allowed)
    return (
      <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        {ar ? "هذه المنطقة مخصصة للإدارة." : "This area is for administrators and service managers."}
      </p>
    );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{ar ? "الاختبار والقياس" : "Testing & Measurement"}</h1>
          <p className="text-sm text-muted-foreground">
            {ar
              ? "كل رقم هنا محسوب من السجلات الفعلية. لا تُعرض النسب عندما تكون العينة أقل من "
              : "Every figure is computed from live records. Percentages are withheld when the sample is under "}
            {MIN_SAMPLE}.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="from" className="text-xs">
              {ar ? "من" : "From"}
            </Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label htmlFor="to" className="text-xs">
              {ar ? "إلى" : "To"}
            </Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!data}
            onClick={() => data && download(`sanadi-evaluation-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(data), "text/csv")}
          >
            <Download className="mr-1.5 h-4 w-4" /> {ar ? "تصدير" : "Export"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-4 w-4" /> {ar ? "طباعة / PDF" : "Print / PDF"}
          </Button>
        </div>
      </header>

      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {isLoading && <p className="text-sm text-muted-foreground">{ar ? "جارٍ الحساب…" : "Calculating…"}</p>}

      {data && (
        <Tabs defaultValue="readiness">
          <TabsList className="flex-wrap">
            <TabsTrigger value="readiness">{ar ? "جاهزية التقييم" : "Readiness"}</TabsTrigger>
            <TabsTrigger value="impact">{ar ? "قبل وبعد" : "Before vs after"}</TabsTrigger>
            <TabsTrigger value="measure">{ar ? "القياسات" : "Measurements"}</TabsTrigger>
            <TabsTrigger value="baselines">{ar ? "خطوط الأساس" : "Baselines"}</TabsTrigger>
            <TabsTrigger value="pilots">{ar ? "اختبار المستخدمين" : "User testing"}</TabsTrigger>
          </TabsList>

          <TabsContent value="readiness" className="mt-4 grid gap-3 md:grid-cols-2">
            {data.readiness.map((c) => (
              <Card key={c.key}>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm">{ar ? c.labelAr : c.labelEn}</CardTitle>
                  <StatusBadge status={c.status} ar={ar} />
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {(ar ? c.evidenceAr : c.evidenceEn).map((e, i) => (
                    <p key={i} className="text-success">
                      ✓ {e}
                    </p>
                  ))}
                  {(ar ? c.missingAr : c.missingEn).map((e, i) => (
                    <p key={i} className="text-muted-foreground">
                      • {ar ? "الدليل الناقص" : "Evidence missing"}: {e}
                    </p>
                  ))}
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="impact" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{ar ? "مؤشرات الأثر" : "Impact indicators"}</CardTitle>
              </CardHeader>
              <CardContent>
                {data.indicators.map((i) => (
                  <IndicatorRow key={i.key} ind={i} ar={ar} />
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="measure" className="mt-4">
            <Measurements snap={data} ar={ar} />
          </TabsContent>

          <TabsContent value="baselines" className="mt-4">
            <BaselineEditor snap={data} ar={ar} onSaved={() => qc.invalidateQueries({ queryKey: ["evaluation"] })} />
          </TabsContent>

          <TabsContent value="pilots" className="mt-4">
            <PilotEditor snap={data} ar={ar} onSaved={() => qc.invalidateQueries({ queryKey: ["evaluation"] })} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function Measurements({ snap, ar }: { snap: EvaluationSnapshot; ar: boolean }) {
  const m = snap.metrics;
  const groups: { title: string; titleAr: string; rows: [string, string, string][] }[] = [
    {
      title: "Volume",
      titleAr: "الحجم",
      rows: [
        ["Interactions", "التفاعلات", String(m.volumes.interactions)],
        ["Requests & cases", "الطلبات والحالات", String(m.volumes.cases)],
        ["Questions", "الاستفسارات", String(m.volumes.queries)],
        ["Complaints", "الشكاوى", String(m.volumes.complaints)],
        ["Suggestions", "الاقتراحات", String(m.volumes.suggestions)],
        ["Alerts", "البلاغات", String(m.volumes.alerts)],
        ["Service requests", "طلبات الخدمة", String(m.volumes.requests)],
      ],
    },
    {
      title: "Handling",
      titleAr: "المعالجة",
      rows: [
        ["Resolved without staff", "أُنجزت دون موظف", String(m.handling.ai_resolved)],
        ["Escalated to a person", "أُحيلت إلى موظف", String(m.handling.human_escalated)],
        ["Resolved", "منجزة", String(m.handling.resolved)],
        ["Closed", "مغلقة", String(m.handling.closed)],
        ["Still open", "مفتوحة", String(m.handling.open)],
      ],
    },
    {
      title: "Speed & service level",
      titleAr: "السرعة ومستوى الخدمة",
      rows: [
        [
          "Average first response",
          "متوسط أول رد",
          m.timing.first_response_sample < MIN_SAMPLE
            ? ar
              ? "بيانات غير كافية"
              : "Insufficient data"
            : `${num(m.timing.avg_first_response_hours, 1)} h`,
        ],
        [
          "Average resolution",
          "متوسط زمن الإنجاز",
          m.timing.resolution_sample < MIN_SAMPLE
            ? ar
              ? "بيانات غير كافية"
              : "Insufficient data"
            : `${num(m.timing.avg_resolution_hours, 1)} h`,
        ],
        [
          "SLA met",
          "الالتزام بمستوى الخدمة",
          m.sla.sample < MIN_SAMPLE ? (ar ? "بيانات غير كافية" : "Insufficient data") : `${m.sla.met} / ${m.sla.sample}`,
        ],
      ],
    },
    {
      title: "Effort",
      titleAr: "الجهد",
      rows: [
        ["Staff touchpoints", "لمسات الموظفين", String(m.effort.staff_touchpoints)],
        ["Fields the student had to enter", "حقول أدخلها الطالب", String(m.effort.student_entered_fields)],
        ["Information requests to students", "طلبات معلومات من الطلبة", String(m.effort.information_requests)],
        ["Known fields reused (not re-asked)", "حقول أُعيد استخدامها", String(m.effort.reused_known_fields)],
        ["In-person visits recorded", "زيارات حضورية مسجلة", String(m.effort.in_person_visits)],
        ["Reopen / objection requests", "طلبات إعادة النظر أو الاعتراض", String(m.reviews.reopen_or_objection)],
      ],
    },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {groups.map((g) => (
        <Card key={g.title}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{ar ? g.titleAr : g.title}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {g.rows.map(([en, arLabel, value]) => (
              <div key={en} className="flex items-center justify-between border-b py-1.5 last:border-0">
                <span className="text-muted-foreground">{ar ? arLabel : en}</span>
                <span className="font-medium">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const EMPTY = { steps: "", forms: "", visits: "", fields: "", hours: "", staff: "", channels: "", notes: "" };

function BaselineEditor({ snap, ar, onSaved }: { snap: EvaluationSnapshot; ar: boolean; onSaved: () => void }) {
  const [serviceId, setServiceId] = useState<string>(snap.services[0]?.id ?? "");
  const [form, setForm] = useState({ ...EMPTY });

  const selected = useMemo(() => snap.services.find((s) => s.id === serviceId) ?? null, [snap.services, serviceId]);

  const pick = (s: ServiceRow | null) => {
    setForm(
      s?.baseline
        ? {
            steps: s.baseline.steps?.toString() ?? "",
            forms: s.baseline.forms?.toString() ?? "",
            visits: s.baseline.visits?.toString() ?? "",
            fields: s.baseline.fieldsRequested?.toString() ?? "",
            hours: s.baseline.avgProcessingHours?.toString() ?? "",
            staff: s.baseline.staffTouchpoints?.toString() ?? "",
            channels: s.baseline.channels.join(", "),
            notes: s.baseline.notes ?? "",
          }
        : { ...EMPTY },
    );
  };

  const int = (v: string) => (v.trim() === "" ? null : Math.trunc(Number(v)));
  const dec = (v: string) => (v.trim() === "" ? null : Number(v));

  const saving = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true }>("/api/evaluation/baselines", {
        method: "POST",
        body: JSON.stringify({
          universityServiceId: serviceId,
          steps: int(form.steps),
          forms: int(form.forms),
          visits: int(form.visits),
          fieldsRequested: int(form.fields),
          avgProcessingHours: dec(form.hours),
          staffTouchpoints: int(form.staff),
          channels: form.channels
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
          notes: form.notes || null,
        }),
      }),
    onSuccess: () => {
      toast.success(ar ? "تم حفظ خط الأساس" : "Baseline saved");
      onSaved();
    },
    onError: (e) => toastError(e),
  });

  const removing = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>("/api/evaluation/baselines/delete", {
        method: "POST",
        body: JSON.stringify({ id }),
      }),
    onSuccess: () => {
      toast.success(ar ? "تم الحذف" : "Baseline removed");
      onSaved();
    },
    onError: (e) => toastError(e),
  });

  const fields: [keyof typeof EMPTY, string, string][] = [
    ["steps", "Steps in the traditional process", "عدد الخطوات"],
    ["forms", "Forms to fill", "عدد النماذج"],
    ["visits", "In-person visits", "الزيارات الحضورية"],
    ["fields", "Fields requested", "الحقول المطلوبة"],
    ["hours", "Average processing time (hours)", "متوسط زمن المعالجة (ساعات)"],
    ["staff", "Staff touchpoints", "لمسات الموظفين"],
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{ar ? "تسجيل خط الأساس التقليدي" : "Record the traditional baseline"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">{ar ? "الخدمة" : "Service"}</Label>
            <Select
              value={serviceId}
              onValueChange={(v) => {
                setServiceId(v);
                pick(snap.services.find((s) => s.id === v) ?? null);
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder={ar ? "اختر خدمة" : "Choose a service"} />
              </SelectTrigger>
              <SelectContent>
                {snap.services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {ar ? s.nameAr : s.nameEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {fields.map(([key, en, arLabel]) => (
              <div key={key}>
                <Label className="text-xs">{ar ? arLabel : en}</Label>
                <Input
                  type="number"
                  min={0}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="h-9"
                />
              </div>
            ))}
          </div>
          <div>
            <Label className="text-xs">{ar ? "القنوات المستخدمة (مفصولة بفواصل)" : "Channels used (comma separated)"}</Label>
            <Input value={form.channels} onChange={(e) => setForm((f) => ({ ...f, channels: e.target.value }))} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">{ar ? "ملاحظات ومصدر البيانات" : "Notes / source of these figures"}</Label>
            <Textarea rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={!serviceId || saving.isPending} onClick={() => saving.mutate()}>
              {ar ? "حفظ" : "Save baseline"}
            </Button>
            {selected?.baseline && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => selected.baseline && removing.mutate(selected.baseline.id)}
                disabled={removing.isPending}
              >
                <Trash2 className="mr-1.5 h-4 w-4" /> {ar ? "حذف" : "Remove"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{ar ? "قبل مقابل بعد لكل خدمة" : "Before vs after, per service"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {snap.services.filter((s) => s.baseline || s.cases > 0).length === 0 && (
            <p className="text-muted-foreground">{ar ? "لا توجد بيانات بعد." : "No data recorded yet."}</p>
          )}
          {snap.services
            .filter((s) => s.baseline || s.cases > 0)
            .map((s) => (
              <div key={s.id} className="border-b py-2 last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{ar ? s.nameAr : s.nameEn}</p>
                  {!s.baseline && <Badge variant="outline">{ar ? "بدون خط أساس" : "No baseline"}</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {ar ? "قبل" : "Before"}:{" "}
                  {s.baseline
                    ? `${s.baseline.steps ?? "—"} ${ar ? "خطوة" : "steps"} · ${s.baseline.visits ?? "—"} ${ar ? "زيارة" : "visits"} · ${s.baseline.avgProcessingHours ?? "—"} h`
                    : ar
                      ? "غير مسجل"
                      : "not recorded"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {ar ? "بعد" : "After"}: {s.cases} {ar ? "طلبًا" : "requests"} · {s.completed} {ar ? "منجزًا" : "completed"} ·{" "}
                  {s.completed < MIN_SAMPLE
                    ? ar
                      ? "زمن الإنجاز: بيانات غير كافية"
                      : "resolution time: insufficient data"
                    : `${num(s.avgResolutionHours, 1)} h`}
                </p>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}

function PilotEditor({ snap, ar, onSaved }: { snap: EvaluationSnapshot; ar: boolean; onSaved: () => void }) {
  const [f, setF] = useState({
    serviceId: "",
    role: "student",
    users: "1",
    date: new Date().toISOString().slice(0, 10),
    completed: "yes",
    minutes: "",
    rating: "",
    issues: "",
    comments: "",
  });

  const adding = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true }>("/api/evaluation/pilots", {
        method: "POST",
        body: JSON.stringify({
          universityServiceId: f.serviceId || null,
          serviceLabel: snap.services.find((s) => s.id === f.serviceId)?.nameEn ?? null,
          participantRole: f.role,
          participantCount: Math.max(1, Number(f.users) || 1),
          testedOn: f.date,
          completedSuccessfully: f.completed === "yes",
          timeTakenMinutes: f.minutes.trim() === "" ? null : Number(f.minutes),
          satisfactionRating: f.rating.trim() === "" ? null : Number(f.rating),
          issues: f.issues || null,
          comments: f.comments || null,
        }),
      }),
    onSuccess: () => {
      toast.success(ar ? "تم تسجيل جلسة الاختبار" : "Testing session recorded");
      setF((x) => ({ ...x, minutes: "", rating: "", issues: "", comments: "" }));
      onSaved();
    },
    onError: (e) => toastError(e),
  });

  const removing = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>("/api/evaluation/pilots/delete", {
        method: "POST",
        body: JSON.stringify({ id }),
      }),
    onSuccess: onSaved,
    onError: (e) => toastError(e),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{ar ? "تسجيل اختبار حقيقي" : "Record a real testing session"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <Label className="text-xs">{ar ? "الخدمة التي جُربت" : "Service tested"}</Label>
              <Select value={f.serviceId} onValueChange={(v) => setF((x) => ({ ...x, serviceId: v }))}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={ar ? "اختر خدمة" : "Choose a service"} />
                </SelectTrigger>
                <SelectContent>
                  {snap.services.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {ar ? s.nameAr : s.nameEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{ar ? "الدور" : "Role"}</Label>
              <Select value={f.role} onValueChange={(v) => setF((x) => ({ ...x, role: v }))}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="student">{ar ? "طالب" : "Student"}</SelectItem>
                  <SelectItem value="staff">{ar ? "موظف" : "Staff"}</SelectItem>
                  <SelectItem value="service_owner">{ar ? "مسؤول خدمة" : "Service owner"}</SelectItem>
                  <SelectItem value="admin">{ar ? "مسؤول نظام" : "Admin"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{ar ? "عدد المستخدمين" : "Number of users"}</Label>
              <Input type="number" min={1} value={f.users} onChange={(e) => setF((x) => ({ ...x, users: e.target.value }))} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">{ar ? "التاريخ" : "Date"}</Label>
              <Input type="date" value={f.date} onChange={(e) => setF((x) => ({ ...x, date: e.target.value }))} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">{ar ? "اكتملت المهمة؟" : "Task completed?"}</Label>
              <Select value={f.completed} onValueChange={(v) => setF((x) => ({ ...x, completed: v }))}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">{ar ? "نعم" : "Yes"}</SelectItem>
                  <SelectItem value="no">{ar ? "لا" : "No"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{ar ? "الزمن (دقائق)" : "Time taken (minutes)"}</Label>
              <Input type="number" min={0} value={f.minutes} onChange={(e) => setF((x) => ({ ...x, minutes: e.target.value }))} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">{ar ? "الرضا (1-5)" : "Satisfaction (1-5)"}</Label>
              <Input
                type="number"
                min={1}
                max={5}
                value={f.rating}
                onChange={(e) => setF((x) => ({ ...x, rating: e.target.value }))}
                className="h-9"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">{ar ? "المشكلات التي ظهرت" : "Issues encountered"}</Label>
            <Textarea rows={2} value={f.issues} onChange={(e) => setF((x) => ({ ...x, issues: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">{ar ? "ملاحظات" : "Comments"}</Label>
            <Textarea rows={2} value={f.comments} onChange={(e) => setF((x) => ({ ...x, comments: e.target.value }))} />
          </div>
          <Button size="sm" disabled={adding.isPending} onClick={() => adding.mutate()}>
            {ar ? "إضافة" : "Add session"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            {ar ? "جلسات مسجلة" : "Recorded sessions"} ({snap.pilots.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {snap.pilots.length === 0 && (
            <p className="text-muted-foreground">
              {ar ? "لا توجد جلسات اختبار بعد — لا تُنشأ نتائج تلقائيًا." : "No testing sessions yet — none are generated automatically."}
            </p>
          )}
          {snap.pilots.map((p) => (
            <div key={p.id} className="flex items-start justify-between gap-2 border-b py-2 last:border-0">
              <div>
                <p className="font-medium">
                  {p.serviceLabel ?? (ar ? "خدمة غير محددة" : "Unspecified service")} · {p.testedOn}
                </p>
                <p className="text-xs text-muted-foreground">
                  {p.participantCount} × {p.participantRole} ·{" "}
                  {p.completedSuccessfully ? (ar ? "اكتملت" : "completed") : ar ? "لم تكتمل" : "not completed"}
                  {p.timeTakenMinutes != null && ` · ${p.timeTakenMinutes} min`}
                  {p.satisfactionRating != null && ` · ${p.satisfactionRating}/5`}
                </p>
                {p.issues && <p className="text-xs text-warning">{p.issues}</p>}
                {p.comments && <p className="text-xs text-muted-foreground">{p.comments}</p>}
              </div>
              <Button variant="ghost" size="icon" onClick={() => removing.mutate(p.id)} aria-label={ar ? "حذف" : "Delete"}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
