import { useEffect, useState } from "react";
import { toastError } from "@/lib/errors/toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Library, PlugZap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  getLibraryIntegration,
  testLibraryConnection,
  updateLibraryIntegration,
} from "@/lib/library.functions";

type Form = {
  providerName: string;
  baseUrl: string;
  authMethod: "header_api_key" | "query_api_key" | "bearer" | "basic_client_credentials" | "client_id_secret_headers";
  authHeaderName: string;
  authQueryParam: string;
  searchPath: string;
  itemPath: string;
  catalogueUrlTemplate: string;
  timeoutMs: number;
  maxRetries: number;
  enabled: boolean;
};

const EMPTY: Form = {
  providerName: "UAEU Library Catalogue",
  baseUrl: "",
  authMethod: "header_api_key",
  authHeaderName: "X-API-Key",
  authQueryParam: "",
  searchPath: "/search",
  itemPath: "/items/{id}",
  catalogueUrlTemplate: "",
  timeoutMs: 6000,
  maxRetries: 1,
  enabled: false,
};

/** Admin configuration for the Ask the Librarian catalogue connector. */
export function LibraryIntegrationPanel({ ar, canManage }: { ar: boolean; canManage: boolean }) {
  const loadFn = useServerFn(getLibraryIntegration);
  const saveFn = useServerFn(updateLibraryIntegration);
  const testFn = useServerFn(testLibraryConnection);
  const config = useQuery({ queryKey: ["library-integration"], queryFn: () => loadFn() });
  const [form, setForm] = useState<Form>(EMPTY);

  useEffect(() => {
    const c = config.data;
    if (!c) return;
    setForm({
      providerName: c.providerName,
      baseUrl: c.baseUrl ?? "",
      authMethod: c.authMethod as Form["authMethod"],
      authHeaderName: c.authHeaderName ?? "X-API-Key",
      authQueryParam: c.authQueryParam ?? "",
      searchPath: c.searchPath ?? "/search",
      itemPath: c.itemPath ?? "",
      catalogueUrlTemplate: c.catalogueUrlTemplate ?? "",
      timeoutMs: c.timeoutMs,
      maxRetries: c.maxRetries,
      enabled: c.enabled,
    });
  }, [config.data]);

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          providerName: form.providerName,
          baseUrl: form.baseUrl.trim() ? form.baseUrl.trim() : null,
          authMethod: form.authMethod,
          authHeaderName: form.authHeaderName,
          authQueryParam: form.authQueryParam.trim() ? form.authQueryParam.trim() : null,
          searchPath: form.searchPath.trim() ? form.searchPath.trim() : null,
          itemPath: form.itemPath.trim() ? form.itemPath.trim() : null,
          catalogueUrlTemplate: form.catalogueUrlTemplate.trim() ? form.catalogueUrlTemplate.trim() : null,
          timeoutMs: form.timeoutMs,
          maxRetries: form.maxRetries,
          enabled: form.enabled,
        },
      }),
    onSuccess: () => {
      toast.success(ar ? "تم حفظ إعدادات المكتبة" : "Library connector saved");
      void config.refetch();
    },
    onError: (e: Error) => toastError(e, ar ? "ar" : "en"),
  });

  const test = useMutation({
    mutationFn: () => testFn({}),
    onSuccess: (r) => {
      if (r.ok) toast.success(`${ar ? "الاتصال ناجح" : "Connection OK"} · ${r.sampleCount} · ${r.latencyMs} ms`);
      else toast.error(r.error ?? (ar ? "فشل الاتصال" : "Connection failed"));
      void config.refetch();
    },
    onError: (e: Error) => toastError(e, ar ? "ar" : "en"),
  });

  const field = (key: keyof Form, labelEn: string, labelAr: string, placeholder = "") => (
    <div className="space-y-1">
      <Label htmlFor={`lib-${key}`} className="text-xs">
        {ar ? labelAr : labelEn}
      </Label>
      <Input
        id={`lib-${key}`}
        value={String(form[key] ?? "")}
        placeholder={placeholder}
        disabled={!canManage}
        onChange={(e) =>
          setForm((f) => ({
            ...f,
            [key]: typeof EMPTY[key] === "number" ? Number(e.target.value) || 0 : e.target.value,
          }))
        }
      />
    </div>
  );

  return (
    <section className="rounded-lg border p-4">
      <header className="flex flex-wrap items-center gap-2">
        <Library className="size-4 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold">{ar ? "تكامل المكتبة" : "Library integration"}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
          {config.data?.healthStatus ?? "unknown"}
        </span>
        {config.data?.lastLatencyMs ? (
          <span className="text-xs text-muted-foreground">{config.data.lastLatencyMs} ms</span>
        ) : null}
      </header>
      <p className="mt-1 text-xs text-muted-foreground">
        {ar
          ? "تُقرأ بيانات الاعتماد من أسرار الخادم (LIBRARY_API_KEY أو معرّف ومفتاح العميل) ولا تُخزَّن هنا."
          : "Credentials are read from server secrets (LIBRARY_API_KEY or the client id/secret) and are never stored here."}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {field("providerName", "Provider name", "اسم المزود")}
        {field("baseUrl", "Base URL", "الرابط الأساسي", "https://api.library.example.com")}
        <div className="space-y-1">
          <Label htmlFor="lib-auth" className="text-xs">
            {ar ? "طريقة المصادقة" : "Authentication"}
          </Label>
          <select
            id="lib-auth"
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={form.authMethod}
            disabled={!canManage}
            onChange={(e) => setForm((f) => ({ ...f, authMethod: e.target.value as Form["authMethod"] }))}
          >
            <option value="header_api_key">API key header</option>
            <option value="query_api_key">API key query parameter</option>
            <option value="bearer">Bearer token</option>
            <option value="basic_client_credentials">Client id + secret (Basic)</option>
            <option value="client_id_secret_headers">Client id + secret (headers)</option>
          </select>
        </div>
        {form.authMethod === "query_api_key"
          ? field("authQueryParam", "Query parameter name", "اسم معامل الاستعلام", "apikey")
          : field("authHeaderName", "Header name", "اسم الترويسة", "X-API-Key")}
        {field("searchPath", "Search endpoint path", "مسار البحث", "/search")}
        {field("itemPath", "Item endpoint path", "مسار السجل", "/items/{id}")}
        {field("catalogueUrlTemplate", "Public catalogue URL template", "قالب رابط الفهرس", "https://catalogue.uaeu.ac.ae/record/{id}")}
        {field("timeoutMs", "Timeout (ms)", "المهلة (مللي ثانية)")}
        {field("maxRetries", "Retries", "إعادة المحاولة")}
        <div className="flex items-center gap-2 pt-5">
          <Switch
            id="lib-enabled"
            checked={form.enabled}
            disabled={!canManage}
            onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
          />
          <Label htmlFor="lib-enabled" className="text-xs">
            {ar ? "تفعيل البحث في الفهرس" : "Enable catalogue search"}
          </Label>
        </div>
      </div>

      {config.data?.lastError ? (
        <p className="mt-3 text-xs text-destructive">{config.data.lastError}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" disabled={!canManage || save.isPending} onClick={() => save.mutate()}>
          {ar ? "حفظ" : "Save"}
        </Button>
        <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
          <PlugZap className="size-4" aria-hidden />
          {ar ? "اختبار الاتصال" : "Test connection"}
        </Button>
      </div>
    </section>
  );
}
