/**
 * The office and student view of a PREFERRED-TIME appointment request.
 *
 * A request is never shown as a confirmed appointment: the panel always states
 * where it stands, and only a confirmation (by the office, or by the student
 * accepting a suggested time) turns it into a confirmed meeting.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import {
  getCaseAppointmentRequestFn,
  respondToAppointmentRequestFn,
} from "@/lib/appointments/requests.functions";

function when(iso: string | null, ar: boolean) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(ar ? "ar-AE" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Dubai",
  }).format(new Date(iso));
}

const STATUS_LABEL: Record<string, { en: string; ar: string }> = {
  REQUESTED: { en: "Awaiting confirmation", ar: "بانتظار التأكيد" },
  ASSIGNED: { en: "Awaiting confirmation", ar: "بانتظار التأكيد" },
  AWAITING_OFFICE_CONFIRMATION: { en: "Awaiting confirmation", ar: "بانتظار التأكيد" },
  ALTERNATIVE_PROPOSED: { en: "Another time suggested", ar: "تم اقتراح وقت آخر" },
  CONFIRMED: { en: "Confirmed", ar: "مؤكد" },
  DECLINED: { en: "Declined", ar: "مرفوض" },
  CANCELLED: { en: "Cancelled", ar: "ملغى" },
};

export function AppointmentRequestPanel({ caseId }: { caseId: string }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { user } = useAuth();
  const qc = useQueryClient();
  const [alternative, setAlternative] = useState("");
  const [location, setLocation] = useState("");
  const [message, setMessage] = useState("");

  const q = useQuery({
    queryKey: ["appointment-request", caseId],
    queryFn: () => getCaseAppointmentRequestFn({ data: { caseId } }),
  });

  const respond = useMutation({
    mutationFn: (vars: {
      action: "confirm" | "propose" | "request_info" | "decline" | "student_accept" | "student_cancel";
    }) =>
      respondToAppointmentRequestFn({
        data: {
          requestId: q.data!.id,
          action: vars.action,
          ...(alternative ? { alternativeDatetime: new Date(alternative).toISOString() } : {}),
          ...(location ? { location } : {}),
          ...(message ? { message } : {}),
        },
      }),
    onSuccess: () => {
      toast.success(ar ? "تم تحديث الطلب." : "Request updated.");
      setMessage("");
      void qc.invalidateQueries({ queryKey: ["appointment-request", caseId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const r = q.data;
  if (!r) return null;
  const isStudent = user?.id === r.studentId;
  const open = !["CONFIRMED", "DECLINED", "CANCELLED"].includes(r.requestStatus);
  const status = STATUS_LABEL[r.requestStatus] ?? STATUS_LABEL["REQUESTED"]!;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-sm">
          {ar ? "طلب موعد (وقت مفضّل)" : "Appointment request (preferred time)"}
        </CardTitle>
        <Badge variant={r.requestStatus === "CONFIRMED" ? "default" : "secondary"}>
          {ar ? status.ar : status.en}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{ar ? "الوقت المفضّل" : "Preferred time"}</dt>
            <dd className="font-medium">{when(r.preferredDatetime, ar)}</dd>
          </div>
          {r.alternativeDatetime ? (
            <div>
              <dt className="text-muted-foreground">{ar ? "وقت مقترح" : "Suggested time"}</dt>
              <dd className="font-medium">{when(r.alternativeDatetime, ar)}</dd>
            </div>
          ) : null}
          {r.confirmedDatetime ? (
            <div>
              <dt className="text-muted-foreground">{ar ? "الوقت المؤكد" : "Confirmed time"}</dt>
              <dd className="font-medium">{when(r.confirmedDatetime, ar)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-muted-foreground">{ar ? "الجهة المسؤولة" : "Responsible office"}</dt>
            <dd className="font-medium">{r.unitName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{ar ? "الموظف المسؤول" : "Responsible staff"}</dt>
            <dd className="font-medium">
              {r.assignedStaffName ?? (ar ? "لم يُسند بعد" : "Not assigned yet")}
              {r.assignedStaffEmail ? ` · ${r.assignedStaffEmail}` : ""}
            </dd>
          </div>
          {isStudent ? null : (
            <div>
              <dt className="text-muted-foreground">{ar ? "الطالب" : "Student"}</dt>
              <dd className="font-medium">
                {r.studentName ?? "—"}
                {r.studentNumber ? ` · ${r.studentNumber}` : ""}
              </dd>
            </div>
          )}
          {r.location ? (
            <div>
              <dt className="text-muted-foreground">{ar ? "المكان" : "Location"}</dt>
              <dd className="font-medium">{r.location}</dd>
            </div>
          ) : null}
        </dl>

        {r.purpose ? (
          <p className="rounded-lg bg-muted/50 p-3 text-muted-foreground">{r.purpose}</p>
        ) : null}
        {r.declineReason ? (
          <p className="rounded-lg bg-destructive/10 p-3">{r.declineReason}</p>
        ) : null}

        {open && !isStudent ? (
          <div className="space-y-3 border-t pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="alt-time">{ar ? "اقترح وقتاً آخر" : "Suggest another time"}</Label>
                <Input
                  id="alt-time"
                  type="datetime-local"
                  value={alternative}
                  onChange={(e) => setAlternative(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="alt-loc">{ar ? "المكان" : "Location"}</Label>
                <Input id="alt-loc" value={location} onChange={(e) => setLocation(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="alt-msg">{ar ? "رسالة للطالب" : "Message to the student"}</Label>
              <Textarea id="alt-msg" value={message} onChange={(e) => setMessage(e.target.value)} rows={2} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={respond.isPending} onClick={() => respond.mutate({ action: "confirm" })}>
                {ar ? "تأكيد الوقت المفضّل" : "Confirm preferred time"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={respond.isPending || !alternative}
                onClick={() => respond.mutate({ action: "propose" })}
              >
                {ar ? "اقتراح وقت آخر" : "Propose alternative"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={respond.isPending || !message}
                onClick={() => respond.mutate({ action: "request_info" })}
              >
                {ar ? "طلب معلومات" : "Request information"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={respond.isPending}
                onClick={() => respond.mutate({ action: "decline" })}
              >
                {ar ? "رفض مع السبب" : "Decline with reason"}
              </Button>
            </div>
          </div>
        ) : null}

        {open && isStudent ? (
          <div className="flex flex-wrap gap-2 border-t pt-4">
            {r.alternativeDatetime ? (
              <Button size="sm" disabled={respond.isPending} onClick={() => respond.mutate({ action: "student_accept" })}>
                {ar ? "قبول الوقت المقترح" : "Accept suggested time"}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={respond.isPending}
              onClick={() => respond.mutate({ action: "student_cancel" })}
            >
              {ar ? "إلغاء الطلب" : "Cancel request"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
