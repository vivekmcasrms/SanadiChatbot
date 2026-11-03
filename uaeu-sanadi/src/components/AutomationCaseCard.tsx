import { useState } from "react";
import { toastError } from "@/lib/errors/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bot, Pause, Play, PencilLine, Send, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/StatusChip";
import { useI18n } from "@/lib/i18n";
import {
  getCaseAutomationFn,
  prepareDraftFn,
  sendDraftFn,
  setAutomationPauseFn,
} from "@/lib/automation.functions";

export type AutomationState = {
  ai_status: string;
  attention_category: string | null;
  attention_reason_en: string | null;
  attention_reason_ar: string | null;
  next_action_en: string | null;
  next_action_ar: string | null;
  next_action_at: string | null;
  automation_paused: boolean;
  pause_reason: string | null;
  reminders_sent: number;
  last_automated_at: string | null;
} | null;

export type AutomationCase = {
  id: string;
  case_number: string;
  title: string;
  status: string;
  urgency: string;
  resolution_due_at: string | null;
  automation: AutomationState;
};

const AI_STATUS_LABEL: Record<string, { en: string; ar: string }> = {
  managing_automatically: { en: "AI managing", ar: "الذكاء الاصطناعي يدير" },
  waiting_for_student: { en: "Waiting for student", ar: "بانتظار الطالب" },
  preparing_follow_up: { en: "Preparing follow-up", ar: "إعداد المتابعة" },
  sla_monitoring: { en: "SLA monitoring", ar: "مراقبة مستوى الخدمة" },
  human_decision_needed: { en: "Your decision needed", ar: "يتطلب قرارك" },
  approval_needed: { en: "Approval needed", ar: "يتطلب اعتماداً" },
  automation_paused: { en: "Automation paused", ar: "الأتمتة متوقفة" },
  completed: { en: "Completed", ar: "مكتمل" },
};

/** One case row in the Service Owner console: AI status, the AI's next action, and human controls. */
export function AutomationCaseCard({ item }: { item: AutomationCase }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [original, setOriginal] = useState("");
  const [pauseReason, setPauseReason] = useState("");

  const timeline = useQuery({
    queryKey: ["case-automation", item.id],
    enabled: open,
    queryFn: () => getCaseAutomationFn({ data: { caseId: item.id } }),
  });

  const prepare = useMutation({
    mutationFn: () => prepareDraftFn({ data: { caseId: item.id } }),
    onSuccess: (r) => {
      setDraft(r.draft);
      setOriginal(r.draft);
    },
    onError: (e: Error) => toastError(e, lang),
  });

  const send = useMutation({
    mutationFn: () => sendDraftFn({ data: { caseId: item.id, originalDraft: original, finalText: draft ?? "" } }),
    onSuccess: (r) => {
      setDraft(null);
      toast.success(r.edited ? (ar ? "تم الإرسال وحُفظ تعديلك" : "Sent — your edit was recorded") : ar ? "تم الإرسال" : "Sent");
      void qc.invalidateQueries({ queryKey: ["owner-console"] });
    },
    onError: (e: Error) => toastError(e, lang),
  });

  const pause = useMutation({
    mutationFn: (next: boolean) =>
      setAutomationPauseFn({ data: { caseId: item.id, pause: next, reason: pauseReason } }),
    onSuccess: () => {
      setPauseReason("");
      void qc.invalidateQueries({ queryKey: ["owner-console"] });
    },
    onError: (e: Error) => toastError(e, lang),
  });

  const st = item.automation;
  const attention = st?.attention_category;
  const reason = ar ? st?.attention_reason_ar : st?.attention_reason_en;
  const next = ar ? st?.next_action_ar : st?.next_action_en;

  return (
    <article className="card-shadow rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/requests/$caseId" params={{ caseId: item.id }} className="font-medium hover:underline">
              {item.title}
            </Link>
            <span className="text-xs text-muted-foreground tabular-nums"><bdi dir="ltr">{item.case_number}</bdi></span>
            <StatusChip status={item.status} />
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Bot className="size-3.5 text-primary" aria-hidden />
            {AI_STATUS_LABEL[st?.ai_status ?? "managing_automatically"]?.[ar ? "ar" : "en"]}
            {next ? ` · ${next}` : ""}
          </p>
          {attention ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-destructive">
              <ShieldAlert className="size-3.5" aria-hidden />
              {reason ?? attention.replace(/_/g, " ")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {st?.automation_paused ? (
            <Badge variant="outline">{ar ? "الأتمتة متوقفة" : "Automation paused"}</Badge>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
            {ar ? "ما الذي فعله الذكاء الاصطناعي" : "What the AI did"}
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => prepare.mutate()} disabled={prepare.isPending}>
            <PencilLine className="size-3.5" aria-hidden />
            {ar ? "مسودة رد" : "Draft reply"}
          </Button>
          <Button
            size="sm"
            variant={st?.automation_paused ? "default" : "ghost"}
            className="gap-1.5"
            onClick={() => pause.mutate(!st?.automation_paused)}
            disabled={pause.isPending}
          >
            {st?.automation_paused ? <Play className="size-3.5" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}
            {st?.automation_paused ? (ar ? "استئناف" : "Resume") : ar ? "إيقاف" : "Pause"}
          </Button>
        </div>
      </div>

      {!st?.automation_paused ? (
        <Input
          value={pauseReason}
          onChange={(e) => setPauseReason(e.target.value)}
          placeholder={ar ? "سبب إيقاف الأتمتة (اختياري)" : "Reason for pausing automation (optional)"}
          className="mt-3 h-8 text-xs"
        />
      ) : st.pause_reason ? (
        <p className="mt-2 text-xs text-muted-foreground">{st.pause_reason}</p>
      ) : null}

      {draft !== null ? (
        <div className="mt-3 space-y-2 rounded-lg border bg-secondary/40 p-3">
          <p className="text-xs text-muted-foreground">
            {ar ? "مسودة أعدها الذكاء الاصطناعي — راجعها قبل الإرسال" : "AI-prepared draft — review before sending"}
          </p>
          <Textarea rows={7} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" className="gap-1.5" onClick={() => send.mutate()} disabled={send.isPending}>
              <Send className="size-3.5" aria-hidden />
              {ar ? "إرسال للطالب" : "Send to student"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              {ar ? "إلغاء" : "Cancel"}
            </Button>
          </div>
        </div>
      ) : null}

      {open ? (
        <ol className="mt-3 space-y-1.5 border-t pt-3 text-xs">
          {(timeline.data?.events ?? []).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 text-muted-foreground">
              <span className="tabular-nums">{new Date(e.created_at).toLocaleString()}</span>
              <Badge variant="secondary" className="font-normal">
                {e.actor_type === "ai" ? (ar ? "ذكاء اصطناعي" : "AI") : ar ? "بشري" : "Human"}
              </Badge>
              <span className="text-foreground">{(ar ? e.summary_ar : e.summary_en) ?? e.action_key}</span>
              {e.rule_used ? <span className="opacity-70">· {e.rule_used}</span> : null}
            </li>
          ))}
          {timeline.isLoading ? <li className="text-muted-foreground">…</li> : null}
          {!timeline.isLoading && !(timeline.data?.events ?? []).length ? (
            <li className="text-muted-foreground">{ar ? "لا توجد أحداث بعد." : "No automation events yet."}</li>
          ) : null}
        </ol>
      ) : null}
    </article>
  );
}