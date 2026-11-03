import { useState } from "react";
import { toastError } from "@/lib/errors/toast";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bot, Clock, MessageSquare, User } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { StatusChip } from "@/components/StatusChip";
import { MetricCard } from "@/components/MetricCard";
import { getOwnerOperationsFn, reportKnowledgeIssueFn } from "@/lib/automation.functions";
import { getOwnerUnitOperationsFn } from "@/lib/owner.functions";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Ops = Awaited<ReturnType<typeof getOwnerOperationsFn>>;
type Item = Ops["items"][number];

/** Scoped to one service unit when the owner has selected a workspace. */
function useOwnerOps(enabled: boolean, unitId?: string | null) {
  const auth = useAuth();
  return useQuery({
    queryKey: ["owner-operations", unitId ?? "all"],
    enabled: enabled && Boolean(auth.user),
    retry: false,
    queryFn: () => getOwnerUnitOperationsFn({ data: { unitId: unitId ?? null } }),
  });
}

const RESPONSIBLE: Record<Item["responsible"], { en: string; ar: string; icon: typeof Bot }> = {
  ai: { en: "Sanadi AI", ar: "سندي", icon: Bot },
  owner: { en: "You", ar: "أنت", icon: User },
  student: { en: "Student", ar: "الطالب", icon: MessageSquare },
  external: { en: "External party", ar: "جهة خارجية", icon: Clock },
};

const SLA_TONE: Record<Item["slaState"], string> = {
  breached: "bg-destructive/10 text-destructive border-destructive/30",
  critical: "bg-destructive/5 text-destructive border-destructive/20",
  attention: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400",
  on_track: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
  none: "bg-muted text-muted-foreground",
};

const SLA_LABEL: Record<Item["slaState"], { en: string; ar: string }> = {
  breached: { en: "Breached", ar: "متجاوز" },
  critical: { en: "Critical", ar: "حرج" },
  attention: { en: "Attention", ar: "يحتاج متابعة" },
  on_track: { en: "On track", ar: "ضمن المدة" },
  none: { en: "No SLA", ar: "بدون مدة" },
};

function OpsRow({ item }: { item: Item }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const R = RESPONSIBLE[item.responsible];
  const Icon = R.icon;
  return (
    <div className="rounded-lg border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{item.caseNumber}</span>
        <span className="min-w-0 flex-1 truncate">{item.title}</span>
        <StatusChip status={item.status} />
        <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", SLA_TONE[item.slaState])}>
          {ar ? SLA_LABEL[item.slaState].ar : SLA_LABEL[item.slaState].en}
          {item.slaHours != null ? ` · ${Math.abs(Math.round(item.slaHours))}${ar ? "س" : "h"}` : ""}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{item.studentName ?? (ar ? "طالب" : "Student")}</span>
        <span>{(ar ? item.unitNameAr : item.unitNameEn) ?? "—"}</span>
        <span className="flex items-center gap-1">
          <Icon className="size-3.5" aria-hidden />
          {ar ? R.ar : R.en}
        </span>
        {item.nextActionEn ? <span>→ {ar ? (item.nextActionAr ?? item.nextActionEn) : item.nextActionEn}</span> : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <Link to="/requests/$caseId" params={{ caseId: item.id }}>
            {ar ? "فتح الحالة" : "Open case"}
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Section({ title, items }: { title: string; items: Item[] }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="min-w-0 flex-1">{title}</span>
          <Badge variant={items.length ? "default" : "secondary"}>{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length ? (
          items.slice(0, 15).map((i) => <OpsRow key={i.id} item={i} />)
        ) : (
          <p className="text-xs text-muted-foreground">{ar ? "لا شيء هنا حالياً." : "Nothing here right now."}</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Exception-first follow-up list for the owner's own service unit. */
export function OwnerFollowUpPanel({ enabled, unitId }: { enabled: boolean; unitId?: string | null }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { data, isLoading } = useOwnerOps(enabled, unitId);
  if (isLoading) return <p className="text-sm text-muted-foreground">…</p>;
  const f = data?.followUp;
  return (
    <div className="space-y-3">
      <Section title={ar ? "يحتاج إجراءً منك" : "Needs your action"} items={f?.needsOwnerAction ?? []} />
      <Section title={ar ? "متأخرة" : "Overdue"} items={f?.overdue ?? []} />
      <Section title={ar ? "مستحقة اليوم" : "Due today"} items={f?.dueToday ?? []} />
      <Section title={ar ? "بانتظار الطالب" : "Waiting for student"} items={f?.waitingStudent ?? []} />
      <Section title={ar ? "بانتظار جهة خارجية" : "Waiting for external party"} items={f?.waitingExternal ?? []} />
      <Section title={ar ? "متابعة مجدولة بالذكاء الاصطناعي" : "AI follow-up scheduled"} items={f?.aiScheduled ?? []} />
    </div>
  );
}

/** Actionable SLA view: breached and at-risk cases, and who owns the next move. */
export function OwnerSlaPanel({ enabled, unitId }: { enabled: boolean; unitId?: string | null }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { data, isLoading } = useOwnerOps(enabled, unitId);
  if (isLoading) return <p className="text-sm text-muted-foreground">…</p>;
  const s = data?.sla;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label={ar ? "متجاوزة المدة" : "Breached"} value={s?.breached.length ?? 0} tone={(s?.breached.length ?? 0) > 0 ? "danger" : "success"} />
        <MetricCard label={ar ? "حرجة" : "Critical"} value={s?.critical.length ?? 0} />
        <MetricCard label={ar ? "ضمن المدة" : "On track"} value={s?.onTrack ?? 0} tone="success" />
        <MetricCard
          label={ar ? "يعالجها الذكاء الاصطناعي" : "Handled by AI"}
          value={s?.aiHandled ?? 0}
          hint={`${s?.humanNeeded ?? 0} ${ar ? "تحتاج تدخلك" : "need you"}`}
        />
      </div>
      <Section title={ar ? "حالات متجاوزة للمدة" : "Breached cases"} items={s?.breached ?? []} />
      <Section title={ar ? "تقترب من التجاوز" : "Approaching breach"} items={[...(s?.critical ?? []), ...(s?.attention ?? [])]} />
      <Section title={ar ? "التصعيدات" : "Escalations"} items={data?.escalations ?? []} />
    </div>
  );
}

/** Service staff can flag knowledge problems without knowledge-admin rights. */
export function KnowledgeIssueButton() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const report = useMutation({
    mutationFn: () => reportKnowledgeIssueFn({ data: { issueType: "suggested_update", description: text } }),
    onSuccess: () => {
      toast.success(ar ? "تم إرسال الطلب إلى فريق المعرفة" : "Sent to the Knowledge team");
      setText("");
      setOpen(false);
    },
    onError: (e: Error) => toastError(e, lang),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <AlertTriangle className="size-4" aria-hidden />
          {ar ? "اقتراح تحديث معرفي" : "Suggest knowledge update"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ar ? "اقتراح تحديث معرفي" : "Suggest a knowledge update"}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {ar
            ? "يصل طلبك إلى مدير المعرفة للمراجعة والاعتماد؛ لا يغيّر المحتوى مباشرة."
            : "Your request goes to the Knowledge Manager for review — it does not change published content directly."}
        </p>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={ar ? "صف المعلومة غير الصحيحة أو الناقصة…" : "Describe the incorrect or missing policy information…"}
        />
        <DialogFooter>
          <Button size="sm" disabled={text.trim().length < 10 || report.isPending} onClick={() => report.mutate()}>
            {ar ? "إرسال" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
