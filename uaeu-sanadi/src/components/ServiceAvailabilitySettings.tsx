import { useMemo, useState } from "react";
import { contentFieldLabel } from "@/lib/field-label";
import { toastError } from "@/lib/errors/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ServiceAvailabilityChip } from "@/components/ServiceAvailabilityNotice";
import { useI18n } from "@/lib/i18n";
import {
  getServiceAvailabilityBoard,
  saveServiceAvailabilityWindow,
  deleteServiceAvailabilityWindow,
} from "@/lib/service-availability.functions";
import type { AvailabilityType } from "@/lib/services/availability-types";
import { availabilityWindowLabel } from "@/lib/services/availability-format";

const TYPES: AvailabilityType[] = [
  "always_available",
  "date_range",
  "term_based",
  "multiple_windows",
  "temporarily_closed",
  "admin_disabled",
];

type Draft = {
  id?: string | null;
  availabilityType: AvailabilityType;
  opensAt: string;
  closesAt: string;
  label: string;
  reasonEn: string;
  reasonAr: string;
  studentMessageEn: string;
  studentMessageAr: string;
  remindersEnabled: boolean;
  preliminaryCheckAllowed: boolean;
  studentVisible: boolean;
};

const emptyDraft: Draft = {
  id: null,
  availabilityType: "date_range",
  opensAt: "",
  closesAt: "",
  label: "",
  reasonEn: "",
  reasonAr: "",
  studentMessageEn: "",
  studentMessageAr: "",
  remindersEnabled: true,
  preliminaryCheckAllowed: true,
  studentVisible: true,
};

const toLocalInput = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : "");

export function ServiceAvailabilitySettings() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const queryClient = useQueryClient();
  const [openServiceId, setOpenServiceId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [filter, setFilter] = useState("");

  const board = useQuery({
    queryKey: ["service-availability-board"],
    queryFn: () => getServiceAvailabilityBoard(),
  });

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = board.data ?? [];
    if (!q) return list;
    return list.filter((r) =>
      [r.service.code, r.service.name_en, r.service.name_ar].some((v) => (v ?? "").toLowerCase().includes(q)),
    );
  }, [board.data, filter]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["service-availability-board"] });
    void queryClient.invalidateQueries({ queryKey: ["help-services"] });
  };

  const save = useMutation({
    mutationFn: (serviceId: string) =>
      saveServiceAvailabilityWindow({
        data: {
          id: draft.id ?? null,
          serviceId,
          availabilityType: draft.availabilityType,
          opensAt: draft.opensAt ? new Date(draft.opensAt).toISOString() : null,
          closesAt: draft.closesAt ? new Date(draft.closesAt).toISOString() : null,
          label: draft.label || null,
          reasonEn: draft.reasonEn || null,
          reasonAr: draft.reasonAr || null,
          studentMessageEn: draft.studentMessageEn || null,
          studentMessageAr: draft.studentMessageAr || null,
          remindersEnabled: draft.remindersEnabled,
          preliminaryCheckAllowed: draft.preliminaryCheckAllowed,
          studentVisible: draft.studentVisible,
          status: "active",
        },
      }),
    onSuccess: () => {
      toast.success(ar ? "تم حفظ فترة الإتاحة" : "Availability window saved");
      setDraft(emptyDraft);
      setOpenServiceId(null);
      invalidate();
    },
    onError: (e: Error) => toastError(e, lang),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteServiceAvailabilityWindow({ data: { id } }),
    onSuccess: () => {
      toast.success(ar ? "تم الحذف" : "Window removed");
      invalidate();
    },
    onError: (e: Error) => toastError(e, lang),
  });

  const dated = ["date_range", "term_based", "multiple_windows"].includes(draft.availabilityType);

  return (
    <section dir={ar ? "rtl" : "ltr"} className="card-shadow space-y-4 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{ar ? "فترات إتاحة الخدمات" : "Service availability periods"}</h2>
          <p className="text-xs text-muted-foreground">
            {ar
              ? "حدد متى تكون كل خدمة مفتوحة للطلبة. تُطبَّق التواريخ بتوقيت الإمارات."
              : "Control when each service is open to students. All times are applied in UAE time."}
          </p>
        </div>
        <Input
          className="w-56"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={ar ? "ابحث عن خدمة" : "Search services"}
        />
      </div>

      {board.isLoading ? (
        <p className="text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>
      ) : null}

      <ul className="space-y-3">
        {rows.map((row) => {
          const editing = openServiceId === row.service.id;
          return (
            <li key={row.service.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{ar ? row.service.name_ar : row.service.name_en}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.service.code}
                    {availabilityWindowLabel(row.availability, lang)
                      ? ` · ${availabilityWindowLabel(row.availability, lang)}`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <ServiceAvailabilityChip availability={row.availability} />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setOpenServiceId(editing ? null : row.service.id);
                      setDraft(emptyDraft);
                    }}
                  >
                    {editing ? (ar ? "إغلاق" : "Close") : ar ? "إدارة" : "Manage"}
                  </Button>
                </div>
              </div>

              {editing ? (
                <div className="mt-4 space-y-4">
                  {row.windows.length ? (
                    <ul className="space-y-2">
                      {row.windows.map((w) => (
                        <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-xs">
                          <span>
                            <span className="font-medium">{w.label || w.availability_type}</span>
                            {w.opens_at ? ` · ${new Date(w.opens_at).toLocaleString(ar ? "ar-AE" : "en-GB")}` : ""}
                            {w.closes_at ? ` → ${new Date(w.closes_at).toLocaleString(ar ? "ar-AE" : "en-GB")}` : ""}
                            {w.status !== "active" ? ` · ${w.status}` : ""}
                          </span>
                          <span className="flex gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setDraft({
                                  id: w.id,
                                  availabilityType: w.availability_type as AvailabilityType,
                                  opensAt: toLocalInput(w.opens_at),
                                  closesAt: toLocalInput(w.closes_at),
                                  label: w.label ?? "",
                                  reasonEn: w.reason_en ?? "",
                                  reasonAr: w.reason_ar ?? "",
                                  studentMessageEn: w.student_message_en ?? "",
                                  studentMessageAr: w.student_message_ar ?? "",
                                  remindersEnabled: w.reminders_enabled ?? true,
                                  preliminaryCheckAllowed: w.preliminary_check_allowed ?? true,
                                  studentVisible: w.student_visible ?? true,
                                })
                              }
                            >
                              {ar ? "تعديل" : "Edit"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => remove.mutate(w.id)}>
                              {ar ? "حذف" : "Delete"}
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {ar ? "لا توجد فترات مُعرَّفة — الخدمة متاحة دائماً." : "No windows configured — the service is always available."}
                    </p>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>{ar ? "نوع الإتاحة" : "Availability type"}</Label>
                      <Select
                        value={draft.availabilityType}
                        onValueChange={(v) => setDraft({ ...draft, availabilityType: v as AvailabilityType })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t.replace(/_/g, " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>{ar ? "التسمية" : "Label"}</Label>
                      <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
                    </div>
                    {dated ? (
                      <>
                        <div className="space-y-2">
                          <Label>{ar ? "يفتح في" : "Opens at"}</Label>
                          <Input
                            type="datetime-local"
                            value={draft.opensAt}
                            onChange={(e) => setDraft({ ...draft, opensAt: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>{ar ? "يغلق في" : "Closes at"}</Label>
                          <Input
                            type="datetime-local"
                            value={draft.closesAt}
                            onChange={(e) => setDraft({ ...draft, closesAt: e.target.value })}
                          />
                        </div>
                      </>
                    ) : null}
                    <div className="space-y-2">
                      <Label>{contentFieldLabel("Student message","رسالة الطالب","en",ar)}</Label>
                      <Textarea
                        rows={2}
                        value={draft.studentMessageEn}
                        onChange={(e) => setDraft({ ...draft, studentMessageEn: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{contentFieldLabel("Student message","رسالة الطالب","ar",ar)}</Label>
                      <Textarea
                        rows={2}
                        value={draft.studentMessageAr}
                        onChange={(e) => setDraft({ ...draft, studentMessageAr: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{contentFieldLabel("Reason","السبب","en",ar)}</Label>
                      <Input value={draft.reasonEn} onChange={(e) => setDraft({ ...draft, reasonEn: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>{contentFieldLabel("Reason","السبب","ar",ar)}</Label>
                      <Input value={draft.reasonAr} onChange={(e) => setDraft({ ...draft, reasonAr: e.target.value })} />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-6">
                    <label className="flex items-center gap-2 text-xs">
                      <Switch
                        checked={draft.remindersEnabled}
                        onCheckedChange={(v) => setDraft({ ...draft, remindersEnabled: v })}
                      />
                      {ar ? "السماح بالتذكيرات" : "Allow reminders"}
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <Switch
                        checked={draft.preliminaryCheckAllowed}
                        onCheckedChange={(v) => setDraft({ ...draft, preliminaryCheckAllowed: v })}
                      />
                      {ar ? "السماح بفحص مبدئي" : "Allow preliminary checks"}
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <Switch
                        checked={draft.studentVisible}
                        onCheckedChange={(v) => setDraft({ ...draft, studentVisible: v })}
                      />
                      {ar ? "ظاهرة للطلبة" : "Visible to students"}
                    </label>
                  </div>

                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => save.mutate(row.service.id)} disabled={save.isPending}>
                      {draft.id ? (ar ? "تحديث الفترة" : "Update window") : ar ? "إضافة فترة" : "Add window"}
                    </Button>
                    {draft.id ? (
                      <Button size="sm" variant="ghost" onClick={() => setDraft(emptyDraft)}>
                        {ar ? "إلغاء" : "Cancel"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
