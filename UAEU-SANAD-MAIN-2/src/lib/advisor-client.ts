import { apiFetch, apiUrl, getAuthToken } from "./auth-token";

export type AdvisorIdentity = "mira" | "suhail";
export type AdvisorLanguage = "ar" | "en";
export type AdvisorAvailability = { available: boolean; audioMode: "websocket"; sessionSeconds: number; idleSeconds: number };

export const advisorAvailability = () => apiFetch<AdvisorAvailability>("/api/voice/advisor/availability");

export async function synthesizeReply(text: string, language: AdvisorLanguage, agent: AdvisorIdentity, signal: AbortSignal) {
  const headers = new Headers({ "content-type": "application/json" });
  const token = getAuthToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(apiUrl("/api/voice/advisor/speech"), {
    method: "POST", credentials: "include", headers, signal,
    body: JSON.stringify({ text, language, agent }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(error.error ?? "speech_unavailable");
  }
  return response.arrayBuffer();
}

/** No language or gender fallback. Pronunciation must be validated with the approved references. */
export function introduction(agent: AdvisorIdentity, language: AdvisorLanguage) {
  return language === "ar"
    ? `مرحباً، أنا ${agent === "mira" ? "ميرا" : "سهيل"}، مساعدك في خدمات جامعة الإمارات. `
    : `Hi, I'm ${agent === "mira" ? "Meera" : "Suhail"}, your UAEU support advisor. `;
}
