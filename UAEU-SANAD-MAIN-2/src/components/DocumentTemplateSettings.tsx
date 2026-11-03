import { useEffect, useMemo, useState } from "react";
import { toastError } from "@/lib/errors/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import {
  listDocumentTemplates,
  previewDocumentTemplate,
  saveDocumentTemplate,
} from "@/lib/documents.functions";

type Draft = {
  id: string;
  title: string;
  headerText: string;
  bodyTemplate: string;
  footerText: string;
  signatoryBlock: string;
  disclaimer: string;
  validityDays: number | null;
};

const PLACEHOLDERS = ["{{student_name}}", "{{student_id}}", "{{programme}}", "{{college}}", "{{academic_term}}"];

/** Administrator editing and live preview of the English and Arabic letter templates. */
export function DocumentTemplateSettings() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();

  const fetchTemplates = listDocumentTemplates;
  const preview = previewDocumentTemplate;
  const save = saveDocumentTemplate;

  const templates = useQuery({ queryKey: ["document-templates"], queryFn: () => fetchTemplates(), retry: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const rows = useMemo(() => templates.data ?? [], [templates.data]);
  const selected = rows.find((t) => t.id === selectedId) ?? rows[0] ?? null;

  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id);
    setDraft({
      id: selected.id,
      title: selected.title ?? "",
      headerText: selected.header_text ?? "",
      bodyTemplate: selected.body_template ?? "",
      footerText: selected.footer_text ?? "",
      signatoryBlock: selected.signatory_block ?? "",
      disclaimer: selected.disclaimer ?? "",
      validityDays: selected.validity_days ?? null,
    });
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const previewMutation = useMutation({
    mutationFn: () =>
      preview({
        data: {
          language: (selected?.language === "ar" ? "ar" : "en") as "en" | "ar",
          title: draft?.title ?? "",
          headerText: draft?.headerText ?? "",
          bodyTemplate: draft?.bodyTemplate ?? "",
          footerText: draft?.footerText ?? "",
          signatoryBlock: draft?.signatoryBlock ?? "",
          disclaimer: draft?.disclaimer ?? "",
        },
      }),
    onError: (e: Error) => toastError(e, lang),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: draft!.id,
          title: draft!.title,
          headerText: draft!.headerText || null,
          bodyTemplate: draft!.bodyTemplate,
          footerText: draft!.footerText || null,
          signatoryBlock: draft!.signatoryBlock || null,
          disclaimer: draft!.disclaimer || null,
          validityDays: draft!.validityDays,
        },
      }),
    onSuccess: () => {
      toast.success(ar ? "تم حفظ القالب" : "Template saved");
      void qc.invalidateQueries({ queryKey: ["document-templates"] });
    },
    onError: (e: Error) => toastError(e, lang),
  });

  if (templates.isError) return null;

  const rtl = selected?.language === "ar";
  const field = (
    key: keyof Draft,
    label: string,
    rowsCount = 3,
  ) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Textarea
        dir={rtl ? "rtl" : "ltr"}
        rows={rowsCount}
        value={(draft?.[key] as string) ?? ""}
        onChange={(e) => setDraft((d) => (d ? { ...d, [key]: e.target.value } : d))}
      />
    </div>
  );

  return (
    <section className="card-shadow space-y-4 rounded-xl border bg-card p-5">
      <div>
        <h2 className="text-sm font-semibold">{ar ? "قوالب الوثائق" : "Document templates"}</h2>
        <p className="text-xs text-muted-foreground">
          {ar
            ? "حرّر نص شهادة «إلى من يهمه الأمر» بالعربية والإنجليزية، واستعرض النتيجة ببيانات نموذجية قبل الحفظ."
            : "Edit the Arabic and English wording of the To Whom It May Concern letter and preview it with sample data before saving."}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {rows.map((t) => (
          <Button
            key={t.id}
            size="sm"
            variant={t.id === selected?.id ? "default" : "outline"}
            onClick={() => setSelectedId(t.id)}
          >
            {t.language === "ar" ? "العربية" : "English"} · v{t.version}
            {t.is_active ? null : <Badge variant="secondary" className="ms-2">{ar ? "غير مفعّل" : "inactive"}</Badge>}
          </Button>
        ))}
      </div>

      {draft ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">{ar ? "العنوان" : "Title"}</Label>
              <Input
                dir={rtl ? "rtl" : "ltr"}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            {field("headerText", ar ? "الترويسة" : "Header", 2)}
            {field("bodyTemplate", ar ? "نص الشهادة" : "Body", 10)}
            {field("signatoryBlock", ar ? "التوقيع" : "Signatory block", 2)}
            {field("footerText", ar ? "التذييل" : "Footer", 2)}
            {field("disclaimer", ar ? "إخلاء المسؤولية" : "Disclaimer", 2)}

            <p className="text-xs text-muted-foreground">
              {ar ? "الحقول المتاحة:" : "Available placeholders:"} <span dir="ltr">{PLACEHOLDERS.join(" ")}</span>
            </p>

            <div className="flex gap-2">
              <Button size="sm" onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending}>
                {ar ? "معاينة" : "Preview"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                {ar ? "حفظ" : "Save"}
              </Button>
            </div>
          </div>

          <div
            dir={rtl ? "rtl" : "ltr"}
            className="min-h-64 space-y-3 rounded-lg border bg-muted/30 p-4 text-sm whitespace-pre-wrap"
          >
            {previewMutation.data ? (
              <>
                <p className="font-semibold">{previewMutation.data.title}</p>
                {previewMutation.data.header ? (
                  <p className="text-xs text-muted-foreground">{previewMutation.data.header}</p>
                ) : null}
                <p>{previewMutation.data.body}</p>
                {previewMutation.data.signatory ? <p>{previewMutation.data.signatory}</p> : null}
                {previewMutation.data.footer ? (
                  <p className="text-xs text-muted-foreground">{previewMutation.data.footer}</p>
                ) : null}
                {previewMutation.data.disclaimer ? (
                  <p className="text-xs text-muted-foreground">{previewMutation.data.disclaimer}</p>
                ) : null}
                {previewMutation.data.unknownPlaceholders.length ? (
                  <p className="text-xs text-destructive">
                    {ar ? "حقول غير معروفة:" : "Unknown placeholders:"}{" "}
                    {previewMutation.data.unknownPlaceholders.join(", ")}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {ar ? "اضغط «معاينة» لعرض الشهادة ببيانات طالب نموذجية." : "Select Preview to render the letter with sample student data."}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
