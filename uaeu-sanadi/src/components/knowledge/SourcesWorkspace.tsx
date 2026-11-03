/**
 * Managed knowledge library: every document, web page and data connection the
 * assistant can draw on, with its lifecycle, health and controls in one place.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/errors/toast";
import {
  activateKnowledgeSource,
  deleteKnowledgeSource,
  getKnowledgeSource,
  listKnowledgeSources,
  refreshWebSource,
  replaceDocument,
  reprocessDocumentIndex,
  setKnowledgeSourceEnabled,
  testConnector,
  testKnowledgeSource,
} from "@/lib/knowledge-center.functions";

type Kind = "document" | "web" | "api";

const STATUS_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  indexed: "secondary",
  processing: "secondary",
  needs_review: "outline",
  failed: "destructive",
  replaced: "secondary",
  disabled: "secondary",
  deleted: "destructive",
};

const STATUS_AR: Record<string, string> = {
  active: "فعّال", indexed: "مفهرس", processing: "قيد المعالجة", needs_review: "بحاجة لمراجعة",
  failed: "فشل", replaced: "مستبدل", disabled: "معطّل", deleted: "محذوف",
};

const KIND_AR: Record<Kind, string> = { document: "وثيقة", web: "موقع", api: "اتصال بيانات" };

function fmt(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
function fmtTime(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
}

const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  md: "text/markdown",
  txt: "text/plain",
};

export function SourcesWorkspace({
  ar,
  kind,
  canManage,
  canManageIntegrations,
  onChange,
}: {
  ar: boolean;
  kind: "all" | Kind;
  canManage: boolean;
  canManageIntegrations: boolean;
  onChange: () => void;
}) {
  const qc = useQueryClient();
  const lang = ar ? "ar" : "en";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [language, setLanguage] = useState("all");
  const [domain, setDomain] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<{ kind: Kind; id: string; name: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ kind: Kind; id: string; name: string } | null>(null);

  const listFn = useServerFn(listKnowledgeSources);
  const list = useQuery({
    queryKey: ["kc", "sources", kind, search, status, language, domain, page],
    queryFn: () => listFn({ data: { kind, search, status, language, domain, page, pageSize: 20 } }),
  });

  const refresh = () => { void list.refetch(); onChange(); };

  const enableFn = useServerFn(setKnowledgeSourceEnabled);
  const deleteFn = useServerFn(deleteKnowledgeSource);
  const reindexFn = useServerFn(reprocessDocumentIndex);
  const refreshWebFn = useServerFn(refreshWebSource);
  const testConnectorFn = useServerFn(testConnector);
  const activateFn = useServerFn(activateKnowledgeSource);

  const activate = useMutation({
    mutationFn: (id: string) => activateFn({ data: { documentId: id, lang } }),
    onSuccess: (r) => {
      const failed = r.checks.filter((c) => !c.ok).map((c) => c.label).join(", ");
      if (r.activated) toast.success(ar ? "تم التحقق والتفعيل" : `Verified and activated — ${r.probes.filter((p) => p.hit).length}/${r.probes.length} section checks passed`);
      else toast.error(ar ? `التفعيل متوقف: ${failed}` : `Not activated — failed: ${failed}`);
      refresh();
      qc.invalidateQueries({ queryKey: ["kc", "source"] });
    },
    onError: (e: Error) => toastError(e, lang),
  });

  const toggle = useMutation({
    mutationFn: (v: { kind: Kind; id: string; enabled: boolean }) => enableFn({ data: v }),
    onSuccess: (_r, v) => { toast.success(v.enabled ? (ar ? "تم التفعيل" : "Source enabled") : (ar ? "تم التعطيل" : "Source disabled")); refresh(); qc.invalidateQueries({ queryKey: ["kc", "source"] }); },
    onError: (e: Error) => toastError(e, lang),
  });

  const remove = useMutation({
    mutationFn: (v: { kind: Kind; id: string }) => deleteFn({ data: v }),
    onSuccess: (r) => {
      toast.success(ar ? `تم الحذف (${r.removedChunks} مقطعاً أُزيلت)` : `Deleted — ${r.removedChunks} indexed chunk(s) removed`);
      setPendingDelete(null);
      setSelected(null);
      refresh();
    },
    onError: (e: Error) => toastError(e, lang),
  });

  const reindex = useMutation({
    mutationFn: (id: string) => reindexFn({ data: { documentId: id } }),
    onSuccess: (r) => { toast.success(ar ? `أُعيدت الفهرسة: ${r.chunks} مقطعاً` : `Re-indexed into ${r.chunks} chunks across ${r.sections.length} sections`); refresh(); qc.invalidateQueries({ queryKey: ["kc", "source"] }); },
    onError: (e: Error) => toastError(e, lang),
  });

  const refetchWeb = useMutation({
    mutationFn: (id: string) => refreshWebFn({ data: { id, revisionSeed: String(Date.now()) } }),
    onSuccess: (r) => { toast[r.ok ? "success" : "error"](r.ok ? (r.changed ? (ar ? "تم اكتشاف تحديث" : "Update detected") : (ar ? "لا تغيير" : "No change")) : String(r.error)); refresh(); },
    onError: (e: Error) => toastError(e, lang),
  });

  const testApi = useMutation({
    mutationFn: (id: string) => testConnectorFn({ data: { connectorId: id } }),
    onSuccess: (r) => { toast[r.status === "failed" ? "error" : "success"](`${r.status} · ${r.latencyMs ?? 0} ms`); refresh(); },
    onError: (e: Error) => toastError(e, lang),
  });

  const s = list.data?.summary;
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (list.data?.pageSize ?? 20)));

  const may = (k: Kind) => (k === "api" ? canManageIntegrations : canManage);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        {[
          [ar ? "الإجمالي" : "Total", s?.total],
          [ar ? "فعّالة" : "Active", s?.active],
          [ar ? "وثائق" : "Documents", s?.documents],
          [ar ? "مواقع" : "Web", s?.web],
          [ar ? "اتصالات" : "APIs", s?.apis],
          [ar ? "بحاجة لمراجعة" : "Needs review", s?.needsReview],
          [ar ? "فشل" : "Failed", s?.failed],
          [ar ? "معطّلة" : "Disabled", s?.disabled],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border bg-card p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-xl font-semibold">{value ?? 0}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Input
          className="max-w-xs"
          placeholder={ar ? "بحث بالاسم أو المجال" : "Search name, service or format"}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["all", "active", "needs_review", "failed", "disabled", "replaced", "indexed", "processing", "deleted"].map((v) => (
              <SelectItem key={v} value={v}>{v === "all" ? (ar ? "كل الحالات" : "All statuses") : ar ? STATUS_AR[v] : v.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={language} onValueChange={(v) => { setLanguage(v); setPage(1); }}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{ar ? "كل اللغات" : "All languages"}</SelectItem>
            <SelectItem value="en">EN</SelectItem>
            <SelectItem value="ar">AR</SelectItem>
          </SelectContent>
        </Select>
        <Select value={domain} onValueChange={(v) => { setDomain(v); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{ar ? "كل الخدمات" : "All services"}</SelectItem>
            {(list.data?.domains ?? []).map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="bg-muted/50">
            <tr>
              {[
                ar ? "المصدر" : "Source", ar ? "النوع" : "Type", ar ? "الخدمة" : "Service",
                ar ? "اللغة" : "Lang", ar ? "الحالة" : "Status", ar ? "الإصدار" : "Version",
                ar ? "أضيف بواسطة" : "Added by", ar ? "التاريخ" : "Added", ar ? "آخر فهرسة" : "Last indexed",
                ar ? "المقاطع" : "Indexed", ar ? "الاسترجاع" : "Retrieval", "",
              ].map((h, i) => <th key={i} className="p-2 text-start font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {(list.data?.rows ?? []).map((r) => (
              <tr key={r.key} className="border-t align-top">
                <td className="p-2">
                  <button className="text-start font-medium hover:underline" onClick={() => setSelected({ kind: r.kind as Kind, id: r.id, name: r.name })}>
                    {r.name}
                  </button>
                  <div className="text-xs text-muted-foreground">{ar ? KIND_AR[r.kind as Kind] : r.kind}</div>
                </td>
                <td className="p-2">{r.format}</td>
                <td className="p-2">{r.domain ?? "—"}</td>
                <td className="p-2">{r.language}</td>
                <td className="p-2"><Badge variant={STATUS_TONE[r.status] ?? "secondary"}>{ar ? STATUS_AR[r.status] ?? r.status : r.status.replace(/_/g, " ")}</Badge></td>
                <td className="p-2">{r.version ?? "—"}</td>
                <td className="p-2">{r.addedBy ?? "—"}</td>
                <td className="p-2">{fmt(r.addedAt)}</td>
                <td className="p-2">{fmt(r.lastIndexedAt)}</td>
                <td className="p-2">{r.units ?? 0} {r.unitLabel}</td>
                <td className="p-2 text-xs">
                  <span className={r.retrievable ? "text-emerald-600" : "text-muted-foreground"}>{r.retrievalNote}</span>
                </td>
                <td className="p-2 text-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button size="sm" variant="outline">{ar ? "إجراءات" : "Actions"}</Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setSelected({ kind: r.kind as Kind, id: r.id, name: r.name })}>{ar ? "عرض" : "View"}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setSelected({ kind: r.kind as Kind, id: r.id, name: r.name })}>{ar ? "اختبار المعرفة" : "Test knowledge"}</DropdownMenuItem>
                      {r.kind === "document" && may("document") ? (
                        <>
                          <DropdownMenuItem onClick={() => reindex.mutate(r.id)}>{ar ? "إعادة المعالجة" : "Reprocess"}</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => activate.mutate(r.id)}>{ar ? "تحقق وتفعيل" : "Verify & activate"}</DropdownMenuItem>
                        </>
                      ) : null}
                      {r.kind === "web" && may("web") ? (
                        <DropdownMenuItem onClick={() => refetchWeb.mutate(r.id)}>{ar ? "تحديث الآن" : "Refresh now"}</DropdownMenuItem>
                      ) : null}
                      {r.kind === "api" && canManageIntegrations ? (
                        <DropdownMenuItem onClick={() => testApi.mutate(r.id)}>{ar ? "اختبار الاتصال" : "Test connection"}</DropdownMenuItem>
                      ) : null}
                      {may(r.kind as Kind) ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => toggle.mutate({ kind: r.kind as Kind, id: r.id, enabled: !r.enabled })}>
                            {r.enabled ? (ar ? "تعطيل" : "Disable") : ar ? "تفعيل" : "Enable"}
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => setPendingDelete({ kind: r.kind as Kind, id: r.id, name: r.name })}>
                            {ar ? "حذف" : "Delete"}
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
            {list.isLoading ? <tr><td colSpan={12} className="p-6 text-center text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</td></tr> : null}
            {!list.isLoading && (list.data?.rows ?? []).length === 0 ? (
              <tr><td colSpan={12} className="p-6 text-center text-muted-foreground">{ar ? "لا توجد مصادر مطابقة." : "No matching sources."}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{ar ? `${total} مصدراً` : `${total} source${total === 1 ? "" : "s"}`}</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{ar ? "السابق" : "Previous"}</Button>
          <span>{page} / {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{ar ? "التالي" : "Next"}</Button>
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          {selected ? (
            <SourceDetail
              ar={ar}
              kind={selected.kind}
              id={selected.id}
              canManage={may(selected.kind)}
              onChanged={refresh}
              onDelete={() => setPendingDelete(selected)}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ar ? "حذف مصدر المعرفة؟" : "Delete this knowledge source?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {ar
                ? `لن يعود "${pendingDelete?.name ?? ""}" متاحاً لسندي في الإجابات المستقبلية، وستُزال مقاطعه من الفهرس. يُحتفظ بسجل التدقيق فقط.`
                : `"${pendingDelete?.name ?? ""}" will no longer be available to Sanadi for future answers. Its indexed chunks are removed; only audit metadata is kept.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{ar ? "إلغاء" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => pendingDelete && remove.mutate({ kind: pendingDelete.kind, id: pendingDelete.id })}
            >
              {ar ? "حذف" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------------------------------------------- detail */

function SourceDetail({
  ar, kind, id, canManage, onChanged, onDelete,
}: { ar: boolean; kind: Kind; id: string; canManage: boolean; onChanged: () => void; onDelete: () => void }) {
  const lang = ar ? "ar" : "en";
  const getFn = useServerFn(getKnowledgeSource);
  const detail = useQuery({ queryKey: ["kc", "source", kind, id], queryFn: () => getFn({ data: { kind, id } }) });
  const doc = detail.data?.document ?? null;
  const web = detail.data?.web ?? null;
  const api = detail.data?.api ?? null;

  const testFn = useServerFn(testKnowledgeSource);
  const [question, setQuestion] = useState("");
  const test = useMutation({
    mutationFn: () => testFn({ data: { kind, id, question, lang: ar ? "ar" : "en" } }),
    onError: (e: Error) => toastError(e, lang),
  });

  const title = doc?.title ?? web?.title ?? api?.name ?? "";

  return (
    <div className="space-y-4">
      <SheetHeader>
        <SheetTitle className="text-start">{title}</SheetTitle>
        <SheetDescription className="text-start">
          {ar ? KIND_AR[kind] : kind} · {doc?.version ? `v${doc.version}` : web?.domain ?? api?.sourceSystem ?? ""}
        </SheetDescription>
      </SheetHeader>

      {detail.isLoading ? <p className="text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p> : null}

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">{ar ? "نظرة عامة" : "Overview"}</TabsTrigger>
          {doc ? <TabsTrigger value="content">{ar ? "النص والمقاطع" : "Text & chunks"}</TabsTrigger> : null}
          {doc ? <TabsTrigger value="versions">{ar ? "الإصدارات" : "Versions"}</TabsTrigger> : null}
          {doc && canManage ? <TabsTrigger value="replace">{ar ? "استبدال" : "Replace"}</TabsTrigger> : null}
          <TabsTrigger value="test">{ar ? "اختبار المعرفة" : "Test knowledge"}</TabsTrigger>
          <TabsTrigger value="audit">{ar ? "سجل التدقيق" : "Audit"}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-3 pt-4 text-sm">
          {doc ? (
            <>
              <Facts rows={[
                [ar ? "الحالة" : "Status", doc.status.replace(/_/g, " ")],
                [ar ? "الاعتماد" : "Approval", doc.approvalStatus],
                [ar ? "الملف" : "Original file", doc.fileName],
                [ar ? "الخدمة" : "Service / domain", doc.knowledgeDomain],
                [ar ? "اللغة" : "Language", `${doc.language ?? "—"}${doc.detectedLanguage ? ` (${ar ? "مكتشفة" : "detected"} ${doc.detectedLanguage})` : ""}`],
                [ar ? "السرية" : "Confidentiality", doc.confidentiality],
                [ar ? "سارٍ من" : "Effective from", doc.effectiveDate],
                [ar ? "ينتهي في" : "Effective to", doc.expiryDate],
                [ar ? "المراجعة" : "Review date", doc.reviewDate],
                [ar ? "الاستخراج" : "Extraction", `${doc.extractionStatus ?? "—"}${doc.extractionError ? ` — ${doc.extractionError}` : ""}`],
                [ar ? "الفهرسة" : "Indexing", `${doc.indexingStatus ?? "—"} · ${doc.chunkCount} ${ar ? "مقطعاً" : "chunks"}${doc.pages ? ` · ${doc.pages} ${ar ? "صفحة" : "pages"}` : ""}`],
                [ar ? "آخر تحديث" : "Last indexed", fmtTime(doc.updatedAt)],
              ]} />
              {doc.blockers.length ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  <p className="font-medium text-destructive">{ar ? "غير قابل للاسترجاع" : "Not retrievable"}</p>
                  <ul className="list-disc ps-4 text-xs">{doc.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
                </div>
              ) : (
                <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-emerald-700">
                  {ar ? "هذا المصدر مستخدم في إجابات سندي." : "Sanadi can use this source in answers."}
                </p>
              )}
              {doc.qualityIssues.length ? (
                <div className="rounded-md border p-3">
                  <p className="mb-1 font-medium">{ar ? "ملاحظات الجودة" : "Quality warnings"}</p>
                  <ul className="list-disc ps-4 text-xs">{doc.qualityIssues.map((q, i) => <li key={i}>[{q.severity}] {q.message}</li>)}</ul>
                </div>
              ) : null}
              {doc.retrieval.length ? (
                <div className="rounded-md border p-3">
                  <p className="mb-1 font-medium">{ar ? "آخر استخدام في الاسترجاع" : "Recent retrieval activity"}</p>
                  <ul className="space-y-1 text-xs">
                    {doc.retrieval.map((r, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span>{r.query_text}</span>
                        <span className="text-muted-foreground">{Number(r.retrieval_score ?? 0).toFixed(2)} · {fmtTime(r.retrieved_at)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{ar ? "لم يُستخدم هذا المصدر في أي إجابة بعد." : "This source has never been retrieved yet."}</p>
              )}
            </>
          ) : null}

          {web ? (
            <Facts rows={[
              ["URL", web.url],
              [ar ? "النطاق" : "Domain", web.domain],
              [ar ? "الحالة" : "Status", web.status.replace(/_/g, " ")],
              [ar ? "آخر فحص" : "Last checked", fmtTime(web.lastCheckedAt)],
              [ar ? "آخر جلب ناجح" : "Last fetched", fmtTime(web.lastFetchAt)],
              [ar ? "آخر تغيير" : "Last changed", fmtTime(web.lastChangedAt)],
              [ar ? "بصمة المحتوى" : "Content hash", web.contentHash?.slice(0, 16) ?? null],
              [ar ? "حجم النص" : "Indexed text", `${web.textLength} ${ar ? "حرفاً" : "characters"}`],
              [ar ? "التحديث التلقائي" : "Auto refresh", web.trustedAutoRefresh ? (ar ? "مسموح" : "Allowed") : ar ? "يتطلب مراجعة" : "Requires review"],
            ]} />
          ) : null}

          {api ? (
            <>
              <Facts rows={[
                [ar ? "المزوّد" : "Provider", api.sourceSystem],
                [ar ? "النوع" : "Connection type", api.connectorType],
                [ar ? "الاستخدام" : "Usage", api.usage === "knowledge" ? (ar ? "معرفة (محتوى ثابت)" : "Knowledge API — indexed content") : (ar ? "بيانات حية وقت الطلب" : "Live operational data — read at request time")],
                [ar ? "نقطة النهاية" : "Endpoint", api.baseUrl],
                [ar ? "المصادقة" : "Authentication", `${api.authenticationType ?? "—"} · ${api.credentialMask ?? (ar ? "غير مهيأ" : "not configured")}`],
                [ar ? "الحالة" : "Connection status", `${api.healthStatus ?? "—"}`],
                [ar ? "آخر طلب ناجح" : "Last successful request", fmtTime(api.lastSuccessAt)],
                [ar ? "آخر فحص" : "Last checked", fmtTime(api.lastHealthCheckAt)],
                [ar ? "آخر خطأ" : "Last error", api.lastError ? `${api.lastError.message} (${fmtTime(api.lastError.at)})` : null],
              ]} />
              <div className="rounded-md border p-3 text-xs">
                <p className="mb-1 font-medium">{ar ? "الأدوات المفعّلة" : "Enabled operations"}</p>
                <ul className="list-disc ps-4">
                  {api.tools.map((t) => <li key={t.id}>{t.display_name_en ?? t.tool_name} · {t.operation_type} {t.enabled ? "" : `(${ar ? "معطّلة" : "disabled"})`}</li>)}
                  {api.tools.length === 0 ? <li>—</li> : null}
                </ul>
              </div>
            </>
          ) : null}

          {canManage ? (
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="destructive" size="sm" onClick={onDelete}>{ar ? "حذف المصدر" : "Delete source"}</Button>
            </div>
          ) : null}
        </TabsContent>

        {doc ? (
          <TabsContent value="content" className="space-y-3 pt-4 text-sm">
            <div className="rounded-md border p-3">
              <p className="mb-1 font-medium">{ar ? "العناوين المكتشفة" : "Detected headings"} ({doc.headings.length})</p>
              <div className="flex flex-wrap gap-1">
                {doc.headings.map((h) => <Badge key={h} variant="secondary">{h}</Badge>)}
                {doc.headings.length === 0 ? <span className="text-xs text-muted-foreground">{ar ? "لم تُكتشف عناوين." : "No headings detected."}</span> : null}
              </div>
            </div>
            <div className="space-y-2">
              {doc.chunks.map((c) => (
                <div key={c.index} className="rounded-md border p-2 text-xs">
                  <div className="font-medium">
                    #{c.index} · {c.sectionTitle ?? (ar ? "بدون عنوان" : "untitled")} · {ar ? "صفحة" : "page"} {c.pageNumber ?? "—"} · {c.tokens ?? 0} {ar ? "رمزاً" : "tokens"}
                    {c.active ? "" : ` · ${ar ? "معطّل" : "inactive"}`}
                  </div>
                  <p className="whitespace-pre-wrap text-muted-foreground">{c.preview}</p>
                </div>
              ))}
              {doc.chunkCount > doc.chunks.length ? (
                <p className="text-xs text-muted-foreground">{ar ? `عرض ${doc.chunks.length} من ${doc.chunkCount} مقطعاً.` : `Showing ${doc.chunks.length} of ${doc.chunkCount} chunks.`}</p>
              ) : null}
            </div>
          </TabsContent>
        ) : null}

        {doc ? (
          <TabsContent value="versions" className="space-y-2 pt-4 text-sm">
            {doc.versions.map((v) => (
              <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                <span className="font-medium">v{v.version ?? "?"} {v.id === doc.id ? `· ${ar ? "هذه النسخة" : "this version"}` : ""}</span>
                <span className="text-xs text-muted-foreground">
                  {v.approval_status} · {ar ? "من" : "from"} {fmt(v.effective_date)} {v.expiry_date ? `→ ${fmt(v.expiry_date)}` : ""}
                  {v.superseded_by_document_id ? ` · ${ar ? "مستبدلة" : "replaced"}` : ""}
                  {v.retirement_reason ? ` · ${v.retirement_reason}` : ""}
                </span>
              </div>
            ))}
          </TabsContent>
        ) : null}

        {doc && canManage ? (
          <TabsContent value="replace" className="pt-4">
            <ReplacePanel ar={ar} doc={doc} onDone={onChanged} />
          </TabsContent>
        ) : null}

        <TabsContent value="test" className="space-y-3 pt-4 text-sm">
          <div className="flex gap-2">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={ar ? "مثال: ما هدف خدمات السكن الطلابي؟" : "e.g. What is the objective of Student Housing Services?"}
            />
            <Button disabled={test.isPending || question.trim().length < 3} onClick={() => test.mutate()}>{ar ? "اختبار" : "Run"}</Button>
          </div>
          <p className="text-xs text-muted-foreground">{ar ? "يستخدم مسار الاسترجاع نفسه المستخدم في المساعد." : "Runs the assistant's own retrieval path — no separate preview engine."}</p>
          {test.data ? (
            <div className="space-y-2">
              <p className={test.data.retrievedFromSource ? "text-emerald-600" : "text-destructive"}>
                {test.data.retrievedFromSource
                  ? ar ? `تم استرجاع هذا المصدر (المرتبة ${test.data.bestRank})` : `This source was retrieved at rank ${test.data.bestRank}`
                  : ar ? "لم يُسترجع هذا المصدر لهذا السؤال" : "This source was not retrieved for this question"}
              </p>
              {test.data.passages.map((p) => (
                <div key={p.rank} className={`rounded-md border p-2 text-xs ${p.fromThisSource ? "border-emerald-500/50 bg-emerald-500/5" : ""}`}>
                  <div className="font-medium">#{p.rank} {p.title}{p.sectionTitle ? ` § ${p.sectionTitle}` : ""} · {ar ? "صفحة" : "p."}{p.pageNumber ?? "—"} · {p.score}</div>
                  <p className="text-muted-foreground">{p.snippet}</p>
                </div>
              ))}
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <p className="mb-1 font-medium">{ar ? "الإجابة المتوقعة" : "Final answer"}</p>
                <p className="whitespace-pre-wrap">{test.data.answer}</p>
              </div>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="audit" className="space-y-2 pt-4 text-sm">
          {(doc?.audit ?? web?.audit ?? api?.audit ?? []).map((a) => (
            <div key={a.id} className="flex justify-between gap-3 border-b pb-2 text-xs last:border-0">
              <span><span className="font-medium">{a.action}</span> — {a.summary}</span>
              <span className="shrink-0 text-muted-foreground">{fmtTime(a.created_at)}</span>
            </div>
          ))}
          {(doc?.audit ?? web?.audit ?? api?.audit ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">{ar ? "لا توجد إجراءات مسجّلة." : "No recorded actions yet."}</p>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Facts({ rows }: { rows: [string, string | null | undefined][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2 border-b py-1 text-xs last:border-0">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="text-end font-medium break-all">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ replace */

function ReplacePanel({
  ar, doc, onDone,
}: {
  ar: boolean;
  doc: { id: string; title: string; version: string | null; documentType: string | null; language: string | null; knowledgeDomain: string | null; confidentiality: string | null; ownerUnitId: string | null };
  onDone: () => void;
}) {
  const lang = ar ? "ar" : "en";
  const replaceFn = useServerFn(replaceDocument);
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState(() => {
    const n = Number(doc.version);
    return Number.isFinite(n) ? String(n + 1) : `${doc.version ?? "1"}-new`;
  });
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [stage, setStage] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error(ar ? "اختر ملف الاستبدال." : "Choose a replacement file.");
      setStage(ar ? "جارٍ الرفع…" : "Uploading…");
      const safe = file.name.replace(/[^\w.\-\u0600-\u06FF]+/g, "_").slice(-120);
      const path = `${crypto.randomUUID()}/${safe}`;
      const { error } = await supabase.storage.from("knowledge-files").upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (error) throw new Error(error.message);
      setStage(ar ? "استخراج وفهرسة…" : "Extracting and indexing…");
      return replaceFn({
        data: {
          targetDocumentId: doc.id,
          title: doc.title,
          documentType: doc.documentType ?? "policy",
          ownerUnitId: doc.ownerUnitId ?? null,
          language: (doc.language === "ar" ? "ar" : "en") as "en" | "ar",
          version,
          effectiveDate,
          confidentialityLevel: (doc.confidentiality ?? "public") as "public",
          knowledgeDomain: doc.knowledgeDomain ?? null,
          fileName: file.name,
          mimeType: file.type || EXT_MIME[file.name.split(".").pop()?.toLowerCase() ?? ""] || "application/octet-stream",
          sizeBytes: file.size,
          textContent: "",
          storagePath: path,
          notes: reason || null,
        },
      });
    },
    onSettled: () => setStage(null),
    onSuccess: (r) => {
      if (!r.activated && r.previousKeptActive) {
        toast.warning(ar
          ? "لم يتم التفعيل — النسخة السابقة ما زالت فعّالة بانتظار الاعتماد."
          : "New version stored but not activated — the previous version stays live until it is approved.");
      } else {
        toast.success(ar ? `تم الاستبدال (${r.chunks} مقطعاً)` : `Replaced — new version indexed into ${r.chunks} chunks`);
      }
      setFile(null);
      onDone();
    },
    onError: (e: Error) => toastError(e, lang),
  });

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">
        {ar
          ? "تبقى النسخة الحالية فعّالة حتى تنجح معالجة الاستبدال بالكامل."
          : "The current version keeps answering questions until the replacement has been validated, extracted, chunked and indexed."}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label>{ar ? "الإصدار الجديد" : "New version"}</Label><Input value={version} onChange={(e) => setVersion(e.target.value)} /></div>
        <div><Label>{ar ? "سارٍ من" : "Effective from"}</Label><Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} /></div>
        <div className="sm:col-span-2"><Label>{ar ? "سبب الاستبدال" : "Replacement reason"}</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <div className="sm:col-span-2">
          <Label>{ar ? "ملف الاستبدال" : "Replacement file"}</Label>
          <Input type="file" accept=".pdf,.docx,.pptx,.xlsx,.csv,.md,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
      </div>
      <Button disabled={run.isPending || !file || version.trim().length < 1} onClick={() => run.mutate()}>
        {run.isPending ? (stage ?? (ar ? "جارٍ…" : "Working…")) : ar ? "استبدال النسخة" : "Replace version"}
      </Button>
    </div>
  );
}
