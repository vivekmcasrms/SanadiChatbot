type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(track?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
};
type RecognitionWindow = { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };

/** Capture one question; the active call owns restarting and stopping recognition. */
export function browserQuestion(language: "en" | "ar", signal: AbortSignal, onStarted: () => void,
  options?: { track?: MediaStreamTrack; isEcho?: (text: string) => boolean; onUserSpeech?: () => void;
    onPreview?: (text: string) => void; audioControlsPause?: boolean }) {
  let finish = () => {};
  let pendingResults = false;
  const text = new Promise<string>((resolve, reject) => {
    const host = window as unknown as RecognitionWindow;
    const Constructor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
    if (!Constructor) { reject(new Error("browser_stt_unsupported")); return; }
    const recognition = new Constructor();
    recognition.lang = language === "ar" ? "ar-AE" : "en-US";
    // Keep adjacent phrases in one question; microphone silence closes the turn.
    // The browser's single-result mode can end after "Hello" before the question.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    let finalText = "", settled = false, stopping = false, heardSpeech = false;
    let lastUserText = "";
    const ignoredFinals = new Set<number>();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let silence: ReturnType<typeof setTimeout> | undefined;
    let closeDeadline: ReturnType<typeof setTimeout> | undefined;
    let startupDeadline: ReturnType<typeof setTimeout> | undefined;
    const settle = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline); clearTimeout(silence); clearTimeout(closeDeadline); clearTimeout(startupDeadline);
      signal.removeEventListener("abort", abort);
      recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null;
      try { recognition.abort(); } catch { /* already ended */ }
      if (error) reject(error);
      else resolve(finalText.trim());
    };
    const abort = () => settle(new DOMException("Interrupted", "AbortError"));
    finish = () => {
      if (settled || stopping) return;
      stopping = true;
      clearTimeout(silence);
      try {
        closeDeadline = setTimeout(() => settle(), 1500);
        recognition.stop(); // Deliver the final result before resolving onend.
      } catch (error) { settle(error); }
    };
    recognition.onstart = () => {
      if (settled) return;
      clearTimeout(startupDeadline);
      deadline = setTimeout(finish, 10_000);
      onStarted();
    };
    recognition.onresult = event => {
      if (settled) return;
      const finals: string[] = [];
      const heard: string[] = [];
      pendingResults = false;
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index];
        if (!result || ignoredFinals.has(index)) continue;
        const transcript = result[0].transcript;
        if (options?.isEcho?.(transcript)) {
          if (result.isFinal) ignoredFinals.add(index);
          continue;
        }
        heard.push(transcript);
        if (result.isFinal) finals.push(transcript);
        else if (transcript.trim()) pendingResults = true;
      }
      // Preview hypotheses, but only submit final text. The caller recovers the
      // whole recording if the browser ends before finalizing the last phrase.
      finalText = finals.join(" ").trim();
      const userText = heard.join(" ").trim();
      if (!userText) return;
      if (!heardSpeech) {
        heardSpeech = true;
        clearTimeout(deadline);
        deadline = setTimeout(finish, 45_000);
      }
      if (userText !== lastUserText) {
        lastUserText = userText;
        options?.onUserSpeech?.();
        options?.onPreview?.(userText);
      }
      clearTimeout(silence);
      // A delayed browser result is not a pause in the student's speech.
      if (!options?.audioControlsPause) silence = setTimeout(finish, 1100);
    };
    recognition.onerror = event => {
      if (event.error === "no-speech") { settle(); return; }
      if (event.error === "not-allowed" || event.error === "service-not-allowed")
        settle(new DOMException("Microphone permission denied", "NotAllowedError"));
      else if (event.error === "audio-capture") settle(new Error("browser_stt_microphone"));
      else if (event.error === "language-not-supported") settle(new Error("browser_stt_language"));
      else settle(new Error("browser_stt_unavailable"));
    };
    recognition.onend = () => settle();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try {
      startupDeadline = setTimeout(() => settle(new Error("browser_stt_unavailable")), 10_000);
      if (options?.track) recognition.start(options.track);
      else recognition.start();
    } catch (error) { settle(error); }
  });
  return { text, finish: () => finish(), hasPendingResults: () => pendingResults };
}
