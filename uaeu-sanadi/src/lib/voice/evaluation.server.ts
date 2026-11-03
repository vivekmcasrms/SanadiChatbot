import { detectComplaintOpening } from "@/lib/agent/complaint-intake.server";
import { isSuggestionIntent } from "@/lib/agent/suggestion-intent.server";
import { detectCaseReference } from "@/lib/agent/case-reference.server";
import { detectRegistrationReadinessIntent } from "@/lib/agent/registration-readiness.server";
import { detectAmbiguousRequest } from "@/lib/exceptions/ambiguity";
import { VOICE_VOCABULARY, normalizeTranscript } from "./normalize";

export type VoiceTestResult = {
  key: string;
  title: string;
  spoken: string;
  transcript: string;
  expected: string;
  passed: boolean;
  detail: string;
};

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

/** Generates real spoken audio for a phrase (test only, kept in memory). */
async function synthesize(apiKey: string, text: string): Promise<Uint8Array> {
  const res = await fetch(`${GATEWAY}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3.1-flash-tts-preview",
      contents: [{ role: "user", parts: [{ text: `Say naturally: ${text}` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
      },
      stream_format: "audio",
    }),
  });
  if (!res.ok) throw new Error(`speech ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Same transcription path and clean-up students use. */
async function transcribe(apiKey: string, audio: Uint8Array): Promise<string> {
  const form = new FormData();
  form.append("model", "google/gemini-3.5-transcribe");
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "test.wav");
  form.append("prompt", `UAEU student services. Terms: ${VOICE_VOCABULARY.join(", ")}.`);
  const res = await fetch(`${GATEWAY}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`transcription ${res.status}`);
  const json = (await res.json()) as { text?: string };
  return normalizeTranscript((json.text ?? "").trim()).text;
}

const SCENARIOS: Array<{
  key: string;
  title: string;
  spoken: string;
  expected: string;
  check: (t: string) => { passed: boolean; detail: string };
}> = [
  {
    key: "english_complaint",
    title: "English complaint",
    spoken: "I want to complain about the evening bus service.",
    expected: "Complaint intent",
    check: (t) => {
      const ok = Boolean(detectComplaintOpening(t));
      return { passed: ok, detail: ok ? "Complaint intake opened" : "Not recognised as a complaint" };
    },
  },
  {
    key: "arabic_suggestion",
    title: "Arabic suggestion",
    spoken: "أقترح أن تتعاون الجامعة مع شركات تقنية أكثر.",
    expected: "Suggestion intent (not career counselling)",
    check: (t) => {
      const ok = isSuggestionIntent(t);
      return { passed: ok, detail: ok ? "Routed as a suggestion" : "Not recognised as a suggestion" };
    },
  },
  {
    key: "existing_case",
    title: "Existing case follow-up",
    spoken: "Is my U A E U 2026 01063 meeting confirmed?",
    expected: "Case reference UAEU-2026-01063 looked up first",
    check: (t) => {
      const ref = detectCaseReference(t);
      return { passed: ref === "UAEU-2026-01063", detail: ref ? `Reference detected: ${ref}` : "No reference detected" };
    },
  },
  {
    key: "registration",
    title: "Academic action",
    spoken: "Can I register for C S B P two twenty?",
    expected: "Registration Readiness with course CSBP220",
    check: (t) => {
      const intent = detectRegistrationReadinessIntent(t);
      const code = /CSBP\s?220/i.test(t);
      return {
        passed: intent && code,
        detail: `${intent ? "Registration readiness" : "No registration intent"}; ${code ? "course CSBP220 kept" : "course code lost"}`,
      };
    },
  },
  {
    key: "ambiguity",
    title: "Ambiguous request",
    spoken: "I have a problem.",
    expected: "One focused clarification",
    check: (t) => {
      const a = detectAmbiguousRequest(t);
      return { passed: Boolean(a), detail: a ? "Clarification question asked" : "No clarification triggered" };
    },
  },
];

export async function runVoiceScenarios(apiKey: string): Promise<VoiceTestResult[]> {
  const results = await Promise.all(
    SCENARIOS.map(async (s): Promise<VoiceTestResult> => {
      try {
        const audio = await synthesize(apiKey, s.spoken);
        const transcript = await transcribe(apiKey, audio);
        const r = s.check(transcript);
        return { key: s.key, title: s.title, spoken: s.spoken, transcript, expected: s.expected, ...r };
      } catch (e) {
        return {
          key: s.key,
          title: s.title,
          spoken: s.spoken,
          transcript: "",
          expected: s.expected,
          passed: false,
          detail: `Speech service unavailable (${(e as Error).message})`,
        };
      }
    }),
  );
  return results;
}
