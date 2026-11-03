import type { AdvisorIdentity, AdvisorLanguage } from "./advisor-client";

// Web Speech exposes no gender field. Prefer the selected advisor's identifiable
// voice, then a generic voice in the same language. Never choose a known
// opposite-gender voice or a voice in another language.
const female = /\b(female|woman|zira|aria|jenny|samantha|ava|susan|sara|heera|natasha|sonia|fatima|hadeel|salama|salma|amany|amina|hoda|zariyah|laila|layla|noura|noora|reem|mariam|mary|victoria|karen|tessa)\b/i;
const male = /\b(male|man|david|mark|daniel|george|alex|guy|ryan|james|liam|hamed|hamad|abdullah|omar|hamdan|naayf|shakir|bassel|taim|yusuf|youssef|kareem|khalid|ahmed|andrew)\b/i;

export function browserVoice(voices: SpeechSynthesisVoice[], language: AdvisorLanguage, agent: AdvisorIdentity) {
  const names = agent === "mira" ? female : male;
  const sameLanguage = voices.filter(v => v.lang.toLowerCase().split(/[-_]/)[0] === language);
  const nameOf = (v: SpeechSynthesisVoice) => v.name.replace(/([a-z])([A-Z])/g, "$1 $2");
  const matching = sameLanguage.filter(v => names.test(nameOf(v)));
  const generic = sameLanguage.filter(v => !female.test(nameOf(v)) && !male.test(nameOf(v)));
  const preferred = (available: SpeechSynthesisVoice[]) =>
    available.find(v => v.lang.toLowerCase().replace("_", "-") === `${language}-ae`)
      ?? available.find(v => v.default) ?? available[0];
  return preferred(matching) ?? preferred(generic);
}

/** Shared by live calls and the chat's Listen action. UI language only translates errors. */
export function browserSpeechError(error: unknown, uiLanguage: "en" | "ar"): string | null {
  const code = error instanceof Error ? error.message : "";
  const ar = uiLanguage === "ar";
  const missing = /^browser_voice_missing_(ar|en)_(mira|suhail)$/.exec(code);
  if (missing) {
    const language = missing[1] === "ar" ? (ar ? "العربية" : "Arabic") : (ar ? "الإنجليزية" : "English");
    return ar
      ? `لا يتوفر صوت مناسب باللغة ${language} في هذا المتصفح. فعّل صوتاً بهذه اللغة في إعدادات الكلام للجهاز، ثم أعد فتح المتصفح.`
      : `No suitable ${language} voice is available in this browser. Enable a voice for that language in your device's speech settings, then reopen the browser.`;
  }
  if (code === "browser_speech_unsupported") return ar
    ? "هذا المتصفح لا يدعم الرد الصوتي. يرجى استخدام متصفح يدعم تحويل النص إلى كلام."
    : "This browser does not support spoken replies. Please use a browser with speech synthesis.";
  if (code === "browser_speech_blocked") return ar
    ? "المتصفح منع تشغيل الصوت. اضغط زر الصوت وحاول مرة ثانية."
    : "The browser blocked speech playback. Click the voice control and try again.";
  if (code === "browser_speech_failed") return ar
    ? "تعذر تشغيل الرد بصوت المتصفح. تحقق من إعدادات الصوت وحاول مرة ثانية."
    : "The browser could not speak the reply. Check its audio settings and try again.";
  return null;
}

async function selectedVoice(language: AdvisorLanguage, agent: AdvisorIdentity, signal: AbortSignal) {
  signal.throwIfAborted();
  const synth = window.speechSynthesis;
  const current = browserVoice(synth.getVoices(), language, agent);
  if (current) return current;
  // Some browsers populate voices asynchronously, after the first gesture.
  return new Promise<SpeechSynthesisVoice>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      synth.removeEventListener("voiceschanged", changed);
      signal.removeEventListener("abort", abort);
    };
    const changed = () => {
      const voice = browserVoice(synth.getVoices(), language, agent);
      if (voice) { cleanup(); resolve(voice); }
    };
    const abort = () => { cleanup(); reject(new DOMException("Interrupted", "AbortError")); };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`browser_voice_missing_${language}_${agent}`));
    }, 3000);
    synth.addEventListener("voiceschanged", changed);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else changed();
  });
}

/** One browser playback pipeline, owned and cancelled by the current mic turn. */
export class BrowserSpeech {
  private utterance: SpeechSynthesisUtterance | null = null;
  private muted = false;

  prepare() {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window))
      throw new Error("browser_speech_unsupported");
    window.speechSynthesis.getVoices();
    window.speechSynthesis.resume();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) window.speechSynthesis.pause();
    else window.speechSynthesis.resume();
  }

  stop() {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
    }
    this.utterance = null;
    this.muted = false;
  }

  async speak(text: string, language: AdvisorLanguage, agent: AdvisorIdentity, signal: AbortSignal, onStart: () => void) {
    signal.throwIfAborted();
    if (!text.trim()) return;
    this.prepare();
    const voice = await selectedVoice(language, agent, signal);
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const synth = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(text);
      this.utterance = utterance;
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        utterance.onstart = utterance.onend = utterance.onerror = null;
        signal.removeEventListener("abort", abort);
        if (this.utterance === utterance) this.utterance = null;
        if (error) reject(error); else resolve();
      };
      const abort = () => {
        finish(new DOMException("Interrupted", "AbortError"));
        synth.cancel();
      };
      utterance.onstart = () => { if (!signal.aborted) onStart(); };
      utterance.onend = () => finish();
      utterance.onerror = event => finish(
        event.error === "interrupted" || event.error === "canceled"
          ? new DOMException("Interrupted", "AbortError")
          : new Error(event.error === "not-allowed" ? "browser_speech_blocked" : "browser_speech_failed"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) { abort(); return; }
      if (!this.muted) synth.resume();
      synth.speak(utterance);
      if (this.muted) synth.pause();
    });
  }
}
