/**
 * Deep-dive panel for one case.
 *
 * Answers the accountability questions in order: who is responsible now, how
 * long have they had it, what happened before, and what can oversight do about
 * it. Oversight actions nudge or move a case — they never resolve it on the
 * owner's behalf, so the audit trail stays honest.
 */
import { useState } from "react";
import { toastError } from "@/lib/errors/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, ArrowUpRight, BellRing, CheckCircle2, Repeat } from "lucide-react";
import {
  getMonitoredCaseFn,
  markResolutionCommunicatedFn,
  recordOversightActionFn,
  type MonitorRow,
  type UnitMonitorRow,
} from "@/lib/monitoring/monitoring.functions";
import { useI18n } from "@/lib/i18n";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ListSelect } from "@/components/list/ListControls";
import { cn } from "@/lib/utils";
import { SLA_LABEL, actorText, duration, slaClasses, typeText } from "./monitoring-format";

export function CaseOversightDrawer({
  row,
  units,
  onClose,
}: {
  row: MonitorRow | null;
  units: UnitMonitorRow[];
  onClose: () => void;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const caseId = row?.id ?? null;

  const [reason, setReason] = useState("");
  const [targetUnit, setTargetUnit] = useState("");

  const fetchDetail = useServerFn(getMonitoredCaseFn);
  const detail = useQuery({
    queryKey: ["monitor-case", caseId],
    queryFn: () => fetchDetail({ data: { caseId: caseId! } }),
    enabled: Boolean(caseId),
  });

  const act = useServerFn(recordOversightActionFn);
  const markCommunicated = useServerFn(markResolutionCommunicatedFn);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["monitor-case", caseId] });
    void qc.invalidateQueries({ queryKey: ["monitor-list"] });
    void qc.invalidateQueries({ queryKey: ["monitor-summary"] });
  };

  const oversight = useMutation({
    mutationFn: (vars: { action: "remind_owner" | "escalate" | "reassign" | "note"; newUnitId?: string }) =>
      act({
        data: {
          caseId: caseId!,
          action: vars.action,
          reason: reason.trim() || undefined,
          ...(vars.newUnitId ? { newUnitId: vars.newUnitId } : {}),
        },
      }),
    onSuccess: (res) => {
      toast[res.ok ? "success" : "warning"](res.message);
      setReason("");
      refresh();
    },
    onError: (e: Error) => toastError(e, lang),
  });

  const closure = useMutation({
    mutationFn: () => markCommunicated({ data: { caseId: caseId! } }),
    onSuccess: () => {
      toast.success(ar ? "تم تأكيد إبلاغ الطالب." : "Closure confirmed as communicated.");
      refresh();
    },
    onError: (e: Error) => toastError(e, lang),
  });

  const d = detail.data;
  const sla = row ? (SLA_LABEL[row.sla_status] ?? { en: row.sla_status, ar: row.sla_status }) : null;

  return (
    <Sheet open={Boolean(row)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={ar ? "left" : "right"} className="w-full overflow-y-auto sm:max-w-xl">
        {row ? (
          <>
            <SheetHeader className="text-start">
              <SheetTitle className="text-base">
                <span className="font-mono text-xs text-muted-foreground"><bdi dir="ltr">{row.case_number}</bdi></span>
                <span className="mt-1 block">{row.title}</span>
              </SheetTitle>
            </SheetHeader>

            <div className="mt-4 space-y-5">
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">{typeText(row.case_type, ar)}</Badge>
                <Badge variant="outline">{row.status.replace(/_/g, " ")}</Badge>
                {sla ? (
                  <Badge variant="outline" className={cn(slaClasses(row.sla_status))}>
                    {ar ? sla.ar : sla.en}
                  </Badge>
                ) : null}
                {row.escalation_unresolved ? (
                  <Badge variant="outline">
                    {ar ? `تصعيد ${row.escalation_level ?? 1}` : `Escalation L${row.escalation_level ?? 1}`}
                  </Badge>
                ) : null}
              </div>

              <dl className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm">
                <Field label={ar ? "المسؤول الآن" : "Responsible now"} value={actorText(row.actor, ar)} />
                <Field label={ar ? "مدة الانتظار" : "Waiting"} value={duration(row.waiting_seconds, ar)} />
                <Field
                  label={ar ? "الوحدة" : "Unit"}
                  value={(ar ? row.unit_name_ar : row.unit_name_en) ?? "—"}
                />
                <Field label={ar ? "الموظف" : "Owner"} value={row.owner_name ?? "—"} />
                <Field
                  label={ar ? "الموعد النهائي" : "SLA due"}
                  value={row.sla_due_at ? new Date(row.sla_due_at).toLocaleString(ar ? "ar" : "en-GB") : "—"}
                />
                <Field
                  label={ar ? "بلا حركة منذ" : "Inactive for"}
                  value={duration(row.inactive_seconds, ar)}
                />
              </dl>

              {row.closure_incomplete ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
                  <div className="flex-1">
                    <p className="font-medium">
                      {ar ? "أُغلقت دون تأكيد إبلاغ الطالب" : "Closed without confirming the student was told"}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      disabled={closure.isPending}
                      onClick={() => closure.mutate()}
                    >
                      <CheckCircle2 className="size-4" aria-hidden />
                      {ar ? "تأكيد الإبلاغ" : "Confirm communicated"}
                    </Button>
                  </div>
                </div>
              ) : null}

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{ar ? "إجراء إشرافي" : "Oversight action"}</h3>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder={ar ? "سبب الإجراء (مطلوب لإعادة الإسناد)" : "Reason (required for reassignment)"}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={oversight.isPending}
                    onClick={() => oversight.mutate({ action: "remind_owner" })}
                  >
                    <BellRing className="size-4" aria-hidden />
                    {ar ? "تذكير المسؤول" : "Remind owner"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={oversight.isPending}
                    onClick={() => oversight.mutate({ action: "escalate" })}
                  >
                    <ArrowUpRight className="size-4" aria-hidden />
                    {ar ? "تصعيد" : "Escalate"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={oversight.isPending || !reason.trim()}
                    onClick={() => oversight.mutate({ action: "note" })}
                  >
                    {ar ? "تسجيل ملاحظة" : "Record note"}
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ListSelect
                    label={ar ? "نقل إلى وحدة" : "Move to unit"}
                    value={targetUnit}
                    options={units
                      .filter((u) => u.unitId)
                      .map((u) => ({ key: u.unitId!, label: ar ? u.unitAr : u.unitEn }))}
                    onChange={setTargetUnit}
                    width="w-[220px]"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={oversight.isPending || !targetUnit || !reason.trim()}
                    onClick={() => oversight.mutate({ action: "reassign", newUnitId: targetUnit })}
                  >
                    <Repeat className="size-4" aria-hidden />
                    {ar ? "إعادة الإسناد" : "Reassign"}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {ar
                    ? "لا يغلق الإشراف الحالات نيابة عن المسؤول؛ يوثَّق كل إجراء في سجل التدقيق."
                    : "Oversight never closes a case on the owner's behalf. Every action is written to the audit trail."}
                </p>
              </section>

              <Separator />

              {detail.isLoading ? (
                <Skeleton className="h-40 rounded-lg" />
              ) : (
                <>
                  <Timeline
                    title={ar ? "سلسلة المسؤولية" : "Responsibility trail"}
                    empty={ar ? "لا يوجد سجل" : "No history yet"}
                    items={(d?.responsibility ?? []).map((h) => ({
                      primary: actorText(h.actor, ar),
                      secondary: `${new Date(h.startedAt).toLocaleString(ar ? "ar" : "en-GB")} · ${duration(h.durationSeconds, ar)}`,
                      note: h.reason,
                    }))}
                  />
                  <Timeline
                    title={ar ? "تنبيهات المدة" : "SLA events"}
                    empty={ar ? "لا توجد تنبيهات" : "No SLA events"}
                    items={(d?.slaEvents ?? []).map((e) => ({
                      primary: e.type.replace(/_/g, " "),
                      secondary: new Date(e.at).toLocaleString(ar ? "ar" : "en-GB"),
                      note: e.action,
                    }))}
                  />
                  <Timeline
                    title={ar ? "إجراءات الإشراف" : "Oversight log"}
                    empty={ar ? "لا توجد إجراءات" : "No oversight actions"}
                    items={(d?.oversight ?? []).map((o) => ({
                      primary: o.type.replace(/_/g, " "),
                      secondary: new Date(o.at).toLocaleString(ar ? "ar" : "en-GB"),
                      note: o.reason,
                    }))}
                  />
                </>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{value}</dd>
    </div>
  );
}

function Timeline({
  title,
  items,
  empty,
}: {
  title: string;
  empty: string;
  items: { primary: string; secondary: string; note?: string | null }[];
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ol className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="rounded-md border p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium capitalize">{it.primary}</span>
                <span className="text-muted-foreground">{it.secondary}</span>
              </div>
              {it.note ? <p className="mt-0.5 text-muted-foreground">{it.note}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
