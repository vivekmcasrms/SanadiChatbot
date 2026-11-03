/**
 * Library catalogue connector. Server only.
 *
 * The provider (base URL, endpoints, auth style, parameter and response maps)
 * is stored in `library_provider_settings` and is fully configurable from the
 * admin panel. Credentials are read from server secrets and never stored in
 * the database, never logged and never returned to the client.
 *
 * The connector never fabricates results: when the provider is unconfigured,
 * disabled, slow or failing, it returns an explicit non-ok status.
 */
import type { Db } from "../agent/tools.server";
import type {
  LibraryAvailability,
  LibraryHolding,
  LibraryResource,
  LibraryResourceType,
  LibrarySearchParams,
  LibrarySearchResponse,
} from "./types";

export type ProviderSettings = {
  id: string;
  providerKey: string;
  providerName: string;
  baseUrl: string | null;
  authMethod: string;
  authHeaderName: string;
  authQueryParam: string | null;
  apiKeySecretName: string;
  extraHeaders: Record<string, string>;
  searchPath: string | null;
  itemPath: string | null;
  catalogueUrlTemplate: string | null;
  queryParamMap: Record<string, string>;
  responseMap: Record<string, string>;
  timeoutMs: number;
  maxRetries: number;
  enabled: boolean;
  healthStatus: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastLatencyMs: number | null;
};

const DEFAULT_PARAM_MAP: Record<string, string> = {
  query: "q",
  title: "title",
  author: "author",
  subject: "subject",
  isbn: "isbn",
  yearFrom: "year_from",
  yearTo: "year_to",
  language: "language",
  type: "type",
  limit: "limit",
  offset: "offset",
};

const DEFAULT_RESPONSE_MAP: Record<string, string> = {
  items: "results",
  total: "total",
  id: "id",
  title: "title",
  subtitle: "subtitle",
  authors: "authors",
  year: "year",
  type: "type",
  publisher: "publisher",
  isbn: "isbn",
  issn: "issn",
  doi: "doi",
  journalTitle: "journal",
  volume: "volume",
  issue: "issue",
  pages: "pages",
  language: "language",
  subjects: "subjects",
  summary: "description",
  onlineUrl: "online_url",
  catalogueUrl: "catalogue_url",
  availability: "availability",
  holdings: "holdings",
  holdingLibrary: "library",
  holdingCollection: "collection",
  holdingFloor: "floor",
  holdingShelf: "shelf",
  holdingCallNumber: "call_number",
  holdingStatus: "status",
  holdingDueDate: "due_date",
};

const asRecord = (v: unknown): Record<string, string> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};

export async function loadProviderSettings(db: Db): Promise<ProviderSettings | null> {
  const { data } = await db
    .from("library_provider_settings")
    .select("*")
    .eq("provider_key", "library_search")
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    providerKey: data.provider_key,
    providerName: data.provider_name,
    baseUrl: data.base_url,
    authMethod: data.auth_method,
    authHeaderName: data.auth_header_name,
    authQueryParam: data.auth_query_param,
    apiKeySecretName: data.api_key_secret_name,
    extraHeaders: asRecord(data.extra_headers),
    searchPath: data.search_path,
    itemPath: data.item_path,
    catalogueUrlTemplate: data.catalogue_url_template,
    queryParamMap: { ...DEFAULT_PARAM_MAP, ...asRecord(data.query_param_map) },
    responseMap: { ...DEFAULT_RESPONSE_MAP, ...asRecord(data.response_map) },
    timeoutMs: data.timeout_ms,
    maxRetries: data.max_retries,
    enabled: data.enabled,
    healthStatus: data.health_status,
    lastSuccessAt: data.last_success_at,
    lastError: data.last_error,
    lastErrorAt: data.last_error_at,
    lastLatencyMs: data.last_latency_ms,
  };
}

/* ---------------------------------------------------------------- */
/* Circuit breaker: stops hammering a failing provider               */
/* ---------------------------------------------------------------- */

const breaker = { failures: 0, openedAt: 0 };
const BREAKER_THRESHOLD = 4;
const BREAKER_COOLDOWN_MS = 30_000;

const breakerOpen = () => breaker.openedAt > 0 && Date.now() - breaker.openedAt < BREAKER_COOLDOWN_MS;
const recordFailure = () => {
  breaker.failures += 1;
  if (breaker.failures >= BREAKER_THRESHOLD) breaker.openedAt = Date.now();
};
const recordSuccess = () => {
  breaker.failures = 0;
  breaker.openedAt = 0;
};

/* ---------------------------------------------------------------- */
/* Normalisation                                                     */
/* ---------------------------------------------------------------- */

const pick = (source: unknown, path: string | undefined): unknown => {
  if (!path) return undefined;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, source);
};

const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
};

const list = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map((x) => text(x) ?? (typeof x === "object" ? (text(pick(x, "name")) ?? "") : "")).filter(Boolean);
  const s = text(v);
  return s ? s.split(/;|\||,(?=\s*[A-Z\u0600-\u06FF])/).map((p) => p.trim()).filter(Boolean) : [];
};

const AVAILABILITY_MAP: [RegExp, LibraryAvailability][] = [
  [/available|on shelf|in library|not checked out|متاح/i, "available"],
  [/loan|checked ?out|borrowed|due|معار/i, "on_loan"],
  [/reference|non[- ]circulating|اطلاع/i, "reference_only"],
  [/online|electronic|e-?book|full ?text|إلكترون/i, "electronic"],
  [/process|order|acquisition|معالجة/i, "in_processing"],
  [/missing|lost|withdrawn|unavailable|غير متاح/i, "unavailable"],
];

export function normaliseAvailability(raw: unknown): LibraryAvailability {
  const s = text(raw);
  if (!s) return "unknown";
  for (const [re, value] of AVAILABILITY_MAP) if (re.test(s)) return value;
  return "unknown";
}

const TYPE_MAP: [RegExp, LibraryResourceType][] = [
  [/e-?book|electronic book/i, "ebook"],
  [/journal article|article/i, "article"],
  [/journal|periodical|serial/i, "journal"],
  [/conference|proceeding/i, "conference_paper"],
  [/thesis|dissertation|رسالة/i, "thesis"],
  [/report|تقرير/i, "report"],
  [/database|قاعدة بيانات/i, "database"],
  [/video|audio|dvd|multimedia|وسائط/i, "multimedia"],
  [/reference|مرجع/i, "reference"],
  [/book|كتاب/i, "book"],
];

export function normaliseType(raw: unknown): LibraryResourceType {
  const s = text(raw);
  if (!s) return "other";
  for (const [re, value] of TYPE_MAP) if (re.test(s)) return value;
  return "other";
}

function normaliseResource(raw: unknown, map: Record<string, string>, settings: ProviderSettings, index: number): LibraryResource {
  const id = text(pick(raw, map["id"])) ?? `result-${index + 1}`;
  const availability = normaliseAvailability(pick(raw, map["availability"]));
  const holdingsRaw = pick(raw, map["holdings"]);
  const holdings: LibraryHolding[] = Array.isArray(holdingsRaw)
    ? holdingsRaw.map((h) => ({
        library: text(pick(h, map["holdingLibrary"])),
        collection: text(pick(h, map["holdingCollection"])),
        floor: text(pick(h, map["holdingFloor"])),
        shelf: text(pick(h, map["holdingShelf"])),
        callNumber: text(pick(h, map["holdingCallNumber"])),
        status: normaliseAvailability(pick(h, map["holdingStatus"])),
        providerStatus: text(pick(h, map["holdingStatus"])),
        dueDate: text(pick(h, map["holdingDueDate"])),
      }))
    : [];
  const onlineUrl = text(pick(raw, map["onlineUrl"]));
  const yearText = text(pick(raw, map["year"]));
  const yearMatch = yearText?.match(/\d{4}/)?.[0];
  const catalogueUrl =
    text(pick(raw, map["catalogueUrl"])) ??
    (settings.catalogueUrlTemplate ? settings.catalogueUrlTemplate.replace("{id}", encodeURIComponent(id)) : null);

  const resolved: LibraryAvailability =
    availability === "unknown" && holdings.length
      ? (holdings.find((h) => h.status === "available")?.status ?? holdings[0]!.status)
      : availability === "unknown" && onlineUrl
        ? "electronic"
        : availability;

  return {
    id,
    title: text(pick(raw, map["title"])) ?? "Untitled record",
    subtitle: text(pick(raw, map["subtitle"])),
    authors: list(pick(raw, map["authors"])),
    year: yearMatch ? Number(yearMatch) : null,
    type: normaliseType(pick(raw, map["type"])),
    providerType: text(pick(raw, map["type"])),
    publisher: text(pick(raw, map["publisher"])),
    isbn: text(pick(raw, map["isbn"])),
    issn: text(pick(raw, map["issn"])),
    doi: text(pick(raw, map["doi"])),
    journalTitle: text(pick(raw, map["journalTitle"])),
    volume: text(pick(raw, map["volume"])),
    issue: text(pick(raw, map["issue"])),
    pages: text(pick(raw, map["pages"])),
    language: text(pick(raw, map["language"])),
    subjects: list(pick(raw, map["subjects"])),
    summary: text(pick(raw, map["summary"])),
    onlineUrl,
    requiresSignIn: Boolean(onlineUrl),
    catalogueUrl,
    availability: resolved,
    holdings,
    copies: holdings.length,
    relevance: 1 - index * 0.01,
  };
}

/* ---------------------------------------------------------------- */
/* Search                                                            */
/* ---------------------------------------------------------------- */

function credentials(settings: ProviderSettings) {
  const apiKey = process.env[settings.apiKeySecretName] ?? process.env["LIBRARY_API_KEY"] ?? null;
  const clientId = process.env["LIBRARY_API_CLIENT_ID"] ?? null;
  const clientSecret = process.env["LIBRARY_API_CLIENT_SECRET"] ?? null;
  return { apiKey, clientId, clientSecret };
}

function buildRequest(settings: ProviderSettings, params: LibrarySearchParams) {
  const url = new URL((settings.searchPath ?? "/search").replace(/^\//, ""), `${settings.baseUrl!.replace(/\/$/, "")}/`);
  const m = settings.queryParamMap;
  const set = (key: string, value: string | number | undefined | null) => {
    const name = m[key];
    if (!name || value === undefined || value === null || value === "") return;
    url.searchParams.set(name, String(value));
  };
  set("query", params.query);
  set("title", params.title);
  set("author", params.author);
  set("subject", params.subject);
  set("isbn", params.isbn);
  set("yearFrom", params.yearFrom);
  set("yearTo", params.yearTo);
  set("language", params.language);
  set("type", params.types?.[0]);
  set("limit", params.limit ?? 10);
  set("offset", params.offset ?? 0);

  const headers: Record<string, string> = { Accept: "application/json", ...settings.extraHeaders };
  const { apiKey, clientId, clientSecret } = credentials(settings);
  switch (settings.authMethod) {
    case "query_api_key":
      if (apiKey && settings.authQueryParam) url.searchParams.set(settings.authQueryParam, apiKey);
      break;
    case "bearer":
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      break;
    case "basic_client_credentials":
      if (clientId && clientSecret)
        headers["Authorization"] = `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
      break;
    case "client_id_secret_headers":
      if (clientId) headers["X-Client-Id"] = clientId;
      if (clientSecret) headers["X-Client-Secret"] = clientSecret;
      break;
    case "header_api_key":
    default:
      if (apiKey) headers[settings.authHeaderName || "X-API-Key"] = apiKey;
      break;
  }
  return { url, headers };
}

function hasCredentials(settings: ProviderSettings): boolean {
  const { apiKey, clientId, clientSecret } = credentials(settings);
  if (settings.authMethod === "basic_client_credentials" || settings.authMethod === "client_id_secret_headers")
    return Boolean(clientId && clientSecret);
  return Boolean(apiKey || (clientId && clientSecret));
}

async function updateHealth(db: Db, settings: ProviderSettings, ok: boolean, latencyMs: number, error?: string) {
  await db
    .from("library_provider_settings")
    .update(
      ok
        ? { health_status: "healthy", last_success_at: new Date().toISOString(), last_latency_ms: latencyMs, last_error: null }
        : { health_status: "degraded", last_error: (error ?? "").slice(0, 300), last_error_at: new Date().toISOString(), last_latency_ms: latencyMs },
    )
    .eq("id", settings.id);
}

export type SearchOptions = { db: Db; params: LibrarySearchParams; settings?: ProviderSettings | null; recordHealth?: boolean };

/** Executes one catalogue search with timeout, one retry and circuit breaking. */
export async function searchCatalogue(opts: SearchOptions): Promise<LibrarySearchResponse> {
  const started = Date.now();
  const settings = opts.settings ?? (await loadProviderSettings(opts.db));
  const base = (status: LibrarySearchResponse["status"], error: string | null): LibrarySearchResponse => ({
    status,
    provider: settings?.providerName ?? null,
    retrievedAt: new Date().toISOString(),
    total: 0,
    results: [],
    latencyMs: Date.now() - started,
    error,
  });

  // Primary engine: OCLC WorldCat Discovery (institution WSKey in server secrets).
  const { isOclcConfigured, searchDiscovery } = await import("./oclc.server");
  if (isOclcConfigured() && settings?.enabled !== false) {
    const res = await searchDiscovery(opts.params);
    if (settings && opts.recordHealth !== false)
      await updateHealth(opts.db, settings, res.status === "ok" || res.status === "empty", res.latencyMs, res.error ?? undefined);
    return res;
  }

  if (!settings) return base("disabled", "The library catalogue connector has not been configured yet.");
  if (!settings.enabled || !settings.baseUrl)
    return base("disabled", "The library catalogue search is not connected yet.");
  if (!hasCredentials(settings)) return base("disabled", "Library catalogue credentials are missing.");
  if (breakerOpen()) return base("unavailable", "The library catalogue is temporarily unreachable.");

  const { url, headers } = buildRequest(settings, opts.params);
  const attempts = Math.max(1, settings.maxRetries + 1);
  let lastError = "The library catalogue did not respond.";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
    try {
      const res = await fetch(url.toString(), { headers, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        lastError = `Catalogue responded with status ${res.status}`;
        if (res.status < 500) break;
        continue;
      }
      const body = (await res.json()) as unknown;
      const map = settings.responseMap;
      const itemsRaw = pick(body, map["items"]);
      const items = Array.isArray(itemsRaw) ? itemsRaw : Array.isArray(body) ? body : [];
      const results = items.map((item, i) => normaliseResource(item, map, settings, i));
      const totalRaw = Number(text(pick(body, map["total"])) ?? results.length);
      recordSuccess();
      const latency = Date.now() - started;
      if (opts.recordHealth !== false) await updateHealth(opts.db, settings, true, latency);
      return {
        status: results.length ? "ok" : "empty",
        provider: settings.providerName,
        retrievedAt: new Date().toISOString(),
        total: Number.isFinite(totalRaw) ? totalRaw : results.length,
        results,
        latencyMs: latency,
        error: null,
      };
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? (err.name === "AbortError" ? "The library catalogue timed out." : err.message) : lastError;
    }
  }

  recordFailure();
  const latency = Date.now() - started;
  if (opts.recordHealth !== false) await updateHealth(opts.db, settings, false, latency, lastError);
  return base("unavailable", lastError);
}

/** Admin "Test connection": a cheap probe that never mutates student data. */
export async function testConnection(db: Db): Promise<{
  ok: boolean;
  status: LibrarySearchResponse["status"];
  provider: string | null;
  latencyMs: number;
  sampleCount: number;
  error: string | null;
  credentialsPresent: boolean;
}> {
  const settings = await loadProviderSettings(db);
  const { isOclcConfigured } = await import("./oclc.server");
  const res = await searchCatalogue({ db, params: { query: "library", limit: 3 }, settings });
  return {
    ok: res.status === "ok" || res.status === "empty",
    status: res.status,
    provider: res.provider,
    latencyMs: res.latencyMs,
    sampleCount: res.results.length,
    error: res.error,
    credentialsPresent: isOclcConfigured() || (settings ? hasCredentials(settings) : false),
  };
}

/**
 * Reduces a natural-language request to its subject words so the catalogue
 * receives "machine learning", not "can you find me some books about machine learning".
 */
export function extractLibraryTopic(raw: string, author?: string | null): string {
  let t = ` ${raw} `;
  if (author) t = t.replace(new RegExp(`\\bby\\s+${author.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"), " ");
  t = t
    .replace(/["“”«»?!.,;:]/g, " ")
    .replace(/\b(after|since|before|from|between|published( in)?)\s+(19|20)\d{2}(\s+(and|to)\s+(19|20)\d{2})?/gi, " ")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\b(please|kindly|hi|hello|hey|thanks?|thank you)\b/gi, " ")
    .replace(/\b(can|could|would|will)\s+(you|i|we)\b/gi, " ")
    .replace(/\b(find|search( for)?|look(ing)? for|locate|recommend|suggest|get|borrow|need|want|show|give|help)\b/gi, " ")
    .replace(/\b(do|does|is|are|there|you|your|have|has|any|some|a|an|the|me|my|i|i'm|im|we|us|of|to|for|with|that|which|good|best|recent|new|latest|available|now|online|full ?text|published|written)\b/gi, " ")
    .replace(/\b(e-?books?|books?|articles?|papers?|journals?|thes[ie]s|dissertations?|databases?|resources?|materials?|readings?|sources?|references?|titles?|items?)\b/gi, " ")
    .replace(/\b(about|on|regarding|related to|relating to|covering|in the (field|area) of|in|at)\b/gi, " ")
    .replace(/\b(library|catalog(ue)?|uaeu)\b/gi, " ")
    .replace(/\b(in\s+)?(arabic|english)\b/gi, " ")
    .replace(/(ابحث|أبحث|ابغى|أبغي|أبي|أريد|أحتاج|ممكن|لو سمحت|هل يوجد|هل عندكم|عندكم|أعطني|اعطني|ساعدني)/g, " ")
    .replace(/(كتب|كتاب|كتاب إلكتروني|مقالات|مقال|أبحاث|بحث|مراجع|مصادر|دوريات|مجلات|رسائل|رسالة)/g, " ")
    .replace(/(^|\s)(عن|حول|في|من|على|بخصوص|المكتبة|بالعربية|بالإنجليزية|عربي|انجليزي|لي|و?أظهر|و?اعرض|المؤلف|العنوان|رابط|الفهرس|متاحة|متاح|نسخة|إلكترونية|مجلة)(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}

/** Arabic subject phrases → catalogue (English) subject terms. Longest first. */
export const ARABIC_TOPIC_GLOSSARY: Array<[RegExp, string]> = [
  [/(ال)?تعلم (ال)?آلي|(ال)?تعلم (ال)?آلة|تعلّم الآلة/, "machine learning"],
  [/(ال)?تعلم (ال)?عميق/, "deep learning"],
  [/(ال)?ذكاء (ال)?اصطناعي/, "artificial intelligence"],
  [/علوم? (ال)?بيانات/, "data science"],
  [/(ال)?أمن (ال)?سيبراني/, "cybersecurity"],
  [/علوم? (ال)?حاسوب|علوم? (ال)?حاسب/, "computer science"],
  [/(ال)?تغير (ال)?مناخي/, "climate change"],
  [/(ال)?أحياء/, "biology"],
];

/**
 * Arabic query understanding: books/journals/articles, availability, e-copy,
 * requested fields, and topic translation through the glossary. Pure.
 */
export function parseArabicLibraryRequest(raw: string): Partial<LibrarySearchParams> {
  const out: Partial<LibrarySearchParams> = {};
  if (!/[\u0600-\u06FF]/.test(raw)) return out;
  const types: LibraryResourceType[] = [];
  if (/نسخة إلكترونية|نسخ إلكترونية|كتب? إلكتروني/.test(raw)) {
    out.electronicOnly = true;
    types.push("ebook");
  } else if (/كتب|كتاب/.test(raw)) types.push("book");
  if (/مجلة|مجلات|دورية|دوريات/.test(raw)) types.push("journal");
  if (/مقال|مقالات|أبحاث/.test(raw)) types.push("article");
  if (types.length) out.types = types;
  if (/(^|\s)(ال)?متاح(ة)?(\s|$)|متوفر(ة)?/.test(raw)) out.availableOnly = true;
  const fields: NonNullable<LibrarySearchParams["requestedFields"]> = [];
  if (/(ال)?مؤلف/.test(raw)) fields.push("author");
  if (/(ال)?عنوان/.test(raw)) fields.push("title");
  if (/رابط (ال)?فهرس|رابط (ال)?كتالوج|الرابط/.test(raw)) fields.push("catalogue_link");
  if (fields.length) out.requestedFields = fields;
  for (const [re, en] of ARABIC_TOPIC_GLOSSARY) {
    const m = raw.match(re);
    if (m) {
      out.query = en;
      out.originalTopic = m[0];
      break;
    }
  }
  return out;
}

/** Extracts structured catalogue parameters from a natural-language request. */
export function parseSearchIntent(input: string): LibrarySearchParams {
  const raw = input.trim();
  const lower = raw.toLowerCase();
  const params: LibrarySearchParams = {};

  const isbn = raw.match(/\b(97[89][\d -]{10,17}|\d{9}[\dXx])\b/)?.[0];
  if (isbn) params.isbn = isbn.replace(/[ -]/g, "");

  const author =
    raw.match(/\bby\s+([A-Z\u0600-\u06FF][\w'.\u0600-\u06FF-]*(?:\s+[A-Z\u0600-\u06FF][\w'.\u0600-\u06FF-]*){0,2})/)?.[1] ??
    raw.match(/(?:للمؤلف|تأليف)\s+([\u0600-\u06FF]+(?:\s+[\u0600-\u06FF]+){0,2})/)?.[1];
  if (author) params.author = author.trim();

  const quoted = raw.match(/["“”'«]([^"“”'»]{3,120})["“”'»]/)?.[1];
  if (quoted) params.title = quoted.trim();

  const years = raw.match(/\b(19|20)\d{2}\b/g)?.map(Number) ?? [];
  if (/after|since|منذ|بعد/.test(lower) && years[0]) params.yearFrom = years[0];
  else if (/before|قبل/.test(lower) && years[0]) params.yearTo = years[0];
  else if (years.length >= 2) {
    params.yearFrom = Math.min(years[0]!, years[1]!);
    params.yearTo = Math.max(years[0]!, years[1]!);
  } else if (years[0] && !params.isbn) {
    params.yearFrom = years[0];
  }

  if (/arabic|بالعربية|عربي/.test(lower)) params.language = "ara";
  else if (/english|بالإنجليزية|انجليزي/.test(lower)) params.language = "eng";

  const types: LibraryResourceType[] = [];
  if (/e-?book|كتاب إلكتروني/.test(lower)) types.push("ebook");
  else if (/book|كتاب/.test(lower)) types.push("book");
  if (/article|paper|مقال|بحث/.test(lower)) types.push("article");
  if (/journal|دورية|مجلة/.test(lower)) types.push("journal");
  if (/thesis|dissertation|رسالة/.test(lower)) types.push("thesis");
  if (/database|قاعدة بيانات/.test(lower)) types.push("database");
  if (types.length) params.types = types;

  if (/available now|on the shelf|متاح الآن/.test(lower)) params.availableOnly = true;
  if (/online|full ?text|إلكترون/.test(lower)) params.electronicOnly = true;

  const cleaned = extractLibraryTopic(raw, author);
  params.query = (quoted ?? cleaned ?? raw).slice(0, 160) || raw.slice(0, 160);

  const arabic = parseArabicLibraryRequest(raw);
  if (arabic.types) params.types = arabic.types;
  if (arabic.availableOnly) params.availableOnly = true;
  if (arabic.electronicOnly) params.electronicOnly = true;
  if (arabic.requestedFields) params.requestedFields = arabic.requestedFields;
  if (arabic.query && !quoted) {
    params.query = arabic.query;
    if (arabic.originalTopic) params.originalTopic = arabic.originalTopic;
  }
  return params;
}

/** Applies student-facing filters that the provider may not support natively. */
export function applyClientFilters(results: LibraryResource[], params: LibrarySearchParams): LibraryResource[] {
  let out = results;
  if (params.availableOnly) out = out.filter((r) => r.availability === "available" || r.availability === "electronic");
  if (params.electronicOnly) out = out.filter((r) => Boolean(r.onlineUrl) || r.availability === "electronic");
  if (params.types?.length) out = out.filter((r) => params.types!.includes(r.type));
  if (params.yearFrom) out = out.filter((r) => !r.year || r.year >= params.yearFrom!);
  if (params.yearTo) out = out.filter((r) => !r.year || r.year <= params.yearTo!);
  return out;
}

/** Non-blocking analytics write; failures must never break a student search. */
export async function logSearchEvent(
  db: Db,
  event: {
    studentId: string | null;
    searchType: string;
    language: string;
    queryTerms: string | null;
    resultCount: number;
    providerStatus: string;
    latencyMs: number;
    errorCode?: string | null;
  },
): Promise<void> {
  try {
    await db.from("library_search_events").insert({
      student_id: event.studentId,
      search_type: event.searchType,
      language: event.language,
      query_terms: (event.queryTerms ?? "").slice(0, 300),
      result_count: event.resultCount,
      zero_results: event.resultCount === 0,
      provider_status: event.providerStatus,
      provider_latency_ms: event.latencyMs,
      error_code: event.errorCode ?? null,
    });
  } catch {
    /* analytics only */
  }
}
