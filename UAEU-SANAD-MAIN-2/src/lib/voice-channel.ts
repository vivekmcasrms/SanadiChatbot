/**
 * Voice channel helpers only. No agent routing — transcripts become normal
 * composer text and are submitted through the same send()/stream path as typing.
 */

import { detectVoiceLanguage, normalizeVoiceText } from "@/lib/voice-agent";

const CASE_REF = /\bUAEU[- ]?\d{4}[- ]?\d{4,}\b/i;
const COURSE_CODE = /\b[A-Z]{2,5}\s?\d{3}[A-Z]?\b/;
const SENSITIVE_TOKEN = /\b(CSBP\d+|GPA|Blackboard|Career Placement|Machine Learning)\b/i;

/** Detect spoken language from transcript text for reply language. */
export function voiceTranscriptLanguage(text: string, previous: "en" | "ar" | null = null): "en" | "ar" {
  const detected = detectVoiceLanguage(text, previous);
  return detected === "ar" ? "ar" : "en";
}

/**
 * When STT confidence is low and the transcript looks like it names a case,
 * course, or other important parameter, return a short review hint for the composer.
 */
export function lowConfidenceReviewHint(
  text: string,
  confidence: number | null,
  lang: "en" | "ar",
): string | null {
  if (confidence !== null && confidence >= 0.55) return null;
  const normalized = normalizeVoiceText(text);
  if (!normalized) return null;
  const hasSensitive =
    CASE_REF.test(text) || COURSE_CODE.test(text) || SENSITIVE_TOKEN.test(text) || /\d/.test(text);
  if (!hasSensitive && (confidence === null || confidence >= 0.35)) return null;
  const match = text.match(CASE_REF)?.[0] ?? text.match(COURSE_CODE)?.[0] ?? null;
  if (match) {
    const looksLikeCourse = COURSE_CODE.test(match);
    if (lang === "ar") {
      return looksLikeCourse
        ? `سمعت رمز المساق «${match}». هل هذا صحيح؟`
        : `سمعت «${match}». هل هذا صحيح؟`;
    }
    return looksLikeCourse
      ? `I heard the course code as ${match}. Is that correct?`
      : `I heard “${match}”. Is that correct?`;
  }
  return lang === "ar"
    ? "ثقة التحويل منخفضة لجزء مهم. راجع النص قبل الإرسال."
    : "Transcription confidence is low for an important detail. Please review before sending.";
}

export const VOICE_PRIVACY_ACK_KEY = "sanadi.voice.privacy-ack";

export function hasAcknowledgedVoicePrivacy(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(VOICE_PRIVACY_ACK_KEY) === "1";
  } catch {
    return true;
  }
}

export function acknowledgeVoicePrivacy(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VOICE_PRIVACY_ACK_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Client-side voice metric event (sent best-effort to the API). */
export type VoiceMetricEvent = {
  type:
    | "voice_interaction"
    | "transcription_ok"
    | "transcription_fail"
    | "clarification_needed"
    | "voice_action_completed"
    | "speech_service_fail";
  language?: "en" | "ar" | "auto";
  detail?: string;
};

export async function recordVoiceMetric(event: VoiceMetricEvent): Promise<void> {
  try {
    const { apiFetch } = await import("@/lib/auth-token");
    await apiFetch("/api/voice/metrics", {
      method: "POST",
      body: JSON.stringify({ ...event, at: new Date().toISOString() }),
    });
  } catch {
    /* metrics are best-effort */
  }
}
