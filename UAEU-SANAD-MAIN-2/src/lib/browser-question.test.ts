import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { browserQuestion } from "./browser-question";
import { isVoiceCallEcho } from "./voice-call-echo";

class FakeRecognition {
  static last: FakeRecognition;
  lang = ""; continuous = true; interimResults = false; maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onresult: ((event: { results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  starts = 0; stops = 0; aborts = 0;
  constructor() { FakeRecognition.last = this; }
  start() { this.starts++; this.onstart?.(); }
  stop() { this.stops++; }
  abort() { this.aborts++; }
  result(text: string, isFinal: boolean) { this.onresult?.({ results: [{ isFinal, 0: { transcript: text } }] }); }
}

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("window", { SpeechRecognition: FakeRecognition }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test("one final question ends recognition, without submitting interim guesses or restarting", async () => {
  const started = vi.fn();
  const capture = browserQuestion("en", new AbortController().signal, started);
  const recognition = FakeRecognition.last;
  let finished = false;
  void capture.text.then(() => { finished = true; });
  recognition.result("What is my", false);
  await vi.advanceTimersByTimeAsync(600);
  expect(finished).toBe(false);
  recognition.result("What is my GPA?", true);
  recognition.onend?.();
  expect(await capture.text).toBe("What is my GPA?");
  expect(recognition.starts).toBe(1);
  expect(recognition.aborts).toBe(1);
  expect(started).toHaveBeenCalledTimes(1);
  expect(recognition.continuous).toBe(true);
});

test("explicit Arabic input is independent of page language", async () => {
  const capture = browserQuestion("ar", new AbortController().signal, () => {});
  const recognition = FakeRecognition.last;
  expect(recognition.lang).toBe("ar-AE");
  recognition.result("ما هو معدلي؟", true);
  capture.finish();
  expect(recognition.stops).toBe(1);
  recognition.onend?.();
  expect(await capture.text).toBe("ما هو معدلي؟");
});

test("recognition readiness is reported only when the browser starts listening", async () => {
  const start = vi.spyOn(FakeRecognition.prototype, "start").mockImplementation(function (this: FakeRecognition) { this.starts++; });
  try {
    const ready = vi.fn();
    const controller = new AbortController();
    const capture = browserQuestion("ar", controller.signal, ready);
    const rejected = expect(capture.text).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(100);
    expect(ready).not.toHaveBeenCalled();
    FakeRecognition.last.onstart?.();
    expect(ready).toHaveBeenCalledOnce();
    controller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  } finally { start.mockRestore(); }
});

test("a browser that never starts recognition fails cleanly instead of leaving startup stuck", async () => {
  const start = vi.spyOn(FakeRecognition.prototype, "start").mockImplementation(() => {});
  try {
    const ready = vi.fn();
    const capture = browserQuestion("en", new AbortController().signal, ready);
    const rejected = expect(capture.text).rejects.toThrow("browser_stt_unavailable");
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(ready).not.toHaveBeenCalled();
    expect(FakeRecognition.last.aborts).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally { start.mockRestore(); }
});

test("a greeting and adjacent question stay in one turn until the pause", async () => {
  const capture = browserQuestion("en", new AbortController().signal, () => {});
  const recognition = FakeRecognition.last;
  recognition.result("Hello Sanadi.", true);
  await vi.advanceTimersByTimeAsync(500);
  recognition.onresult?.({ results: [
    { isFinal: true, 0: { transcript: "Hello Sanadi." } },
    { isFinal: false, 0: { transcript: "What university" } },
  ] });
  await vi.advanceTimersByTimeAsync(600);
  expect(recognition.stops).toBe(0);
  recognition.onresult?.({ results: [
    { isFinal: true, 0: { transcript: "Hello Sanadi." } },
    { isFinal: true, 0: { transcript: "What university services can you help me with?" } },
  ] });
  await vi.advanceTimersByTimeAsync(1100);
  expect(recognition.stops).toBe(1);
  recognition.onend?.();
  expect(await capture.text).toBe("Hello Sanadi. What university services can you help me with?");
});

test("cancel stops recognition and discards late results", async () => {
  const turn = new AbortController();
  const capture = browserQuestion("en", turn.signal, () => {});
  const result = expect(capture.text).rejects.toMatchObject({ name: "AbortError" });
  const recognition = FakeRecognition.last;
  const late = recognition.onresult;
  turn.abort();
  late?.({ results: [{ isFinal: true, 0: { transcript: "stale speech" } }] });
  await result;
  expect(recognition.aborts).toBe(1);
  expect(recognition.onend).toBeNull();
});

test("browser network failure is explicit and does not restart recognition", async () => {
  const capture = browserQuestion("en", new AbortController().signal, () => {});
  const result = expect(capture.text).rejects.toThrow("browser_stt_unavailable");
  const recognition = FakeRecognition.last;
  recognition.onerror?.({ error: "network" });
  await result;
  expect(recognition.starts).toBe(1);
  expect(recognition.aborts).toBe(1);
});

test("silence closes the microphone without sending a question", async () => {
  const capture = browserQuestion("en", new AbortController().signal, () => {});
  await vi.advanceTimersByTimeAsync(11500);
  expect(await capture.text).toBe("");
  expect(FakeRecognition.last.stops).toBe(1);
  expect(FakeRecognition.last.aborts).toBe(1);
});

test("unsupported browsers do not attempt server speech recognition", async () => {
  vi.stubGlobal("window", {});
  await expect(browserQuestion("en", new AbortController().signal, () => {}).text)
    .rejects.toThrow("browser_stt_unsupported");
});

test("speaker echo does not interrupt; new interim user speech interrupts before question completion", async () => {
  const onUserSpeech = vi.fn();
  const capture = browserQuestion("en", new AbortController().signal, () => {}, {
    isEcho: text => isVoiceCallEcho(text, "Your GPA is three point five."),
    onUserSpeech,
  });
  const recognition = FakeRecognition.last;
  const echo = { isFinal: true, 0: { transcript: "Your GPA is three point five." } };
  recognition.onresult?.({ results: [echo] });
  expect(onUserSpeech).not.toHaveBeenCalled();
  recognition.onresult?.({ results: [echo, { isFinal: false, 0: { transcript: "What about my" } }] });
  expect(onUserSpeech).toHaveBeenCalledTimes(1);
  recognition.onresult?.({ results: [echo, { isFinal: true, 0: { transcript: "What about my courses?" } }] });
  recognition.onend?.();
  expect(await capture.text).toBe("What about my courses?");
});

test.each([
  ["en", "Hello Mira.", "Can you check my", "Can you check my GPA and explain how to improve it next semester?"],
  ["ar", "السلام عليكم ميرا.", "ممكن تشوفين", "ممكن تشوفين معدلي وتشرحين لي كيف أرفعه الفصل القادم؟"],
] as const)("%s previews the complete growing question and replaces interim corrections without duplication", async (language, greeting, interim, question) => {
  const onPreview = vi.fn();
  const capture = browserQuestion(language, new AbortController().signal, vi.fn(), { onPreview, audioControlsPause: true });
  const recognition = FakeRecognition.last;
  recognition.result(greeting, true);
  recognition.onresult?.({ results: [
    { isFinal: true, 0: { transcript: greeting } },
    { isFinal: false, 0: { transcript: interim } },
  ] });
  expect(onPreview).toHaveBeenLastCalledWith(`${greeting} ${interim}`);
  expect(capture.hasPendingResults()).toBe(true);
  // A browser result delay must not stop a student who is still speaking.
  await vi.advanceTimersByTimeAsync(2500);
  expect(recognition.stops).toBe(0);
  recognition.onresult?.({ results: [
    { isFinal: true, 0: { transcript: greeting } },
    { isFinal: true, 0: { transcript: question } },
  ] });
  expect(onPreview).toHaveBeenLastCalledWith(`${greeting} ${question}`);
  capture.finish(); // Actual microphone silence (or Finish speaking).
  expect(recognition.stops).toBe(1);
  recognition.onend?.();
  expect(await capture.text).toBe(`${greeting} ${question}`);
  expect(capture.hasPendingResults()).toBe(false);
});

test("an unfinished tail remains detectable when the browser stops before its final result", async () => {
  const capture = browserQuestion("en", new AbortController().signal, vi.fn());
  FakeRecognition.last.onresult?.({ results: [
    { isFinal: true, 0: { transcript: "Hello." } },
    { isFinal: false, 0: { transcript: "Please check my academic record and current GPA" } },
  ] });
  capture.finish();
  await vi.advanceTimersByTimeAsync(1500);
  expect(await capture.text).toBe("Hello.");
  expect(capture.hasPendingResults()).toBe(true); // Caller must transcribe the full recording.
});

test("previews exclude assistant echo and cannot return after End Call", async () => {
  const controller = new AbortController();
  const onPreview = vi.fn();
  const capture = browserQuestion("en", controller.signal, vi.fn(), { onPreview, isEcho: text => text === "Assistant echo." });
  const rejected = expect(capture.text).rejects.toMatchObject({ name: "AbortError" });
  const recognition = FakeRecognition.last;
  recognition.onresult?.({ results: [
    { isFinal: true, 0: { transcript: "Assistant echo." } },
    { isFinal: false, 0: { transcript: "My question" } },
  ] });
  expect(onPreview).toHaveBeenCalledExactlyOnceWith("My question");
  const lateResult = recognition.onresult;
  controller.abort();
  lateResult?.({ results: [{ isFinal: true, 0: { transcript: "Late result" } }] });
  await rejected;
  expect(onPreview).toHaveBeenCalledTimes(1);
});
