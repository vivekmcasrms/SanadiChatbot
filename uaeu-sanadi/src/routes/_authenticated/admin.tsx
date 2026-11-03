import { useState } from "react";
import { contentFieldLabel } from "@/lib/field-label";
import { toastError } from "@/lib/errors/toast";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MetricCard } from "@/components/MetricCard";
import { DocumentRetentionSettings } from "@/components/DocumentRetentionSettings";
import { DocumentTemplateSettings } from "@/components/DocumentTemplateSettings";
import { ServiceAvailabilitySettings } from "@/components/ServiceAvailabilitySettings";
import { EmergencyContactsSettings } from "@/components/EmergencyContactsSettings";
import { HostelStudentDataSettings } from "@/components/HostelStudentDataSettings";
import { TransferSettings } from "@/components/TransferSettings";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Data administration — Sanadi | UAEU" },
      {
        name: "description",
        content: "Administer service units, campus alerts and role assignments behind Sanadi.",
      },
      { property: "og:title", content: "Data administration — Sanadi | UAEU" },
      { property: "og:description", content: "Manage units, alerts and roles from one console." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminPage,
});

type Urgency = "low" | "medium" | "high" | "critical";

const ROLES = [
  "student",
  "service_officer",
  "service_owner",
  "service_manager",
  "knowledge_manager",
  "system_admin",
  "auditor",
  "leadership_viewer",
] as const;

function AdminPage() {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const { roles, loading } = useAuth();
  const isAdmin = roles.includes("system_admin");
  const queryClient = useQueryClient();

  const [alertDraft, setAlertDraft] = useState({
    unit: "",
    titleEn: "",
    titleAr: "",
    bodyEn: "",
    bodyAr: "",
    urgency: "medium" as Urgency,
  });
  const [roleDraft, setRoleDraft] = useState({ email: "", role: "service_officer" });

  const unitsQuery = useQuery({
    queryKey: ["admin-units"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_units")
        .select("id, code, name_en, name_ar, contact_email, office_location_en, office_location_ar, is_active, service_hours_en")
        .order("code");
      if (error) throw error;
      return data;
    },
  });

  const alertsQuery = useQuery({
    queryKey: ["admin-alerts"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alerts")
        .select("id, title_en, title_ar, urgency, is_active, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const peopleQuery = useQuery({
    queryKey: ["admin-people"],
    enabled: isAdmin,
    queryFn: async () => {
      const [{ data: profiles, error }, { data: userRoles, error: rErr }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email").order("full_name").limit(500),
        supabase.from("user_roles").select("user_id, role").limit(1000),
      ]);
      if (error) throw error;
      if (rErr) throw rErr;
      return (profiles ?? []).map((p) => ({
        ...p,
        roles: (userRoles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role),
      }));
    },
  });

  async function toggleUnit(id: string, isActive: boolean) {
    const { error } = await supabase.from("service_units").update({ is_active: isActive }).eq("id", id);
    if (error) return void toastError(error, lang);
    void queryClient.invalidateQueries({ queryKey: ["admin-units"] });
    toast.success(t("saved"));
  }

  async function updateUnitEmail(id: string, value: string) {
    const { error } = await supabase.from("service_units").update({ contact_email: value || null }).eq("id", id);
    if (error) return void toastError(error, lang);
    void queryClient.invalidateQueries({ queryKey: ["admin-units"] });
    toast.success(t("saved"));
  }

  async function updateUnitLocation(id: string, value: string) {
    const { error } = await supabase.from("service_units").update({ office_location_en: value || null }).eq("id", id);
    if (error) return void toastError(error, lang);
    void queryClient.invalidateQueries({ queryKey: ["admin-units"] });
    toast.success(t("saved"));
  }

  async function toggleAlert(id: string, isActive: boolean) {
    const { error } = await supabase.from("alerts").update({ is_active: isActive }).eq("id", id);
    if (error) return void toastError(error, lang);
    void queryClient.invalidateQueries({ queryKey: ["admin-alerts"] });
    toast.success(t("saved"));
  }

  async function publishAlert() {
    if (!alertDraft.titleEn.trim()) return;
    const { error } = await supabase.from("alerts").insert({
      service_unit_id: alertDraft.unit || null,
      title_en: alertDraft.titleEn.trim(),
      title_ar: alertDraft.titleAr.trim() || alertDraft.titleEn.trim(),
      body_en: alertDraft.bodyEn.trim(),
      body_ar: alertDraft.bodyAr.trim() || alertDraft.bodyEn.trim(),
      urgency: alertDraft.urgency,
      category: "general",
      is_active: true,
    });
    if (error) return void toastError(error, lang);
    setAlertDraft({ unit: "", titleEn: "", titleAr: "", bodyEn: "", bodyAr: "", urgency: "medium" });
    void queryClient.invalidateQueries({ queryKey: ["admin-alerts"] });
    toast.success(t("saved"));
  }

  async function grantRole() {
    const person = (peopleQuery.data ?? []).find(
      (p) => p.email?.toLowerCase() === roleDraft.email.trim().toLowerCase(),
    );
    if (!person) return void toast.error(ar ? "لم يتم العثور على المستخدم" : "No user with that email");
    const { error } = await supabase
      .from("user_roles")
      .insert({ user_id: person.id, role: roleDraft.role as (typeof ROLES)[number] });
    if (error) return void toastError(error, lang);
    setRoleDraft({ email: "", role: "service_officer" });
    void queryClient.invalidateQueries({ queryKey: ["admin-people"] });
    toast.success(t("saved"));
  }

  if (loading) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  if (!isAdmin)
    return (
      <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        {ar ? "هذه المنطقة مخصصة لمسؤولي النظام." : "This area is for system administrators."}
      </p>
    );

  const units = unitsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{ar ? "إدارة البيانات" : "Data administration"}</h1>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label={ar ? "وحدات الخدمة" : "Service units"} value={units.length} />
        <MetricCard label={ar ? "وحدات فعّالة" : "Active units"} value={units.filter((u) => u.is_active).length} tone="success" />
        <MetricCard label={ar ? "تنبيهات عامة" : "Campus alerts"} value={alertsQuery.data?.length ?? 0} />
        <MetricCard label={ar ? "مستخدمون" : "Accounts"} value={peopleQuery.data?.length ?? 0} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{ar ? "وحدات الخدمة" : "Service units"}</h2>
        {units.map((u) => (
          <div key={u.id} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <div>
              <p className="text-sm font-medium">{ar ? u.name_ar : u.name_en}</p>
              <p className="text-xs text-muted-foreground">
                {u.code}{u.service_hours_en ? ` · ${u.service_hours_en}` : ""}
              </p>
            </div>
            <Input
              defaultValue={u.contact_email ?? ""}
              placeholder={ar ? "بريد التواصل" : "Contact email"}
              onBlur={(e) => {
                if (e.target.value !== (u.contact_email ?? "")) void updateUnitEmail(u.id, e.target.value);
              }}
            />
            <Input
              defaultValue={u.office_location_en ?? ""}
              placeholder={ar ? "موقع المكتب" : "Office location"}
              onBlur={(e) => {
                if (e.target.value !== (u.office_location_en ?? "")) void updateUnitLocation(u.id, e.target.value);
              }}
            />
            <Switch checked={u.is_active} onCheckedChange={(checked) => toggleUnit(u.id, checked)} />
          </div>
        ))}
      </section>

      <section className="card-shadow space-y-4 rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">{ar ? "نشر تنبيه عام" : "Publish a campus alert"}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{ar ? "الوحدة" : "Unit"}</Label>
            <Select value={alertDraft.unit} onValueChange={(v) => setAlertDraft({ ...alertDraft, unit: v })}>
              <SelectTrigger>
                <SelectValue placeholder={ar ? "اختر وحدة" : "Select a unit"} />
              </SelectTrigger>
              <SelectContent>
                {units.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{ar ? "الخطورة" : "Urgency"}</Label>
            <Select value={alertDraft.urgency} onValueChange={(v) => setAlertDraft({ ...alertDraft, urgency: v as Urgency })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["low", "medium", "high", "critical"] as const).map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tEn">{contentFieldLabel("Title","العنوان","en",ar)}</Label>
            <Input id="tEn" value={alertDraft.titleEn} onChange={(e) => setAlertDraft({ ...alertDraft, titleEn: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tAr">{contentFieldLabel("Title","العنوان","ar",ar)}</Label>
            <Input id="tAr" value={alertDraft.titleAr} onChange={(e) => setAlertDraft({ ...alertDraft, titleAr: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bEn">{contentFieldLabel("Body","النص","en",ar)}</Label>
            <Textarea id="bEn" rows={3} value={alertDraft.bodyEn} onChange={(e) => setAlertDraft({ ...alertDraft, bodyEn: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bAr">{contentFieldLabel("Body","النص","ar",ar)}</Label>
            <Textarea id="bAr" rows={3} value={alertDraft.bodyAr} onChange={(e) => setAlertDraft({ ...alertDraft, bodyAr: e.target.value })} />
          </div>
        </div>
        <Button size="sm" onClick={publishAlert} disabled={!alertDraft.titleEn.trim()}>
          {t("save")}
        </Button>
        <ul className="space-y-2">
          {(alertsQuery.data ?? []).map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">{ar ? a.title_ar : a.title_en}</p>
                <p className="text-xs text-muted-foreground">{a.urgency}</p>
              </div>
              <Switch checked={a.is_active} onCheckedChange={(checked) => toggleAlert(a.id, checked)} />
            </li>
          ))}
        </ul>
      </section>

      <section className="card-shadow space-y-4 rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">{ar ? "الأدوار" : "Role assignments"}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1 space-y-2">
            <Label htmlFor="roleEmail">{t("email")}</Label>
            <Input id="roleEmail" value={roleDraft.email} onChange={(e) => setRoleDraft({ ...roleDraft, email: e.target.value })} />
          </div>
          <div className="w-56 space-y-2">
            <Label>{ar ? "الدور" : "Role"}</Label>
            <Select value={roleDraft.role} onValueChange={(v) => setRoleDraft({ ...roleDraft, role: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={grantRole} disabled={!roleDraft.email.trim()}>
            {ar ? "منح الدور" : "Grant role"}
          </Button>
        </div>
        <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
          {(peopleQuery.data ?? []).map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-4 rounded-lg border p-2">
              <span>
                {p.full_name} <span className="text-xs text-muted-foreground">{p.email}</span>
              </span>
              <span className="text-xs text-muted-foreground">{p.roles.join(", ") || "—"}</span>
            </li>
          ))}
        </ul>
      </section>

      <ServiceAvailabilitySettings />
      <HostelStudentDataSettings />
      <TransferSettings />
      <EmergencyContactsSettings />

      <DocumentRetentionSettings />

      <DocumentTemplateSettings />
    </div>
  );
}