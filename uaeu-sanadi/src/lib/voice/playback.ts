import { speakText } from "@/lib/voice.functions";
import { setAssistantState } from "@/lib/assistant-state";
import { readVoiceSettings } from "@/lib/voice-settings";

/** One reply plays at a time; starting another stops the previous one. */
let current: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let stopResolve: (() => void) | null = null;
const listeners = new Set<() => void>();
let playingKey: string | null = null;

function emit() {
  for (const l of listeners) l();
}

export function subscribePlayback(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function getPlayingKey() {
  return playingKey;
}

export function stopSpeaking() {
  current?.pause();
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  current = null;
  currentUrl = null;
  playingKey = null;
  stopResolve?.();
  stopResolve = null;
  setAssistantState("idle");
  emit();
}

/** Speaks the reply; resolves when playback ends or is stopped. */
export async function speakReply(key: string, text: string, lang: "en" | "ar"): Promise<void> {
  stopSpeaking();
  playingKey = key;
  emit();
  const { audioBase64, mime } = await speakText({ data: { text, lang, persona: readVoiceSettings().persona } });
  if (playingKey !== key) return;
  const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  currentUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const audio = new Audio(currentUrl);
  current = audio;
  setAssistantState("speaking");
  await new Promise<void>((resolve) => {
    stopResolve = resolve;
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    void audio.play().catch(() => resolve());
  });
  if (current === audio) stopSpeaking();
}
