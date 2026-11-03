import { afterEach, expect, test, vi } from "vitest";
import { apiFetch } from "./auth-token";
import { MultilingualSpeech } from "./multilingual-speech";

vi.mock("./auth-token", () => ({ apiFetch: vi.fn() }));
afterEach(() => vi.clearAllMocks());

test("voice recording is sent as WAV only to the configured API path", async () => {
  vi.mocked(apiFetch).mockResolvedValue({ text: "  سؤال جديد  " });
  const speech = new MultilingualSpeech();
  const text = await speech.transcribe(new Float32Array(16000).fill(0.1),
    new AbortController().signal, { language: "en", text: "wrong words" }, "ar");
  expect(text).toBe("سؤال جديد");
  expect(apiFetch).toHaveBeenCalledExactlyOnceWith("/api/voice/transcribe", expect.objectContaining({
    method: "POST", signal: expect.any(AbortSignal),
  }));
  const body = JSON.parse(vi.mocked(apiFetch).mock.calls[0]![1]!.body as string);
  expect(body.language).toBe("auto");
  expect(body.targetLanguage).toBeUndefined();
  expect(body.recognitionHint).toBe("ar");
  const wav = Uint8Array.from(atob(body.audioBase64), char => char.charCodeAt(0));
  expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
  expect(new DataView(wav.buffer).getUint32(24, true)).toBe(16000);
});

test.each(["en", "ar"] as const)("selected %s output language is separate from speech detection", async language => {
  vi.mocked(apiFetch).mockResolvedValue({ text: "transcript" });
  await new MultilingualSpeech().transcribe(new Float32Array(16000), new AbortController().signal, undefined, language);
  const body = JSON.parse(vi.mocked(apiFetch).mock.calls[0]![1]!.body as string);
  expect(body.language).toBe("auto");
  expect(body.targetLanguage).toBeUndefined();
  expect(body.recognitionHint).toBe(language);
});

test("End Call aborts an in-flight API transcription", async () => {
  vi.mocked(apiFetch).mockImplementation((_path, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(new DOMException("Interrupted", "AbortError")));
  }));
  const speech = new MultilingualSpeech();
  const pending = speech.transcribe(new Float32Array(16000), new AbortController().signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledOnce());
  speech.close();
  await rejected;
});

test("optional detected-language metadata leaves the translated question unchanged", async () => {
  vi.mocked(apiFetch).mockResolvedValue({ text: "سؤالي المترجم", feedbackLanguage: "en", skipAcknowledgment: false });
  const heard = vi.fn();
  const result = await new MultilingualSpeech().transcribe(new Float32Array(16000), new AbortController().signal, undefined, "ar", heard);
  expect(result).toBe("سؤالي المترجم");
  expect(heard).toHaveBeenCalledExactlyOnceWith({ language: "en", skip: false });
  expect(JSON.parse(vi.mocked(apiFetch).mock.calls[0]![1]!.body as string).includeFeedbackContext).toBe(true);
});

test("caller cancellation aborts API transcription", async () => {
  vi.mocked(apiFetch).mockImplementation((_path, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(new DOMException("Interrupted", "AbortError")));
  }));
  const speech = new MultilingualSpeech();
  const controller = new AbortController();
  const pending = speech.transcribe(new Float32Array(16000), controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledOnce());
  controller.abort();
  await rejected;
});

test("an audio-incompatible configured model keeps the existing voice error", async () => {
  vi.mocked(apiFetch).mockRejectedValue(new Error("The configured AI model does not support audio input."));
  const speech = new MultilingualSpeech();
  await expect(speech.transcribe(new Float32Array(16000), new AbortController().signal))
    .rejects.toThrow("stt_audio_unsupported");
});

test.each(["সুক্রান", "धन्यवाद", "谢谢", "спасибо", "شكرا こんにちは"])("blocks unsupported transcript before display or feedback: %s", async text => {
  vi.mocked(apiFetch).mockResolvedValue({ text, sourceText: text, feedbackLanguage: "ar", skipAcknowledgment: true });
  const heard = vi.fn();
  await expect(new MultilingualSpeech().transcribe(new Float32Array(16000), new AbortController().signal, undefined, "ar", heard))
    .rejects.toThrow("stt_unsupported_language");
  expect(heard).not.toHaveBeenCalled();
  expect(apiFetch).toHaveBeenCalledOnce();
});

test.each(["شكراً", "مـرحباً", "Thank you!", "ما هو GPA؟", "José, ID 00200336, GPA 3.75"])("keeps supported transcript unchanged: %s", async text => {
  vi.mocked(apiFetch).mockResolvedValue({ text });
  expect(await new MultilingualSpeech().transcribe(new Float32Array(16000), new AbortController().signal)).toBe(text);
});

test("an older server cannot hide unsupported source text behind a translated question", async () => {
  vi.mocked(apiFetch).mockResolvedValue({ text: "شكرا", sourceText: "সুক্রান", feedbackLanguage: "ar" });
  const heard = vi.fn();
  await expect(new MultilingualSpeech().transcribe(new Float32Array(16000), new AbortController().signal, undefined, "ar", heard))
    .rejects.toThrow("stt_unsupported_language");
  expect(heard).not.toHaveBeenCalled();
});

test.each(["en", "ar"] as const)("server-approved %s greeting metadata never changes the transcript", async language => {
  const text = language === "ar" ? "مرحبا ميرا" : "Hello Mira";
  const greetingReply = { text: language === "ar" ? "أهلا بك." : "Hello!", language };
  vi.mocked(apiFetch).mockResolvedValue({ text, sourceText: text, feedbackLanguage: language, skipAcknowledgment: true, greetingReply });
  const context = vi.fn();
  expect(await new MultilingualSpeech().transcribe(new Float32Array(16000), new AbortController().signal, undefined, language, context)).toBe(text);
  expect(context).toHaveBeenCalledWith({ language, skip: true, sourceText: text, greetingReply });
});

test.each([null, { text: 12, language: "en" }, { text: "Hello", language: "bn" }, { text: "x".repeat(501), language: "en" }])(
  "invalid optional greeting metadata is ignored without affecting recognition: %j", async greetingReply => {
    vi.mocked(apiFetch).mockResolvedValue({ text: "Hello", feedbackLanguage: "en", skipAcknowledgment: true, greetingReply });
    const context = vi.fn();
    expect(await new MultilingualSpeech().transcribe(new Float32Array(16000), new AbortController().signal, undefined, "en", context)).toBe("Hello");
    expect(context).toHaveBeenCalledWith({ language: "en", skip: true });
  });
