import { questionWav } from "./advisor-audio";
import { apiFetch } from "./auth-token";

export type VoiceFeedbackContext = { language: "en" | "ar"; skip: boolean; sourceText?: string;
  greetingReply?: { text: string; language: "en" | "ar" } };

// Defense for older API deployments: never display a third-script recognition result.
function requireSupportedTranscript(text: string) {
  for (const character of text) {
    if (/\p{Letter}/u.test(character) && !/[\p{Script_Extensions=Latin}\p{Script_Extensions=Arabic}]/u.test(character))
      throw new Error("stt_unsupported_language");
  }
}

/** The API transcribes through its configured private speech server, never a browser model. */
export class MultilingualSpeech {
  private pending = new Set<AbortController>();

  prepare(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    return Promise.resolve("");
  }

  async transcribe(audio: Float32Array, signal: AbortSignal,
    _browserResult?: { language: "en" | "ar"; text: string }, selectedLanguage?: "en" | "ar",
    onFeedbackContext?: (context: VoiceFeedbackContext) => void): Promise<string> {
    signal.throwIfAborted();
    const request = new AbortController();
    const abort = () => request.abort();
    signal.addEventListener("abort", abort, { once: true });
    this.pending.add(request);
    try {
      const wav = new Uint8Array(await questionWav([audio], 16000).arrayBuffer());
      request.signal.throwIfAborted();
      let binary = "";
      for (let offset = 0; offset < wav.length; offset += 0x8000)
        binary += String.fromCharCode(...wav.subarray(offset, offset + 0x8000));
      const result = await apiFetch<{ text: string; sourceText?: string; feedbackLanguage?: "en" | "ar"; skipAcknowledgment?: boolean;
        greetingReply?: { text?: unknown; language?: unknown } | null }>("/api/voice/transcribe", {
        method: "POST",
        // Preserve the transcript. The preference is only a hint for one retry
        // if auto-detection returns an unsupported language; it never requests translation.
        body: JSON.stringify({ audioBase64: btoa(binary), language: "auto",
          ...(selectedLanguage ? { recognitionHint: selectedLanguage } : {}),
          ...(onFeedbackContext ? { includeFeedbackContext: true } : {}) }),
        signal: request.signal,
      });
      request.signal.throwIfAborted();
      const text = result.text?.trim() ?? "";
      requireSupportedTranscript(text);
      if (typeof result.sourceText === "string") requireSupportedTranscript(result.sourceText);
      const greeting = result.greetingReply;
      if (onFeedbackContext && (result.feedbackLanguage === "en" || result.feedbackLanguage === "ar"))
        onFeedbackContext({ language: result.feedbackLanguage, skip: result.skipAcknowledgment !== false,
          ...(typeof greeting?.text === "string" && greeting.text.trim() && greeting.text.length <= 500 &&
              (greeting.language === "en" || greeting.language === "ar")
            ? { greetingReply: { text: greeting.text, language: greeting.language } } : {}),
          ...(typeof result.sourceText === "string" ? { sourceText: result.sourceText } : {}) });
      return text;
    } catch (error) {
      if (error instanceof Error && error.message === "The configured AI model does not support audio input.")
        throw new Error("stt_audio_unsupported");
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      this.pending.delete(request);
    }
  }

  close() {
    for (const request of this.pending) request.abort();
    this.pending.clear();
  }
}
