/**
 * Meeting details recorded by staff on the case itself. Nothing here is
 * invented: the card only renders what a staff member saved on this case.
 */
import { useI18n } from "@/lib/i18n";
import { CalendarClock } from "lucide-react";

export const MEETING_MODE_LABEL: Record<string, { en: string; ar: string }> = {
  in_person: { en: "In person", ar: "حضورياً" },
  online: { en: "Online", ar: "عن بُعد" },
  phone: { en: "Phone", ar: "هاتفياً" },
};

export function formatMeetingWhen(at: string, lang: string) {
  return new Date(at).toLocaleString(lang === "ar" ? "ar-AE" : "en-GB", {
    timeZone: "Asia/Dubai",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function CaseMeetingCard(props: {
  meetingAt: string | null | undefined;
  mode?: string | null;
  location?: string | null;
  note?: string | null;
  staffName?: string | null;
  unitName?: string | null;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  if (!props.meetingAt) return null;
  const mode = props.mode ? MEETING_MODE_LABEL[props.mode] : null;

  return (
    <section className="rounded-2xl border bg-card p-5 card-shadow">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <CalendarClock className="size-4 text-primary" aria-hidden />
        {ar ? "تفاصيل اللقاء" : "Meeting details"}
      </h2>
      <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{ar ? "الموعد (توقيت الإمارات)" : "When (UAE time)"}</dt>
          <dd className="font-medium">{formatMeetingWhen(props.meetingAt, lang)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{ar ? "الطريقة" : "Mode"}</dt>
          <dd className="font-medium">{mode ? (ar ? mode.ar : mode.en) : "—"}</dd>
        </div>
        {props.location ? (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">{ar ? "المكان / الرابط" : "Location / link"}</dt>
            <dd className="break-all font-medium">
              {/^https?:\/\//i.test(props.location) ? (
                <a href={props.location} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  {props.location}
                </a>
              ) : (
                props.location
              )}
            </dd>
          </div>
        ) : null}
        {props.unitName ? (
          <div>
            <dt className="text-muted-foreground">{ar ? "الجهة" : "Unit"}</dt>
            <dd className="font-medium">{props.unitName}</dd>
          </div>
        ) : null}
        {props.staffName ? (
          <div>
            <dt className="text-muted-foreground">{ar ? "الموظف المسؤول" : "Responsible staff"}</dt>
            <dd className="font-medium">{props.staffName}</dd>
          </div>
        ) : null}
      </dl>
      {props.note ? <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{props.note}</p> : null}
    </section>
  );
}
