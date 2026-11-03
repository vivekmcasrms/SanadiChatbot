import { useCallback, useEffect, useState } from "react";

export type VoiceLanguagePref = "auto" | "en" | "ar";

export type VoiceSettings = {
  enabled: boolean;
  language: VoiceLanguagePref;
  /** When true: continuous voice conversation (auto-send + optional speak). Default false = Phase 1 review. */
  autoSend: boolean;
  /** Speak assistant replies automatically in continuous mode only. */
  autoSpeak: boolean;
};

export const defaultVoiceSettings: VoiceSettings = {
  enabled: true,
  language: "auto",
  autoSend: false,
  autoSpeak: true,
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
      autoSpeak: typeof parsed.autoSpeak === "boolean" ? parsed.autoSpeak : defaultVoiceSettings.autoSpeak,
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
