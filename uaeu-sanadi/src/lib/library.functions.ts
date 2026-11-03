import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Branch hours (Asia/Dubai) plus the approved library service catalogue. */
export const getLibraryOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getLibraryHours, getLibraryServices } = await import("./library/hours.server");
    const db = context.supabase as never;
    const [branches, services] = await Promise.all([getLibraryHours(db), getLibraryServices(db)]);
    return { branches, services };
  });

const SearchInput = z.object({
  query: z.string().max(300).default(""),
  title: z.string().max(200).optional(),
  author: z.string().max(200).optional(),
  subject: z.string().max(200).optional(),
  isbn: z.string().max(40).optional(),
  yearFrom: z.number().int().min(1000).max(2200).optional(),
  yearTo: z.number().int().min(1000).max(2200).optional(),
  availableOnly: z.boolean().optional(),
  electronicOnly: z.boolean().optional(),
  types: z.array(z.string()).max(6).optional(),
  limit: z.number().int().min(1).max(25).default(12),
  lang: z.enum(["en", "ar"]).default("en"),
});

/** Catalogue search for the Ask the Librarian page. Never returns invented rows. */
export const searchLibraryCatalogue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SearchInput.parse(input))
  .handler(async ({ data, context }) => {
    const { searchCatalogue, applyClientFilters, parseSearchIntent, logSearchEvent } = await import(
      "./library/provider.server"
    );
    const db = context.supabase as never;
    const parsed = data.query ? parseSearchIntent(data.query) : {};
    const params = {
      ...parsed,
      ...(data.title ? { title: data.title } : {}),
      ...(data.author ? { author: data.author } : {}),
      ...(data.subject ? { subject: data.subject } : {}),
      ...(data.isbn ? { isbn: data.isbn } : {}),
      ...(data.yearFrom ? { yearFrom: data.yearFrom } : {}),
      ...(data.yearTo ? { yearTo: data.yearTo } : {}),
      ...(data.types?.length ? { types: data.types as never } : {}),
      ...(data.availableOnly ? { availableOnly: true } : {}),
      ...(data.electronicOnly ? { electronicOnly: true } : {}),
      limit: data.limit,
    };
    const res = await searchCatalogue({ db, params });
    const results = applyClientFilters(res.results, params);
    await logSearchEvent(db, {
      studentId: context.userId,
      searchType: "page",
      language: data.lang,
      queryTerms: data.query || (data.title ?? data.author ?? data.subject ?? null),
      resultCount: results.length,
      providerStatus: res.status,
      latencyMs: res.latencyMs,
      errorCode: res.error,
    });
    return { ...res, results, searchUsed: params };
  });

const AskInput = z.object({
  question: z.string().min(5).max(2000),
  details: z.string().max(2000).default(""),
  lang: z.enum(["en", "ar"]).default("en"),
});

/** Human handoff: opens a tracked request routed to Library Services. */
export const askALibrarian = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AskInput.parse(input))
  .handler(async ({ data, context }) => {
    // Same intake pipeline as the Assistant: classification, routing to
    // Library Services, owner assignment, SLA and notification.
    const { createLibrarianRequest } = await import("./library/librarian.server");
    const { request, created, acknowledgement } = await createLibrarianRequest({
      db: context.supabase as never,
      studentId: context.userId,
      question: data.question,
      details: data.details ?? null,
      lang: data.lang,
    });
    return { caseId: request.id, reference: request.reference, created, acknowledgement };
  });

/* ------------------------------------------------------------------ */
/* Admin: library integration configuration                            */
/* ------------------------------------------------------------------ */

export const getLibraryIntegration = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadProviderSettings } = await import("./library/provider.server");
    const settings = await loadProviderSettings(context.supabase as never);
    if (!settings) return null;
    // Credentials live in server secrets and are never returned to the client.
    return {
      providerName: settings.providerName,
      baseUrl: settings.baseUrl,
      authMethod: settings.authMethod,
      authHeaderName: settings.authHeaderName,
      authQueryParam: settings.authQueryParam,
      apiKeySecretName: settings.apiKeySecretName,
      searchPath: settings.searchPath,
      itemPath: settings.itemPath,
      catalogueUrlTemplate: settings.catalogueUrlTemplate,
      timeoutMs: settings.timeoutMs,
      maxRetries: settings.maxRetries,
      enabled: settings.enabled,
      healthStatus: settings.healthStatus,
      lastSuccessAt: settings.lastSuccessAt,
      lastError: settings.lastError,
      lastErrorAt: settings.lastErrorAt,
      lastLatencyMs: settings.lastLatencyMs,
    };
  });

const ConfigInput = z.object({
  providerName: z.string().min(2).max(120),
  baseUrl: z.string().url().max(300).nullable(),
  authMethod: z.enum(["header_api_key", "query_api_key", "bearer", "basic_client_credentials", "client_id_secret_headers"]),
  authHeaderName: z.string().max(60).default("X-API-Key"),
  authQueryParam: z.string().max(60).nullable().default(null),
  searchPath: z.string().max(200).nullable(),
  itemPath: z.string().max(200).nullable(),
  catalogueUrlTemplate: z.string().max(300).nullable(),
  timeoutMs: z.number().int().min(1000).max(20000).default(6000),
  maxRetries: z.number().int().min(0).max(3).default(1),
  enabled: z.boolean(),
});

export const updateLibraryIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ConfigInput.parse(input))
  .handler(async ({ data, context }) => {
    // RLS restricts this table to administrators; a student write is rejected.
    const { error } = await (context.supabase as never as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      from: (t: string) => any;
    })
      .from("library_provider_settings")
      .update({
        provider_name: data.providerName,
        base_url: data.baseUrl,
        auth_method: data.authMethod,
        auth_header_name: data.authHeaderName,
        auth_query_param: data.authQueryParam,
        search_path: data.searchPath,
        item_path: data.itemPath,
        catalogue_url_template: data.catalogueUrlTemplate,
        timeout_ms: data.timeoutMs,
        max_retries: data.maxRetries,
        enabled: data.enabled,
        updated_at: new Date().toISOString(),
      })
      .eq("provider_key", "library_search");
    if (error) throw new Error(error.message);
    return { saved: true };
  });

export const testLibraryConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { testConnection } = await import("./library/provider.server");
    return testConnection(context.supabase as never);
  });

/* ------------------------------------------------------------------ */
/* OCLC WorldCat: record details, availability and admin diagnostics    */
/* ------------------------------------------------------------------ */

/** Full record view: bibliographic detail, UAEU holdings and access links. */
export const getLibraryRecordDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ oclcNumber: z.string().min(1).max(40) }).parse(input))
  .handler(async ({ data }) => {
    const { getRecordDetails, getInstitutionHoldings, getItemAvailability, getAccessOptions } = await import(
      "./library/oclc.server"
    );
    const [record, holdings, items, access] = await Promise.all([
      getRecordDetails(data.oclcNumber).catch(() => null),
      getInstitutionHoldings(data.oclcNumber).catch(() => null),
      getItemAvailability(data.oclcNumber).catch(() => ({ configured: false, items: [] })),
      getAccessOptions(data.oclcNumber).catch(() => []),
    ]);
    if (!record) return { record: null, holdings: [], heldByInstitution: null, access: [], checkedAt: new Date().toISOString() };
    const localHoldings = items.items.length ? items.items : (holdings?.holdings ?? []);
    return {
      record: {
        ...record,
        heldByInstitution: holdings ? holdings.count > 0 : null,
        localHoldingCount: holdings?.count ?? null,
        holdings: localHoldings,
        onlineUrl: access[0]?.uri ?? record.onlineUrl,
      },
      holdings: localHoldings,
      heldByInstitution: holdings ? holdings.count > 0 : null,
      access,
      checkedAt: new Date().toISOString(),
    };
  });

/** Query help when a search returns nothing; terms come from OCLC probes only. */
export const getLibrarySuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ query: z.string().max(300) }).parse(input))
  .handler(async ({ data }) => {
    const { getSuggestions } = await import("./library/oclc.server");
    return { suggestion: await getSuggestions(data.query) };
  });

/** Admin diagnostics for the OCLC integration. Never returns credentials. */
export const getOclcDiagnostics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertLibraryAdmin } = await import("./library/admin.server");
    await assertLibraryAdmin(context.supabase as never, context.userId);
    const { testOclcConnection } = await import("./library/oclc.server");
    return testOclcConnection();
  });

/** Admin live test search against OCLC. */
export const runOclcTestSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ query: z.string().min(2).max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertLibraryAdmin } = await import("./library/admin.server");
    await assertLibraryAdmin(context.supabase as never, context.userId);
    const { oclcTestSearch } = await import("./library/oclc.server");
    return oclcTestSearch(data.query);
  });
