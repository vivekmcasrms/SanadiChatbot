/** Presentation helpers that clean up LLM answer text before it is rendered. */

export type FactTone = "neutral" | "success" | "warning" | "danger";
export type FactItem = { label: string; value: string; tone: FactTone };
export type AnswerBlock =
  | { kind: "text"; content: string }
  | { kind: "facts"; title?: string; items: FactItem[]; tone: FactTone };

const ANSWER_KEYS = ["answer", "message", "content", "text"] as const;

function answerFromValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  for (const key of ANSWER_KEYS) {
    if (typeof obj[key] === "string") return obj[key];
  }
  return null;
}

function extractEmbeddedAnswer(text: string): string | null {
  const keyed = text.match(/["'](?:answer|message|content|text)["']\s*:\s*["']((?:\\.|[^"'\\])*)["']/i);
  if (!keyed?.[1]) return null;
  try {
    return JSON.parse(`"${keyed[1].replace(/"/g, '\\"')}"`) as string;
  } catch {
    return keyed[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
}

const SUCCESS_WORDS =
  /^(eligible|completed|complete|approved|active|cleared|resolved|confirmed|met|yes|good standing|paid|allocated|reserved|available|no holds?|none)\b|^(مؤهل|مكتمل|مستوفى|معتمد|نشط|تم|لا يوجد|متاح|محجوز|مسدد)/i;
const WARNING_WORDS =
  /^(pending|in review|under review|awaiting|in progress|partial|not yet|submitted|waitlist|due|expiring|action required)\b|^(قيد|بانتظار|جزئي|معلق|مطلوب)/i;
const DANGER_WORDS =
  /^(not eligible|ineligible|blocked|hold|holds|on hold|overdue|rejected|failed|expired|missing|unpaid|denied|no)\b|^(غير مؤهل|محظور|متأخر|مرفوض|منتهي|ناقص|غير مسدد)/i;

export function toneForValue(value: string): FactTone {
  const v = value.replace(/[*_`✓✔✅⚠️❗]/g, "").trim();
  if (DANGER_WORDS.test(v)) return "danger";
  if (SUCCESS_WORDS.test(v)) return "success";
  if (WARNING_WORDS.test(v)) return "warning";
  return "neutral";
}

const STATUS_LABEL = /^(status|state|eligibility|result|outcome|الحالة|النتيجة|الأهلية)$/i;

/** Whether a fact should render as a compact badge rather than plain text. */
export function isBadgeFact(item: FactItem): boolean {
  return (
    item.tone !== "neutral" &&
    (STATUS_LABEL.test(item.label.trim()) || item.value.trim().split(/\s+/).length <= 3)
  );
}

/** Breaks inline "- a - b - c" or "1. a 2. b" runs onto their own lines. */
function explodeInlineLists(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      let out = line;
      const bulletHits = out.match(/\s[-–—]\s+(?=\S)/g);
      if (bulletHits && bulletHits.length >= 2) {
        out = out.replace(/\s[-–—]\s+(?=\S)/g, "\n- ");
      }
      const numHits = out.match(/(?:^|[.:!?)\s])\s?\b([2-9]|1\d)\.\s+(?=[A-Za-z\u0600-\u06FF])/g);
      if (numHits && numHits.length >= 1 && /(^|\s)1\.\s/.test(out)) {
        out = out.replace(/\s+(\d{1,2})\.\s+(?=[A-Za-z\u0600-\u06FF])/g, "\n$1. ");
      }
      // Put a heading-like "Label:" lead-in on its own line when a list follows.
      out = out.replace(/^(.{0,80}?:)\n- /, "$1\n\n- ");
      // Break a trailing lead-in like "... course. Next steps:" onto its own line.
      out = out.replace(
        /([.!?؟])\s+([A-Z\u0600-\u06FF][\w\u0600-\u06FF]*(?:\s[\w\u0600-\u06FF]+){0,3}:)\s*$/gm,
        "$1\n\n$2",
      );
      return out;
    })
    .join("\n");
}

/** Decodes escaped characters, unwraps JSON payloads and tidies markdown spacing. */
export function normalizeAnswer(raw: string): string {
  let text = (raw ?? "").trim();
  if (!text) return "";

  // Unwrap a fenced block that only contains JSON.
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) text = fenced[1].trim();

  // Unwrap a JSON object/string payload that carries the real answer.
  if (/^[{["]/.test(text)) {
    try {
      const parsed: unknown = JSON.parse(text);
      const candidate = answerFromValue(parsed);
      if (candidate) text = candidate;
    } catch {
      const candidate = extractEmbeddedAnswer(text);
      if (candidate) text = candidate;
    }
  }

  // Decode escape sequences that leaked through as literal characters.
  text = text
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "  ")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\r\n/g, "\n");

  // Strip leaked markup: inline SVG/HTML fragments and bare tag-name tokens
  // such as a stray "svg" or "path" left behind by icon markup.
  text = text
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<\/?(?:svg|path|circle|rect|g|use|defs)\b[^>]*>/gi, "")
    .replace(/\bsvg(?=[A-Z][A-Za-z]*)/g, "")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(?:svg|path|circle|rect)\s*$/i, "")
        .replace(/(^|\s)svg(?=\s|$)/gi, "$1")
        .replace(/^\s*(?:tool|function)_(?:call|output|result)\s*[:=].*$/i, "")
        .replace(/^\s*\}\}+\s*$/g, ""),
    )
    .join("\n")
    .replace(/\}\}+\s*$/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n");


  // Normalise bullets written as "* item" or "•" into markdown list items.
  text = text
    .split("\n")
    .map((line) => line.replace(/^(\s*)[•·]\s+/, "$1- ").replace(/^(\s*)\*\s+(?!\*)/, "$1- "))
    .join("\n");

  text = explodeInlineLists(text);

  // Collapse runs of blank lines and trailing spaces.
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    // Drop empty list items like a bare "1." or "-" with no content.
    .filter((line) => !/^\s*(?:[-*•]|\d{1,2}[.)])\s*$/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

const FACT_LINE = /^\s*(?:[-*]\s+)?(?:\*\*)?([^:*\n]{2,48}?)(?:\*\*)?\s*:\s*(.+?)\s*$/;
const TITLE_LINE = /^\s*(?:#{1,4}\s*)?(?:\*\*)?([^*\n]{3,60}?)(?:\*\*)?\s*:?\s*$/;
/** Structured field labels (e.g. TITLE / REFERENCE NUMBER / العنوان) may omit list markers. */
const STRUCTURED_LABEL =
  /^(?:[A-Z][A-Z0-9 /&_-]{1,46}|title|status|reference(?:\s+number)?|العنوان|الحالة|الرقم(?:\s*المرجعي)?)$/i;

const STATUS_TOKEN =
  /^((?:not\s+)?[A-Za-z\u0600-\u06FF]+(?:\s(?:standing|required|review|hold|progress))?)\s+(?=[A-Z\u0600-\u06FF])/;

/** "Eligible You meet the ..." -> value "Eligible" + trailing sentence. */
function splitTrailingProse(raw: string): { value: string; trailing?: string } {
  if (raw.split(/\s+/).length <= 3) return { value: raw };
  const m = raw.match(STATUS_TOKEN);
  if (m?.[1] && toneForValue(m[1]) !== "neutral") {
    const rest = raw.slice(m[0].length).trim();
    return rest ? { value: m[1], trailing: rest } : { value: m[1] };
  }
  return { value: raw };
}

function cardTone(items: FactItem[]): FactTone {
  if (items.some((i) => i.tone === "danger")) return "danger";
  if (items.some((i) => i.tone === "warning")) return "warning";
  if (items.some((i) => i.tone === "success")) return "success";
  return "neutral";
}

/**
 * Splits an answer into prose and compact "label: value" fact groups so structured
 * summaries can be shown as a small card instead of a bullet dump.
 */
export function splitAnswerBlocks(text: string): AnswerBlock[] {
  const lines = text.split("\n");
  const blocks: AnswerBlock[] = [];
  let buffer: string[] = [];
  let facts: FactItem[] = [];

  const flushText = () => {
    const content = buffer.join("\n").trim();
    if (content) blocks.push({ kind: "text", content });
    buffer = [];
  };
  const takeTitle = (): string | undefined => {
    // A short heading-ish line right before the facts becomes the card title.
    while (buffer.length && !buffer[buffer.length - 1]!.trim()) buffer.pop();
    const last = buffer[buffer.length - 1];
    if (!last) return undefined;
    if (/^\s*(?:[-*]\s|\d+[.)]\s)/.test(last)) return undefined;
    const m = last.match(TITLE_LINE);
    if (!m?.[1]) return undefined;
    const isHeading = /^\s*#/.test(last) || /\*\*/.test(last) || /:\s*$/.test(last);
    if (!isHeading) return undefined;
    buffer.pop();
    return m[1].trim().replace(/[:：]$/, "");
  };
  const flushFacts = () => {
    if (facts.length >= 2) {
      const title = takeTitle();
      flushText();
      blocks.push({ kind: "facts", ...(title ? { title } : {}), items: facts, tone: cardTone(facts) });
    } else if (facts.length) {
      buffer.push(...facts.map((f) => `- **${f.label}:** ${f.value}`));
    }
    facts = [];
  };

  for (const line of lines) {
    const match = line.match(FACT_LINE);
    const isListy = /^\s*[-*]\s/.test(line);
    const isOrdered = /^\s*\d{1,2}[.)]\s/.test(line);
    const labelHint = match?.[1]?.trim() ?? "";
    const canStartFacts = isListy || STRUCTURED_LABEL.test(labelHint);
    if (
      match?.[1] &&
      match[2] &&
      !isOrdered &&
      (canStartFacts || facts.length > 0)
    ) {
      const label = match[1].trim();
      const raw = match[2].replace(/\*\*/g, "").replace(/^`+|`+$/g, "").trim();
      const { value, trailing } = splitTrailingProse(raw);
      if (value.split(/\s+/).length > 12) {
        if (facts.length) flushFacts();
        buffer.push(line);
        continue;
      }
      facts.push({ label, value, tone: toneForValue(value) });
      if (trailing) {
        flushFacts();
        buffer.push("", trailing);
      }
      continue;
    }
    if (facts.length) {
      flushFacts();
      if (!line.trim()) continue;
    }
    buffer.push(line);
  }
  flushFacts();
  flushText();
  return blocks;
}
