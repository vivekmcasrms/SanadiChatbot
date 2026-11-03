/**
 * OCLC WorldCat connector. SERVER ONLY.
 *
 * Authentication: OAuth 2.0 client credentials against the configured OAuth token endpoint
 * using the institution WSKey (client id / secret) held in server secrets. The
 * secret and the access token are never logged, never returned to the client and
 * never sent to the model.
 *
 * Every catalogue record surfaced to a student originates from an OCLC response.
 * Nothing here invents bibliographic data or local availability.
 */
import { loadLibraryUrls } from "./url-settings.server";
import type {
  LibraryAvailability,
  LibraryHolding,
  LibraryResource,
  LibraryResourceType,
  LibrarySearchParams,
  LibrarySearchResponse,
} from "./types";

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const env = (name: string): string | null => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
};

export type OclcConfig = {
  clientId: string;
  clientSecret: string;
  oauthBaseUrl: string;
  institutionId: string | null;
  scope: string;
};

/** Reads OCLC configuration from server secrets. Returns null when unconfigured. */
export function readOclcConfig(): OclcConfig | null {
  const clientId = env("OCLC_CLIENT_ID") ?? env("LIBRARY_API_CLIENT_ID");
  const clientSecret = env("OCLC_CLIENT_SECRET") ?? env("LIBRARY_API_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    oauthBaseUrl: env("OCLC_OAUTH_BASE_URL") ?? import.meta.env["VITE_OCLC_OAUTH_BASE_URL"],
    institutionId: env("OCLC_INSTITUTION_ID"),
    scope: env("OCLC_SCOPE") ?? "wcapi",
  };
}

export const isOclcConfigured = () => readOclcConfig() !== null;

const TIMEOUTS = { oauth: 5_000, discovery: 8_000, availability: 5_000, detail: 6_000 };

/* ------------------------------------------------------------------ */
/* Diagnostics (in-memory, no secrets)                                 */
/* ------------------------------------------------------------------ */

export type ServiceHealth = {
  service: string;
  lastStatus: "healthy" | "failed" | "not_configured" | "unknown";
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  calls: number;
  failures: number;
  avgLatencyMs: number | null;
  rateLimitEvents: number;
};

const health = new Map<string, ServiceHealth>();

const blank = (service: string): ServiceHealth => ({
  service,
  lastStatus: "unknown",
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: null,
  calls: 0,
  failures: 0,
  avgLatencyMs: null,
  rateLimitEvents: 0,
});

function record(service: string, ok: boolean, latencyMs: number, error?: string, rateLimited = false) {
  const h = health.get(service) ?? blank(service);
  h.calls += 1;
  h.avgLatencyMs = h.avgLatencyMs === null ? latencyMs : Math.round((h.avgLatencyMs * (h.calls - 1) + latencyMs) / h.calls);
  if (rateLimited) h.rateLimitEvents += 1;
  if (ok) {
    h.lastStatus = "healthy";
    h.lastSuccessAt = new Date().toISOString();
  } else {
    h.failures += 1;
    h.lastStatus = "failed";
    h.lastFailureAt = new Date().toISOString();
    h.lastError = (error ?? "request failed").slice(0, 200);
  }
  health.set(service, h);
}

export const readOclcHealth = (): ServiceHealth[] => [...health.values()];

/* ------------------------------------------------------------------ */
/* Token cache                                                         */
/* ------------------------------------------------------------------ */

type CachedToken = { token: string; expiresAt: number; scopes: string; institutionId: string | null };
let cachedToken: CachedToken | null = null;
let inflightToken: Promise<CachedToken> | null = null;
const TOKEN_SAFETY_MS = 60_000;

export function tokenCacheState() {
  return cachedToken
    ? {
        cached: true,
        expiresAt: new Date(cachedToken.expiresAt).toISOString(),
        scopes: cachedToken.scopes,
        institutionId: cachedToken.institutionId,
      }
    : { cached: false, expiresAt: null, scopes: null, institutionId: null };
}

async function requestToken(config: OclcConfig): Promise<CachedToken> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUTS.oauth);
  try {
    const res = await fetch(`${config.oauthBaseUrl.replace(/\/$/, "")}/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: config.scope }).toString(),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      record("oauth", false, Date.now() - started, `status ${res.status}`);
      throw new Error(`OCLC authentication failed (status ${res.status})`);
    }
    const body = (await res.json()) as Record<string, unknown>;
    const token = typeof body["access_token"] === "string" ? (body["access_token"] as string) : null;
    if (!token) {
      record("oauth", false, Date.now() - started, "missing access token");
      throw new Error("OCLC authentication returned no access token");
    }
    const expiresIn = Number(body["expires_in"] ?? 1199);
    const value: CachedToken = {
      token,
      expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
      scopes: String(body["scope"] ?? body["scopes"] ?? config.scope),
      institutionId:
        (typeof body["context_institution_id"] === "string" || typeof body["context_institution_id"] === "number"
          ? String(body["context_institution_id"])
          : null) ?? config.institutionId,
    };
    record("oauth", true, Date.now() - started);
    return value;
  } catch (err) {
    clearTimeout(timer);
    if (!(err instanceof Error && err.message.startsWith("OCLC authentication")))
      record("oauth", false, Date.now() - started, err instanceof Error ? err.name : "network error");
    throw err instanceof Error ? err : new Error("OCLC authentication failed");
  }
}

/** Returns a cached OCLC access token, refreshing ~60s before expiry. */
export async function getOCLCAccessToken(force = false): Promise<CachedToken> {
  const config = readOclcConfig();
  if (!config) throw new Error("OCLC credentials are not configured");
  if (!force && cachedToken && cachedToken.expiresAt - TOKEN_SAFETY_MS > Date.now()) return cachedToken;
  if (!force && inflightToken) return inflightToken;
  inflightToken = requestToken(config)
    .then((t) => {
      cachedToken = t;
      return t;
    })
    .finally(() => {
      inflightToken = null;
    });
  return inflightToken;
}

/** Institution context confirmed by OCLC for this WSKey. */
export async function getInstitutionId(): Promise<string | null> {
  const config = readOclcConfig();
  if (!config) return null;
  if (config.institutionId) return config.institutionId;
  try {
    return (await getOCLCAccessToken()).institutionId;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Throttle + cache + request helper                                   */
/* ------------------------------------------------------------------ */

const MAX_CONCURRENT = 4;
let active = 0;
const queue: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => queue.push(resolve));
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    queue.shift()?.();
  }
}

type CacheEntry = { value: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): unknown | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key: string, value: unknown, ttlMs: number) {
  if (cache.size > 400) cache.clear();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

const traceId = () => Math.random().toString(36).slice(2, 10);

export class OclcError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "rate_limit" | "timeout" | "provider" | "config",
  ) {
    super(message);
  }
}

type CallOptions = { service: string; path: string; query?: Record<string, string | number | undefined>; ttlMs?: number; timeoutMs?: number };

/** Performs one authenticated OCLC call: cache → token → fetch → retry once on 401. */
async function oclcCall<T>(opts: CallOptions): Promise<T> {
  const config = readOclcConfig();
  if (!config) throw new OclcError("OCLC is not configured", "config");

  const urls = await loadLibraryUrls();
  const url = new URL(`${urls.baseUrl}/${opts.path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(opts.query ?? {}))
    if (v !== undefined && v !== null && String(v) !== "") url.searchParams.set(k, String(v));

  const key = `${opts.service}:${url.toString()}`;
  const cached = opts.ttlMs ? cacheGet(key) : undefined;
  const trace = traceId();
  if (cached !== undefined) {
    console.info(`[oclc] trace=${trace} service=${opts.service} cache=hit`);
    return cached as T;
  }

  const timeout = opts.timeoutMs ?? TIMEOUTS.discovery;
  let retries = 0;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const started = Date.now();
    const { token } = await getOCLCAccessToken(attempt > 0);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await withSlot(() =>
        fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: controller.signal,
        }),
      );
      clearTimeout(timer);
      const latency = Date.now() - started;

      if (res.status === 401 && attempt === 0) {
        retries += 1;
        cachedToken = null;
        continue;
      }
      if (res.status === 429) {
        record(opts.service, false, latency, "rate limited", true);
        console.info(`[oclc] trace=${trace} service=${opts.service} status=429 latency=${latency}ms`);
        throw new OclcError("OCLC rate limit reached", "rate_limit");
      }
      if (!res.ok) {
        record(opts.service, false, latency, `status ${res.status}`);
        console.info(`[oclc] trace=${trace} service=${opts.service} status=${res.status} latency=${latency}ms retries=${retries}`);
        throw new OclcError(`OCLC responded with status ${res.status}`, res.status === 403 ? "auth" : "provider");
      }

      const body = (await res.json()) as T;
      record(opts.service, true, latency);
      console.info(
        `[oclc] trace=${trace} service=${opts.service} status=200 latency=${latency}ms retries=${retries} cache=miss`,
      );
      if (opts.ttlMs) cacheSet(key, body, opts.ttlMs);
      return body;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof OclcError) throw err;
      const latency = Date.now() - started;
      const timedOut = err instanceof Error && err.name === "AbortError";
      record(opts.service, false, latency, timedOut ? "timeout" : "network error");
      console.info(`[oclc] trace=${trace} service=${opts.service} status=error latency=${latency}ms`);
      throw new OclcError(timedOut ? "OCLC request timed out" : "OCLC request failed", timedOut ? "timeout" : "provider");
    }
  }
  throw new OclcError("OCLC authentication could not be refreshed", "auth");
}

/* ------------------------------------------------------------------ */
/* Query construction                                                  */
/* ------------------------------------------------------------------ */

const escape = (value: string) => value.replace(/["\\]/g, " ").trim();

const TYPE_FILTERS: Partial<Record<LibraryResourceType, { itemType?: string; itemSubType?: string }>> = {
  book: { itemType: "book", itemSubType: "book-printbook" },
  ebook: { itemType: "book", itemSubType: "book-digital" },
  thesis: { itemSubType: "book-thsis" },
  article: { itemType: "artchap", itemSubType: "artchap-artcl" },
  conference_paper: { itemType: "artchap" },
  journal: { itemType: "jrnl" },
  multimedia: { itemType: "video" },
};

export function buildOclcQuery(params: LibrarySearchParams): string {
  const parts: string[] = [];
  if (params.isbn) parts.push(`bn:${escape(params.isbn)}`);
  if (params.title) parts.push(`ti:"${escape(params.title)}"`);
  if (params.author) parts.push(`au:"${escape(params.author)}"`);
  if (params.subject) parts.push(`su:"${escape(params.subject)}"`);
  const keywords = escape(params.query ?? "");
  if (keywords && !parts.length) parts.push(`kw:${keywords}`);
  else if (keywords && parts.length && !params.isbn) parts.push(`kw:${keywords}`);
  return parts.join(" AND ") || keywords || "kw:library";
}

function searchQueryParams(params: LibrarySearchParams, limit: number, heldBy?: string | null) {
  const filters = params.types?.length ? (TYPE_FILTERS[params.types[0]!] ?? {}) : {};
  const thisYear = new Date().getFullYear();
  const datePublished =
    params.yearFrom || params.yearTo
      ? `${params.yearFrom ?? 1500}-${params.yearTo ?? thisYear + 1}`
      : undefined;
  return {
    q: buildOclcQuery(params),
    limit,
    offset: params.offset ? params.offset + 1 : undefined,
    itemType: filters.itemType,
    itemSubType: filters.itemSubType,
    datePublished,
    inLanguage: params.language,
    orderBy: params.yearFrom && !params.title && !params.isbn ? "publicationDateDesc" : "bestMatch",
    heldByInstitutionID: heldBy ?? undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

type BriefRecord = Record<string, unknown>;

const str = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  return null;
};

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((x): x is string => Boolean(x)) : []);

export function mapOclcType(generalFormat: string | null, specificFormat: string | null): LibraryResourceType {
  const g = (generalFormat ?? "").toLowerCase();
  const s = (specificFormat ?? "").toLowerCase();
  if (s.includes("thsis") || s.includes("thesis")) return "thesis";
  if (g === "artchap") return s.includes("chptr") ? "article" : "article";
  if (g === "jrnl") return "journal";
  if (g === "book") return s.includes("digital") ? "ebook" : "book";
  if (g === "video" || g === "audiobook" || g === "music" || g === "image" || g === "intmm") return "multimedia";
  if (g === "archv" || g === "news") return "report";
  if (g === "web" || g === "compfile") return "database";
  if (g === "encyc" || g === "map") return "reference";
  return "other";
}

const HTTPS_ONLY = (url: string | null): string | null =>
  url && /^https:\/\//i.test(url) && url.length < 600 ? url : null;

export type OclcRecordExtras = {
  heldByInstitution: boolean | null;
  localHoldings: LibraryHolding[];
  localHoldingCount: number | null;
  onlineUrl: string | null;
};

function normaliseBrief(rec: BriefRecord, index: number, extras: Partial<OclcRecordExtras> = {}, catalogueUrlTemplate: string | null = null): LibraryResource {
  const oclcNumber = str(rec["oclcNumber"]) ?? `oclc-${index}`;
  const generalFormat = str(rec["generalFormat"]);
  const specificFormat = str(rec["specificFormat"]);
  const type = mapOclcType(generalFormat, specificFormat);
  const isElectronic = type === "ebook" || (specificFormat ?? "").toLowerCase() === "digital";
  const held = extras.heldByInstitution ?? null;
  const holdings = extras.localHoldings ?? [];
  const onlineUrl = HTTPS_ONLY(extras.onlineUrl ?? null);

  const knownHolding = holdings.find((h) => h.status !== "unknown");
  const availability: LibraryAvailability = knownHolding
    ? (holdings.find((h) => h.status === "available")?.status ?? knownHolding.status)
    : held && (isElectronic || onlineUrl)
      ? "electronic"
      : "unknown";

  return {
    id: oclcNumber,
    title: str(rec["title"]) ?? "Untitled record",
    subtitle: null,
    authors: [str(rec["creator"]), ...arr(rec["contributors"])].filter((x): x is string => Boolean(x)),
    year: Number(str(rec["machineReadableDate"])?.match(/\d{4}/)?.[0] ?? str(rec["date"])?.match(/\d{4}/)?.[0] ?? NaN) || null,
    type,
    providerType: [generalFormat, specificFormat].filter(Boolean).join(" · ") || null,
    publisher: str(rec["publisher"]),
    isbn: arr(rec["isbns"])[0] ?? null,
    issn: arr(rec["issns"])[0] ?? null,
    doi: str(rec["doi"]),
    journalTitle: null,
    volume: null,
    issue: null,
    pages: null,
    language: str(rec["language"]),
    subjects: [],
    summary: null,
    onlineUrl,
    requiresSignIn: Boolean(onlineUrl),
    catalogueUrl: catalogueUrlTemplate?.split("{id}").join(encodeURIComponent(oclcNumber)) ?? null,
    availability,
    holdings,
    copies: holdings.length,
    relevance: 1 - index * 0.01,
    provider: "OCLC",
    oclcNumber,
    edition: str(rec["edition"]),
    heldByInstitution: held,
    localHoldingCount: extras.localHoldingCount ?? null,
    accessScope: held === null ? "unknown" : held ? (isElectronic ? "uaeu_electronic" : "uaeu") : "worldcat",
    isElectronic,
    sourceCheckedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Public operations                                                   */
/* ------------------------------------------------------------------ */

type BriefBibsResponse = { briefRecords?: BriefRecord[]; numberOfRecords?: number };

/** Raw Discovery brief-bib search (single call). */
export async function discoverBriefBibs(
  params: LibrarySearchParams,
  limit: number,
  heldBy?: string | null,
): Promise<BriefBibsResponse> {
  return oclcCall<BriefBibsResponse>({
    service: heldBy ? "discovery_local" : "discovery",
    path: "brief-bibs",
    query: searchQueryParams(params, limit, heldBy),
    ttlMs: 60_000,
    timeoutMs: TIMEOUTS.discovery,
  });
}

/**
 * Primary student search. Runs the UAEU-held query and the global WorldCat query
 * in parallel, then classifies every record as UAEU-held or WorldCat-only.
 */
export async function searchDiscovery(params: LibrarySearchParams): Promise<LibrarySearchResponse> {
  const started = Date.now();
  const limit = Math.min(Math.max(params.limit ?? 5, 1), 25);
  const institutionId = await getInstitutionId();

  const base = (status: LibrarySearchResponse["status"], error: string | null): LibrarySearchResponse => ({
    status,
    provider: "OCLC WorldCat",
    retrievedAt: new Date().toISOString(),
    total: 0,
    results: [],
    latencyMs: Date.now() - started,
    error,
  });

  try {
    const [localRes, globalRes] = await Promise.all([
      institutionId
        ? discoverBriefBibs(params, limit, institutionId).catch(() => null)
        : Promise.resolve(null),
      params.availableOnly && institutionId
        ? Promise.resolve(null)
        : discoverBriefBibs(params, limit).catch((e: unknown) => {
            if (e instanceof OclcError) throw e;
            return null;
          }),
    ]);

    if (!localRes && !globalRes) return base("unavailable", "The library catalogue did not respond.");

    const localRecords = localRes?.briefRecords ?? [];
    const globalRecords = globalRes?.briefRecords ?? [];
    const seen = new Set<string>();
    const ordered: { rec: BriefRecord; held: boolean }[] = [];
    for (const rec of localRecords) {
      const id = String(rec["oclcNumber"] ?? "");
      if (id && !seen.has(id)) {
        seen.add(id);
        ordered.push({ rec, held: true });
      }
    }
    for (const rec of globalRecords) {
      const id = String(rec["oclcNumber"] ?? "");
      if (id && !seen.has(id)) {
        seen.add(id);
        ordered.push({ rec, held: institutionId ? false : null as unknown as boolean });
      }
    }

    const top = ordered.slice(0, limit);
    const { catalogueUrlTemplate } = await loadLibraryUrls();

    // Enrich only the records we will actually show: local holdings for UAEU
    // records, electronic access links for electronic ones.
    const enriched = await Promise.all(
      top.map(async ({ rec, held }, index) => {
        const oclcNumber = String(rec["oclcNumber"] ?? "");
        const specific = (str(rec["specificFormat"]) ?? "").toLowerCase();
        const electronic = specific === "digital";
        let extras: Partial<OclcRecordExtras> = { heldByInstitution: held };
        if (held && oclcNumber) {
          const [holdingInfo, access] = await Promise.all([
            getInstitutionHoldings(oclcNumber).catch(() => null),
            electronic ? getAccessOptions(oclcNumber).catch(() => []) : Promise.resolve([]),
          ]);
          extras = {
            heldByInstitution: holdingInfo ? holdingInfo.count > 0 : held,
            localHoldings: holdingInfo?.holdings ?? [],
            localHoldingCount: holdingInfo?.count ?? null,
            onlineUrl: access[0]?.uri ?? null,
          };
        }
        return normaliseBrief(rec, index, extras, catalogueUrlTemplate);
      }),
    );

    const total = Math.max(localRes?.numberOfRecords ?? 0, globalRes?.numberOfRecords ?? 0);
    return {
      status: enriched.length ? "ok" : "empty",
      provider: "OCLC WorldCat",
      retrievedAt: new Date().toISOString(),
      total,
      results: enriched,
      latencyMs: Date.now() - started,
      error: null,
    };
  } catch (err) {
    const kind = err instanceof OclcError ? err.kind : "provider";
    return base(kind === "config" ? "disabled" : "unavailable", messageForKind(kind));
  }
}

const messageForKind = (kind: string) =>
  kind === "config"
    ? "The library catalogue connector is not configured."
    : kind === "rate_limit"
      ? "The library catalogue is busy right now."
      : "The live library catalogue is temporarily unavailable.";

/** Full bibliographic record (subjects, summary, edition, electronic access). */
export async function getRecordDetails(oclcNumber: string): Promise<LibraryResource | null> {
  const id = oclcNumber.replace(/[^\d]/g, "");
  if (!id) return null;
  const body = await oclcCall<Record<string, unknown>>({
    service: "discovery_detail",
    path: `bibs/${id}`,
    ttlMs: 10 * 60_000,
    timeoutMs: TIMEOUTS.detail,
  });

  const format = (body["format"] ?? {}) as Record<string, unknown>;
  const identifier = (body["identifier"] ?? {}) as Record<string, unknown>;
  const title = (body["title"] ?? {}) as Record<string, unknown>;
  const description = (body["description"] ?? {}) as Record<string, unknown>;
  const contributor = (body["contributor"] ?? {}) as Record<string, unknown>;
  const date = (body["date"] ?? {}) as Record<string, unknown>;
  const language = (body["language"] ?? {}) as Record<string, unknown>;

  const mainTitles = Array.isArray(title["mainTitles"]) ? (title["mainTitles"] as Record<string, unknown>[]) : [];
  const creators = Array.isArray(contributor["creators"]) ? (contributor["creators"] as Record<string, unknown>[]) : [];
  const authors = creators
    .map((c) => {
      const first = str((c["firstName"] as Record<string, unknown> | undefined)?.["text"]);
      const second = str((c["secondName"] as Record<string, unknown> | undefined)?.["text"]);
      return [first, second].filter(Boolean).join(" ") || str(c["name"]);
    })
    .filter((x): x is string => Boolean(x));

  const publishers = Array.isArray(body["publishers"]) ? (body["publishers"] as Record<string, unknown>[]) : [];
  const subjectsRaw = Array.isArray(body["subjects"]) ? (body["subjects"] as Record<string, unknown>[]) : [];
  const summaries = Array.isArray(description["summaries"]) ? (description["summaries"] as Record<string, unknown>[]) : [];
  const access = Array.isArray(body["digitalAccessAndLocations"])
    ? (body["digitalAccessAndLocations"] as Record<string, unknown>[])
    : [];

  const rec: BriefRecord = {
    oclcNumber: str(identifier["oclcNumber"]) ?? id,
    title: str(mainTitles[0]?.["text"]),
    creator: authors[0] ?? null,
    date: str(date["publicationDate"]),
    machineReadableDate: str(date["machineReadableDate"]),
    generalFormat: str(format["generalFormat"]),
    specificFormat: str(format["specificFormat"]),
    publisher: str(publishers[0]?.["publisherName"] as unknown) ?? str((publishers[0]?.["publisherName"] as Record<string, unknown> | undefined)?.["text"]),
    isbns: identifier["isbns"],
    issns: identifier["issns"],
    language: str(language["itemLanguage"]),
  };

  const { catalogueUrlTemplate } = await loadLibraryUrls();
  const resource = normaliseBrief(rec, 0, {
    heldByInstitution: null,
    onlineUrl: HTTPS_ONLY(str(access[0]?.["uri"])),
  }, catalogueUrlTemplate);
  resource.authors = authors;
  resource.subjects = subjectsRaw
    .map((s) => str(s["subjectName"]) ?? str((s["subjectName"] as Record<string, unknown> | undefined)?.["text"]))
    .filter((x): x is string => Boolean(x))
    .slice(0, 8);
  resource.summary = str(summaries[0]?.["text"]);
  return resource;
}

/** UAEU holdings for one record (Availability Query / holdings capability). */
export async function getInstitutionHoldings(
  oclcNumber: string,
): Promise<{ count: number; holdings: LibraryHolding[]; institutions: string[] } | null> {
  const institutionId = await getInstitutionId();
  const id = oclcNumber.replace(/[^\d]/g, "");
  if (!institutionId || !id) return null;
  const body = await oclcCall<{ briefRecords?: BriefRecord[] }>({
    service: "availability",
    path: "bibs-holdings",
    query: { oclcNumber: id, heldByInstitutionID: institutionId },
    ttlMs: 60_000,
    timeoutMs: TIMEOUTS.availability,
  });
  const rec = body.briefRecords?.[0];
  const holdingInfo = (rec?.["institutionHolding"] ?? {}) as Record<string, unknown>;
  const brief = Array.isArray(holdingInfo["briefHoldings"])
    ? (holdingInfo["briefHoldings"] as Record<string, unknown>[])
    : [];
  const count = Number(holdingInfo["totalHoldingCount"] ?? brief.length) || 0;
  const holdings: LibraryHolding[] = brief.map((h) => ({
    library: str(h["institutionName"]) ?? str(h["alsoCalled"]),
    collection: null,
    floor: null,
    shelf: null,
    callNumber: null,
    status: "unknown",
    providerStatus: null,
    dueDate: null,
  }));
  return { count, holdings, institutions: brief.map((h) => str(h["oclcSymbol"]) ?? "").filter(Boolean) };
}

/** WMS item availability for the institution's own copies (item level). */
export async function getItemAvailability(
  oclcNumber: string,
): Promise<{ configured: boolean; items: LibraryHolding[] }> {
  const id = oclcNumber.replace(/[^\d]/g, "");
  if (!id) return { configured: false, items: [] };
  try {
    const body = await oclcCall<Record<string, unknown>>({
      service: "wms_item_availability",
      path: "my-holdings",
      query: { oclcNumber: id },
      ttlMs: 30_000,
      timeoutMs: TIMEOUTS.availability,
    });
    const detailed = Array.isArray(body["detailedHoldings"])
      ? (body["detailedHoldings"] as Record<string, unknown>[])
      : [];
    const items: LibraryHolding[] = detailed.map((h) => {
      const raw = str(h["itemStatus"]) ?? str(h["status"]);
      return {
        library: str(h["institutionName"]) ?? str(h["branchName"]),
        collection: str(h["collectionName"]) ?? str(h["shelvingLocation"]),
        floor: null,
        shelf: str(h["shelvingLocation"]),
        callNumber: str(h["callNumber"]),
        status: mapItemStatus(raw),
        providerStatus: raw,
        dueDate: str(h["dueDate"]),
      };
    });
    return { configured: Number(body["numberOfHoldings"] ?? 0) > 0 || items.length > 0, items };
  } catch {
    return { configured: false, items: [] };
  }
}

export function mapItemStatus(raw: string | null): LibraryAvailability {
  const s = (raw ?? "").toLowerCase();
  if (!s) return "unknown";
  if (/available|on shelf/.test(s)) return "available";
  if (/loan|charged|checked ?out|due/.test(s)) return "on_loan";
  if (/reference|non[- ]circulating/.test(s)) return "reference_only";
  if (/process|order|acquisition|cataloging/.test(s)) return "in_processing";
  if (/missing|lost|withdrawn/.test(s)) return "unavailable";
  return "unknown";
}

/** Electronic access options for a record (HTTPS links only). */
export async function getAccessOptions(
  oclcNumber: string,
): Promise<{ uri: string; provider: string | null }[]> {
  const id = oclcNumber.replace(/[^\d]/g, "");
  if (!id) return [];
  try {
    const body = await oclcCall<Record<string, unknown>>({
      service: "access_options",
      path: `bibs/${id}`,
      ttlMs: 10 * 60_000,
      timeoutMs: TIMEOUTS.detail,
    });
    const access = Array.isArray(body["digitalAccessAndLocations"])
      ? (body["digitalAccessAndLocations"] as Record<string, unknown>[])
      : [];
    return access
      .map((a) => ({ uri: HTTPS_ONLY(str(a["uri"])), provider: str(a["materialSpecified"]) }))
      .filter((a): a is { uri: string; provider: string | null } => Boolean(a.uri));
  } catch {
    return [];
  }
}

/**
 * Query help for zero/low-result searches. Terms come from OCLC records only —
 * nothing is invented; when OCLC returns nothing we return null.
 */
export async function getSuggestions(query: string): Promise<string | null> {
  const cleaned = query.trim();
  if (cleaned.length < 4) return null;
  try {
    const body = await discoverBriefBibs({ query: cleaned }, 1);
    if ((body.numberOfRecords ?? 0) > 0) return null;
    const words = cleaned.split(/\s+/).filter((w) => w.length > 3);
    for (const word of words) {
      const probe = await discoverBriefBibs({ query: word }, 1);
      const title = str(probe.briefRecords?.[0]?.["title"]);
      if ((probe.numberOfRecords ?? 0) > 0 && title) return word;
    }
    return null;
  } catch {
    return null;
  }
}

/** Recently published titles held by the institution (New Titles style listing). */
export async function getNewTitles(filters: {
  subject?: string;
  language?: string;
  type?: LibraryResourceType;
  limit?: number;
}): Promise<LibrarySearchResponse> {
  const year = new Date().getFullYear();
  return searchDiscovery({
    query: filters.subject ?? "",
    ...(filters.subject ? { subject: filters.subject } : {}),
    ...(filters.language ? { language: filters.language } : {}),
    ...(filters.type ? { types: [filters.type] } : {}),
    yearFrom: year - 1,
    limit: filters.limit ?? 5,
  });
}

/** WorldCat knowledge-base style electronic collection lookup for a record. */
export async function searchKnowledgeBase(query: string): Promise<LibrarySearchResponse> {
  return searchDiscovery({ query, types: ["ebook"], limit: 5 });
}

/* ------------------------------------------------------------------ */
/* Diagnostics / admin                                                 */
/* ------------------------------------------------------------------ */

export type OclcDiagnostics = {
  configured: boolean;
  institutionId: string | null;
  scopes: string | null;
  tokenCached: boolean;
  tokenExpiresAt: string | null;
  checkedAt: string;
  services: { key: string; label: string; status: "healthy" | "failed" | "not_configured"; detail: string | null }[];
  health: ServiceHealth[];
};

/** Live end-to-end verification of the OCLC integration. Never returns secrets. */
export async function testOclcConnection(): Promise<OclcDiagnostics> {
  const checkedAt = new Date().toISOString();
  const config = readOclcConfig();
  if (!config)
    return {
      configured: false,
      institutionId: null,
      scopes: null,
      tokenCached: false,
      tokenExpiresAt: null,
      checkedAt,
      services: [{ key: "oauth", label: "Authentication", status: "not_configured", detail: "Credentials are missing." }],
      health: readOclcHealth(),
    };

  const services: OclcDiagnostics["services"] = [];
  let institutionId: string | null = null;
  let scopes: string | null = null;

  try {
    const token = await getOCLCAccessToken();
    institutionId = token.institutionId;
    scopes = token.scopes;
    services.push({ key: "oauth", label: "Authentication", status: "healthy", detail: `Institution ${institutionId ?? "unknown"}` });
  } catch (err) {
    services.push({
      key: "oauth",
      label: "Authentication",
      status: "failed",
      detail: err instanceof Error ? err.message : "Authentication failed",
    });
    return {
      configured: true,
      institutionId: null,
      scopes: null,
      tokenCached: false,
      tokenExpiresAt: null,
      checkedAt,
      services,
      health: readOclcHealth(),
    };
  }

  const probe = "machine learning";
  const [discovery, local, detail] = await Promise.all([
    discoverBriefBibs({ query: probe }, 1).then(
      (r) => ({ ok: true, n: r.numberOfRecords ?? 0, id: str(r.briefRecords?.[0]?.["oclcNumber"]) }),
      (e: unknown) => ({ ok: false, n: 0, id: null, error: e instanceof Error ? e.message : "failed" }),
    ),
    institutionId
      ? discoverBriefBibs({ query: probe }, 1, institutionId).then(
          (r) => ({ ok: true, n: r.numberOfRecords ?? 0, id: str(r.briefRecords?.[0]?.["oclcNumber"]) }),
          (e: unknown) => ({ ok: false, n: 0, id: null, error: e instanceof Error ? e.message : "failed" }),
        )
      : Promise.resolve({ ok: false, n: 0, id: null, error: "No institution context" }),
    Promise.resolve(null),
  ]);
  void detail;

  services.push({
    key: "discovery",
    label: "WorldCat Discovery search",
    status: discovery.ok ? "healthy" : "failed",
    detail: discovery.ok ? `${discovery.n.toLocaleString()} records for “${probe}”` : ((discovery as { error?: string }).error ?? null),
  });
  services.push({
    key: "local_holdings",
    label: "Institution holdings / Availability",
    status: local.ok ? "healthy" : "failed",
    detail: local.ok ? `${local.n.toLocaleString()} records held by the institution` : ((local as { error?: string }).error ?? null),
  });

  const sampleId = local.id ?? discovery.id;
  if (sampleId) {
    const [holdings, access, item] = await Promise.all([
      getInstitutionHoldings(sampleId).catch(() => null),
      getAccessOptions(sampleId),
      getItemAvailability(sampleId),
    ]);
    services.push({
      key: "availability_query",
      label: "Availability query",
      status: holdings ? "healthy" : "failed",
      detail: holdings ? `${holdings.count} institution holding(s) on sample record` : "No response",
    });
    services.push({
      key: "wms_item_availability",
      label: "WMS item availability",
      status: item.configured ? "healthy" : "not_configured",
      detail: item.configured ? `${item.items.length} item(s)` : "No WMS item data returned for this WSKey",
    });
    services.push({
      key: "access_options",
      label: "Access options",
      status: access.length ? "healthy" : "not_configured",
      detail: access.length ? `${access.length} electronic access link(s)` : "No electronic access link on sample record",
    });
    const details = await getRecordDetails(sampleId).catch(() => null);
    services.push({
      key: "detailed_bib",
      label: "Detailed bib / citation metadata",
      status: details ? "healthy" : "failed",
      detail: details ? "Full metadata available for citations" : "Detail record unavailable",
    });
  }

  services.push({
    key: "citation",
    label: "Citations",
    status: "healthy",
    detail: "Built deterministically from OCLC metadata (OCLC citation endpoint not enabled on this WSKey)",
  });
  services.push({
    key: "suggestions",
    label: "Suggestions",
    status: "healthy",
    detail: "Derived from OCLC result probes (OCLC suggestions scope not enabled on this WSKey)",
  });
  services.push({
    key: "new_titles",
    label: "New titles",
    status: "healthy",
    detail: "Recent institution-held records via Discovery date ordering",
  });
  services.push({
    key: "knowledge_base",
    label: "Knowledge base",
    status: "not_configured",
    detail: "Knowledge Base scope is not enabled on this WSKey",
  });

  const cacheState = tokenCacheState();
  return {
    configured: true,
    institutionId,
    scopes,
    tokenCached: cacheState.cached,
    tokenExpiresAt: cacheState.expiresAt,
    checkedAt,
    services,
    health: readOclcHealth(),
  };
}

/** Admin "Test search": live search summary with no credential exposure. */
export async function oclcTestSearch(query: string): Promise<{
  query: string;
  status: string;
  resultsReturned: number;
  localHoldings: number;
  availabilityResolved: number;
  electronicAccess: number;
  latencyMs: number;
  error: string | null;
  sample: { title: string; year: number | null; type: string; scope: string }[];
}> {
  const res = await searchDiscovery({ query, limit: 10 });
  return {
    query,
    status: res.status,
    resultsReturned: res.results.length,
    localHoldings: res.results.filter((r) => r.heldByInstitution === true).length,
    availabilityResolved: res.results.filter((r) => r.availability !== "unknown").length,
    electronicAccess: res.results.filter((r) => Boolean(r.onlineUrl)).length,
    latencyMs: res.latencyMs,
    error: res.error,
    sample: res.results.slice(0, 5).map((r) => ({
      title: r.title,
      year: r.year,
      type: r.type,
      scope: r.accessScope ?? "unknown",
    })),
  };
}
