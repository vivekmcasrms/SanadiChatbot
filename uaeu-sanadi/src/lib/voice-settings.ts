import { useCallback, useEffect, useState } from "react";

export type VoiceLanguagePref = "auto" | "en" | "ar";

export type VoiceSettings = {
  enabled: boolean;
  language: VoiceLanguagePref;
  autoSend: boolean;
  /** Read every answer aloud. Off unless the student turns it on. */
  speakReplies: boolean;
  /** The one-time microphone notice has been shown. */
  privacyAck: boolean;
  /** Spoken voice: Meera (female) or Suhail (male). */
  persona: VoicePersona;
};

export type VoicePersona = "meera" | "suhail";

export const defaultVoiceSettings: VoiceSettings = {
  enabled: true,
  language: "auto",
  autoSend: false,
  speakReplies: false,
  privacyAck: false,
  persona: "meera",
};

const KEY = "sanad.voice.settings";
const EVENT = "sanad-voice-settings";

export function readVoiceSettings(): VoiceSettings {
  if (typeof window === "undefined") return defaultVoiceSettings;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultVoiceSettings;
    const parsed = JSON.parse(raw) as Partial<VoiceSettings>;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : defaultVoiceSettings.enabled,
      language:
        parsed.language === "en" || parsed.language === "ar" || parsed.language === "auto"
          ? parsed.language
          : defaultVoiceSettings.language,
      autoSend: typeof parsed.autoSend === "boolean" ? parsed.autoSend : defaultVoiceSettings.autoSend,
      speakReplies: parsed.speakReplies === true,
      privacyAck: parsed.privacyAck === true,
      persona: parsed.persona === "suhail" ? "suhail" : "meera",
    };
  } catch {
    return defaultVoiceSettings;
  }
}

export function writeVoiceSettings(next: VoiceSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Reads voice preferences after hydration so SSR and client markup match. */
export function useVoiceSettings() {
  const [settings, setSettings] = useState<VoiceSettings>(defaultVoiceSettings);

  useEffect(() => {
    setSettings(readVoiceSettings());
    const sync = () => setSettings(readVoiceSettings());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const update = useCallback((patch: Partial<VoiceSettings>) => {
    const next = { ...readVoiceSettings(), ...patch };
    writeVoiceSettings(next);
    setSettings(next);
  }, []);

  return { settings, update };
}
