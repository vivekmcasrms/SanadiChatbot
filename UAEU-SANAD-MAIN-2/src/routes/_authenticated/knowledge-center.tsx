import { Fragment, useMemo, useState } from "react";
import { toastError } from "@/lib/errors/toast";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LibraryIntegrationPanel } from "@/components/LibraryIntegrationPanel";
import { OclcIntegrationPanel } from "@/components/OclcIntegrationPanel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MetricCard } from "@/components/MetricCard";
import { SourcesWorkspace } from "@/components/knowledge/SourcesWorkspace";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  decideDocumentApproval,
  exportCenterConfiguration,
  diagnoseDocumentSearch,
  getCenterOverview,
  getKnowledgeHealth,
  createConnector,
  listConnectors,
  listDocuments,
  listWebSources,
  listWebSourcePages,
  previewKnowledge,
  rebuildSemanticIndex,
  refreshWebSource,
  reprocessDocumentIndex,
  requestDocumentApproval,
  resolveConflict,
  retireDocument,
  reviewWebChange,
  saveWebSource,
  testConnector,
  updateConnector,
  updateGapStatus,
  updateTool,
  uploadDocument,
} from "@/lib/knowledge-center.functions";

export const Route = createFileRoute("/_authenticated/knowledge-center")({
  head: () => ({
    meta: [
      { title: "Knowledge & integrations centre — Sanadi | UAEU" },
      { name: "description", content: "Maintain documents, web sources, data connections and knowledge health for the UAEU student assistant without developer involvement." },
      { property: "og:title", content: "Knowledge & integrations centre — Sanadi | UAEU" },
      { property: "og:description", content: "Documents, web sources, API connections and knowledge health in one governed workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: KnowledgeCenterPage,
  validateSearch: (search: Record<string, unknown>) => ({
    tab: typeof search["tab"] === "string" ? (search["tab"] as string) : "sources",
  }),
});

const DOC_TYPES = ["policy", "regulation", "procedure", "service_guide", "student_handbook", "academic_guide", "circular", "form_instructions", "programme_requirement", "internship_guide", "graduation_guide", "other"];
const CONFIDENTIALITY = ["public", "student_authenticated", "staff_only", "restricted", "highly_restricted"];

function fmt(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function statusTone(status?: string | null) {
  if (!status) return "secondary" as const;
  if (["published", "approved", "healthy", "passed", "resolved", "auto_approved"].includes(status)) return "default" as const;
  if (["failed", "offline", "critical", "removed", "rejected"].includes(status)) return "destructive" as const;
  return "secondary" as const;
}

function KnowledgeCenterPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const { isStaff } = useAuth();
  const search = useSearch({ from: "/_authenticated/knowledge-center" });
  const navigate = useNavigate();
  const tab = search.tab && ["sources", "documents", "web", "connections", "test", "health", "activity"].includes(search.tab)
    ? search.tab
    : "sources";

  const overviewFn = getCenterOverview;
  const overview = useQuery({
    queryKey: ["kc", "overview"],
    queryFn: () => overviewFn({}),
    enabled: isStaff,
    retry: false,
  });
  const perms = overview.data?.permissions;
  const m = overview.data?.metrics;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["kc"] });


  const exportFn = exportCenterConfiguration;
  const exportConfig = useMutation({
    mutationFn: () => exportFn({}),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "knowledge-center-configuration.json";
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (e: Error) => toastError(e, lang),
  });

  if (!isStaff || overview.isError) {
    return (
      <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        {ar ? "هذه الصفحة متاحة لموظفي الجامعة المخوّلين فقط." : "This area is for authorised university staff."}
      </p>
    );
  }

  // Wait for the server to confirm access before mounting any tab query.
  if (!perms?.canViewCenter) {
    return (
      <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        {ar ? "جارٍ التحقق من الصلاحيات…" : "Checking your access…"}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{ar ? "مركز المعرفة والتكاملات" : "Knowledge & integrations centre"}</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {ar
              ? "إدارة الوثائق والمصادر الإلكترونية واتصالات البيانات وصحة المعرفة دون الحاجة إلى المطورين."
              : "Maintain documents, web sources, data connections and knowledge health without developer involvement."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => exportConfig.mutate()} disabled={exportConfig.isPending}>
            {ar ? "تصدير الإعدادات" : "Export configuration"}
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label={ar ? "وثائق منشورة" : "Published documents"} value={m?.publishedDocs ?? 0} hint={`${m?.activeDocs ?? 0} ${ar ? "فعّالة" : "active"}`} />
        <MetricCard label={ar ? "بانتظار الاعتماد" : "Pending approval"} value={m?.pendingDocs ?? 0} hint={`${m?.dueReview ?? 0} ${ar ? "تستحق المراجعة" : "due for review"}`} />
        <MetricCard label={ar ? "مصادر الويب" : "Web sources"} value={m?.webSources ?? 0} hint={`${m?.webChanged ?? 0} ${ar ? "تغيّرت" : "changed"}`} />
        <MetricCard label={ar ? "الموصلات السليمة" : "Healthy connectors"} value={m?.healthy ?? 0} hint={`${m?.degraded ?? 0} ${ar ? "متدهورة" : "degraded"} · ${m?.offline ?? 0} ${ar ? "متوقفة" : "offline"}`} />
        <MetricCard label={ar ? "الأسئلة الشائعة" : "Active FAQs"} value={m?.activeFaqs ?? 0} />
        <MetricCard label={ar ? "تعارضات" : "Open conflicts"} value={m?.conflicts ?? 0} hint={`${m?.criticalConflicts ?? 0} ${ar ? "حرجة" : "critical"}`} />
        <MetricCard label={ar ? "فجوات معرفية" : "Knowledge gaps"} value={m?.gaps ?? 0} />
        <MetricCard label={ar ? "متوسط زمن الاستجابة" : "Avg connector latency"} value={`${m?.avgLatency ?? 0} ms`} />
      </div>

      <Tabs value={tab} onValueChange={(v) => void navigate({ to: "/knowledge-center", search: { tab: v } })}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="sources">{ar ? "كل المصادر" : "All sources"}</TabsTrigger>
          <TabsTrigger value="documents">{ar ? "الوثائق" : "Documents"}</TabsTrigger>
          <TabsTrigger value="web">{ar ? "مصادر الويب" : "Web sources"}</TabsTrigger>
          <TabsTrigger value="connections">{ar ? "الاتصالات" : "APIs & data"}</TabsTrigger>
          <TabsTrigger value="test">{ar ? "اختبار المعرفة" : "Test knowledge"}</TabsTrigger>
          <TabsTrigger value="health">{ar ? "صحة المعرفة" : "Knowledge health"}</TabsTrigger>
          <TabsTrigger value="activity">{ar ? "النشاط" : "Activity"}</TabsTrigger>
        </TabsList>

        <TabsContent value="sources" className="pt-4">
          <SourcesWorkspace
            ar={ar}
            kind="all"
            canManage={!!perms?.canManageKnowledge}
            canManageIntegrations={!!perms?.canManageIntegrations}
            onChange={invalidate}
          />
        </TabsContent>
        <TabsContent value="documents" className="pt-4"><DocumentsTab ar={ar} canManage={!!perms?.canManageKnowledge} canApprove={!!perms?.canApproveKnowledge} onChange={invalidate} /></TabsContent>
        <TabsContent value="web" className="pt-4"><WebTab ar={ar} canManage={!!perms?.canManageKnowledge} onChange={invalidate} /></TabsContent>

        <TabsContent value="connections" className="pt-4"><ConnectionsTab ar={ar} canManage={!!perms?.canManageIntegrations} onChange={invalidate} /></TabsContent>
        <TabsContent value="test" className="pt-4"><TestKnowledgeTab ar={ar} /></TabsContent>
        <TabsContent value="health" className="pt-4"><HealthTab ar={ar} onChange={invalidate} /></TabsContent>
        <TabsContent value="activity" className="pt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border p-4">
              <h2 className="mb-3 font-medium">{ar ? "آخر الإجراءات" : "Recent activity"}</h2>
              <ul className="space-y-2 text-sm">
                {(overview.data?.activity ?? []).map((a) => (
                  <li key={a.id} className="flex justify-between gap-3 border-b pb-2 last:border-0">
                    <span><span className="font-medium">{a.action}</span> — {a.summary}</span>
                    <span className="shrink-0 text-muted-foreground">{fmt(a.created_at)}</span>
                  </li>
                ))}
                {(overview.data?.activity ?? []).length === 0 ? <li className="text-muted-foreground">{ar ? "لا يوجد نشاط بعد." : "No activity yet."}</li> : null}
              </ul>
            </section>
            <section className="rounded-lg border p-4">
              <h2 className="mb-3 font-medium">{ar ? "معالجة فاشلة" : "Processing failures"}</h2>
              <ul className="space-y-2 text-sm">
                {(overview.data?.failures ?? []).map((f) => (
                  <li key={f.id} className="border-b pb-2 last:border-0">
                    <div className="font-medium">{f.title}</div>
                    <div className="text-muted-foreground">{f.extraction_error ?? `${f.extraction_status} / ${f.indexing_status}`}</div>
                  </li>
                ))}
                {(overview.data?.failures ?? []).length === 0 ? <li className="text-muted-foreground">{ar ? "لا توجد أعطال." : "No failures."}</li> : null}
              </ul>
            </section>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ documents */

const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  md: "text/markdown",
  txt: "text/plain",
};

function guessMime(name: string): string {
  return EXT_MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

function DocumentsTab({ ar, canManage, canApprove, onChange }: { ar: boolean; canManage: boolean; canApprove: boolean; onChange: () => void }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const listFn = listDocuments;
  const list = useQuery({ queryKey: ["kc", "documents", search, status], queryFn: () => listFn({ data: { search, status } }) });

  const uploadFn = uploadDocument;
  const requestFn = requestDocumentApproval;
  const decideFn = decideDocumentApproval;
  const retireFn = retireDocument;

  const [form, setForm] = useState({
    title: "", documentType: "policy", categoryId: "", ownerUnitId: "", language: "en" as "en" | "ar",
    version: "1.0", effectiveDate: new Date().toISOString().slice(0, 10), reviewDate: "", confidentialityLevel: "public", text: "",
  });
  const [files, setFiles] = useState<File[]>([]);
  const [stage, setStage] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      const queue: (File | null)[] = files.length ? files : [null];
      const results: { title: string; chunks: number; ok: boolean }[] = [];
      for (const [i, file] of queue.entries()) {
        const label = queue.length > 1 ? ` (${i + 1}/${queue.length})` : "";
        let storagePath: string | null = null;
        if (file) {
          setStage((ar ? "جارٍ رفع الملف…" : "Uploading file…") + label);
          const safe = file.name.replace(/[^\w.\-\u0600-\u06FF]+/g, "_").slice(-120);
          const path = `${crypto.randomUUID()}/${safe}`;
          const { error } = await supabase.storage.from("knowledge-files").upload(path, file, {
            contentType: file.type || "application/octet-stream",
            upsert: false,
          });
          if (error) throw new Error(error.message);
          storagePath = path;
        }
        setStage((ar ? "استخراج النص والفهرسة…" : "Extracting text and indexing…") + label);
        const title =
          queue.length > 1 && file
            ? file.name.replace(/\.[^.]+$/, "").slice(0, 120)
            : form.title;
        const r = await uploadFn({
          data: {
            title,
            documentType: form.documentType,
            categoryId: form.categoryId || null,
            ownerUnitId: form.ownerUnitId || null,
            language: form.language,
            version: form.version,
            effectiveDate: form.effectiveDate,
            reviewDate: form.reviewDate || null,
            confidentialityLevel: form.confidentialityLevel as "public",
            fileName: file ? file.name : `${form.title.slice(0, 60)}.md`,
            mimeType: file ? (file.type || guessMime(file.name)) : "text/markdown",
            sizeBytes: file ? file.size : form.text.length,
            textContent: queue.length > 1 ? "" : form.text,
            storagePath,
          },
        });
        results.push({ title, chunks: r.chunks, ok: r.processingStatus === "ready_for_review" });
      }
      return results;
    },
    onSettled: () => setStage(null),
    onSuccess: (results) => {
      const ok = results.filter((r) => r.ok).length;
      const chunks = results.reduce((s, r) => s + r.chunks, 0);
      toast.success(
        ar
          ? `تمت معالجة ${ok}/${results.length} وثيقة (${chunks} مقطعاً)`
          : `Processed ${ok} of ${results.length} document(s) into ${chunks} chunks`,
      );
      setForm({ ...form, title: "", text: "" });
      setFiles([]);
      list.refetch();
      onChange();
    },
    onError: (e: Error) => toastError(e, ar ? "ar" : "en"),
  });

  const act = useMutation({
    mutationFn: async (a: { kind: "request" | "approve" | "reject" | "retire"; id: string }) => {
      if (a.kind === "request") return requestFn({ data: { documentId: a.id } });
      if (a.kind === "retire") return retireFn({ data: { documentId: a.id, reason: "Retired from the knowledge centre" } });
      return decideFn({ data: { documentId: a.id, decision: a.kind === "approve" ? "approved" : "rejected", notes: a.kind === "approve" ? "Approved for publication" : "Returned for correction" } });
    },
    onSuccess: () => { toast.success(ar ? "تم التحديث" : "Updated"); list.refetch(); onChange(); },
    onError: (e: Error) => toastError(e, ar ? "ar" : "en"),
  });

  const reindexFn = reprocessDocumentIndex;
  const diagnoseFn = diagnoseDocumentSearch;
  const [diagnoseId, setDiagnoseId] = useState<string | null>(null);
  const [diagQuery, setDiagQuery] = useState("");

  const reindex = useMutation({
    mutationFn: (documentId: string) => reindexFn({ data: { documentId } }),
    onSuccess: (r) => {
      toast.success(
        ar
          ? `أُعيدت الفهرسة: ${r.chunks} مقطعاً، ${r.sections.length} قسماً`
          : `Re-indexed into ${r.chunks} chunks across ${r.sections.length} sections`,
      );
      list.refetch();
      onChange();
    },
    onError: (e: Error) => toastError(e, ar ? "ar" : "en"),
  });

  const diagnose = useMutation({
    mutationFn: (v: { documentId: string; query: string }) => diagnoseFn({ data: v }),
    onError: (e: Error) => toastError(e, ar ? "ar" : "en"),
  });

  return (
    <div className="space-y-4">
      {canManage ? (
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">{ar ? "إضافة وثيقة" : "Add a document"}</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="md:col-span-2"><Label>{ar ? "العنوان" : "Title"}</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div>
              <Label>{ar ? "النوع" : "Type"}</Label>
              <Select value={form.documentType} onValueChange={(v) => setForm({ ...form, documentType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>{ar ? "الوحدة المالكة" : "Owner unit"}</Label>
              <Select value={form.ownerUnitId} onValueChange={(v) => setForm({ ...form, ownerUnitId: v })}>
                <SelectTrigger><SelectValue placeholder={ar ? "اختر" : "Select"} /></SelectTrigger>
                <SelectContent>{(list.data?.units ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{ar ? u.name_ar : u.name_en}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>{ar ? "التصنيف" : "Category"}</Label>
              <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                <SelectTrigger><SelectValue placeholder={ar ? "اختر" : "Select"} /></SelectTrigger>
                <SelectContent>{(list.data?.categories ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{ar ? c.name_ar : c.name_en}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>{ar ? "اللغة" : "Language"}</Label>
              <Select value={form.language} onValueChange={(v) => setForm({ ...form, language: v as "en" | "ar" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="ar">العربية</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>{ar ? "الإصدار" : "Version"}</Label><Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></div>
            <div><Label>{ar ? "تاريخ السريان" : "Effective date"}</Label><Input type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} /></div>
            <div><Label>{ar ? "تاريخ المراجعة" : "Review date"}</Label><Input type="date" value={form.reviewDate} onChange={(e) => setForm({ ...form, reviewDate: e.target.value })} /></div>
            <div>
              <Label>{ar ? "السرية" : "Confidentiality"}</Label>
              <Select value={form.confidentialityLevel} onValueChange={(v) => setForm({ ...form, confidentialityLevel: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CONFIDENTIALITY.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="md:col-span-3">
              <Label>{ar ? "ملفات الوثائق (يمكن اختيار أكثر من ملف)" : "Document files (you can add more than one)"}</Label>
              <Input
                type="file"
                multiple
                accept=".pdf,.docx,.pptx,.xlsx,.csv,.md,.txt"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  if (!picked.length) return;
                  setFiles((prev) => {
                    const merged = [...prev];
                    for (const f of picked) if (!merged.some((m) => m.name === f.name && m.size === f.size)) merged.push(f);
                    return merged;
                  });
                  const first = picked[0];
                  if (first && form.title.trim().length < 3)
                    setForm((s) => ({ ...s, title: first.name.replace(/\.[^.]+$/, "").slice(0, 120) }));
                  e.target.value = "";
                }}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {ar
                  ? "PDF أو Word أو PowerPoint أو Excel أو CSV أو نص (حتى 20 ميغابايت لكل ملف). اختر عدة ملفات أو أضفها على دفعات — تتم معالجة كل ملف كوثيقة مستقلة، ويصبح اسم الملف عنوانها."
                  : "PDF, Word, PowerPoint, Excel, CSV or text — up to 20 MB each. Pick several at once or add more in batches; each file becomes its own document, titled from the file name."}
              </p>
              {files.length ? (
                <ul className="mt-2 space-y-1 text-xs">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2">
                      <span className="truncate">{f.name} · {(f.size / 1024).toFixed(0)} KB</span>
                      <button type="button" className="underline" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                        {ar ? "إزالة" : "Remove"}
                      </button>
                    </li>
                  ))}
                  <li>
                    <button type="button" className="underline" onClick={() => setFiles([])}>{ar ? "مسح الكل" : "Clear all"}</button>
                  </li>
                </ul>
              ) : null}
            </div>
            <div className="md:col-span-3">
              <Label>{ar ? "المحتوى (اختياري إذا تم رفع ملف)" : "Content (optional when a file is attached)"}</Label>
              <Textarea rows={6} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder={ar ? "الصق نص الوثيقة بعناوين ## للأقسام" : "Paste the document text; use ## headings for sections"} />
            </div>
          </div>
          <Button
            className="mt-3"
            onClick={() => upload.mutate()}
            disabled={upload.isPending || (files.length === 0 && (form.title.length < 3 || form.text.length < 20))}
          >
            {upload.isPending
              ? (stage ?? (ar ? "جارٍ المعالجة…" : "Processing…"))
              : files.length > 1
                ? ar ? `معالجة ${files.length} وثائق` : `Process ${files.length} documents`
                : ar ? "معالجة وإرسال للمراجعة" : "Process and send for review"}
          </Button>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder={ar ? "بحث بالعنوان" : "Search by title"} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["all", "draft", "pending_review", "approved", "published", "rejected", "superseded", "retired"].map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-start">
            <tr>
              {[ar ? "الوثيقة" : "Document", ar ? "النوع" : "Type", ar ? "الإصدار" : "Version", ar ? "الحالة" : "Status", ar ? "المعالجة" : "Processing", ar ? "المراجعة" : "Review", ""].map((h, i) => <th key={i} className="p-1 text-start font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {(list.data?.documents ?? []).map((d) => (
              <tr key={d.id} className="border-t align-top">
                <td className="p-1">
                  <div className="font-medium">{d.title}</div>
                  <div className="text-xs text-muted-foreground">{d.language?.toUpperCase()} · {d.confidentiality_level?.replace(/_/g, " ")}{d.superseded_by_document_id ? ` · ${ar ? "مستبدلة" : "superseded"}` : ""}</div>
                </td>
                <td className="p-1">{d.document_type?.replace(/_/g, " ")}</td>
                <td className="p-1">{d.version}</td>
                <td className="p-1"><Badge variant={statusTone(d.approval_status)}>{d.approval_status?.replace(/_/g, " ")}</Badge></td>
                <td className="p-1 text-xs">{d.extraction_status} / {d.indexing_status} / {d.quality_status}</td>
                <td className="p-1 text-xs">{(() => {
                  if (!d.review_date) return "—";
                  const dt = new Date(d.review_date);
                  if (Number.isNaN(dt.getTime())) return d.review_date;
                  const day = String(dt.getDate()).padStart(2, "0");
                  const mon = dt.toLocaleString("en-GB", { month: "short" });
                  const year = dt.getFullYear();
                  const time = dt.toLocaleString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  });
                  return `${day}-${mon}-${year}, ${time}`;
                })()}</td>
                <td className="p-1">
                  <div className="flex flex-wrap gap-1">
                    {canManage && ["draft", "rejected"].includes(d.approval_status ?? "") ? <Button size="sm" variant="outline" onClick={() => act.mutate({ kind: "request", id: d.id })}>{ar ? "طلب اعتماد" : "Request approval"}</Button> : null}
                    {canApprove && d.approval_status === "pending_review" ? (
                      <>
                        <Button size="sm" onClick={() => act.mutate({ kind: "approve", id: d.id })}>{ar ? "اعتماد" : "Approve"}</Button>
                        <Button size="sm" variant="outline" onClick={() => act.mutate({ kind: "reject", id: d.id })}>{ar ? "رفض" : "Reject"}</Button>
                      </>
                    ) : null}
                    {canManage ? (
                      <Button size="sm" variant="outline" disabled={reindex.isPending} onClick={() => reindex.mutate(d.id)}>
                        {ar ? "إعادة فهرسة" : "Re-index"}
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={() => setDiagnoseId(diagnoseId === d.id ? null : d.id)}>
                      {ar ? "تشخيص الاسترجاع" : "Diagnose"}
                    </Button>
                    {canManage && d.is_active ? <Button size="sm" variant="ghost" onClick={() => act.mutate({ kind: "retire", id: d.id })}>{ar ? "إيقاف" : "Retire"}</Button> : null}
                  </div>
                  {diagnoseId === d.id ? (
                    <div className="mt-2 w-full max-w-xl space-y-2 rounded-md border bg-muted/30 p-2">
                      <div className="flex gap-2">
                        <Input
                          value={diagQuery}
                          onChange={(e) => setDiagQuery(e.target.value)}
                          placeholder={ar ? "مثال: ما هدف سياسة السكن؟" : "e.g. What is the objective of the housing policy?"}
                        />
                        <Button size="sm" disabled={diagnose.isPending || diagQuery.trim().length < 2} onClick={() => diagnose.mutate({ documentId: d.id, query: diagQuery })}>
                          {ar ? "فحص" : "Run"}
                        </Button>
                      </div>
                      {diagnose.data && diagnose.variables?.documentId === d.id ? (
                        <div className="space-y-2 text-xs">
                          {diagnose.data.blockers.length ? (
                            <ul className="list-disc space-y-0.5 ps-4 text-destructive">
                              {diagnose.data.blockers.map((b, i) => <li key={i}>{b}</li>)}
                            </ul>
                          ) : (
                            <p className="text-muted-foreground">{ar ? "الوثيقة قابلة للبحث." : "Document is searchable."}</p>
                          )}
                          <p className="text-muted-foreground">
                            {ar ? "مرادفات الأقسام" : "Section concepts"}: {diagnose.data.sectionTerms.join(", ") || "—"} · {diagnose.data.totalChunks} {ar ? "مقطعاً" : "chunks"}
                          </p>
                          {diagnose.data.matches.map((m) => (
                            <div key={m.chunkIndex} className="rounded border bg-background p-2">
                              <div className="font-medium">
                                #{m.chunkIndex} · {m.sectionTitle ?? (ar ? "بدون عنوان" : "untitled")} · p.{m.pageNumber ?? "—"} · {m.score}
                                {m.headingMatch ? ` · ${ar ? "تطابق عنوان" : "heading match"}` : ""}
                              </div>
                              <p className="text-muted-foreground">{m.preview}</p>
                            </div>
                          ))}
                          <p className="font-medium">{ar ? "نتائج البحث الحية" : "Live search results"}</p>
                          {diagnose.data.live.length === 0 ? <p className="text-muted-foreground">—</p> : null}
                          {diagnose.data.live.map((p, i) => (
                            <div key={i} className="rounded border bg-background p-2">
                              <div className="font-medium">{p.title}{p.sectionTitle ? ` § ${p.sectionTitle}` : ""} · {p.score}</div>
                              <p className="text-muted-foreground">{p.snippet}</p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
            {(list.data?.documents ?? []).length === 0 ? <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">{ar ? "لا توجد وثائق." : "No documents yet."}</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- web sources */

function WebTab({ ar, canManage, onChange }: { ar: boolean; canManage: boolean; onChange: () => void }) {
  const listFn = listWebSources;
  const list = useQuery({ queryKey: ["kc", "web"], queryFn: () => listFn({}) });
  const saveFn = saveWebSource;
  const refreshFn = refreshWebSource;
  const reviewFn = reviewWebChange;

  const [form, setForm] = useState({
    language: "en" as "en" | "ar", sourceCategory: "service_guide",
    refreshFrequency: "weekly", trustedAutoRefresh: false,
    crawlScope: "single_page" as "single_page" | "selected_pages" | "same_domain",
    maxDepth: 1, maxPages: 25, seedUrls: "", allowedPaths: "", excludedPaths: "",
  });
  const [entries, setEntries] = useState<{ title: string; url: string }[]>([{ title: "", url: "" }]);
  const [openPages, setOpenPages] = useState<string | null>(null);

  const lines = (value: string) => value.split(/[\n,]/).map((v) => v.trim()).filter(Boolean);
  const validEntries = entries.filter((e) => e.title.trim().length >= 3 && /^https:\/\//i.test(e.url.trim()));

  const save = useMutation({
    mutationFn: async () => {
      for (const entry of validEntries) {
        await saveFn({ data: {
          title: entry.title.trim(), url: entry.url.trim(), language: form.language,
          sourceCategory: form.sourceCategory, refreshFrequency: form.refreshFrequency,
          trustedAutoRefresh: form.trustedAutoRefresh, confidentialityLevel: "public", ownerUnitId: null,
          crawlScope: form.crawlScope, maxDepth: form.maxDepth, maxPages: form.maxPages,
          seedUrls: lines(form.seedUrls), allowedPaths: lines(form.allowedPaths), excludedPaths: lines(form.excludedPaths),
        } });
      }
      return validEntries.length;
    },
    onSuccess: (count) => {
      toast.success(ar ? `تم تسجيل ${count} مصدراً` : `Registered ${count} web source(s)`);
      setEntries([{ title: "", url: "" }]);
      setForm({ ...form, seedUrls: "" });
      list.refetch();
      onChange();
    },
    onError: (e: Error) => toastError(e, ar ? "ar" : "en"),
  });
  const refresh = useMutation({
    mutationFn: (id: string) => refreshFn({ data: { id, revisionSeed: String(Date.now()) } }),
    onSuccess: (r) => {
      if (!r.ok) toastError(r.error ?? (ar ? "تعذّرت الفهرسة." : "Indexing failed."), ar ? "ar" : "en");
      else toast.success(ar
        ? `تمت الفهرسة: ${r.indexed} صفحة · ${r.chunks} مقطع${r.colleges ? ` · ${r.colleges} كلية` : ""}`
        : `Indexed ${r.indexed} page(s) · ${r.chunks} passage(s)${r.colleges ? ` · ${r.colleges} colleges verified` : ""}`);
      list.refetch(); onChange();
    },
    onError: (e: Error) => toastError(e, ar ? "ar" : "en"),
  });
  const review = useMutation({
    mutationFn: (a: { changeId: string; decision: "approved" | "rejected" }) => reviewFn({ data: a }),
    onSuccess: () => { toast.success(ar ? "تمت المراجعة" : "Reviewed"); list.refetch(); onChange(); },
    onError: (e: Error) => toastError(e, ar ? "ar" : "en"),
  });

  const pendingChanges = (list.data?.changes ?? []).filter((c) => c.review_status === "pending");

  return (
    <div className="space-y-4">
      {canManage ? (
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">{ar ? "تسجيل مصادر إلكترونية" : "Register website sources"}</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="md:col-span-3 space-y-2">
              {entries.map((entry, i) => (
                <div key={i} className="grid gap-3 md:grid-cols-3">
                  <div>
                    <Label>{ar ? "العنوان" : "Title"}</Label>
                    <Input
                      value={entry.title}
                      onChange={(e) => setEntries((prev) => prev.map((p, j) => (j === i ? { ...p, title: e.target.value } : p)))}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label>URL</Label>
                    <div className="flex gap-2">
                      <Input
                        value={entry.url}
                        onChange={(e) => setEntries((prev) => prev.map((p, j) => (j === i ? { ...p, url: e.target.value } : p)))}
                      />
                      {entries.length > 1 ? (
                        <Button variant="ghost" size="sm" onClick={() => setEntries((prev) => prev.filter((_, j) => j !== i))}>
                          {ar ? "إزالة" : "Remove"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setEntries((prev) => [...prev, { title: "", url: "" }])}>
                {ar ? "إضافة رابط آخر" : "Add another URL"}
              </Button>
            </div>
            <div>
              <Label>{ar ? "اللغة" : "Language"}</Label>
              <Select value={form.language} onValueChange={(v) => setForm({ ...form, language: v as "en" | "ar" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="ar">العربية</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label>{ar ? "التحديث" : "Refresh"}</Label>
              <Select value={form.refreshFrequency} onValueChange={(v) => setForm({ ...form, refreshFrequency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["daily", "weekly", "monthly", "manual"].map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>{ar ? "نطاق الزحف" : "Crawl scope"}</Label>
              <Select value={form.crawlScope} onValueChange={(v) => setForm({ ...form, crawlScope: v as typeof form.crawlScope })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="single_page">{ar ? "صفحة واحدة" : "Single page"}</SelectItem>
                  <SelectItem value="selected_pages">{ar ? "صفحات محددة" : "Selected pages"}</SelectItem>
                  <SelectItem value="same_domain">{ar ? "زحف داخل النطاق" : "Same-domain crawl"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.crawlScope === "selected_pages" ? (
              <div className="md:col-span-3">
                <Label>{ar ? "روابط إضافية (سطر لكل رابط)" : "Additional page URLs (one per line)"}</Label>
                <Textarea rows={3} value={form.seedUrls} onChange={(e) => setForm({ ...form, seedUrls: e.target.value })} placeholder={import.meta.env["VITE_COLLEGES_URL"]} />
              </div>
            ) : null}
            {form.crawlScope === "same_domain" ? (
              <>
                <div>
                  <Label>{ar ? "العمق الأقصى" : "Max depth"}</Label>
                  <Input type="number" min={0} max={3} value={form.maxDepth} onChange={(e) => setForm({ ...form, maxDepth: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>{ar ? "الحد الأقصى للصفحات" : "Max pages"}</Label>
                  <Input type="number" min={1} max={300} value={form.maxPages} onChange={(e) => setForm({ ...form, maxPages: Number(e.target.value) })} />
                </div>
                <div className="md:col-span-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <Label>{ar ? "مسارات مسموحة" : "Allowed path prefixes"}</Label>
                    <Textarea rows={2} value={form.allowedPaths} onChange={(e) => setForm({ ...form, allowedPaths: e.target.value })} placeholder="/en/colleges" />
                  </div>
                  <div>
                    <Label>{ar ? "مسارات مستثناة" : "Excluded path prefixes"}</Label>
                    <Textarea rows={2} value={form.excludedPaths} onChange={(e) => setForm({ ...form, excludedPaths: e.target.value })} placeholder="/en/news" />
                  </div>
                </div>
              </>
            ) : null}
            <div className="flex items-end gap-2">
              <Switch checked={form.trustedAutoRefresh} onCheckedChange={(v) => setForm({ ...form, trustedAutoRefresh: v })} />
              <span className="text-sm">{ar ? "تحديث تلقائي موثوق" : "Trusted auto-refresh"}</span>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {ar
              ? "يحترم الزحف ملف robots.txt ويقتصر على النطاق نفسه عبر HTTPS. بعد التسجيل اضغط «فهرسة» لتحويل الصفحات إلى معرفة قابلة للاسترجاع."
              : "Crawling respects robots.txt and stays on the same HTTPS domain. After registering, run Index to turn the pages into retrievable knowledge."}
          </p>
          <Button className="mt-3" onClick={() => save.mutate()} disabled={save.isPending || validEntries.length === 0}>
            {validEntries.length > 1 ? (ar ? `تسجيل ${validEntries.length} مصادر` : `Register ${validEntries.length} sources`) : ar ? "تسجيل" : "Register"}
          </Button>
        </section>
      ) : null}

      {pendingChanges.length ? (
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">{ar ? "تغييرات بانتظار المراجعة" : "Changes awaiting review"}</h2>
          <ul className="space-y-2 text-sm">
            {pendingChanges.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0">
                <span>
                  <Badge variant={c.change_type === "major" ? "destructive" : "secondary"}>{c.change_type}</Badge>{" "}
                  {c.change_summary} · {c.change_percentage ?? 0}% · {fmt(c.detected_at)}
                </span>
                <span className="flex gap-1">
                  <Button size="sm" onClick={() => review.mutate({ changeId: c.id, decision: "approved" })}>{ar ? "اعتماد" : "Approve"}</Button>
                  <Button size="sm" variant="outline" onClick={() => review.mutate({ changeId: c.id, decision: "rejected" })}>{ar ? "رفض" : "Reject"}</Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50"><tr>{[ar ? "المصدر" : "Source", ar ? "الاستيعاب" : "Ingestion", ar ? "الحالة" : "Status", ar ? "آخر فحص" : "Last checked", ""].map((h, i) => <th key={i} className="p-2 text-start font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {(list.data?.sources ?? []).map((s) => (
              <Fragment key={s.id}>
                <tr className="border-t align-top">
                  <td className="p-2">
                    <div className="font-medium">{s.title}</div>
                    <div className="text-xs text-muted-foreground break-all">{s.url}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{(s.crawl_scope ?? "single_page").replace(/_/g, " ")}</div>
                  </td>
                  <td className="p-2 text-xs">
                    <Badge variant={s.ingestion_status === "indexed" ? "secondary" : s.ingestion_status === "failed" ? "destructive" : "outline"}>
                      {s.ingestion_status ?? "pending"}
                    </Badge>
                    <div className="mt-1">
                      {ar
                        ? `${s.pages_indexed ?? 0}/${s.pages_discovered ?? 0} صفحة · ${s.chunk_count ?? 0} مقطع`
                        : `${s.pages_indexed ?? 0}/${s.pages_discovered ?? 0} pages · ${s.chunk_count ?? 0} passages`}
                    </div>
                    {s.pages_failed ? <div className="text-destructive">{ar ? `${s.pages_failed} فشل` : `${s.pages_failed} failed`}</div> : null}
                    {s.last_error ? <div className="mt-1 max-w-[22rem] text-destructive">{s.last_error}</div> : null}
                  </td>
                  <td className="p-2 space-x-1">
                    <Badge variant={statusTone(s.health_status)}>{s.health_status}</Badge>
                    <Badge variant={statusTone(s.approval_status)}>{s.approval_status?.replace(/_/g, " ")}</Badge>
                  </td>
                  <td className="p-2 text-xs">{fmt(s.last_checked_at)}</td>
                  <td className="p-2 space-x-1 whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setOpenPages(openPages === s.id ? null : s.id)}>
                      {ar ? "الصفحات" : "Pages"}
                    </Button>
                    {canManage ? <Button size="sm" variant="outline" onClick={() => refresh.mutate(s.id)} disabled={refresh.isPending}>{ar ? "فهرسة" : "Index"}</Button> : null}
                  </td>
                </tr>
                {openPages === s.id ? (
                  <tr className="border-t bg-muted/30">
                    <td colSpan={5} className="p-3"><WebSourcePages ar={ar} sourceId={s.id} /></td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
            {(list.data?.sources ?? []).length === 0 ? <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">{ar ? "لا توجد مصادر." : "No web sources yet."}</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Per-page ingestion outcome so an admin can see exactly what became knowledge. */
function WebSourcePages({ ar, sourceId }: { ar: boolean; sourceId: string }) {
  const pagesFn = listWebSourcePages;
  const pages = useQuery({ queryKey: ["kc", "web", "pages", sourceId], queryFn: () => pagesFn({ data: { id: sourceId } }) });
  if (pages.isLoading) return <p className="text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>;
  if (pages.isError) {
    return (
      <p className="text-sm text-destructive">
        {ar ? "تعذّر تحميل الصفحات." : "Could not load pages for this source."}
      </p>
    );
  }
  const rows = pages.data?.pages ?? [];
  if (!rows.length) return <p className="text-sm text-muted-foreground">{ar ? "لم تتم فهرسة أي صفحة بعد. اضغط «فهرسة»." : "No pages crawled yet — run Index."}</p>;
  return (
    <ul className="space-y-1 text-xs">
      {rows.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-1 last:border-0">
          <span className="break-all">
            <Badge variant={p.status === "indexed" ? "secondary" : "destructive"}>{p.status}</Badge>{" "}
            {p.title ?? p.url}
            <span className="ms-1 text-muted-foreground">({p.url})</span>
          </span>
          <span className="text-muted-foreground">
            {ar ? `عمق ${p.depth} · ${p.chunk_count} مقطع` : `depth ${p.depth} · ${p.chunk_count} passages`}
            {p.error_reason ? ` · ${p.error_reason}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}


/* ---------------------------------------------------------------- connections */

function ConnectionsTab({ ar, canManage, onChange }: { ar: boolean; canManage: boolean; onChange: () => void }) {
  const listFn = listConnectors;
  const list = useQuery({ queryKey: ["kc", "connectors"], queryFn: () => listFn({}) });
  const testFn = testConnector;
  const updateConnectorFn = updateConnector;
  const updateToolFn = updateTool;
  const [selected, setSelected] = useState<string | null>(null);

  const test = useMutation({
    mutationFn: (connectorId: string) => testFn({ data: { connectorId } }),
    onSuccess: (r) => { toast[r.status === "failed" ? "error" : "success"](`${r.status} · ${r.latencyMs} ms${r.schemaChanged ? " · schema changed" : ""}`); list.refetch(); onChange(); },
    onError: (e: Error) => toastError(e, ar ? "ar" : "en"),
  });
  const toggleConnector = useMutation({
    mutationFn: (a: { id: string; isActive?: boolean; readEnabled?: boolean }) => updateConnectorFn({ data: a }),
    onSuccess: () => { list.refetch(); onChange(); },
    onError: (e: Error) => toastError(e, ar ? "ar" : "en"),
  });
  const toggleTool = useMutation({
    mutationFn: (a: { id: string; enabled: boolean }) => updateToolFn({ data: a }),
    onSuccess: () => { list.refetch(); onChange(); },
    onError: (e: Error) => toastError(e, ar ? "ar" : "en"),
  });

  const tools = useMemo(() => (list.data?.tools ?? []).filter((t) => !selected || t.connector_id === selected), [list.data, selected]);

  const createFn = createConnector;
  const blankApi = {
    displayNameEn: "", sourceSystem: "", baseUrl: "", authenticationType: "none",
    credentialSecretName: "", usage: "live" as "live" | "knowledge", environment: "development" as "development" | "staging" | "production",
  };
  const [apis, setApis] = useState([{ ...blankApi }]);
  const validApis = apis.filter((a) => a.displayNameEn.trim().length >= 3 && a.sourceSystem.trim().length >= 2 && a.baseUrl.startsWith("http"));

  const createApis = useMutation({
    mutationFn: async () => {
      for (const a of validApis) {
        await createFn({ data: {
          displayNameEn: a.displayNameEn.trim(),
          sourceSystem: a.sourceSystem.trim(),
          connectorType: "rest_api",
          environment: a.environment,
          baseUrl: a.baseUrl.trim(),
          authenticationType: a.authenticationType,
          credentialSecretName: a.credentialSecretName.trim() || undefined,
          dataClassification: "internal",
          usage: a.usage,
        } });
      }
      return validApis.length;
    },
    onSuccess: (count) => {
      toast.success(ar ? `تمت إضافة ${count} اتصال` : `Added ${count} data connection(s)`);
      setApis([{ ...blankApi }]);
      list.refetch();
      onChange();
    },
    onError: (e: Error) => toastError(e, ar ? "ar" : "en"),
  });

  const patchApi = (i: number, patch: Partial<typeof blankApi>) =>
    setApis((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <div className="space-y-4">
      {canManage ? (
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">{ar ? "إضافة اتصالات بيانات" : "Add data connections"}</h2>
          <div className="space-y-4">
            {apis.map((a, i) => (
              <div key={i} className="grid gap-3 md:grid-cols-3 border-b pb-3 last:border-0">
                <div><Label>{ar ? "الاسم" : "Name"}</Label><Input value={a.displayNameEn} onChange={(e) => patchApi(i, { displayNameEn: e.target.value })} /></div>
                <div><Label>{ar ? "الخدمة / المجال" : "Service / domain"}</Label><Input value={a.sourceSystem} onChange={(e) => patchApi(i, { sourceSystem: e.target.value })} placeholder="library" /></div>
                <div>
                  <Label>{ar ? "البيئة" : "Environment"}</Label>
                  <Select value={a.environment} onValueChange={(v) => patchApi(i, { environment: v as typeof a.environment })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{["development", "staging", "production"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2"><Label>{ar ? "نقطة النهاية" : "Endpoint"}</Label><Input value={a.baseUrl} onChange={(e) => patchApi(i, { baseUrl: e.target.value })} /></div>
                <div>
                  <Label>{ar ? "المصادقة" : "Authentication"}</Label>
                  <Select value={a.authenticationType} onValueChange={(v) => patchApi(i, { authenticationType: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{["none", "api_key", "bearer_token", "oauth2", "basic"].map((v) => <SelectItem key={v} value={v}>{v.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2">
                  <Label>{ar ? "اسم السر (مرجع فقط)" : "Secret reference name"}</Label>
                  <Input value={a.credentialSecretName} onChange={(e) => patchApi(i, { credentialSecretName: e.target.value })} placeholder="LIBRARY_API_CLIENT_SECRET" />
                </div>
                <div>
                  <Label>{ar ? "الاستخدام" : "Usage"}</Label>
                  <Select value={a.usage} onValueChange={(v) => patchApi(i, { usage: v as typeof a.usage })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="knowledge">{ar ? "معرفة (محتوى ثابت)" : "Knowledge — indexed content"}</SelectItem>
                      <SelectItem value="live">{ar ? "بيانات حية وقت الطلب" : "Live — read at request time"}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {apis.length > 1 ? (
                  <div className="md:col-span-3">
                    <Button variant="ghost" size="sm" onClick={() => setApis((prev) => prev.filter((_, j) => j !== i))}>{ar ? "إزالة" : "Remove"}</Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {ar
              ? "لا تُدخل المفاتيح هنا؛ اكتب اسم السر المحفوظ فقط."
              : "Never paste keys here — enter only the name of the stored secret."}
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setApis((prev) => [...prev, { ...blankApi }])}>{ar ? "إضافة اتصال آخر" : "Add another connection"}</Button>
            <Button size="sm" onClick={() => createApis.mutate()} disabled={createApis.isPending || validApis.length === 0}>
              {validApis.length > 1 ? (ar ? `حفظ ${validApis.length} اتصالات` : `Save ${validApis.length} connections`) : ar ? "حفظ" : "Save"}
            </Button>
          </div>
        </section>
      ) : null}
      <LibraryIntegrationPanel ar={ar} canManage={canManage} />
      {canManage ? <OclcIntegrationPanel ar={ar} /> : null}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50"><tr>{[ar ? "الموصل" : "Connector", ar ? "البيئة" : "Environment", ar ? "المصادقة" : "Auth", ar ? "الصحة" : "Health", ar ? "قراءة" : "Read", ""].map((h, i) => <th key={i} className="p-2 text-start font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {(list.data?.connectors ?? []).map((c) => (
              <tr key={c.id} className={`border-t ${selected === c.id ? "bg-muted/40" : ""}`}>
                <td className="p-2">
                  <button className="text-start" onClick={() => setSelected(selected === c.id ? null : c.id)}>
                    <div className="font-medium">{ar ? c.display_name_ar : c.display_name_en}</div>
                    <div className="text-xs text-muted-foreground">{c.source_system} · {c.data_classification}</div>
                  </button>
                </td>
                <td className="p-2"><Badge variant="secondary">{c.environment}</Badge></td>
                <td className="p-2 text-xs">{c.authentication_type?.replace(/_/g, " ")}{c.credential_configured ? " ✓" : ""}</td>
                <td className="p-2"><Badge variant={statusTone(c.health_status)}>{c.health_status}</Badge></td>
                <td className="p-2"><Switch checked={!!c.read_enabled} disabled={!canManage} onCheckedChange={(v) => toggleConnector.mutate({ id: c.id, readEnabled: v })} /></td>
                <td className="p-2">{canManage ? <Button size="sm" variant="outline" onClick={() => test.mutate(c.id)} disabled={test.isPending}>{ar ? "اختبار" : "Test"}</Button> : null}</td>
              </tr>
            ))}
            {(list.data?.connectors ?? []).length === 0 ? <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">{ar ? "لا توجد موصلات." : "No connectors yet."}</td></tr> : null}
          </tbody>
        </table>
      </div>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-medium">{ar ? "الأدوات المتاحة" : "Exposed tools"}{selected ? "" : ` (${ar ? "الكل" : "all"})`}</h2>
        <ul className="space-y-2 text-sm">
          {tools.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0">
              <span>
                <span className="font-medium">{ar ? t.display_name_ar : t.display_name_en}</span>{" "}
                <code className="text-xs text-muted-foreground">{t.tool_name}</code>{" "}
                <Badge variant="secondary">{t.operation_type}</Badge> <Badge variant={t.risk_level === "high" ? "destructive" : "secondary"}>{t.risk_level}</Badge>
              </span>
              <Switch checked={!!t.enabled} disabled={!canManage} onCheckedChange={(v) => toggleTool.mutate({ id: t.id, enabled: v })} />
            </li>
          ))}
          {tools.length === 0 ? <li className="text-muted-foreground">{ar ? "لا توجد أدوات." : "No tools."}</li> : null}
        </ul>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-medium">{ar ? "تعيين الحقول" : "Field mappings"}</h2>
        <ul className="space-y-1 text-sm">
          {(list.data?.mappings ?? []).map((f) => (
            <li key={f.id} className="flex justify-between gap-2 border-b pb-1 last:border-0">
              <span><code>{f.external_field}</code> → <code>{f.internal_field}</code> · {f.data_type}</span>
              <span className="text-muted-foreground">{f.sensitive ? `${ar ? "حساس" : "sensitive"}${f.masking_rule ? ` · ${f.masking_rule}` : ""}` : ""}</span>
            </li>
          ))}
          {(list.data?.mappings ?? []).length === 0 ? <li className="text-muted-foreground">{ar ? "لا توجد تعيينات." : "No mappings."}</li> : null}
        </ul>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-medium">{ar ? "آخر الاختبارات" : "Recent tests"}</h2>
        <ul className="space-y-1 text-sm">
          {(list.data?.tests ?? []).slice(0, 15).map((t) => (
            <li key={t.id} className="flex justify-between gap-2 border-b pb-1 last:border-0">
              <span><Badge variant={statusTone(t.status)}>{t.status}</Badge> {t.test_type} · {t.latency_ms ?? 0} ms</span>
              <span className="text-muted-foreground">{fmt(t.started_at)}</span>
            </li>
          ))}
          {(list.data?.tests ?? []).length === 0 ? <li className="text-muted-foreground">{ar ? "لا توجد اختبارات." : "No tests yet."}</li> : null}
        </ul>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------- health */

function HealthTab({ ar, onChange }: { ar: boolean; onChange: () => void }) {
  const healthFn = getKnowledgeHealth;
  const health = useQuery({ queryKey: ["kc", "health"], queryFn: () => healthFn({}) });
  const resolveFn = resolveConflict;
  const gapFn = updateGapStatus;
  const rebuildFn = rebuildSemanticIndex;
  const idx = health.data?.index;

  const rebuild = useMutation({
    mutationFn: () => rebuildFn({ data: { limit: 300 } }),
    onSuccess: (r) => { toast.success(ar ? `تمت فهرسة ${r.documents + r.web} مقطعاً` : `Embedded ${r.documents + r.web} chunk(s)`); health.refetch(); onChange(); },
    onError: (e: Error) => toastError(e, ar ? "ar" : "en"),
  });
  const resolve = useMutation({
    mutationFn: (id: string) => resolveFn({ data: { id, notes: "Resolved from the knowledge health board" } }),
    onSuccess: () => { toast.success(ar ? "تم الحل" : "Resolved"); health.refetch(); onChange(); },
    onError: (e: Error) => toastError(e, ar ? "ar" : "en"),
  });
  const gap = useMutation({
    mutationFn: (a: { id: string; status: string }) => gapFn({ data: a }),
    onSuccess: () => { health.refetch(); onChange(); },
    onError: (e: Error) => toastError(e, ar ? "ar" : "en"),
  });

  const serviceName = (id: string) => {
    const s = (health.data?.services ?? []).find((x) => x.id === id);
    return s ? (ar ? s.name_ar : s.name_en) : id;
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">{ar ? "حالة الفهرس" : "Index health"}</h2>
          <Button size="sm" variant="outline" onClick={() => rebuild.mutate()} disabled={rebuild.isPending}>
            {rebuild.isPending ? (ar ? "جارٍ البناء…" : "Rebuilding…") : ar ? "إعادة بناء الفهرس الدلالي" : "Rebuild semantic index"}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label={ar ? "مصادر فعّالة" : "Active sources"} value={idx?.activeSources ?? 0} hint={`${idx?.activeDocuments ?? 0} ${ar ? "وثيقة" : "documents"} · ${idx?.activeWebSources ?? 0} ${ar ? "ويب" : "web"} · ${idx?.activeApis ?? 0} API`} />
          <MetricCard label={ar ? "صفحات مفهرسة" : "Indexed web pages"} value={idx?.webPagesIndexed ?? 0} />
          <MetricCard label={ar ? "مقاطع مفهرسة" : "Indexed chunks"} value={idx?.indexedChunks ?? 0} hint={`${idx?.embeddedChunks ?? 0} ${ar ? "بمتجه دلالي" : "with semantic vector"}`} />
          <MetricCard label={ar ? "بانتظار المراجعة" : "Needing review"} value={idx?.needsReviewDocuments ?? 0} hint={`${idx?.failedSources ?? 0} ${ar ? "فاشلة" : "failed"}`} />
          <MetricCard label={ar ? "تغطية الإنجليزية" : "English documents"} value={idx?.englishDocuments ?? 0} />
          <MetricCard label={ar ? "تغطية العربية" : "Arabic documents"} value={idx?.arabicDocuments ?? 0} />
          <MetricCard label={ar ? "مقاطع بدون متجه" : "Chunks without vector"} value={idx?.unembeddedChunks ?? 0} />
          <MetricCard label={ar ? "استرجاعات غير مستخدمة" : "Unused retrievals"} value={idx?.unusedRetrievals ?? 0} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">{ar ? "الفجوات المعرفية" : "Knowledge gaps"}</h2>
          <ul className="space-y-2 text-sm">
            {(health.data?.gaps ?? []).map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0">
                <span>
                  <span className="font-medium">{g.normalized_topic}</span> · {g.occurrence_count}× · {g.language?.toUpperCase()}
                  <span className="text-muted-foreground"> · {ar ? "مقترح" : "suggest"} {g.recommended_source_type}</span>
                </span>
                <span className="flex gap-1">
                  <Badge variant="secondary">{g.status}</Badge>
                  <Button size="sm" variant="outline" onClick={() => gap.mutate({ id: g.id, status: "under_review" })}>{ar ? "قيد العمل" : "Start"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => gap.mutate({ id: g.id, status: "resolved" })}>{ar ? "منجز" : "Done"}</Button>
                </span>
              </li>
            ))}
            {(health.data?.gaps ?? []).length === 0 ? <li className="text-muted-foreground">{ar ? "لا توجد فجوات." : "No gaps."}</li> : null}
          </ul>
        </section>

        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">{ar ? "التعارضات" : "Conflicts"}</h2>
          <ul className="space-y-2 text-sm">
            {(health.data?.conflicts ?? []).map((c) => (
              <li key={c.id} className="border-b pb-2 last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{c.affected_topic}</span>
                  <span className="flex items-center gap-1">
                    <Badge variant={c.severity === "critical" ? "destructive" : "secondary"}>{c.severity}</Badge>
                    {c.resolution_status !== "resolved" ? <Button size="sm" variant="outline" onClick={() => resolve.mutate(c.id)}>{ar ? "حل" : "Resolve"}</Button> : null}
                  </span>
                </div>
                <div className="text-muted-foreground">{c.conflicting_statement_one} ⟷ {c.conflicting_statement_two}</div>
              </li>
            ))}
            {(health.data?.conflicts ?? []).length === 0 ? <li className="text-muted-foreground">{ar ? "لا توجد تعارضات." : "No conflicts."}</li> : null}
          </ul>
        </section>

        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">{ar ? "تغطية الخدمات" : "Service coverage"}</h2>
          <ul className="space-y-1 text-sm">
            {(health.data?.coverage ?? []).map((c) => (
              <li key={c.service_id} className="flex justify-between gap-2 border-b pb-1 last:border-0">
                <span>{serviceName(c.service_id)}</span>
                <span className="text-muted-foreground">{c.coverage_score ?? 0}% · {ar ? "عربي" : "AR"} {c.topics_with_ar_content ?? 0}/{c.total_known_topics ?? 0}</span>
              </li>
            ))}
            {(health.data?.coverage ?? []).length === 0 ? <li className="text-muted-foreground">{ar ? "لا توجد بيانات تغطية." : "No coverage data."}</li> : null}
          </ul>
        </section>

        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">{ar ? "أكثر المصادر استخداماً" : "Most used sources"}</h2>
          <ul className="space-y-1 text-sm">
            {(health.data?.topSources ?? []).map((s) => (
              <li key={s.key} className="flex justify-between gap-2 border-b pb-1 last:border-0">
                <span className="break-all">{s.key}</span>
                <span className="text-muted-foreground">{s.retrieved} {ar ? "استرجاع" : "retrieved"} · {s.cited} {ar ? "استشهاد" : "cited"}</span>
              </li>
            ))}
            {(health.data?.topSources ?? []).length === 0 ? <li className="text-muted-foreground">{ar ? "لا توجد بيانات استخدام." : "No usage data yet."}</li> : null}
          </ul>
        </section>
      </div>
    </div>
  );
}


/* ------------------------------------------------------------ test knowledge */

/**
 * Admin rehearsal that runs the *same* retrieval pipeline the student
 * assistant uses, so a newly added source can be verified end to end.
 */
function TestKnowledgeTab({ ar }: { ar: boolean }) {
  const previewFn = previewKnowledge;
  const [question, setQuestion] = useState("");
  const [lang, setLang] = useState<"en" | "ar">(ar ? "ar" : "en");

  const preview = useMutation({
    mutationFn: () => previewFn({ data: { question, lang } }),
    onError: (e: Error) => toastError(e, ar ? "ar" : "en"),
  });

  return (
    <div className="space-y-4">
      <section className="rounded-lg border p-4">
        <h2 className="font-medium">{ar ? "اختبار المعرفة" : "Test knowledge"}</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {ar
            ? "اطرح سؤال طالب لترى الإجابة المستندة إلى المصادر، والمقاطع المسترجعة، ودرجات المطابقة — بنفس مسار الاسترجاع المستخدم في المساعد."
            : "Ask a student question to see the grounded answer, the exact retrieved passages and their scores — using the same retrieval path as the live assistant."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Input
            className="max-w-xl"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && question.length >= 3) preview.mutate(); }}
            placeholder={ar ? "مثال: ما هو هدف سياسة السكن الطلابي؟" : "e.g. What is the objective of the Student Housing Services policy?"}
          />
          <Select value={lang} onValueChange={(v) => setLang(v as "en" | "ar")}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="ar">العربية</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => preview.mutate()} disabled={preview.isPending || question.length < 3}>
            {preview.isPending ? (ar ? "جارٍ البحث…" : "Searching…") : ar ? "اختبار" : "Run test"}
          </Button>
        </div>
      </section>

      {preview.data ? (
        <div className="space-y-4">
          <section className="rounded-lg border p-4">
            <h3 className="mb-2 font-medium">{ar ? "إجابة سندي المتوقعة" : "Expected Sanadi answer"}</h3>
            <div className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">{preview.data.draftAnswer}</div>
            {preview.data.expectedCitation ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {ar ? "الاستشهاد" : "Citation"}: {preview.data.expectedCitation.title}
                {preview.data.expectedCitation.section ? ` — ${preview.data.expectedCitation.section}` : ""}
                {preview.data.expectedCitation.version ? ` · v${preview.data.expectedCitation.version}` : ""}
                {preview.data.expectedCitation.url ? ` · ${preview.data.expectedCitation.url}` : ""}
              </p>
            ) : null}
          </section>

          <section className="rounded-lg border p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">{ar ? "المقاطع المسترجعة" : "Retrieved passages"} ({preview.data.sources.length})</h3>
              <Badge variant={preview.data.groundingStatus === "grounded" ? "default" : preview.data.groundingStatus === "no_evidence" ? "destructive" : "secondary"}>
                {preview.data.groundingStatus}
              </Badge>
            </div>
            <ul className="space-y-2">
              {preview.data.sources.map((s) => (
                <li key={`${s.sourceId}-${s.rank}`} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{s.rank}. {s.title}{s.sectionTitle ? ` — ${s.sectionTitle}` : ""}</span>
                    <span className="flex flex-wrap items-center gap-1">
                      <Badge variant="secondary">{s.sourceType}</Badge>
                      {s.wouldBeSelected ? <Badge>{ar ? "مختار" : "selected"}</Badge> : null}
                      <Badge variant="outline">{ar ? "الدرجة" : "score"} {s.score.toFixed(2)}</Badge>
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{s.snippet}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {s.citationUrl ? `${s.citationUrl} · ` : ""}
                    {s.pageNumber ? `${ar ? "صفحة" : "page"} ${s.pageNumber} · ` : ""}
                    {s.domain} · {s.language?.toUpperCase()}
                    {s.version ? ` · v${s.version}` : ""}
                    {` · ${ar ? "نصي" : "lexical"} ${s.lexical.toFixed(2)} · ${ar ? "دلالي" : "semantic"} ${(s.semantic ?? 0).toFixed(2)} · ${ar ? "تقريبي" : "fuzzy"} ${s.fuzzy.toFixed(2)}`}
                  </p>
                </li>
              ))}
              {preview.data.sources.length === 0 ? (
                <li className="text-sm text-muted-foreground">
                  {ar ? "لم يعثر البحث على أي مصدر معتمد — هذه فجوة معرفية." : "No approved source answers this question — this is a knowledge gap."}
                </li>
              ) : null}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}
