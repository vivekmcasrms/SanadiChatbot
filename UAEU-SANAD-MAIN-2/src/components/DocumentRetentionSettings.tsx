import { useEffect, useState } from "react";
import { toastError } from "@/lib/errors/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import { getDocumentRetentionPolicies, updateDocumentRetentionPolicy } from "@/lib/documents.functions";

/** Administrator control of how long issued student documents stay available. */
export function DocumentRetentionSettings() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();

  const fetchPolicies = getDocumentRetentionPolicies;
  const savePolicy = updateDocumentRetentionPolicy;

  const policies = useQuery({ queryKey: ["document-retention"], queryFn: () => fetchPolicies() });
  const [draft, setDraft] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!policies.data) return;
    setDraft(Object.fromEntries(policies.data.map((p) => [p.document_type, p.retention_days])));
  }, [policies.data]);

  const save = useMutation({
    mutationFn: (v: { documentType: string; retentionDays: number }) => savePolicy({ data: v }),
    onSuccess: () => {
      toast.success(ar ? "تم تحديث مدة الاحتفاظ" : "Retention period updated");
      void qc.invalidateQueries({ queryKey: ["document-retention"] });
    },
    onError: (e: Error) => toastError(e, lang),
  });

  return (
    <section className="card-shadow space-y-4 rounded-xl border bg-card p-5">
      <div>
        <h2 className="text-sm font-semibold">
          {ar ? "مدة الاحتفاظ بالوثائق" : "Document retention"}
        </h2>
        <p className="text-xs text-muted-foreground">
          {ar
            ? "بعد انتهاء هذه المدة يُحذف ملف الوثيقة تلقائياً ويتوقف رابط التحقق."
            : "After this period the document file is deleted automatically and its verification link stops confirming it."}
        </p>
      </div>

      {(policies.data ?? []).map((p) => (
        <div key={p.document_type} className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
          <div className="min-w-48 flex-1">
            <Label className="text-xs text-muted-foreground">{ar ? p.label_ar : p.label_en}</Label>
            <p className="font-mono text-xs text-muted-foreground">{p.document_type}</p>
          </div>
          <div className="w-32 space-y-1">
            <Label htmlFor={`ret-${p.document_type}`} className="text-xs">
              {ar ? "عدد الأيام" : "Days"}
            </Label>
            <Input
              id={`ret-${p.document_type}`}
              type="number"
              min={1}
              max={365}
              value={draft[p.document_type] ?? p.retention_days}
              onChange={(e) =>
                setDraft((d) => ({ ...d, [p.document_type]: Number(e.target.value) }))
              }
            />
          </div>
          <Button
            size="sm"
            disabled={
              save.isPending || (draft[p.document_type] ?? p.retention_days) === p.retention_days
            }
            onClick={() =>
              save.mutate({
                documentType: p.document_type,
                retentionDays: draft[p.document_type] ?? p.retention_days,
              })
            }
          >
            {ar ? "حفظ" : "Save"}
          </Button>
        </div>
      ))}

      {policies.data && policies.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {ar ? "لا توجد سياسات محددة." : "No retention policies configured."}
        </p>
      ) : null}
    </section>
  );
}
