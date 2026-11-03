import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/errors/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";

type Contact = {
  id: string;
  code: string;
  category_en: string | null;
  category_ar: string | null;
  emergency_type_en: string | null;
  emergency_type_ar: string | null;
  responsible_unit_en: string | null;
  responsible_unit_ar: string | null;
  mobile_number: string | null;
  emergency_number: string | null;
  email: string | null;
  keywords: string[] | null;
  priority: number | null;
  is_active: boolean;
};

/** SQL Server returns nvarchar JSON for keywords — normalize to a string[]. */
function normalizeKeywords(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((k): k is string => typeof k === "string");
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter((k): k is string => typeof k === "string");
      }
    } catch {
      /* plain comma-separated fallback */
    }
    return trimmed
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
  }
  return [];
}

const EMPTY = {
  code: "",
  category_en: "",
  category_ar: "",
  emergency_type_en: "",
  emergency_type_ar: "",
  responsible_unit_en: "",
  responsible_unit_ar: "",
  mobile_number: "",
  emergency_number: "",
  email: "",
  keywords: "",
  priority: "50",
};

const SELECT =
  "id, code, category_en, category_ar, emergency_type_en, emergency_type_ar, responsible_unit_en, responsible_unit_ar, mobile_number, emergency_number, email, keywords, priority, is_active";

/** Admin management of the emergency records the Assistant answers from. */
export function EmergencyContactsSettings() {
  const { lang, t } = useI18n();
  const ar = lang === "ar";
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  const contactsQuery = useQuery({
    queryKey: ["admin-emergency-contacts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("emergency_contacts")
        .select(SELECT)
        .order("priority", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as Contact[]).map((row) => ({
        ...row,
        keywords: normalizeKeywords(row.keywords),
      }));
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-emergency-contacts"] });

  type Patch = Partial<{
    is_active: boolean;
    responsible_unit_en: string | null;
    responsible_unit_ar: string | null;
    emergency_number: string | null;
    mobile_number: string | null;
    email: string | null;
    keywords: string[];
  }>;

  async function patch(id: string, values: Patch) {
    const { error } = await supabase.from("emergency_contacts").update(values).eq("id", id);
    if (error) return void toastError(error, lang);
    void refresh();
    toast.success(t("saved"));
  }

  async function remove(id: string) {
    const { error } = await supabase.from("emergency_contacts").delete().eq("id", id);
    if (error) return void toastError(error, lang);
    void refresh();
    toast.success(ar ? "تم الحذف" : "Deleted");
  }

  async function create() {
    if (!draft.code.trim() || !draft.category_en.trim()) return;
    setSaving(true);
    const keywords = draft.keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const { error } = await supabase.from("emergency_contacts").insert({
      code: draft.code.trim(),
      kind: "campus",
      label_en: draft.responsible_unit_en.trim() || draft.category_en.trim(),
      label_ar: draft.responsible_unit_ar.trim() || draft.category_ar.trim() || draft.category_en.trim(),
      category_en: draft.category_en.trim(),
      category_ar: draft.category_ar.trim() || null,
      emergency_type_en: draft.emergency_type_en.trim() || null,
      emergency_type_ar: draft.emergency_type_ar.trim() || null,
      responsible_unit_en: draft.responsible_unit_en.trim() || null,
      responsible_unit_ar: draft.responsible_unit_ar.trim() || null,
      mobile_number: draft.mobile_number.trim() || null,
      emergency_number: draft.emergency_number.trim() || null,
      email: draft.email.trim() || null,
      keywords,
      priority: Number(draft.priority) || 50,
      is_active: true,
    });
    setSaving(false);
    if (error) return void toastError(error, lang);
    setDraft({ ...EMPTY });
    void refresh();
    toast.success(t("saved"));
  }

  const rows = contactsQuery.data ?? [];

  return (
    <section className="card-shadow space-y-4 rounded-xl border bg-card p-5">
      <div>
        <h2 className="text-sm font-semibold">{ar ? "معلومات الطوارئ" : "Emergency information"}</h2>
        <p className="text-xs text-muted-foreground">
          {ar
            ? "يجيب المساعد على أسئلة الطوارئ من هذه السجلات فقط."
            : "The Assistant answers emergency questions from these records only."}
        </p>
      </div>

      <ul className="space-y-3">
        {rows.map((c) => (
          <li key={c.id} className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  {(ar ? c.category_ar : c.category_en) ?? c.code}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(ar ? c.emergency_type_ar : c.emergency_type_en) ?? "—"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={c.is_active}
                  onCheckedChange={(checked) => patch(c.id, { is_active: checked })}
                />
                <Button variant="ghost" size="sm" onClick={() => remove(c.id)}>
                  {ar ? "حذف" : "Delete"}
                </Button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Input
                defaultValue={c.responsible_unit_en ?? ""}
                placeholder={ar ? "الجهة (EN)" : "Responsible unit (EN)"}
                onBlur={(e) =>
                  e.target.value !== (c.responsible_unit_en ?? "") &&
                  patch(c.id, { responsible_unit_en: e.target.value || null })
                }
              />
              <Input
                defaultValue={c.responsible_unit_ar ?? ""}
                placeholder={ar ? "الجهة (AR)" : "Responsible unit (AR)"}
                onBlur={(e) =>
                  e.target.value !== (c.responsible_unit_ar ?? "") &&
                  patch(c.id, { responsible_unit_ar: e.target.value || null })
                }
              />
              <Input
                defaultValue={c.emergency_number ?? ""}
                placeholder={ar ? "رقم الطوارئ" : "Emergency number"}
                onBlur={(e) =>
                  e.target.value !== (c.emergency_number ?? "") &&
                  patch(c.id, { emergency_number: e.target.value || null })
                }
              />
              <Input
                defaultValue={c.mobile_number ?? ""}
                placeholder={ar ? "الهاتف المتحرك" : "Mobile"}
                onBlur={(e) =>
                  e.target.value !== (c.mobile_number ?? "") &&
                  patch(c.id, { mobile_number: e.target.value || null })
                }
              />
              <Input
                defaultValue={c.email ?? ""}
                placeholder={ar ? "البريد الإلكتروني" : "Email"}
                onBlur={(e) =>
                  e.target.value !== (c.email ?? "") && patch(c.id, { email: e.target.value || null })
                }
              />
              <Input
                className="sm:col-span-2 lg:col-span-3"
                defaultValue={normalizeKeywords(c.keywords).join(", ")}
                placeholder={ar ? "كلمات مفتاحية (مفصولة بفواصل)" : "Matching keywords (comma separated)"}
                onBlur={(e) => {
                  const next = e.target.value
                    .split(",")
                    .map((k) => k.trim())
                    .filter(Boolean);
                  if (next.join("|") !== normalizeKeywords(c.keywords).join("|")) {
                    patch(c.id, { keywords: next });
                  }
                }}
              />
            </div>
          </li>
        ))}
        {!rows.length && (
          <li className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            {ar ? "لا توجد سجلات طوارئ." : "No emergency records yet."}
          </li>
        )}
      </ul>

      <div className="space-y-3 rounded-lg border border-dashed p-4">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">
          {ar ? "إضافة سجل طوارئ" : "Add an emergency record"}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["code", ar ? "الرمز" : "Code"],
              ["category_en", "Category (EN)"],
              ["category_ar", "التصنيف (AR)"],
              ["emergency_type_en", "Type (EN)"],
              ["emergency_type_ar", "النوع (AR)"],
              ["responsible_unit_en", "Unit (EN)"],
              ["responsible_unit_ar", "الجهة (AR)"],
              ["emergency_number", ar ? "رقم الطوارئ" : "Emergency number"],
              ["mobile_number", ar ? "الهاتف المتحرك" : "Mobile"],
              ["email", ar ? "البريد الإلكتروني" : "Email"],
              ["priority", ar ? "الأولوية" : "Priority"],
              ["keywords", ar ? "كلمات مفتاحية" : "Keywords (comma separated)"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="space-y-1">
              <Label className="text-xs" htmlFor={`ec-${key}`}>
                {label}
              </Label>
              <Input
                id={`ec-${key}`}
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <Button size="sm" onClick={create} disabled={saving || !draft.code.trim() || !draft.category_en.trim()}>
          {t("save")}
        </Button>
      </div>
    </section>
  );
}
