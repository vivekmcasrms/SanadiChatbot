/**
 * Turns a full on-screen answer into a short spoken reply. Deterministic and
 * instant: no extra model call between the answer and the voice.
 *
 * - Short answers are spoken in full.
 * - Longer or structured answers speak only the opening conclusion, then
 *   point naturally to the screen.
 * - Pending approvals are never read out; the student is asked to confirm
 *   on screen.
 */
import { speakableText } from "./normalize";

export type SpokenSummaryInput = {
  answer: string;
  lang: "en" | "ar";
  hasPendingAction?: boolean;
  hasDocument?: boolean;
};

const SHORT_LIMIT = 260;

function isStructuredLine(line: string): boolean {
  const l = line.trim();
  return (
    /^#{1,6}\s/.test(l) ||
    /^[-*•▪◦]\s/.test(l) ||
    /^\d+[.)]\s/.test(l) ||
    /^\|/.test(l) ||
    /^[^:：]{2,40}[:：]\s*\S/.test(l) // "GPA: 3.42" style fields
  );
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?؟。])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function spokenSummary({ answer, lang, hasPendingAction, hasDocument }: SpokenSummaryInput): string {
  const ar = lang === "ar";
  const raw = (answer ?? "").trim();
  if (!raw) return "";

  const lines = raw.split(/\n+/);
  const structured = lines.filter(isStructuredLine).length;
  const plain = speakableText(raw);

  const screenNote = hasDocument
    ? ar
      ? "وهو متاح أدناه."
      : "It's available below."
    : ar
      ? "عرضت التفاصيل الكاملة تحت الرد."
      : "I've displayed the full details below.";
  const confirmNote = ar
    ? "يرجى تأكيد الإجراء المعروض تحت الرد."
    : "Please confirm the action shown below.";

  // SHORT: plain prose that fits comfortably in one breath.
  if (structured === 0 && plain.length <= SHORT_LIMIT) {
    return hasPendingAction ? `${plain} ${confirmNote}` : plain;
  }

  // MEDIUM / LONG: the conclusion before the first list or field block.
  const lead: string[] = [];
  for (const line of lines) {
    if (isStructuredLine(line)) break;
    lead.push(line);
  }
  let opening = speakableText(lead.join(" "));
  if (!opening) {
    // Answer starts with a list: speak its first item as the headline.
    opening = speakableText(lines.find((l) => l.trim()) ?? "");
  }
  const picked: string[] = [];
  for (const s of sentences(opening)) {
    if (picked.join(" ").length + s.length > SHORT_LIMIT && picked.length) break;
    picked.push(s);
    if (picked.length >= 2) break;
  }
  let spoken = picked.join(" ");
  if (spoken.length > SHORT_LIMIT + 60) spoken = `${spoken.slice(0, SHORT_LIMIT).replace(/\s+\S*$/, "")}…`;

  const tail = hasPendingAction ? confirmNote : screenNote;
  return `${spoken} ${tail}`.trim();
}

/** Spoken commands that end voice conversation. */
export function isEndVoiceCommand(text: string): boolean {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[.!?؟،,]/g, "")
    .trim();
  return /^(stop|end|end voice( mode| conversation)?|stop voice( mode)?|goodbye|bye|that's all|thats all|توقف|انتهى|إنهاء|انهاء|خلاص|مع السلامة|اوقف|أوقف)$/.test(t);
}
