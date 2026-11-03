import { useState } from "react";
import { toastError } from "@/lib/errors/toast";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MetricCard } from "@/components/MetricCard";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/knowledge")({
  head: () => ({
    meta: [
      { title: "Knowledge management — Sanadi | UAEU" },
      {
        name: "description",
        content: "Maintain the bilingual FAQ answers and policy documents the student assistant cites.",
      },
      { property: "og:title", content: "Knowledge management — Sanadi | UAEU" },
      { property: "og:description", content: "Curate the answers the assistant is allowed to use." },
    ],
  }),
  component: KnowledgePage,
});

function KnowledgePage() {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const { isStaff, loading } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState({ unit: "", qEn: "", qAr: "", aEn: "", aAr: "" });

  const unitsQuery = useQuery({
    queryKey: ["service-units"],
    enabled: isStaff,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_units")
        .select("id, code, name_en, name_ar")
        .order("code");
      if (error) throw error;
      return data;
    },
  });

  const faqQuery = useQuery({
    queryKey: ["faq-items"],
    enabled: isStaff,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("faq_items")
        .select("id, question_en, question_ar, answer_en, answer_ar, is_active, service_unit_id")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
  });

  const docsQuery = useQuery({
    queryKey: ["knowledge-docs"],
    enabled: isStaff,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("knowledge_documents")
        .select("id, title, document_type, version, is_active, approval_status, effective_date")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  async function toggleFaq(id: string, isActive: boolean) {
    const { error } = await supabase.from("faq_items").update({ is_active: isActive }).eq("id", id);
    if (error) {
      toastError(error, lang);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["faq-items"] });
    toast.success(t("saved"));
  }

  async function toggleDoc(id: string, isActive: boolean) {
    const { error } = await supabase.from("knowledge_documents").update({ is_active: isActive }).eq("id", id);
    if (error) {
      toastError(error, lang);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["knowledge-docs"] });
    toast.success(t("saved"));
  }

  async function createFaq() {
    if (!draft.qEn.trim() || !draft.aEn.trim()) return;
    const { error } = await supabase.from("faq_items").insert({
      service_unit_id: draft.unit || null,
      question_en: draft.qEn.trim(),
      question_ar: draft.qAr.trim() || draft.qEn.trim(),
      answer_en: draft.aEn.trim(),
      answer_ar: draft.aAr.trim() || draft.aEn.trim(),
      is_active: true,
    });
    if (error) {
      toastError(error, lang);
      return;
    }
    setDraft({ unit: "", qEn: "", qAr: "", aEn: "", aAr: "" });
    void queryClient.invalidateQueries({ queryKey: ["faq-items"] });
    toast.success(t("saved"));
  }

  if (loading) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  if (!isStaff)
    return (
      <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("staff_only")}</p>
    );

  const term = search.trim().toLowerCase();
  const faqs = (faqQuery.data ?? []).filter(
    (f) => !term || `${f.question_en} ${f.question_ar}`.toLowerCase().includes(term),
  );
  const activeFaqs = (faqQuery.data ?? []).filter((f) => f.is_active).length;
  const activeDocs = (docsQuery.data ?? []).filter((d) => d.is_active).length;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{ar ? "إدارة المعرفة" : "Knowledge management"}</h1>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label={ar ? "أسئلة شائعة" : "FAQ entries"} value={faqQuery.data?.length ?? 0} />
        <MetricCard label={ar ? "أسئلة منشورة" : "Published FAQs"} value={activeFaqs} tone="success" />
        <MetricCard label={ar ? "وثائق" : "Documents"} value={docsQuery.data?.length ?? 0} />
        <MetricCard label={ar ? "وثائق فعّالة" : "Active documents"} value={activeDocs} tone="success" />
      </section>

      <section className="card-shadow space-y-4 rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">{ar ? "إضافة سؤال شائع" : "Add an FAQ answer"}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>{ar ? "الوحدة المسؤولة" : "Owning unit"}</Label>
            <Select value={draft.unit} onValueChange={(v) => setDraft({ ...draft, unit: v })}>
              <SelectTrigger>
                <SelectValue placeholder={ar ? "اختر وحدة" : "Select a unit"} />
              </SelectTrigger>
              <SelectContent>
                {(unitsQuery.data ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.code} · {ar ? u.name_ar : u.name_en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="qEn">Question (EN)</Label>
            <Input id="qEn" value={draft.qEn} onChange={(e) => setDraft({ ...draft, qEn: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="qAr">السؤال (AR)</Label>
            <Input id="qAr" value={draft.qAr} onChange={(e) => setDraft({ ...draft, qAr: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="aEn">Answer (EN)</Label>
            <Textarea id="aEn" rows={3} value={draft.aEn} onChange={(e) => setDraft({ ...draft, aEn: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="aAr">الإجابة (AR)</Label>
            <Textarea id="aAr" rows={3} value={draft.aAr} onChange={(e) => setDraft({ ...draft, aAr: e.target.value })} />
          </div>
        </div>
        <Button size="sm" onClick={createFaq} disabled={!draft.qEn.trim() || !draft.aEn.trim()}>
          {t("save")}
        </Button>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{ar ? "الأسئلة الشائعة" : "FAQ library"}</h2>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("search")}
            className="max-w-xs"
          />
        </div>
        {faqQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        ) : faqs.length ? (
          <ul className="space-y-2">
            {faqs.map((f) => (
              <li key={f.id} className="rounded-xl border bg-card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{ar ? f.question_ar : f.question_en}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{ar ? f.answer_ar : f.answer_en}</p>
                  </div>
                  <Switch
                    checked={f.is_active}
                    onCheckedChange={(checked) => toggleFaq(f.id, checked)}
                    aria-label={ar ? "نشر" : "Published"}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("none_yet")}</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{ar ? "الوثائق" : "Documents"}</h2>
        {docsQuery.data?.length ? (
          <ul className="space-y-2">
            {docsQuery.data.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-4 rounded-xl border bg-card p-4">
                <div>
                  <p className="text-sm font-medium">{d.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.document_type} · v{d.version} · {d.approval_status}
                    {d.effective_date ? ` · ${d.effective_date}` : ""}
                  </p>
                </div>
                <Switch checked={d.is_active} onCheckedChange={(checked) => toggleDoc(d.id, checked)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("none_yet")}</p>
        )}
      </section>
    </div>
  );
}