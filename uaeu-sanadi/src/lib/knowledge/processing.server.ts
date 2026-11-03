/** Document text extraction, chunking and quality checks. Server only. */

export const SUPPORTED_MIME: Record<string, { ext: string; textExtractable: boolean; structured: boolean }> = {
  "application/pdf": { ext: "pdf", textExtractable: true, structured: false },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", textExtractable: true, structured: false },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { ext: "pptx", textExtractable: true, structured: false },
  "text/plain": { ext: "txt", textExtractable: true, structured: false },
  "text/markdown": { ext: "md", textExtractable: true, structured: false },
  "text/csv": { ext: "csv", textExtractable: true, structured: true },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: "xlsx", textExtractable: true, structured: true },
};

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function validateFile(input: { mimeType: string; sizeBytes: number; fileName: string }):
  { ok: true } | { ok: false; error: string } {
  const spec = SUPPORTED_MIME[input.mimeType];
  if (!spec) return { ok: false, error: `Unsupported file type: ${input.mimeType}` };
  if (input.sizeBytes <= 0) return { ok: false, error: "Empty file" };
  if (input.sizeBytes > MAX_FILE_BYTES) return { ok: false, error: "File exceeds the 20 MB limit" };
  if (/[\u0000-\u001f]/.test(input.fileName)) return { ok: false, error: "Invalid file name" };
  return { ok: true };
}

/** Placeholder for institutional malware scanning; wired here so the flow exists. */
export async function malwareScan(_bytes: number): Promise<{ clean: boolean; scanner: string }> {
  return { clean: true, scanner: "placeholder" };
}

export function detectLanguage(text: string): "ar" | "en" | "mixed" | "unknown" {
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length < 20) return "unknown";
  const arabic = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  const ratio = arabic / letters.length;
  if (ratio > 0.7) return "ar";
  if (ratio < 0.05) return "en";
  return "mixed";
}

export async function checksum(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type Chunk = {
  chunkNumber: number;
  sectionTitle: string | null;
  sectionPath: string | null;
  content: string;
  pageNumber: number | null;
  sourceLocator: string;
  tokenCount: number;
};

const STRUCTURAL_HEADING =
  /^\s*(#{1,6}\s+.+|Article\s+\d+[.:)]?.*|Section\s+\d+[.:)]?.*|\d+(\.\d+)*[.)]?\s+[A-Z\u0600-\u06FF].{2,80}|Q\s*[:.].+)$/i;

/**
 * Canonical section labels found in university policy documents. A standalone
 * line carrying one of these is a heading even when the source PDF has lost
 * every font and numbering cue.
 */
const SECTION_LABELS = new Set(
  [
    "objective", "objectives", "purpose", "purposes", "aim", "aims", "goal", "goals",
    "scope", "applicability", "scope and applicability", "subject", "title",
    "policy", "policy statement", "statement of policy", "general provisions", "provisions",
    "definitions", "terminology", "abbreviations",
    "procedure", "procedures", "process", "implementation",
    "responsibility", "responsibilities", "roles and responsibilities", "accountability",
    "eligibility", "requirements", "conditions", "exceptions", "penalties", "sanctions",
    "references", "related policies", "related documents", "appendix", "appendices", "annex",
    "introduction", "background", "overview", "summary", "review", "revision history",
    "effective date", "contact", "contacts", "enquiries", "compliance", "enforcement",
    "الهدف", "الأهداف", "الغرض", "الغاية", "النطاق", "نطاق التطبيق", "الموضوع",
    "السياسة", "بيان السياسة", "التعريفات", "المصطلحات", "الإجراءات", "الإجراء",
    "المسؤوليات", "المسؤولية", "الأهلية", "الشروط", "المتطلبات", "الاستثناءات",
    "المراجع", "الملاحق", "المقدمة", "نبذة", "المراجعة", "تاريخ السريان",
  ].map((s) => s.toLowerCase()),
);

function normaliseHeading(line: string): string {
  return line
    .replace(/^[\s#*\-–—•]+/, "")
    .replace(/[\s:：.،,;)]+$/, "")
    .replace(/^\d+(\.\d+)*[.)]?\s*/, "")
    .trim()
    .toLowerCase();
}

/** True when the line stands on its own as a section heading. */
function isHeading(line: string): boolean {
  const raw = line.replace(/\f/g, "").trim();
  if (!raw || raw.length > 100) return false;
  if (STRUCTURAL_HEADING.test(raw)) return true;

  const label = normaliseHeading(raw);
  if (!label) return false;
  if (SECTION_LABELS.has(label)) return true;

  const words = label.split(/\s+/);
  if (words.length > 6) return false;
  if (/[.!?؟]$/.test(raw)) return false;
  // Short ALL-CAPS or Title-Case lines with no terminal punctuation read as headings.
  const letters = raw.replace(/[^\p{L}]/gu, "");
  if (!letters) return false;
  if (raw === raw.toUpperCase() && letters.length > 2 && /[A-Z]/.test(raw)) return true;
  return false;
}

/** Split a long block on whitespace so words are never cut in half. */
function splitOnWhitespace(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    let cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(". "), window.lastIndexOf(" "));
    if (cut < maxChars * 0.5) cut = maxChars;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

/**
 * Section-aware chunking. Headings stay attached to the content they
 * introduce, section titles/paths/pages are recorded as metadata, and long
 * sections are split only at word boundaries with a short overlap so answers
 * are never cut mid-sentence.
 *
 * Page numbers are derived from form-feed (\f) page separators when the
 * extractor supplies them.
 */
export function chunkText(text: string, maxChars = 1400): Chunk[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  type Section = { title: string | null; path: string | null; page: number; body: string[] };
  const sections: Section[] = [{ title: null, path: null, page: 1, body: [] }];
  const trail: string[] = [];
  let page = 1;

  // Repeated page furniture (running headers/footers such as "Subject" or a
  // review-date banner printed on every page) must never start a new section:
  // it would cut a real section into fragments detached from its heading.
  const counts = new Map<string, number>();
  for (const line of lines) {
    const key = line.replace(/\f/g, "").trim().toLowerCase();
    if (key.length > 0 && key.length <= 120) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const furniture = new Set([...counts].filter(([, n]) => n >= 3).map(([k]) => k));

  for (const line of lines) {
    const breaks = (line.match(/\f/g) ?? []).length;
    const bare = line.replace(/\f/g, "").trim().toLowerCase();
    if (bare && furniture.has(bare)) {
      page += breaks;
      continue;
    }
    if (isHeading(line)) {
      page += breaks;
      const title = line.replace(/\f/g, "").replace(/^\s*#+\s*/, "").trim();
      // Keep at most two levels of context in the path for readability.
      trail.length = trail.length >= 2 ? 1 : trail.length;
      trail.push(title);
      sections.push({ title, path: trail.join(" › "), page, body: [] });
    } else {
      sections[sections.length - 1]!.body.push(line.replace(/\f/g, ""));
      page += breaks;
    }
  }

  const chunks: Chunk[] = [];
  let n = 0;
  const overlap = Math.min(180, Math.floor(maxChars * 0.15));

  for (const section of sections) {
    const body = section.body.join("\n").trim();
    if (!body) continue;
    // The heading is part of the indexed text so a query for "objective"
    // matches the passage that answers it.
    const header = section.title ? `${section.title}\n\n` : "";
    const budget = Math.max(400, maxChars - header.length);

    const paragraphs = body.split(/\n{2,}/);
    const blocks: string[] = [];
    let buffer = "";
    for (const p of paragraphs) {
      if (buffer && (buffer.length + 2 + p.length) > budget) {
        blocks.push(buffer);
        buffer = "";
      }
      buffer = buffer ? `${buffer}\n\n${p}` : p;
      if (buffer.length > budget) {
        const parts = splitOnWhitespace(buffer, budget);
        buffer = parts.pop() ?? "";
        blocks.push(...parts);
      }
    }
    if (buffer.trim()) blocks.push(buffer);

    blocks.forEach((block, i) => {
      const tail = i > 0 && overlap > 0 ? `${(blocks[i - 1] ?? "").slice(-overlap).trim()}\n…\n` : "";
      const content = `${header}${tail}${block}`.trim();
      if (!content) return;
      n += 1;
      chunks.push({
        chunkNumber: n,
        sectionTitle: section.title,
        sectionPath: section.path ?? (section.title ? section.title : `part ${n}`),
        content,
        pageNumber: section.page || null,
        sourceLocator: section.title
          ? `${section.title} · p.${section.page} · chunk ${n}`
          : `p.${section.page} · chunk ${n}`,
        tokenCount: Math.ceil(content.length / 4),
      });
    });
  }
  return chunks;
}

export type QualityIssue = { code: string; severity: "info" | "warning" | "blocking"; message: string };

export function runQualityChecks(input: {
  text: string;
  chunks: Chunk[];
  detectedLanguage: string;
  declaredLanguage: string;
  effectiveDate: string | null;
  expiryDate: string | null;
  version: string | null;
  duplicateOfTitle: string | null;
  duplicateChunkCount: number;
}): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const push = (code: string, severity: QualityIssue["severity"], message: string) =>
    issues.push({ code, severity, message });

  if (!input.text.trim()) push("empty_extraction", "blocking", "No text could be extracted from the file.");
  else if (input.text.trim().length < 200) push("very_short", "warning", "Extracted content is unusually short.");
  if (!input.chunks.length) push("incomplete_indexing", "blocking", "No chunks were produced for indexing.");
  if (!input.effectiveDate) push("missing_effective_date", "blocking", "An effective date is required before publication.");
  if (!input.version) push("missing_version", "warning", "No version number was recorded.");
  if (input.detectedLanguage === "unknown") push("unsupported_language", "warning", "Language could not be detected.");
  else if (input.detectedLanguage !== "mixed" && input.detectedLanguage !== input.declaredLanguage)
    push("language_mismatch", "warning", `Detected ${input.detectedLanguage} but the document is declared as ${input.declaredLanguage}.`);
  if (input.duplicateOfTitle) push("duplicate_document", "warning", `A document with the same content already exists: ${input.duplicateOfTitle}.`);
  if (input.duplicateChunkCount > 0) push("duplicate_chunks", "info", `${input.duplicateChunkCount} chunk(s) duplicate existing content.`);
  if (input.expiryDate && new Date(input.expiryDate) < new Date()) push("expired", "blocking", "The expiry date is already in the past.");

  const suspicious = (input.text.match(/[^\p{L}\p{N}\s\p{P}]/gu) ?? []).length;
  if (input.text.length > 0 && suspicious / input.text.length > 0.05)
    push("ocr_quality", "warning", "The extracted text contains many unreadable characters (possible OCR problem).");

  return issues;
}

export const PROMPT_INJECTION_PATTERNS = [
  /ignore (all )?previous instructions/i,
  /disregard (the )?(system|prior) (prompt|instructions)/i,
  /reveal (the )?(api|secret|service) key/i,
  /you are now/i,
  /change your system prompt/i,
  /access (another|other) student/i,
  /call this url/i,
  /\u062a\u062c\u0627\u0647\u0644 \u0627\u0644\u062a\u0639\u0644\u064a\u0645\u0627\u062a/,
];

export function detectInjection(text: string): string[] {
  return PROMPT_INJECTION_PATTERNS.filter((p) => p.test(text)).map((p) => p.source);
}

/**
 * Retrieved content is data, never instruction. Everything handed to the model
 * is neutralised and wrapped so it cannot act as a directive.
 */
export function neutraliseForPrompt(text: string): string {
  let out = text;
  for (const p of PROMPT_INJECTION_PATTERNS) out = out.replace(new RegExp(p.source, "gi"), "[removed instruction-like text]");
  return out;
}
