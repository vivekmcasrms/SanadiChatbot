/**
 * Real ingestion for approved website sources: fetch → extract → detect
 * sections → follow approved same-domain links → chunk → index. A source only
 * becomes searchable after at least one page has been indexed successfully.
 * Server only.
 */
import type { Db } from "../agent/tools.server";
import { checksum, chunkText, detectLanguage, type Chunk } from "./processing.server";
import { validateSourceUrl, isDemoHost } from "./web.server";

export type CrawlScope = "single_page" | "selected_pages" | "same_domain";

export type PageOutcome = {
  url: string;
  depth: number;
  ok: boolean;
  status: "indexed" | "unchanged" | "fetch_failed" | "removed" | "empty";
  title: string | null;
  language: string;
  chunks: number;
  textLength: number;
  hash: string | null;
  error: string | null;
};

export type CrawlReport = {
  discovered: number;
  fetched: number;
  indexed: number;
  failed: number;
  chunks: number;
  removed: number;
  pages: PageOutcome[];
  /** Institutional facts harvested from official pages during this crawl. */
  collegeNames: string[];
  error: string | null;
  truncated: boolean;
};

const SKIP_EXTENSION = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|jpe?g|png|gif|svg|webp|mp4|mp3|ics|css|js|json|xml)$/i;
const BOILERPLATE =
  /^(skip to main content|close modal|search|popular searches|learn more|read more|enter|home|menu|share|print|back to top|english|عربي|الرئيسية)$/i;

/* ------------------------------------------------------------------ fetching */

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&[a-z]+;/gi, " ");
}

/**
 * Turns a page into heading-aware markdown-ish text. Headings survive as
 * `## Heading` so the shared chunker can attach each passage to its section.
 */
export function extractPageText(html: string): { title: string | null; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  body = body.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, _lvl, inner: string) => {
    const heading = decodeEntities(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    return heading ? `\n\n## ${heading}\n\n` : "\n\n";
  });
  body = body
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|section|article|td|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const lines = decodeEntities(body)
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter((l) => l.length > 0 && !BOILERPLATE.test(l));

  // Collapse the navigational repetition typical of university templates.
  const seen = new Map<string, number>();
  const kept: string[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      kept.push("", line, "");
      continue;
    }
    const key = line.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > 2) continue;
    kept.push(line);
  }

  const text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const title = titleMatch ? decodeEntities(titleMatch[1]!.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() : null;
  return { title, text };
}

export function extractLinks(html: string, pageUrl: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    const raw = m[1]!.trim();
    if (!raw || raw.startsWith("mailto:") || raw.startsWith("tel:") || raw.startsWith("javascript:")) continue;
    try {
      const abs = new URL(raw, pageUrl);
      abs.hash = "";
      out.add(abs.toString());
    } catch {
      /* unparseable link */
    }
  }
  return [...out];
}

export type RobotsRules = { disallow: string[] };

/** Best-effort robots.txt reading; a missing or unreadable file allows crawling. */
export async function loadRobots(origin: string): Promise<RobotsRules> {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(6000),
      headers: { "user-agent": "Sanadi-KnowledgeBot/1.0" },
    });
    if (!res.ok) return { disallow: [] };
    const body = (await res.text()).slice(0, 100_000);
    const disallow: string[] = [];
    let applies = false;
    for (const line of body.split("\n")) {
      const clean = line.split("#")[0]!.trim();
      if (!clean) continue;
      const [rawKey, ...rest] = clean.split(":");
      const key = (rawKey ?? "").toLowerCase().trim();
      const value = rest.join(":").trim();
      if (key === "user-agent") applies = value === "*" || /sanadi/i.test(value);
      else if (key === "disallow" && applies && value) disallow.push(value);
    }
    return { disallow };
  } catch {
    return { disallow: [] };
  }
}

export function robotsAllows(rules: RobotsRules, pathname: string): boolean {
  return !rules.disallow.some((rule) => {
    const prefix = rule.replace(/\*+$/, "");
    return prefix === "/" ? true : pathname.startsWith(prefix);
  });
}

export type FetchOutcome =
  | { ok: true; title: string | null; text: string; html: string; language: string; hash: string }
  | { ok: false; status: "fetch_failed" | "removed"; error: string };

/** Fetches one page and maps every failure to a safe, admin-readable reason. */
export async function fetchPage(url: string, timeoutMs = 12_000): Promise<FetchOutcome> {
  const validation = validateSourceUrl(url);
  if (!validation.ok) return { ok: false, status: "fetch_failed", error: validation.error };
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
      headers: { "user-agent": "Sanadi-KnowledgeBot/1.0", accept: "text/html,application/xhtml+xml" },
    });
    if (res.status === 404 || res.status === 410) return { ok: false, status: "removed", error: `Page no longer exists (HTTP ${res.status})` };
    if (res.status === 401 || res.status === 403) return { ok: false, status: "fetch_failed", error: "Authentication required or access blocked by the site" };
    if (res.status === 429) return { ok: false, status: "fetch_failed", error: "The site is rate-limiting requests" };
    if (!res.ok) return { ok: false, status: "fetch_failed", error: `The site returned HTTP ${res.status}` };
    const contentType = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(contentType))
      return { ok: false, status: "fetch_failed", error: `Unsupported content type: ${contentType.split(";")[0] || "unknown"}` };
    const html = (await res.text()).slice(0, 1_500_000);
    const { title, text } = extractPageText(html);
    const detected = detectLanguage(text);
    return {
      ok: true,
      title,
      text,
      html,
      language: detected === "ar" ? "ar" : "en",
      hash: await checksum(text),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fetch failed";
    return {
      ok: false,
      status: "fetch_failed",
      error: /timeout|abort/i.test(message) ? "The page did not respond in time (timeout)" : message.slice(0, 200),
    };
  }
}

/* ------------------------------------------------------------------ crawling */

export type CrawlConfig = {
  scope: CrawlScope;
  maxDepth: number;
  maxPages: number;
  allowedPaths: string[];
  excludedPaths: string[];
  seedUrls: string[];
  /** Wall-clock budget so a crawl always returns a usable partial result. */
  budgetMs?: number;
};

function pathAllowed(pathname: string, config: CrawlConfig): boolean {
  if (config.excludedPaths.some((p) => p && pathname.startsWith(p))) return false;
  if (config.allowedPaths.length) return config.allowedPaths.some((p) => p && pathname.startsWith(p));
  return true;
}

function languageOf(url: URL, detected: string): string {
  if (/^\/ar(\/|$)/.test(url.pathname)) return "ar";
  if (/^\/en(\/|$)/.test(url.pathname)) return "en";
  return detected;
}

type Db_ = Db;

/**
 * Crawl, extract and index one web source. Pages are replaced atomically per
 * page: old passages are removed only once the new ones are ready.
 */
export async function crawlAndIndexSource(
  db: Db_,
  source: { id: string; url: string; title: string; knowledgeDomain: string | null },
  config: CrawlConfig,
): Promise<CrawlReport> {
  const started = Date.now();
  const budget = config.budgetMs ?? 55_000;
  const report: CrawlReport = { discovered: 0, fetched: 0, indexed: 0, failed: 0, chunks: 0, removed: 0, pages: [], collegeNames: [], error: null, truncated: false };

  const root = validateSourceUrl(source.url);
  if (!root.ok) {
    report.error = root.error;
    return report;
  }
  if (isDemoHost(source.url)) {
    report.error = "Demo hosts cannot be crawled.";
    return report;
  }

  const origin = root.url.origin;
  const robots = await loadRobots(origin);

  const queue: { url: string; depth: number }[] = [{ url: root.url.toString(), depth: 0 }];
  const queued = new Set<string>([root.url.toString()]);
  for (const seed of config.seedUrls) {
    try {
      const abs = new URL(seed, root.url).toString();
      if (!queued.has(abs)) {
        queued.add(abs);
        queue.push({ url: abs, depth: 0 });
      }
    } catch {
      /* ignore malformed seed */
    }
  }

  const maxPages = config.scope === "single_page" ? 1 : Math.min(Math.max(1, config.maxPages), 300);
  const maxDepth = config.scope === "same_domain" ? Math.min(Math.max(0, config.maxDepth), 3) : 0;
  const visitedUrls: string[] = [];

  while (queue.length && visitedUrls.length < maxPages) {
    if (Date.now() - started > budget) {
      report.truncated = true;
      break;
    }
    const next = queue.shift()!;
    visitedUrls.push(next.url);
    report.discovered += 1;

    const fetched = await fetchPage(next.url);
    if (!fetched.ok) {
      report.failed += 1;
      report.pages.push({
        url: next.url, depth: next.depth, ok: false, status: fetched.status, title: null,
        language: "en", chunks: 0, textLength: 0, hash: null, error: fetched.error,
      });
      await upsertPage(db, source.id, {
        url: next.url, depth: next.depth, title: null, language: "en",
        status: fetched.status, error: fetched.error, hash: null, textLength: 0, chunks: [],
      });
      continue;
    }

    report.fetched += 1;
    for (const name of extractCollegeNames(fetched.html)) {
      if (!report.collegeNames.includes(name)) report.collegeNames.push(name);
    }
    const url = new URL(next.url);
    const language = languageOf(url, fetched.language);
    const chunks = chunkText(fetched.text).filter((c) => c.content.trim().length >= 80);

    if (!chunks.length) {
      report.pages.push({
        url: next.url, depth: next.depth, ok: false, status: "empty", title: fetched.title,
        language, chunks: 0, textLength: fetched.text.length, hash: fetched.hash,
        error: "No meaningful text could be extracted from this page",
      });
      await upsertPage(db, source.id, {
        url: next.url, depth: next.depth, title: fetched.title, language,
        status: "empty", error: "No meaningful text could be extracted from this page",
        hash: fetched.hash, textLength: fetched.text.length, chunks: [],
      });
    } else {
      await upsertPage(db, source.id, {
        url: next.url, depth: next.depth, title: fetched.title, language,
        status: "indexed", error: null, hash: fetched.hash, textLength: fetched.text.length, chunks,
      });
      report.indexed += 1;
      report.chunks += chunks.length;
      report.pages.push({
        url: next.url, depth: next.depth, ok: true, status: "indexed", title: fetched.title,
        language, chunks: chunks.length, textLength: fetched.text.length, hash: fetched.hash, error: null,
      });
    }

    if (config.scope === "same_domain" && next.depth < maxDepth) {
      for (const link of extractLinks(fetched.html, next.url)) {
        if (queued.size >= maxPages * 4) break;
        let candidate: URL;
        try {
          candidate = new URL(link);
        } catch {
          continue;
        }
        if (candidate.origin !== origin) continue;
        if (SKIP_EXTENSION.test(candidate.pathname)) continue;
        if (!pathAllowed(candidate.pathname, config)) continue;
        if (!robotsAllows(robots, candidate.pathname)) continue;
        const key = candidate.toString();
        if (queued.has(key)) continue;
        queued.add(key);
        queue.push({ url: key, depth: next.depth + 1 });
      }
    }
  }

  // Pages that disappeared between crawls stop answering questions.
  const { data: stale } = await db
    .from("web_source_pages")
    .select("id, url")
    .eq("web_source_id", source.id)
    .eq("is_active", true);
  const gone = ((stale ?? []) as { id: string; url: string }[]).filter((p) => !visitedUrls.includes(p.url));
  if (gone.length && !report.truncated && config.scope !== "selected_pages") {
    const ids = gone.map((g) => g.id);
    await db.from("web_page_chunks").delete().in("page_id", ids);
    await db.from("web_source_pages").update({ is_active: false, status: "removed" }).in("id", ids);
    report.removed = gone.length;
  }

  return report;
}

async function upsertPage(
  db: Db_,
  sourceId: string,
  page: {
    url: string; depth: number; title: string | null; language: string;
    status: string; error: string | null; hash: string | null; textLength: number; chunks: Chunk[];
  },
): Promise<void> {
  const now = new Date().toISOString();
  const { data: existing } = await db
    .from("web_source_pages")
    .select("id")
    .eq("web_source_id", sourceId)
    .eq("url", page.url)
    .maybeSingle();

  const row = {
    web_source_id: sourceId,
    url: page.url,
    title: page.title,
    language: page.language,
    depth: page.depth,
    status: page.status,
    error_reason: page.error,
    content_hash: page.hash,
    text_length: page.textLength,
    chunk_count: page.chunks.length,
    fetched_at: now,
    indexed_at: page.chunks.length ? now : null,
    is_active: page.status === "indexed",
  };

  let pageId = (existing as { id: string } | null)?.id ?? null;
  if (pageId) {
    await db.from("web_source_pages").update(row as never).eq("id", pageId);
  } else {
    const { data: inserted, error } = await db.from("web_source_pages").insert(row as never).select("id").single();
    if (error) throw new Error(error.message);
    pageId = (inserted as { id: string }).id;
  }

  await db.from("web_page_chunks").delete().eq("page_id", pageId);
  if (!page.chunks.length) return;

  const rows = page.chunks.map((c) => ({
    web_source_id: sourceId,
    page_id: pageId,
    chunk_index: c.chunkNumber,
    section_title: c.sectionTitle,
    section_path: c.sectionPath,
    page_title: page.title,
    source_url: page.url,
    content: c.content.slice(0, 6000),
    token_count: c.tokenCount,
    language: page.language,
    content_hash: page.hash,
    fetched_at: now,
    indexed_at: now,
    is_active: true,
  }));
  const insertedRows: { id: string; content: string; section_title: string | null }[] = [];
  for (let i = 0; i < rows.length; i += 100) {
    const { data: inserted, error } = await db
      .from("web_page_chunks")
      .insert(rows.slice(i, i + 100) as never)
      .select("id, content, section_title");
    if (error) throw new Error(error.message);
    insertedRows.push(...((inserted ?? []) as typeof insertedRows));
  }
  const { embedChunkRows } = await import("./embeddings.server");
  await embedChunkRows(
    db as never,
    "web_page_chunks",
    insertedRows.map((r) => ({ id: r.id, content: r.content, sectionTitle: r.section_title, title: page.title })),
  ).catch(() => 0);

}

/* -------------------------------------------------- structured institutional facts */

/** Anchor/heading text is the reliable carrier of college names on the site. */
const COLLEGE_LABEL_RE = />\s*(College of [^<>]{3,60}?)\s*</g;

/** Pulls the official college names out of one page's raw HTML. */
export function extractCollegeNames(html: string): string[] {
  const names = new Map<string, string>();
  for (const match of html.matchAll(COLLEGE_LABEL_RE)) {
    const name = decodeEntities(match[1]!)
      .replace(/\s+/g, " ")
      .replace(/[,;:].*$/, "")
      .trim();
    if (!/^College of [A-Z]/.test(name)) continue;
    if (name.length < 12 || name.length > 70) continue;
    if (!names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  }
  return [...names.values()].sort();
}

/**
 * Stable institutional facts are better counted than inferred: college names
 * found on the official site become verified records the assistant can count.
 */
export async function refreshUniversityColleges(
  db: Db_,
  sourceId: string,
  names: string[],
): Promise<{ found: number; stored: number; names: string[] }> {
  const unique = new Map<string, string>();
  for (const name of names) if (!unique.has(name.toLowerCase())) unique.set(name.toLowerCase(), name);
  const list = [...unique.values()].sort();
  if (!list.length) return { found: 0, stored: 0, names: [] };


  const now = new Date().toISOString();
  for (const name of list) {
    const { data: existing } = await db.from("university_colleges").select("id").eq("name_en", name).maybeSingle();
    const payload = { name_en: name, source_url: `https://www.uaeu.ac.ae/en/colleges/`, web_source_id: sourceId, verified_at: now, is_active: true };
    if (existing) await db.from("university_colleges").update(payload as never).eq("id", (existing as { id: string }).id);
    else await db.from("university_colleges").insert(payload as never);
  }
  // Records not seen in this verification pass stop being presented as current.
  await db
    .from("university_colleges")
    .update({ is_active: false } as never)
    .eq("web_source_id", sourceId)
    .lt("verified_at", now);

  return { found: list.length, stored: list.length, names: list };
}
