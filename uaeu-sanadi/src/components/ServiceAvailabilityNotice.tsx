import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toastError } from "@/lib/errors/toast";
import { CalendarClock, CheckCircle2, BellRing } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { requestServiceReminder } from "@/lib/service-availability.functions";
import type { ServiceAvailability } from "@/lib/services/availability-types";
import { availabilityChip, availabilityMessage } from "@/lib/services/availability-format";

/** Small status chip usable in lists and headers. */
export function ServiceAvailabilityChip({ availability }: { availability: ServiceAvailability }) {
  const { lang } = useI18n();
  const open = availability.isAvailable;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
        open ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-700" : "border-amber-600/30 bg-amber-600/10 text-amber-700"
      }`}
    >
      {open ? <CheckCircle2 className="h-3 w-3" /> : <CalendarClock className="h-3 w-3" />}
      {availabilityChip(availability, lang)}
    </span>
  );
}

/** Full banner shown at the top of a service page when it is closed. */
export function ServiceAvailabilityNotice({
  availability,
  serviceCode,
  className = "",
}: {
  availability: ServiceAvailability;
  serviceCode: string;
  className?: string;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const queryClient = useQueryClient();

  const remind = useMutation({
    mutationFn: () => requestServiceReminder({ data: { code: serviceCode, reminderType: "service_open" } }),
    onSuccess: () => {
      toast.success(ar ? "سأخطرك فور فتح الخدمة." : "I'll notify you as soon as this service opens.");
      void queryClient.invalidateQueries({ queryKey: ["my-service-reminders"] });
    },
    onError: (e: Error) => toastError(e, lang),
  });

  if (availability.isAvailable) return null;

  const canRemind = availability.remindersEnabled && !!availability.nextOpenAt;

  return (
    <div
      dir={ar ? "rtl" : "ltr"}
      className={`rounded-xl border border-amber-600/30 bg-amber-600/5 p-4 ${className}`}
    >
      <div className="flex items-start gap-3">
        <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {ar ? "هذه الخدمة غير مفتوحة حالياً" : "This service is not currently open"}
          </p>
          <p className="text-sm text-muted-foreground">{availabilityMessage(availability, lang)}</p>
          {availability.preliminaryCheckAllowed ? (
            <p className="text-xs text-muted-foreground">
              {ar
                ? "يمكنك الاطلاع على تقييم مبدئي الآن، وسيتم إعادة التحقق من بياناتك عند فتح الفترة."
                : "You can review a preliminary assessment now; your record will be re-checked when the period opens."}
            </p>
          ) : null}
          {canRemind ? (
            <Button size="sm" variant="outline" onClick={() => remind.mutate()} disabled={remind.isPending}>
              <BellRing className={ar ? "ml-2 h-4 w-4" : "mr-2 h-4 w-4"} />
              {ar ? "ذكّرني عند الفتح" : "Remind me when it opens"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
