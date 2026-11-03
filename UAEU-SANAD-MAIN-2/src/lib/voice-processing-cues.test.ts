import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { VoiceProcessingCues } from "./voice-processing-cues";
import type { VoicePrompt } from "./voice-prompt-audio";

const clips = (language: string, kind: string, count: number) => Array.from({ length: count }, (_, i) => ({
  id: `mira/${language}/${kind}/${i}`, text: `${language} ${kind} ${i}`, wav: new ArrayBuffer(48),
}));
function fixture(language = "en") {
  const play = vi.fn(async (_clip: VoicePrompt, _signal: AbortSignal) => {}), stop = vi.fn(), turn = new AbortController();
  const cues = new VoiceProcessingCues(play, stop);
  const input = { enabled: true, skip: false, signal: turn.signal,
    initial: clips(language, "initial", 2), waiting: clips(language, "waiting", 5) };
  return { play, stop, turn, cues, input };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

test.each([{ enabled: false, skip: false }, { enabled: true, skip: true }])("disabled or immediate social replies schedule nothing: %j", async flags => {
  const { cues, input, play } = fixture();
  cues.start({ ...input, ...flags });
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(play).not.toHaveBeenCalled();
});
test("an immediately available final response skips the initial acknowledgment", async () => {
  const { cues, input, play } = fixture();
  cues.start(input);
  await vi.advanceTimersByTimeAsync(100);
  cues.finish();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(play).not.toHaveBeenCalled();
});
test.each(["en", "ar"])("one initial %s cue, waiting only at 3 seconds and no repeats", async language => {
  const { cues, input, play } = fixture(language);
  cues.start(input);
  await vi.advanceTimersByTimeAsync(150);
  expect(play).toHaveBeenCalledOnce();
  expect(play.mock.calls[0]![0]).toMatchObject({ id: `mira/${language}/initial/0` });
  await vi.advanceTimersByTimeAsync(2849);
  expect(play).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(play).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60_000);
  const ids = play.mock.calls.map(call => (call[0] as { id: string }).id);
  expect(ids).toHaveLength(6);
  expect(new Set(ids).size).toBe(6);
  expect(ids.filter(id => id.includes("initial"))).toHaveLength(1);
});
test("a final response before 3 seconds cancels waiting without changing the result", async () => {
  const { cues, input, play } = fixture();
  cues.start(input);
  await vi.advanceTimersByTimeAsync(2500);
  cues.finish();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(play).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
test.each(["api_error", "user_interrupt", "end_call"])("%s stops in-progress audio and all timers immediately", async reason => {
  const { cues, input, play, stop, turn } = fixture();
  play.mockImplementation(() => new Promise(() => {}));
  cues.start(input);
  await vi.advanceTimersByTimeAsync(150);
  if (reason === "user_interrupt" || reason === "end_call") turn.abort(); else cues.cancel();
  expect(stop).toHaveBeenCalledOnce();
  expect((play.mock.calls[0]![1] as AbortSignal).aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(play).toHaveBeenCalledOnce();
});

test.each([
  { language: "en", kind: "initial" }, { language: "ar", kind: "initial" },
  { language: "en", kind: "waiting" }, { language: "ar", kind: "waiting" },
])("a ready reply waits for the current $language $kind clip, without starting more cues", async ({ language, kind }) => {
  const { cues, input, play, stop } = fixture(language);
  let finish!: () => void;
  if (kind === "waiting") play.mockImplementationOnce(async () => {});
  play.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  cues.start(input);
  await vi.advanceTimersByTimeAsync(kind === "waiting" ? 3000 : 150);
  const count = kind === "waiting" ? 2 : 1;
  expect(play).toHaveBeenCalledTimes(count);
  const signal = play.mock.calls[count - 1]![1];
  const pending = cues.finish();
  expect(pending).toBeInstanceOf(Promise);
  expect(cues.finish()).toBe(pending);
  let completed = false;
  void pending!.then(() => { completed = true; });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(completed).toBe(false);
  expect(signal.aborted).toBe(false);
  expect(stop).not.toHaveBeenCalled();
  expect(play).toHaveBeenCalledTimes(count);
  finish();
  await pending;
  expect(completed).toBe(true);
  expect(cues.finish()).toBeUndefined();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(play).toHaveBeenCalledTimes(count);
  expect(stop).not.toHaveBeenCalled();
});

test("user interruption still cancels a clip after the final reply has queued behind it", async () => {
  const { cues, input, play, stop, turn } = fixture();
  play.mockImplementation((_clip, signal) => new Promise<void>((_resolve, reject) =>
    signal.addEventListener("abort", () => reject(new DOMException("Interrupted", "AbortError")), { once: true })));
  cues.start(input);
  await vi.advanceTimersByTimeAsync(150);
  const pending = cues.finish();
  turn.abort();
  await pending;
  expect(stop).toHaveBeenCalledOnce();
  expect(play.mock.calls[0]![1].aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(play).toHaveBeenCalledOnce();
});
test("waiting never overlaps a slow initial clip and ends as soon as the result is ready", async () => {
  const { cues, input, play, stop } = fixture();
  let finish!: () => void;
  play.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  cues.start(input);
  await vi.advanceTimersByTimeAsync(4000);
  expect(play).toHaveBeenCalledOnce();
  finish();
  await vi.advanceTimersByTimeAsync(600);
  expect(play).toHaveBeenCalledTimes(2);
  cues.cancel();
  expect(stop).not.toHaveBeenCalled(); // Both clips completed; never stop a new final response.
});
test("a cue playback failure is silent and disables waiting for that turn", async () => {
  const { cues, input, play } = fixture();
  play.mockRejectedValueOnce(new Error("optional audio unavailable"));
  cues.start(input);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(play).toHaveBeenCalledOnce();
  expect(input.signal.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
test("an interrupted turn cannot restart timers in a newer turn; initial phrases vary", async () => {
  const { cues, input, play } = fixture();
  let finish!: () => void;
  play.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  cues.start(input);
  await vi.advanceTimersByTimeAsync(150);
  cues.start({ ...input, signal: new AbortController().signal });
  finish();
  await vi.advanceTimersByTimeAsync(150);
  expect(play.mock.calls[1]![0]).toMatchObject({ id: "mira/en/initial/1" });
  cues.cancel();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(play).toHaveBeenCalledTimes(2);
});
