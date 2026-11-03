import { captureQuestionAudio } from "./question-audio";
import type { MultilingualSpeech, VoiceFeedbackContext } from "./multilingual-speech";

/** Capture locally; the university API detects speech and transcribes the unchanged WAV. */
export function multilingualQuestion(engine: MultilingualSpeech, _timingHint: "en" | "ar",
  signal: AbortSignal, onStarted: () => void,
  options: { track: MediaStreamTrack; isEcho: (text: string) => boolean; onUserSpeech: () => void;
    onPreview?: (text: string) => void; onRecognizing?: () => void; selectedLanguage?: "en" | "ar";
    onFeedbackContext?: (context: VoiceFeedbackContext) => void; isReplying?: () => boolean }) {
  let finish = () => {};
  const text = (async () => {
    let complete = () => {};
    const ended = new Promise<void>(resolve => { complete = resolve; });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let heardSpeech = false;
    let captureError: Error | undefined;
    const audio = await captureQuestionAudio(options.track, signal, () => complete(), () => {
      if (heardSpeech) return;
      heardSpeech = true;
      clearTimeout(deadline);
      deadline = setTimeout(complete, 45_000);
      options.onUserSpeech();
    }, error => { captureError = error; complete(); }, options.isReplying);
    finish = complete;
    const abort = () => complete();
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      deadline = setTimeout(complete, 10_000);
      onStarted();
      await ended;
      signal.throwIfAborted();
      if (captureError) throw captureError;
      const samples = audio.finish();
      if (!samples.length) return "";
      options.onRecognizing?.();
      let original = "";
      const question = (await (options.onFeedbackContext
        ? engine.transcribe(samples, signal, undefined, options.selectedLanguage, context => {
          original = context.sourceText ?? "";
          options.onFeedbackContext?.(context);
        })
        : engine.transcribe(samples, signal, undefined, options.selectedLanguage))).trim();
      signal.throwIfAborted();
      if (!question || options.isEcho(question) || original && original !== question && options.isEcho(original)) return "";
      if (!heardSpeech) options.onUserSpeech();
      return question;
    } finally {
      clearTimeout(deadline);
      signal.removeEventListener("abort", abort);
      audio.cancel();
    }
  })();
  return { text, finish: () => finish() };
}
