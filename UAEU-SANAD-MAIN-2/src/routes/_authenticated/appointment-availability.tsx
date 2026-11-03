/**
 * Appointment availability (Admin).
 *
 * The only place where real bookable times are created. Sanadi offers nothing
 * that was not published here: every generated slot is marked as real admin
 * data, and seeded/demo schedules stay excluded from the Assistant.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ShieldAlert, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { apiFetch } from "@/lib/auth-token";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/appointment-availability")({
  head: () => ({
    meta: [
      { title: "Appointment Availability — Sanadi | UAEU" },
      {
        name: "description",
        content: "Publish real weekly appointment availability for UAEU service units so students can book verified times.",
      },
      { property: "og:title", content: "Appointment Availability — Sanadi | UAEU" },
      { property: "og:description", content: "Admin tool for publishing real bookable appointment times per unit and staff member." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AvailabilityPage,
});

const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
type AvailabilityUnit = { id: string; nameEn: string; nameAr: string; appointmentEnabled: boolean };
type AvailabilityRule = {
  id: string;
  unitName: string;
  typeName: string | null;
  weekday: number;
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
  staffName: string | null;
  location: string | null;
  isActive: boolean;
  realSlots: number;
};
const toMinutes = (v: string) => {
  const [h, m] = v.split(":");
  return Number(h) * 60 + Number(m ?? 0);
};
const fromMinutes = (v: number) => `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;

function AvailabilityPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { roles } = useAuth();
  const isAdmin = roles.includes("system_admin");
  const qc = useQueryClient();

  const workspace = useQuery({
    queryKey: ["appt-availability"],
    queryFn: () => apiFetch<{ units: AvailabilityUnit[]; rules: AvailabilityRule[]; realSlotTotal: number }>("/api/appointments/availability/workspace"),
    enabled: isAdmin,
    retry: false,
  });

  const [unitId, setUnitId] = useState<string>("");
  const [staffId, setStaffId] = useState<string>("none");
  const [serviceEn, setServiceEn] = useState("");
  const [serviceAr, setServiceAr] = useState("");
  const [weekday, setWeekday] = useState("1");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("12:00");
  const [slotMinutes, setSlotMinutes] = useState("30");
  const [location, setLocation] = useState("");
  const [weeks, setWeeks] = useState("4");

  const staff = useQuery({
    queryKey: ["appt-availability-staff", unitId],
    queryFn: () => apiFetch<{ userId: string; name: string; jobTitle: string | null }[]>("/api/appointments/availability/staff", {
      method: "POST",
      body: JSON.stringify({ unitId }),
    }),
    enabled: isAdmin && !!unitId,
    retry: false,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["appt-availability"] });

  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true; slotsCreated: number }>("/api/appointments/availability/rules", {
        method: "POST",
        body: JSON.stringify({
          unitId,
          staffProfileId: staffId === "none" ? null : staffId,
          serviceNameEn: serviceEn.trim(),
          serviceNameAr: serviceAr.trim() || serviceEn.trim(),
          weekday: Number(weekday),
          startMinute: toMinutes(start),
          endMinute: toMinutes(end),
          slotMinutes: Number(slotMinutes),
          location: location.trim() || null,
          validFrom: new Date().toISOString().slice(0, 10),
          validTo: null,
          weeks: Number(weeks),
        }),
      }),
    onSuccess: (r) => {
      toast.success(ar ? `تم إنشاء ${r.slotsCreated} موعداً حقيقياً.` : `${r.slotsCreated} real appointment times published.`);
      setServiceEn("");
      setServiceAr("");
      setLocation("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin)
    return (
      <Card>
        <CardContent className="flex items-start gap-3 p-6">
          <ShieldAlert className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {ar ? "إدارة أوقات المواعيد متاحة لمسؤولي النظام فقط." : "Appointment availability is managed by system administrators only."}
          </p>
        </CardContent>
      </Card>
    );

  const units = workspace.data?.units ?? [];
  const rules = workspace.data?.rules ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <CalendarClock className="size-6" aria-hidden />
          {ar ? "أوقات المواعيد" : "Appointment availability"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {ar
            ? "تظهر للطلبة الأوقات المنشورة هنا فقط. لن يعرض سندي أي وقت غير حقيقي."
            : "Students can only be offered times published here. Sanadi never shows a time that is not real."}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{ar ? "إضافة خطة أسبوعية" : "Add a weekly plan"}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label>{ar ? "الوحدة" : "Service unit"}</Label>
            <Select value={unitId} onValueChange={(v) => { setUnitId(v); setStaffId("none"); }}>
              <SelectTrigger><SelectValue placeholder={ar ? "اختر الوحدة" : "Select unit"} /></SelectTrigger>
              <SelectContent>
                {units.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{ar ? u.nameAr : u.nameEn}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{ar ? "الموظف" : "Staff member"}</Label>
            <Select value={staffId} onValueChange={setStaffId} disabled={!unitId}>
              <SelectTrigger><SelectValue placeholder={ar ? "اختياري" : "Optional"} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{ar ? "بدون تحديد" : "Not specified"}</SelectItem>
                {(staff.data ?? []).map((s) => (
                  <SelectItem key={s.userId} value={s.userId}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{ar ? "اسم الخدمة (إنجليزي)" : "Service name (English)"}</Label>
            <Input value={serviceEn} onChange={(e) => setServiceEn(e.target.value)} placeholder="Career Counselling" />
          </div>
          <div className="space-y-1.5">
            <Label>{ar ? "اسم الخدمة (عربي)" : "Service name (Arabic)"}</Label>
            <Input value={serviceAr} onChange={(e) => setServiceAr(e.target.value)} placeholder="الإرشاد المهني" />
          </div>
          <div className="space-y-1.5">
            <Label>{ar ? "اليوم" : "Day"}</Label>
            <Select value={weekday} onValueChange={setWeekday}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DAYS_EN.map((d, i) => (
                  <SelectItem key={d} value={String(i)}>{ar ? DAYS_AR[i] : d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>{ar ? "من" : "From"}</Label>
              <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{ar ? "إلى" : "To"}</Label>
              <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{ar ? "مدة الموعد (دقيقة)" : "Session length (minutes)"}</Label>
            <Input type="number" min={10} max={240} value={slotMinutes} onChange={(e) => setSlotMinutes(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{ar ? "المكان" : "Location"}</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={ar ? "المبنى والمكتب" : "Building and office"} />
          </div>
          <div className="space-y-1.5">
            <Label>{ar ? "عدد الأسابيع" : "Weeks ahead"}</Label>
            <Input type="number" min={1} max={12} value={weeks} onChange={(e) => setWeeks(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button
              onClick={() => save.mutate()}
              disabled={!unitId || serviceEn.trim().length < 2 || save.isPending}
            >
              {ar ? "نشر الأوقات" : "Publish times"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {ar ? "الخطط المنشورة" : "Published plans"}{" "}
            <Badge variant="secondary" className="ml-2">
              {ar ? `${workspace.data?.realSlotTotal ?? 0} وقت حقيقي` : `${workspace.data?.realSlotTotal ?? 0} real times`}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {workspace.isLoading ? (
            <Skeleton className="h-32" />
          ) : rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {ar
                ? "لا توجد أوقات منشورة بعد، لذلك يخبر سندي الطلبة بصدق أنه سيحوّل الطلب إلى الوحدة."
                : "No times are published yet, so Sanadi honestly tells students it will route the request to the unit instead."}
            </p>
          ) : (
            rules.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                <div className="text-sm">
                  <p className="font-medium">
                    {r.unitName} · {r.typeName ?? "—"}
                  </p>
                  <p className="text-muted-foreground">
                    {(ar ? DAYS_AR : DAYS_EN)[r.weekday]} {fromMinutes(r.startMinute)}–{fromMinutes(r.endMinute)} ·{" "}
                    {r.slotMinutes} {ar ? "دقيقة" : "min"}
                    {r.staffName ? ` · ${r.staffName}` : ""}
                    {r.location ? ` · ${r.location}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={r.isActive ? "secondary" : "outline"}>
                    {ar ? `${r.realSlots} وقت` : `${r.realSlots} times`}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const res = await apiFetch<{ ok: true; slotsCreated: number }>("/api/appointments/availability/regenerate", {
                        method: "POST",
                        body: JSON.stringify({ ruleId: r.id, weeks: Number(weeks) }),
                      });
                      toast.success(ar ? `تمت إضافة ${res.slotsCreated} وقتاً.` : `${res.slotsCreated} times added.`);
                      refresh();
                    }}
                  >
                    <RefreshCw className="size-4" aria-hidden />
                    <span className="sr-only">{ar ? "تحديث" : "Extend"}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await apiFetch<{ ok: true }>("/api/appointments/availability/deactivate", {
                        method: "POST",
                        body: JSON.stringify({ ruleId: r.id }),
                      });
                      toast.success(ar ? "تم إيقاف الخطة." : "Plan withdrawn.");
                      refresh();
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    <span className="sr-only">{ar ? "إيقاف" : "Withdraw"}</span>
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{ar ? "الوحدات التي تستقبل مواعيد" : "Units that accept appointments"}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {units.map((u) => (
            <label key={u.id} className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
              <span>{ar ? u.nameAr : u.nameEn}</span>
              <Switch
                checked={u.appointmentEnabled}
                onCheckedChange={async (v) => {
                  await apiFetch<{ ok: true }>("/api/appointments/availability/enabled", {
                    method: "POST",
                    body: JSON.stringify({ unitId: u.id, enabled: v }),
                  });
                  refresh();
                }}
              />
            </label>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
