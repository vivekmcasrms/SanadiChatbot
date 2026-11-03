import { refreshCaseViews } from "@/lib/case-refresh";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bot, Briefcase, Lock, MessageSquare, Send, ShieldCheck, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusChip } from "@/components/StatusChip";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import {
  addCaseNoteFn,
  getCaseDossierFn,
  ownerChangePlacementFn,
  ownerReopenCaseFn,
  sendCaseMessageFn,
  setConversationStatusFn,
  setOwnerCaseStatusFn,
} from "@/lib/case-dossier.functions";

const CASE_STATUSES = [
  ["submitted", "New", "جديدة"],
  ["ai_processing", "AI processing", "معالجة بالذكاء الاصطناعي"],
  ["in_progress", "In progress", "قيد العمل"],
  ["awaiting_student", "Waiting for student", "بانتظار الطالب"],
  ["waiting_external", "Waiting for external party", "بانتظار جهة خارجية"],
  ["placement_allocated", "Placement allocated", "تم تخصيص التدريب"],
  ["resolved", "Resolved", "تم الحل"],
  ["closed", "Closed", "مغلقة"],
  ["reopened", "Reopened", "أعيد فتحها"],
  ["escalated", "Escalated", "مصعّدة"],
] as const;

const CONV_STATUSES = [
  ["active", "Active", "نشطة"],
  ["waiting_student", "Waiting for student", "بانتظار الطالب"],
  ["waiting_staff", "Waiting for staff", "بانتظار الموظف"],
  ["resolved", "Resolved", "تم الحل"],
  ["closed", "Closed", "مغلقة"],
] as const;

const ACTOR_ICON = { student: User, ai: Bot, owner: ShieldCheck, system: MessageSquare } as const;
const ACTOR_LABEL = {
  student: ["Student", "الطالب"],
  ai: ["Sanadi AI", "سندي الذكي"],
  owner: ["Service Owner", "مالك الخدمة"],
  system: ["System", "النظام"],
} as const;

function msg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** Service-owner dossier: linked complaint, internship outcome, unified timeline and case actions. */
export function CaseDossierPanel({ caseId }: { caseId: string }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const fetchDossier = useServerFn(getCaseDossierFn);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<string>("");
  const [statusNote, setStatusNote] = useState("");
  const [reopen, setReopen] = useState("");
  const [newOpp, setNewOpp] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [showInternal, setShowInternal] = useState(true);

  const q = useQuery({
    queryKey: ["case-dossier", caseId],
    queryFn: () => fetchDossier({ data: { caseId } }),
  });

  useEffect(() => {
    const channel = supabase
      .channel(`case-live-${caseId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cases", filter: `id=eq.${caseId}` }, () =>
        qc.invalidateQueries({ queryKey: ["case-dossier", caseId] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "case_comments", filter: `case_id=eq.${caseId}` },
        () => qc.invalidateQueries({ queryKey: ["case-dossier", caseId] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "case_status_history", filter: `case_id=eq.${caseId}` },
        () => qc.invalidateQueries({ queryKey: ["case-dossier", caseId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [caseId, qc]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
      toast.success(ar ? "تم" : "Done");
    } catch (e) {
      toast.error(msg(e));
    } finally {
      await refreshCaseViews(qc, caseId);
      setBusy(null);
    }
  }

  if (q.isLoading) return <p className="text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>;
  if (q.isError) return <p className="text-sm text-destructive">{msg(q.error)}</p>;
  const d = q.data;
  if (!d) return null;

  const a = d.assignment as
    | (Record<string, unknown> & {
        id: string;
        assignment_number: string;
        assignment_status: string;
        match_score: number | null;
        assigned_at: string | null;
        internship_opportunities: { title_en: string; title_ar: string; location_emirate: string | null; work_mode: string | null } | null;
        internship_organizations: { name_en: string; name_ar: string } | null;
        internship_match_explanations: { explanation_en: string | null; explanation_ar: string | null } | null;
      })
    | null;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{ar ? "ملف الحالة الموحّد" : "Unified case dossier"}</h3>
          <StatusChip status={String(d.case.status)} />
          {d.case.outcome_en ? (
            <span className="rounded-full bg-success/12 px-2.5 py-0.5 text-xs font-semibold text-success">
              {ar ? "النتيجة" : "Outcome"}: {ar ? (d.case.outcome_ar ?? d.case.outcome_en) : d.case.outcome_en}
            </span>
          ) : null}
        </div>
        <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">{ar ? "الطالب" : "Student"}</dt>
            <dd className="font-medium">
              {d.student.name} {d.student.studentNumber ? `· ${d.student.studentNumber}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{ar ? "البرنامج" : "Programme"}</dt>
            <dd className="font-medium">{d.student.programme ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{ar ? "تاريخ التقديم" : "Submitted"}</dt>
            <dd className="font-medium">{new Date(String(d.case.created_at)).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{ar ? "المسؤول" : "Assigned to"}</dt>
            <dd className="font-medium">{d.assignedToName ?? "—"}</dd>
          </div>
        </dl>
        <p className="mt-3 whitespace-pre-wrap text-sm">{String(d.case.description ?? "")}</p>
        {d.case.ai_summary ? (
          <p className="mt-3 rounded-lg bg-surface p-3 text-xs text-muted-foreground">
            <Bot className="me-1 inline size-3.5" aria-hidden />
            {ar ? "تصنيف وتوجيه الذكاء الاصطناعي" : "AI classification and routing"}: {String(d.case.ai_summary)}
            {d.case.ai_confidence ? ` (${Math.round(Number(d.case.ai_confidence) * 100)}%)` : ""}
          </p>
        ) : null}
      </section>

      {a ? (
        <section className="rounded-xl border border-success/40 bg-success/5 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Briefcase className="size-4 text-success" aria-hidden />
            {ar ? "النتيجة: تم تخصيص فرصة تدريب" : "Outcome: Internship Placement Allocated"}
          </h3>
          <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">{ar ? "الجهة" : "Organization"}</dt>
              <dd className="font-medium">
                {ar ? (a.internship_organizations?.name_ar ?? "—") : (a.internship_organizations?.name_en ?? "—")}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{ar ? "الدور" : "Role"}</dt>
              <dd className="font-medium">
                {ar ? (a.internship_opportunities?.title_ar ?? "—") : (a.internship_opportunities?.title_en ?? "—")}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{ar ? "الموقع" : "Location"}</dt>
              <dd className="font-medium">{a.internship_opportunities?.location_emirate ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{ar ? "رقم التكليف" : "Assignment number"}</dt>
              <dd className="font-medium">{a.assignment_number}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{ar ? "تاريخ التكليف" : "Assignment date"}</dt>
              <dd className="font-medium">{a.assigned_at ? new Date(a.assigned_at).toLocaleString() : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{ar ? "درجة المطابقة" : "Match score"}</dt>
              <dd className="font-medium">{a.match_score ?? "—"}%</dd>
            </div>
          </dl>
          {a.internship_match_explanations ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {ar
                ? (a.internship_match_explanations.explanation_ar ?? a.internship_match_explanations.explanation_en)
                : a.internship_match_explanations.explanation_en}
            </p>
          ) : null}

          <div className="mt-3 space-y-2 border-t pt-3">
            <Label className="text-xs">{ar ? "تغيير التدريب (آمن للمقاعد)" : "Change placement (seat-safe)"}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={newOpp} onValueChange={setNewOpp}>
                <SelectTrigger className="h-9 w-full max-w-sm">
                  <SelectValue placeholder={ar ? "اختر فرصة بديلة" : "Select an alternative placement"} />
                </SelectTrigger>
                <SelectContent>
                  {(d.alternatives ?? []).map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {(ar ? o.title_ar : o.title_en) ?? o.opportunity_code} — {o.available_seats}{" "}
                      {ar ? "مقعد" : "seats"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea
                rows={1}
                className="max-w-sm"
                value={changeReason}
                onChange={(e) => setChangeReason(e.target.value)}
                placeholder={ar ? "سبب التغيير" : "Reason for the change"}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null || !newOpp || changeReason.trim().length < 5}
                onClick={() =>
                  run("placement", () =>
                    ownerChangePlacementFn({
                      data: {
                        caseId,
                        assignmentId: a.id,
                        newOpportunityId: newOpp,
                        reason: changeReason.trim(),
                      },
                    }).then(() => {
                      setNewOpp("");
                      setChangeReason("");
                    }),
                  )
                }
              >
                {ar ? "تغيير التدريب" : "Change placement"}
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2 rounded-xl border bg-card p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Lock className="size-4" aria-hidden />
            {ar ? "ملاحظة داخلية (غير مرئية للطالب)" : "Internal note (not visible to the student)"}
          </h3>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button
            size="sm"
            disabled={busy !== null || note.trim().length < 2}
            onClick={() => run("note", () => addCaseNoteFn({ data: { caseId, body: note.trim() } }).then(() => setNote("")))}
          >
            {ar ? "إضافة ملاحظة" : "Add note"}
          </Button>
        </div>

        <div className="space-y-2 rounded-xl border bg-card p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Send className="size-4" aria-hidden />
            {ar ? "رسالة إلى الطالب" : "Message to the student"}
          </h3>
          <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
          <Button
            size="sm"
            disabled={busy !== null || message.trim().length < 2}
            onClick={() =>
              run("message", () =>
                sendCaseMessageFn({ data: { caseId, body: message.trim() } }).then(() => setMessage("")),
              )
            }
          >
            {ar ? "إرسال إلى الطالب" : "Send to student"}
          </Button>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2 rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold">{ar ? "حالة الطلب" : "Case status"}</h3>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9" aria-label={ar ? "الحالة الجديدة للطلب" : "New request status"}>
              <SelectValue placeholder={ar ? "اختر الحالة" : "Select a status"} />
            </SelectTrigger>
            <SelectContent>
              {CASE_STATUSES.map(([value, en, arLabel]) => (
                <SelectItem key={value} value={value}>
                  {ar ? arLabel : en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            rows={2}
            value={statusNote}
            onChange={(e) => setStatusNote(e.target.value)}
            placeholder={ar ? "ملاحظة على التغيير (اختياري)" : "Note about this change (optional)"}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy !== null || !status}
              onClick={() =>
                run("status", () =>
                  setOwnerCaseStatusFn({
                    data: {
                      caseId,
                      status: status as "resolved",
                      ...(statusNote.trim() ? { note: statusNote.trim() } : {}),
                    },
                  }).then(() => setStatusNote("")),
                )
              }
            >
              {ar ? "تحديث الحالة" : "Update status"}
            </Button>
          </div>
          <div className="space-y-2 border-t pt-3">
            <Label className="text-xs">{ar ? "إعادة فتح الحالة" : "Reopen case"}</Label>
            <Textarea rows={2} value={reopen} onChange={(e) => setReopen(e.target.value)} />
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null || reopen.trim().length < 5}
              onClick={() =>
                run("reopen", () =>
                  ownerReopenCaseFn({ data: { caseId, reason: reopen.trim() } }).then(() => setReopen("")),
                )
              }
            >
              {ar ? "إعادة الفتح" : "Reopen"}
            </Button>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold">{ar ? "حالة المحادثة" : "Conversation status"}</h3>
          <p className="text-xs text-muted-foreground">
            {d.conversation
              ? `${d.conversation.title ?? ""} — ${d.conversation.conversation_status}`
              : ar
                ? "لا توجد محادثة مرتبطة"
                : "No linked conversation"}
          </p>
          <div className="flex flex-wrap gap-2">
            {CONV_STATUSES.map(([value, en, arLabel]) => (
              <Button
                key={value}
                size="sm"
                variant="outline"
                disabled={busy !== null || !d.conversation}
                onClick={() => run(`conv-${value}`, () => setConversationStatusFn({ data: { caseId, status: value } }))}
              >
                {ar ? arLabel : en}
              </Button>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-2 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{ar ? "الجدول الزمني الموحّد" : "Unified timeline"}</h3>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="size-4 accent-[hsl(var(--primary))]"
              checked={showInternal}
              onChange={(e) => setShowInternal(e.target.checked)}
            />
            {ar ? "إظهار الملاحظات الداخلية" : "Show internal notes"}
          </label>
        </div>
        <ol className="space-y-3">
          {(d.timeline ?? [])
            .filter((e) => showInternal || !e.internal)
            .map((e) => {
              const Icon = ACTOR_ICON[e.actor] ?? MessageSquare;
              return (
                <li key={e.id} className="flex items-start gap-3 text-sm">
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-medium capitalize">{e.title}</span>
                      <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-muted-foreground">
                        {ar ? ACTOR_LABEL[e.actor][1] : ACTOR_LABEL[e.actor][0]}
                        {e.actorName ? ` · ${e.actorName}` : ""}
                      </span>
                      {e.internal ? (
                        <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] text-warning-foreground">
                          {ar ? "داخلي" : "Internal"}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">{new Date(e.at).toLocaleString()}</p>
                    {e.detail ? <p className="mt-1 whitespace-pre-wrap text-xs">{e.detail}</p> : null}
                  </div>
                </li>
              );
            })}
          {!(d.timeline ?? []).length ? (
            <li className="text-xs text-muted-foreground">{ar ? "لا توجد أحداث بعد." : "No events yet."}</li>
          ) : null}
        </ol>
      </section>
    </div>
  );
}
