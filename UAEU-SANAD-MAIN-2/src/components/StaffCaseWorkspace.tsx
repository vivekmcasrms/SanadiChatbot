import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { CaseDossierPanel } from "@/components/CaseDossierPanel";
import {
  acknowledgeCaseFn,
  assignCaseFn,
  escalateCaseFn,
  proposeResolutionFn,
  requestInformationFn,
  routeCaseFn,
  setCaseMeetingFn,
  clearCaseMeetingFn,
} from "@/lib/case-ops.functions";
import { formatMeetingWhen, MEETING_MODE_LABEL } from "@/components/CaseMeetingCard";

function msg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export function StaffCaseWorkspace({ caseId }: { caseId: string }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [ackNote, setAckNote] = useState("");
  const [info, setInfo] = useState("");
  const [infoDays, setInfoDays] = useState("5");
  const [summary, setSummary] = useState("");
  const [remedy, setRemedy] = useState("");
  const [needsApproval, setNeedsApproval] = useState(false);
  const [escalation, setEscalation] = useState("");
  const [meetDate, setMeetDate] = useState("");
  const [meetTime, setMeetTime] = useState("");
  const [meetMode, setMeetMode] = useState<"in_person" | "online" | "phone">("in_person");
  const [meetPlace, setMeetPlace] = useState("");
  const [meetNote, setMeetNote] = useState("");
  const [viewer, setViewer] = useState<{
    url: string;
    name: string;
    mime: string | null;
  } | null>(null);

  const opsQuery = useQuery({
    queryKey: ["case-ops", caseId],
    queryFn: async () => {
      const [c, infoReqs, resolutions] = await Promise.all([
        supabase
          .from("cases")
          .select(
            "id, status, sla_state, escalation_level, first_response_due_at, resolution_due_at, sla_paused_at, assigned_to, next_action_en, next_action_ar, meeting_at, meeting_mode, meeting_location, meeting_note",
          )
          .eq("id", caseId)
          .maybeSingle(),
        supabase
          .from("case_information_requests")
          .select("id, information_required, status, due_at, response_note, responded_at")
          .eq("case_id", caseId)
          .order("created_at", { ascending: false }),
        supabase
          .from("case_resolutions")
          .select(
            "id, resolution_summary_en, resolution_type, manager_approval_required, approved_at, proposed_to_student_at, student_response, finalized_at",
          )
          .eq("case_id", caseId)
          .order("created_at", { ascending: false }),
      ]);
      return {
        case: c.data,
        infoRequests: infoReqs.data ?? [],
        resolutions: resolutions.data ?? [],
      };
    },
  });

  const evidenceQuery = useQuery({
    queryKey: ["case-evidence", caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("case_evidence")
        .select("id, file_name, storage_path, mime_type, size_bytes, created_at")
        .eq("case_id", caseId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function openEvidence(path: string) {
    const { data, error } = await supabase.storage
      .from("case-evidence")
      .createSignedUrl(path, 600);
    if (error || !data) {
      toast.error(msg(error));
      return;
    }
    return data.signedUrl;
  }

  async function viewEvidence(f: { storage_path: string; file_name: string; mime_type: string | null }) {
    const url = await openEvidence(f.storage_path);
    if (!url) return;
    setViewer({ url, name: f.file_name, mime: f.mime_type });
  }

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
      toast.success(ar ? "تم" : "Done");
      void qc.invalidateQueries({ queryKey: ["case-ops", caseId] });
      void qc.invalidateQueries({ queryKey: ["staff-cases"] });
      void qc.invalidateQueries({ queryKey: ["metrics"] });
    } catch (e) {
      toast.error(msg(e));
    } finally {
      setBusy(null);
    }
  }

  const c = opsQuery.data?.case;

  return (
    <div className="space-y-4">
      <Dialog open={viewer !== null} onOpenChange={(o) => !o && setViewer(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="truncate text-sm">{viewer?.name}</DialogTitle>
          </DialogHeader>
          <div className="h-[60vh] w-full overflow-auto rounded-lg border bg-surface sm:h-[70vh]">
            {viewer ? (
              viewer.mime?.startsWith("image/") ? (
                <img src={viewer.url} alt={viewer.name} className="mx-auto max-h-full" />
              ) : (
                <iframe
                  src={viewer.url}
                  title={viewer.name}
                  className="h-full w-full"
                />
              )
            ) : null}
          </div>
          {viewer ? (
            <a
              href={viewer.url}
              download={viewer.name}
              className="text-xs text-primary underline"
            >
              {ar ? "تنزيل المستند" : "Download document"}
            </a>
          ) : null}
        </DialogContent>
      </Dialog>
      <CaseDossierPanel caseId={caseId} />
      <section className="rounded-xl border bg-surface p-4">
        <h3 className="text-sm font-semibold">{ar ? "مستوى الخدمة" : "Service level"}</h3>
        <dl className="mt-2 grid gap-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">{ar ? "حالة الاتفاقية" : "SLA state"}</dt>
            <dd className="font-medium">{c?.sla_state ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{ar ? "موعد أول رد" : "First response due"}</dt>
            <dd className="font-medium">
              {c?.first_response_due_at ? new Date(c.first_response_due_at).toLocaleString() : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{ar ? "موعد الحل" : "Resolution due"}</dt>
            <dd className="font-medium">
              {c?.resolution_due_at ? new Date(c.resolution_due_at).toLocaleString() : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{ar ? "مستوى التصعيد" : "Escalation level"}</dt>
            <dd className="font-medium">{c?.escalation_level ?? 0}</dd>
          </div>
        </dl>
        {c?.sla_paused_at ? (
          <p className="mt-2 text-xs text-warning-foreground">
            {ar ? "الاتفاقية موقوفة بانتظار الطالب" : "SLA paused while awaiting the student"}
          </p>
        ) : null}
      </section>

      <section className="space-y-2 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">
          {ar ? "مستندات الطالب المرفقة" : "Student documents"}
        </h3>
        {evidenceQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>
        ) : evidenceQuery.data?.length ? (
          <ul className="space-y-2">
            {evidenceQuery.data.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border bg-surface p-2 text-xs"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{f.file_name}</span>
                <span className="text-muted-foreground">
                  {f.size_bytes ? `${Math.round(Number(f.size_bytes) / 1024)} KB` : ""}
                </span>
                <Button size="sm" variant="outline" onClick={() => void viewEvidence(f)}>
                  {ar ? "عرض المستند" : "View document"}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            {ar ? "لا توجد مستندات مرفقة." : "No documents attached."}
          </p>
        )}
      </section>

      <section className="space-y-2 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">{ar ? "إجراءات سريعة" : "Quick actions"}</h3>
        <Textarea
          rows={2}
          value={ackNote}
          onChange={(e) => setAckNote(e.target.value)}
          placeholder={ar ? "ملاحظة اختيارية" : "Optional note"}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              run("ack", () =>
                acknowledgeCaseFn({ data: { caseId, note: ackNote.trim() || undefined } }).then(() => setAckNote("")),
              )
            }
          >
            {ar ? "إشعار بالاستلام" : "Acknowledge"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => run("assign", () => assignCaseFn({ data: { caseId, note: ackNote.trim() || undefined } }))}
          >
            {ar ? "إسناد لي" : "Assign to me"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => run("route", () => routeCaseFn({ data: { caseId } }))}
          >
            {ar ? "توجيه تلقائي" : "Auto-route"}
          </Button>
        </div>
      </section>

      <section className="space-y-2 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">{ar ? "طلب معلومات من الطالب" : "Request information"}</h3>
        <Textarea
          rows={2}
          value={info}
          onChange={(e) => setInfo(e.target.value)}
          placeholder={ar ? "ما المعلومات المطلوبة؟" : "What information is required?"}
        />
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs">{ar ? "مهلة (أيام)" : "Due in (days)"}</Label>
            <Input
              className="w-24"
              value={infoDays}
              onChange={(e) => setInfoDays(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <Button
            size="sm"
            disabled={busy !== null || info.trim().length < 5}
            onClick={() =>
              run("info", () =>
                requestInformationFn({
                  data: {
                    caseId,
                    informationRequired: info.trim(),
                    dueInDays: Math.min(60, Math.max(1, Number(infoDays) || 5)),
                    pausesSla: true,
                  },
                }).then(() => setInfo("")),
              )
            }
          >
            {ar ? "إرسال الطلب" : "Send request"}
          </Button>
        </div>
        {opsQuery.data?.infoRequests.length ? (
          <ul className="space-y-2 pt-2">
            {opsQuery.data.infoRequests.map((r) => (
              <li key={r.id} className="rounded-lg border bg-surface p-3 text-xs">
                <p className="font-medium">{r.information_required}</p>
                <p className="mt-1 text-muted-foreground">
                  {r.status}
                  {r.due_at ? ` · ${new Date(r.due_at).toLocaleDateString()}` : ""}
                </p>
                {r.response_note ? <p className="mt-1 whitespace-pre-wrap">{r.response_note}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-2 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">{ar ? "اقتراح الحل" : "Propose resolution"}</h3>
        <Textarea
          rows={3}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder={ar ? "ملخص الحل للطالب" : "Resolution summary for the student"}
        />
        <Textarea
          rows={2}
          value={remedy}
          onChange={(e) => setRemedy(e.target.value)}
          placeholder={ar ? "الإجراء التصحيحي (اختياري)" : "Remedy or corrective action (optional)"}
        />
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={needsApproval}
            onChange={(e) => setNeedsApproval(e.target.checked)}
            className="size-4 accent-[hsl(var(--primary))]"
          />
          {ar ? "يتطلب موافقة المدير" : "Requires manager approval"}
        </label>
        <Button
          size="sm"
          disabled={busy !== null || summary.trim().length < 10}
          onClick={() =>
            run("resolve", () =>
              proposeResolutionFn({
                data: {
                  caseId,
                  summaryEn: summary.trim(),
                  remedy: remedy.trim() || undefined,
                  managerApprovalRequired: needsApproval,
                },
              }).then(() => {
                setSummary("");
                setRemedy("");
              }),
            )
          }
        >
          {ar ? "إرسال الاقتراح" : "Submit proposal"}
        </Button>
        {opsQuery.data?.resolutions.length ? (
          <ul className="space-y-2 pt-2">
            {opsQuery.data.resolutions.map((r) => (
              <li key={r.id} className="rounded-lg border bg-surface p-3 text-xs">
                <p className="whitespace-pre-wrap">{r.resolution_summary_en}</p>
                <p className="mt-1 text-muted-foreground">
                  {r.manager_approval_required && !r.approved_at
                    ? ar
                      ? "بانتظار موافقة المدير"
                      : "Awaiting manager approval"
                    : r.student_response
                      ? `${ar ? "رد الطالب" : "Student response"}: ${r.student_response}`
                      : ar
                        ? "معروض على الطالب"
                        : "Proposed to the student"}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-2 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">{ar ? "تحديد تفاصيل اللقاء" : "Set Meeting Details"}</h3>
        <p className="text-xs text-muted-foreground">
          {ar
            ? "يُحفظ اللقاء على هذا الطلب نفسه ويُبلَّغ به الطالب. لا يتم إنشاء حجز موعد منفصل."
            : "Saved on this same request and sent to the student. No separate appointment record is created."}
        </p>
        {opsQuery.data?.case?.meeting_at ? (
          <div className="rounded-lg border bg-surface p-3 text-xs">
            <p className="font-medium">
              {formatMeetingWhen(opsQuery.data.case.meeting_at, lang)}
              {opsQuery.data.case.meeting_mode
                ? ` · ${ar ? (MEETING_MODE_LABEL[opsQuery.data.case.meeting_mode]?.ar ?? "") : (MEETING_MODE_LABEL[opsQuery.data.case.meeting_mode]?.en ?? "")}`
                : ""}
            </p>
            {opsQuery.data.case.meeting_location ? (
              <p className="mt-1 break-all text-muted-foreground">{opsQuery.data.case.meeting_location}</p>
            ) : null}
            {opsQuery.data.case.meeting_note ? (
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{opsQuery.data.case.meeting_note}</p>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={busy !== null}
              onClick={() => run("meeting-clear", () => clearCaseMeetingFn({ data: { caseId } }))}
            >
              {ar ? "إلغاء اللقاء" : "Cancel meeting"}
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs">{ar ? "التاريخ" : "Date"}</Label>
            <Input type="date" className="w-40" value={meetDate} onChange={(e) => setMeetDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">{ar ? "الوقت" : "Time"}</Label>
            <Input type="time" className="w-32" value={meetTime} onChange={(e) => setMeetTime(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">{ar ? "الطريقة" : "Mode"}</Label>
            <select
              className="h-9 w-40 rounded-md border bg-background px-2 text-xs"
              value={meetMode}
              onChange={(e) => setMeetMode(e.target.value as "in_person" | "online" | "phone")}
            >
              <option value="in_person">{ar ? "حضورياً" : "In person"}</option>
              <option value="online">{ar ? "عن بُعد" : "Online"}</option>
              <option value="phone">{ar ? "هاتفياً" : "Phone"}</option>
            </select>
          </div>
        </div>
        <Input
          value={meetPlace}
          onChange={(e) => setMeetPlace(e.target.value)}
          placeholder={ar ? "المكان أو رابط الاجتماع" : "Location or online link"}
        />
        <Textarea
          rows={2}
          value={meetNote}
          onChange={(e) => setMeetNote(e.target.value)}
          placeholder={ar ? "ملاحظة اختيارية للطالب" : "Optional note for the student"}
        />
        <Button
          size="sm"
          disabled={busy !== null || !meetDate || !meetTime}
          onClick={() =>
            run("meeting", () =>
              setCaseMeetingFn({
                data: {
                  caseId,
                  meetingAt: new Date(`${meetDate}T${meetTime}:00+04:00`).toISOString(),
                  mode: meetMode,
                  location: meetPlace.trim() || undefined,
                  note: meetNote.trim() || undefined,
                },
              }).then(() => {
                setMeetPlace("");
                setMeetNote("");
              }),
            )
          }
        >
          {ar ? "حفظ تفاصيل اللقاء" : "Save meeting details"}
        </Button>
      </section>

      <section className="space-y-2 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">{ar ? "تصعيد" : "Escalate"}</h3>
        <Textarea
          rows={2}
          value={escalation}
          onChange={(e) => setEscalation(e.target.value)}
          placeholder={ar ? "سبب التصعيد" : "Escalation reason"}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null || escalation.trim().length < 5}
          onClick={() =>
            run("escalate", () =>
              escalateCaseFn({ data: { caseId, reason: escalation.trim() } }).then(() => setEscalation("")),
            )
          }
        >
          {ar ? "تصعيد الحالة" : "Escalate case"}
        </Button>
      </section>
    </div>
  );
}
