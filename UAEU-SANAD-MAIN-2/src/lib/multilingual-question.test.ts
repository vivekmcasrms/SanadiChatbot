import { beforeEach, expect, test, vi } from "vitest";
import { multilingualQuestion } from "./multilingual-question";
import { captureQuestionAudio } from "./question-audio";
import type { MultilingualSpeech } from "./multilingual-speech";

vi.mock("./question-audio", () => ({ captureQuestionAudio: vi.fn() }));
const samples = new Float32Array(16_000).fill(0.1);
const audio = { finish: vi.fn(), cancel: vi.fn(), markUserSpeech: vi.fn(), markEcho: vi.fn() };
const options = { track: {} as MediaStreamTrack, isEcho: vi.fn(() => false), onUserSpeech: vi.fn(), onRecognizing: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  audio.finish.mockReturnValue(samples);
  vi.mocked(captureQuestionAudio).mockResolvedValue(audio);
  options.isEcho.mockReturnValue(false);
});
function engine(text: string) {
  return { transcribe: vi.fn().mockResolvedValue(text) } as unknown as MultilingualSpeech;
}
async function start(stt: MultilingualSpeech, controller = new AbortController()) {
  const onStarted = vi.fn();
  const capture = multilingualQuestion(stt, "en", controller.signal, onStarted, options);
  await vi.waitFor(() => expect(onStarted).toHaveBeenCalledOnce());
  return { capture, controller };
}

test("a local pause sends the complete recording to API transcription", async () => {
  const stt = engine("ما هو معدلي؟");
  const { capture } = await start(stt);
  vi.mocked(captureQuestionAudio).mock.calls[0]![3]!();
  expect(options.onUserSpeech).toHaveBeenCalledOnce();
  vi.mocked(captureQuestionAudio).mock.calls[0]![2]();
  expect(await capture.text).toBe("ما هو معدلي؟");
  expect(stt.transcribe).toHaveBeenCalledExactlyOnceWith(samples, expect.any(AbortSignal), undefined, undefined);
  expect(options.onRecognizing).toHaveBeenCalledOnce();
  expect(audio.cancel).toHaveBeenCalledOnce();
});

test("a cue echo is rejected in its original language even when display translation differs", async () => {
  const sourceText = "Sure, I'm checking that now.";
  const stt = { transcribe: vi.fn(async (_audio, _signal, _browser, _selected, callback) => {
    callback({ language: "en", skip: false, sourceText });
    return "بالتأكيد أتحقق من ذلك الآن";
  }) } as unknown as MultilingualSpeech;
  const isEcho = vi.fn((text: string) => text === sourceText);
  const heard = vi.fn();
  const capture = multilingualQuestion(stt, "ar", new AbortController().signal, () => {},
    { ...options, isEcho, selectedLanguage: "ar", onFeedbackContext: heard });
  await vi.waitFor(() => expect(captureQuestionAudio).toHaveBeenCalled());
  capture.finish();
  expect(await capture.text).toBe("");
  expect(isEcho).toHaveBeenCalledWith(sourceText);
  expect(heard).toHaveBeenCalledWith({ language: "en", skip: false, sourceText });
});

test("Finish speaking ends capture without browser speech recognition", async () => {
  const { capture } = await start(engine("Full question"));
  capture.finish();
  expect(await capture.text).toBe("Full question");
});

test("silence never reaches the API", async () => {
  audio.finish.mockReturnValue(new Float32Array());
  const stt = engine("hallucination");
  const { capture } = await start(stt);
  capture.finish();
  expect(await capture.text).toBe("");
  expect(stt.transcribe).not.toHaveBeenCalled();
});

test("a server VAD failure never sends uncertain audio to H200", async () => {
  const stt = engine("should not be called");
  const { capture } = await start(stt);
  const result = expect(capture.text).rejects.toThrow("voice_activity_unavailable");
  vi.mocked(captureQuestionAudio).mock.calls[0]![4]!(new Error("voice_activity_unavailable"));
  await result;
  expect(stt.transcribe).not.toHaveBeenCalled();
  expect(audio.cancel).toHaveBeenCalledOnce();
});

test("server activation does not change the selected STT language", async () => {
  const stt = engine("سؤالي");
  const capture = multilingualQuestion(stt, "ar", new AbortController().signal, () => {},
    { ...options, selectedLanguage: "ar" });
  await vi.waitFor(() => expect(captureQuestionAudio).toHaveBeenCalled());
  await Promise.resolve();
  capture.finish();
  expect(await capture.text).toBe("سؤالي");
  expect(stt.transcribe).toHaveBeenCalledExactlyOnceWith(samples, expect.any(AbortSignal), undefined, "ar");
});

test("assistant echo is discarded after API transcription", async () => {
  options.isEcho.mockReturnValue(true);
  const { capture } = await start(engine("assistant audio"));
  capture.finish();
  expect(await capture.text).toBe("");
});

test("End Call discards late transcription", async () => {
  const controller = new AbortController();
  const stt = engine("");
  vi.mocked(stt.transcribe).mockImplementation(async () => { controller.abort(); return "late question"; });
  const { capture } = await start(stt, controller);
  capture.finish();
  await expect(capture.text).rejects.toMatchObject({ name: "AbortError" });
  expect(audio.cancel).toHaveBeenCalledOnce();
});
