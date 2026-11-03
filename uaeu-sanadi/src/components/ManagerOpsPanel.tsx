import { useState } from "react";
import { toastError } from "@/lib/errors/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { decideApprovalFn, decideReopenFn, runScheduledJobFn } from "@/lib/case-ops.functions";

const JOBS = ["sla_sweep", "auto_escalation", "alert_generation", "info_request_reminders", "satisfaction_surveys", "all"] as const;

export function ManagerOpsPanel() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const queueQuery = useQuery({
    queryKey: ["manager-queue"],
    queryFn: async () => {
      const [approvals, reopens] = await Promise.all([
        supabase
          .from("approval_requests")
          .select("id, request_summary, approval_type, risk_level, requested_at, case_id")
          .eq("approval_status", "pending")
          .order("requested_at", { ascending: true })
          .limit(50),
        supabase
          .from("case_reopen_requests")
          .select("id, reason, requested_outcome, created_at, case_id")
          .eq("review_decision", "pending")
          .order("created_at", { ascending: true })
          .limit(50),
      ]);
      return { approvals: approvals.data ?? [], reopens: reopens.data ?? [] };
    },
  });

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      const result = await fn();
      toast.success(typeof result === "object" && result ? (ar ? "تم" : "Done") : (ar ? "تم" : "Done"));
      void qc.invalidateQueries({ queryKey: ["manager-queue"] });
      void qc.invalidateQueries({ queryKey: ["staff-cases"] });
      void qc.invalidateQueries({ queryKey: ["metrics"] });
    } catch (e) {
      toastError(e, lang);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border bg-card p-4 card-shadow">
        <h3 className="text-sm font-semibold">{ar ? "طلبات الموافقة" : "Pending approvals"}</h3>
        <ul className="mt-3 space-y-2">
          {queueQuery.data?.approvals.length ? (
            queueQuery.data.approvals.map((a) => (
              <li key={a.id} className="rounded-lg border bg-surface p-3 text-xs">
                <p className="font-medium">{a.request_summary}</p>
                <p className="mt-1 text-muted-foreground">
                  {a.approval_type} · {a.risk_level ?? "—"} · {new Date(a.requested_at).toLocaleString()}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => act(() => decideApprovalFn({ data: { approvalId: a.id, approve: true } }))}
                  >
                    {ar ? "موافقة" : "Approve"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => act(() => decideApprovalFn({ data: { approvalId: a.id, approve: false } }))}
                  >
                    {ar ? "رفض" : "Reject"}
                  </Button>
                </div>
              </li>
            ))
          ) : (
            <li className="text-xs text-muted-foreground">{ar ? "لا يوجد" : "Nothing pending"}</li>
          )}
        </ul>
      </section>

      <section className="rounded-xl border bg-card p-4 card-shadow">
        <h3 className="text-sm font-semibold">{ar ? "طلبات إعادة الفتح" : "Reopen requests"}</h3>
        <ul className="mt-3 space-y-2">
          {queueQuery.data?.reopens.length ? (
            queueQuery.data.reopens.map((r) => (
              <li key={r.id} className="rounded-lg border bg-surface p-3 text-xs">
                <p className="whitespace-pre-wrap font-medium">{r.reason}</p>
                {r.requested_outcome ? <p className="mt-1 text-muted-foreground">{r.requested_outcome}</p> : null}
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => act(() => decideReopenFn({ data: { reopenId: r.id, approve: true } }))}
                  >
                    {ar ? "إعادة الفتح" : "Reopen"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => act(() => decideReopenFn({ data: { reopenId: r.id, approve: false } }))}
                  >
                    {ar ? "رفض" : "Decline"}
                  </Button>
                </div>
              </li>
            ))
          ) : (
            <li className="text-xs text-muted-foreground">{ar ? "لا يوجد" : "Nothing pending"}</li>
          )}
        </ul>
      </section>

      <section className="rounded-xl border bg-card p-4 card-shadow lg:col-span-2">
        <h3 className="text-sm font-semibold">{ar ? "المهام المجدولة" : "Scheduled jobs"}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {ar ? "تشغيل يدوي آمن للتكرار" : "Manual, idempotent runs for testing and recovery"}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {JOBS.map((job) => (
            <Button
              key={job}
              size="sm"
              variant={job === "all" ? "default" : "outline"}
              disabled={busy}
              onClick={() => act(() => runScheduledJobFn({ data: { job } }))}
            >
              {job.replaceAll("_", " ")}
            </Button>
          ))}
        </div>
      </section>
    </div>
  );
}
