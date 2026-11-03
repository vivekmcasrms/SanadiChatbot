/** Approved web-source retrieval with SSRF protection. Server only. */
import { checksum, chunkText, detectLanguage, type Chunk } from "./processing.server";

const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "metadata.google.internal", "169.254.169.254"]);

export function validateSourceUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "The URL is not valid." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "Only HTTPS sources are allowed." };
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return { ok: false, error: "This host is not permitted." };
  if (/^(10|127)\./.test(host)) return { ok: false, error: "Private network addresses are not permitted." };
  if (/^192\.168\./.test(host)) return { ok: false, error: "Private network addresses are not permitted." };
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return { ok: false, error: "Private network addresses are not permitted." };
  if (/^169\.254\./.test(host)) return { ok: false, error: "Link-local addresses are not permitted." };
  if (host.endsWith(".internal")) return { ok: false, error: "Internal hosts are not permitted." };
  if (url.username || url.password) return { ok: false, error: "Credentials must not be embedded in the URL." };
  if (/\/(login|signin|portal|account|my)(\/|$)/i.test(url.pathname))
    return { ok: false, error: "Login or personal portal pages cannot be ingested." };
  return { ok: true, url };
}

export function isDemoHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith(".local") || host.endsWith(".example") || host === "demo.example.local";
  } catch {
    return false;
  }
}

function stripMarkup(html: string): { title: string | null; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  body = body.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, _l, inner: string) => `\n\n## ${inner.replace(/<[^>]+>/g, "").trim()}\n\n`);
  body = body.replace(/<\/(p|div|li|tr|section)>/gi, "\n").replace(/<[^>]+>/g, " ");
  const text = body
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: titleMatch ? titleMatch[1]!.replace(/<[^>]+>/g, "").trim() : null, text };
}

export type FetchedPage = {
  ok: boolean;
  status: "fetched" | "access_failed" | "page_removed";
  title: string | null;
  text: string;
  hash: string;
  language: string;
  chunks: Chunk[];
  error?: string;
};

/**
 * Demo sources (*.local / *.example) are served from deterministic fictional
 * content so the pilot never calls a real external system.
 */
function demoPage(url: string, seed: string): string {
  const topic = new URL(url).pathname.replace(/[^a-z]+/gi, " ").trim() || "student services";
  return [
    `## ${topic}`,
    `This fictional UAEU demo page describes ${topic}. Content revision marker: ${seed}.`,
    "",
    "## Eligibility",
    "Students must be in good academic standing, have no active financial hold, and have completed at least 80 credit hours before applying for internship placement.",
    "",
    "## How to apply",
    "1. Sign in to the student portal.",
    "2. Complete the online request form.",
    "3. Track the request in the Sanadi under My requests.",
    "",
    "## Processing time",
    "Standard requests are processed within five working days. Escalated requests are reviewed within two working days.",
  ].join("\n");
}

export async function fetchWebSource(url: string, opts: { timeoutMs?: number; revisionSeed?: string } = {}): Promise<FetchedPage> {
  const validation = validateSourceUrl(url);
  const base = { title: null, text: "", hash: "", language: "unknown", chunks: [] as Chunk[] };
  if (!validation.ok) return { ...base, ok: false, status: "access_failed", error: validation.error };

  let html: string;
  let title: string | null = null;
  if (isDemoHost(url)) {
    const text = demoPage(url, opts.revisionSeed ?? "rev-1");
    title = `Demo source · ${new URL(url).pathname}`;
    const hash = await checksum(text);
    return { ok: true, status: "fetched", title, text, hash, language: detectLanguage(text), chunks: chunkText(text) };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "Sanadi-KnowledgeBot/1.0" },
    });
    clearTimeout(timer);
    if (res.status === 404 || res.status === 410) return { ...base, ok: false, status: "page_removed", error: `HTTP ${res.status}` };
    if (!res.ok) return { ...base, ok: false, status: "access_failed", error: `HTTP ${res.status}` };
    const contentType = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(contentType))
      return { ...base, ok: false, status: "access_failed", error: `Unsupported content type: ${contentType}` };
    html = (await res.text()).slice(0, 800_000);
  } catch (err) {
    return { ...base, ok: false, status: "access_failed", error: err instanceof Error ? err.message : "Fetch failed" };
  }

  const stripped = stripMarkup(html);
  title = stripped.title;
  const hash = await checksum(stripped.text);
  return {
    ok: true,
    status: "fetched",
    title,
    text: stripped.text,
    hash,
    language: detectLanguage(stripped.text),
    chunks: chunkText(stripped.text),
  };
}

export function classifyChange(previous: string, next: string): { changeType: string; percentage: number; summary: string } {
  if (!previous) return { changeType: "minor", percentage: 0, summary: "First successful ingestion." };
  const a = previous.split(/\s+/);
  const b = next.split(/\s+/);
  const setA = new Set(a);
  const common = b.filter((w) => setA.has(w)).length;
  const percentage = Math.round((1 - common / Math.max(a.length, b.length, 1)) * 1000) / 10;
  const changeType = percentage >= 40 ? "major" : percentage >= 10 ? "moderate" : "minor";
  return {
    changeType,
    percentage,
    summary: `${percentage}% of the page content differs from the previously approved version (${a.length} → ${b.length} words).`,
  };
}
