import type { Lang } from "../agent-types";
import { normalizeAnswer } from "../format-answer";

const INTERNAL_OUTPUT =
  /(?:tool_(?:call|output|result)|function_(?:call|output|result)|"toolCalls?"|"arguments"\s*:|backend_deterministic_rules)/i;

/** Internal field names that must never reach a student, in any casing. */
const INTERNAL_KEYS =
  "totalMatches|total_matches|totalResults|total|count|score|similarity|relevance|rank|chunkId|chunk_id|chunkIndex|documentId|document_id|sourceId|source_id|conversationId|conversation_id|messageId|message_id|userId|user_id|studentId|student_id|embedding|metadata|traceId|trace_id|runId|run_id|toolName|tool_name|arguments|payload|results|matches|passages|snippets|debug|raw";

/** Any `"key": value` JSON pair for an internal field, with optional commas. */
const INTERNAL_PAIR = new RegExp(
  `,?\\s*["'](?:${INTERNAL_KEYS})["']\\s*:\\s*(?:"[^"]*"|'[^']*'|-?\\d+(?:\\.\\d+)?|true|false|null|\\[[^\\]]*\\]|\\{[^}]*\\})\\s*,?`,
  "gi",
);

/** Any leftover quoted-key JSON pair, used only for detection. */
const ANY_JSON_PAIR = /["'][A-Za-z_][A-Za-z0-9_]{2,}["']\s*:\s*(?:"[^"]*"|-?\d+(?:\.\d+)?|true|false|null|[[{])/;

/**
 * Removes machine-readable fragments (JSON key/value pairs, stray braces,
 * bare tool payload lines) that occasionally leak out of structured model
 * output or tool results. Prose is left untouched.
 */
export function stripInternalFragments(raw: string): string {
  let text = raw ?? "";
  text = text.replace(INTERNAL_PAIR, " ");
  text = text
    .split("\n")
    .map((line) => {
      let out = line;
      // A line that is only punctuation/JSON scaffolding carries no meaning.
      if (/^[\s,;:{}[\]"'`]*$/.test(out) && /[{}[\],"]/.test(out)) return "";
      // Leading/trailing scaffolding around real prose.
      out = out.replace(/^[\s,]*[}\])]+\s*/, "").replace(/\s*[,{[]+\s*$/, "");
      return out;
    })
    .join("\n");
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/** True when the text still looks like machine output rather than an answer. */
export function looksStructured(text: string): boolean {
  return (
    /^[[{]/.test(text) ||
    /[}\]]{2,}\s*$/.test(text) ||
    ANY_JSON_PAIR.test(text) ||
    INTERNAL_OUTPUT.test(text)
  );
}

export function safeAssistantOutput(raw: string, lang: Lang): string {
  const cleaned = stripInternalFragments(normalizeAnswer(raw)).trim();
  if (cleaned && !looksStructured(cleaned)) return cleaned;
  console.error("[assistant] unsafe model output replaced", {
    reason: !cleaned ? "empty" : "structured_fragment",
    responseLength: raw.length,
  });
  return lang === "ar"
    ? "تعذّر تنسيق الرد بشكل صحيح. تحققت من طلبك، لكن يرجى إعادة المحاولة للحصول على إجابة واضحة."
    : "I could not format the response correctly. I checked your request, but please try again for a clear answer.";
}

/** Characters held back so a partially streamed fragment is never shown. */
const STREAM_TAIL = 48;

/**
 * Wraps a token callback so streamed text is sanitised before it is shown.
 *
 * Deltas are accumulated, cleaned as a whole, and only the stable prefix is
 * emitted — the trailing window stays buffered until more text arrives (or the
 * stream ends), so a half-written JSON fragment can never flash on screen.
 */
export function createSafeTokenStream(emit: (delta: string) => void) {
  let raw = "";
  let sent = "";

  const flush = (final: boolean) => {
    const cleaned = stripInternalFragments(raw);
    const stable = final ? cleaned : cleaned.slice(0, Math.max(0, cleaned.length - STREAM_TAIL));
    if (!stable.startsWith(sent)) return; // cleanup rewrote history: wait for the final answer
    const delta = stable.slice(sent.length);
    if (delta) {
      sent = stable;
      emit(delta);
    }
  };

  return {
    push(delta: string) {
      raw += delta;
      // Never stream anything while the buffer still opens with JSON scaffolding.
      if (/^\s*[[{]/.test(raw)) return;
      flush(false);
    },
    end() {
      flush(true);
    },
    /** Text already shown to the student. */
    get emitted() {
      return sent;
    },
  };
}
