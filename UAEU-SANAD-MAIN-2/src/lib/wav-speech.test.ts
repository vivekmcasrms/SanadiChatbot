import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { WavSpeech } from "./wav-speech";
import { VoiceReplyPresentation } from "./voice-reply-presentation";

class Source {
  buffer: { duration: number } | null = null;
  playbackRate = { value: 1 };
  onended: (() => void) | null = null;
  connect = vi.fn(); disconnect = vi.fn(); start = vi.fn(); stop = vi.fn();
}
class Context {
  static last: Context;
  currentTime = 0; state = "running"; destination = {};
  gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  sources: Source[] = [];
  decodeAudioData = vi.fn(async (_: ArrayBuffer) => ({ duration: 2 }));
  resume = vi.fn(async () => {});
  close = vi.fn(async () => { this.state = "closed"; });
  constructor() { Context.last = this; }
  createGain() { return this.gain; }
  createBufferSource() { const source = new Source(); this.sources.push(source); return source; }
}
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("window", { AudioContext: Context }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test("a reply received before WAV decoding is revealed only when playback starts", async () => {
  const player = new WavSpeech(); await player.prepare();
  const show = vi.fn(), reply = new VoiceReplyPresentation(show);
  reply.result({ answer: "Your reply is ready." });
  let decode!: (buffer: { duration: number }) => void;
  Context.last.decodeAudioData.mockImplementationOnce(() => new Promise(resolve => { decode = resolve; }));
  const playing = player.play(new ArrayBuffer(48), new AbortController().signal, () => reply.start());
  await vi.advanceTimersByTimeAsync(2000);
  expect(show).not.toHaveBeenCalled();
  decode({ duration: 2 });
  await vi.advanceTimersByTimeAsync(39);
  expect(show).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2);
  expect(show).toHaveBeenCalledExactlyOnceWith({ answer: "Your reply is ready." });
  Context.last.sources[0]!.onended?.(); await playing;
  reply.finish();
  expect(show).toHaveBeenCalledTimes(1);
  player.close();
});

test("a final reply arriving after the first spoken sentence is shown without another wait", () => {
  const show = vi.fn(), reply = new VoiceReplyPresentation(show);
  reply.start();
  reply.result({ answer: "The complete answer." });
  expect(show).toHaveBeenCalledExactlyOnceWith({ answer: "The complete answer." });
});

test("interruption or speech failure preserves a confirmed outcome without leaking it into the next turn", () => {
  const show = vi.fn(), first = new VoiceReplyPresentation(show);
  first.result({ receipt: "confirmed" });
  first.finish();
  first.finish();
  const second = new VoiceReplyPresentation(show);
  second.start();
  expect(show).toHaveBeenCalledExactlyOnceWith({ receipt: "confirmed" });
  second.result({ answer: "The new reply." });
  expect(show).toHaveBeenCalledTimes(2);
});

test("next sentence decodes and schedules while first is playing, with no overlap or intentional gap", async () => {
  const player = new WavSpeech(); await player.prepare();
  const turn = new AbortController(), started = vi.fn();
  const first = player.play(new ArrayBuffer(48), turn.signal, started);
  const second = player.play(new ArrayBuffer(48), turn.signal, started);
  await vi.advanceTimersByTimeAsync(45);
  const context = Context.last;
  expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
  expect(context.sources[0]!.start).toHaveBeenCalledWith(0.04);
  expect(context.sources[1]!.start).toHaveBeenCalledWith(2.04);
  expect(started).toHaveBeenCalledTimes(1);
  context.sources[0]!.onended?.();
  await first;
  await vi.advanceTimersByTimeAsync(2000);
  expect(started).toHaveBeenCalledTimes(2);
  context.sources[1]!.onended?.();
  await second;
  player.close();
});

test("interruption stops active and queued audio immediately and permits the new turn", async () => {
  const player = new WavSpeech(); await player.prepare();
  const turn = new AbortController();
  const first = player.play(new ArrayBuffer(48), turn.signal, vi.fn());
  const second = player.play(new ArrayBuffer(48), turn.signal, vi.fn());
  const failures = Promise.all([
    expect(first).rejects.toMatchObject({ name: "AbortError" }),
    expect(second).rejects.toMatchObject({ name: "AbortError" }),
  ]);
  await vi.advanceTimersByTimeAsync(45);
  player.stop();
  await failures;
  expect(Context.last.sources.every(source => source.stop.mock.calls.length === 1)).toBe(true);
  const next = player.play(new ArrayBuffer(48), new AbortController().signal, vi.fn());
  await vi.advanceTimersByTimeAsync(45);
  expect(Context.last.sources[2]!.start).toHaveBeenCalledWith(0.04);
  Context.last.sources[2]!.onended?.(); await next;
  player.close();
});

test("a WAV finishing decoding after cancellation cannot speak", async () => {
  const player = new WavSpeech(); await player.prepare();
  let finish!: (buffer: { duration: number }) => void;
  Context.last.decodeAudioData.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const pending = player.play(new ArrayBuffer(48), controller.signal, vi.fn());
  const failure = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await Promise.resolve();
  controller.abort(); player.stop();
  finish({ duration: 2 });
  await failure;
  await vi.advanceTimersByTimeAsync(100);
  expect(Context.last.sources).toHaveLength(0);
  player.close();
});

test("mute adjusts volume without repeating or regenerating speech; End Call releases audio resources", async () => {
  const player = new WavSpeech(); await player.prepare();
  const pending = player.play(new ArrayBuffer(48), new AbortController().signal, vi.fn());
  const failure = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(45);
  player.setMuted(true); expect(Context.last.gain.gain.value).toBe(0);
  player.setMuted(false); expect(Context.last.gain.gain.value).toBe(1);
  expect(Context.last.decodeAudioData).toHaveBeenCalledTimes(1);
  player.close(); await failure;
  expect(Context.last.close).toHaveBeenCalledOnce();
});

test("unavailable spectrum analysis leaves playback, mute and interruption working", async () => {
  const player = new WavSpeech(); await player.prepare();
  // This context deliberately has no analyser support.
  expect(() => player.observe({} as MediaStream)).not.toThrow();
  expect(player.spectrum).toBeNull();
  const pending = player.play(new ArrayBuffer(48), new AbortController().signal, vi.fn());
  const failure = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(45);
  expect(Context.last.sources[0]!.start).toHaveBeenCalledWith(.04);
  player.setMuted(true);
  expect(Context.last.gain.gain.value).toBe(0);
  player.close(); await failure;
});

test("invalid audio rejects and never starts a source", async () => {
  const player = new WavSpeech(); await player.prepare();
  Context.last.decodeAudioData.mockRejectedValueOnce(new Error("Cannot decode WAV"));
  await expect(player.play(new ArrayBuffer(48), new AbortController().signal, vi.fn())).rejects.toThrow("Cannot decode WAV");
  expect(Context.last.sources).toHaveLength(0);
  player.close();
});

test("voice delivery pauses and subtle speed changes schedule without overlapping sentences", async () => {
  const player = new WavSpeech(); await player.prepare();
  const signal = new AbortController().signal, started = vi.fn();
  const first = player.play(new ArrayBuffer(48), signal, started, { pauseBeforeMs: 400, rate: 1.02 });
  const second = player.play(new ArrayBuffer(48), signal, started, { pauseBeforeMs: 250, rate: .98 });
  await vi.advanceTimersByTimeAsync(439);
  expect(started).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2);
  expect(started).toHaveBeenCalledOnce();
  const sources = Context.last.sources;
  expect(sources[0]!.start).toHaveBeenCalledWith(.44);
  expect(sources[0]!.playbackRate.value).toBe(1.02);
  expect(sources[1]!.start.mock.calls[0]![0]).toBeCloseTo(.44 + 2 / 1.02 + .25);
  expect(sources[1]!.playbackRate.value).toBe(.98);
  sources.forEach(source => source.onended?.());
  await Promise.all([first, second]); player.close();
});

test("interrupting the initial thinking pause cancels speech before it starts", async () => {
  const player = new WavSpeech(); await player.prepare();
  const turn = new AbortController(), started = vi.fn();
  const pending = player.play(new ArrayBuffer(48), turn.signal, started, { pauseBeforeMs: 800 });
  const failed = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(400);
  turn.abort(); player.stop(); await failed;
  await vi.advanceTimersByTimeAsync(1000);
  expect(started).not.toHaveBeenCalled();
  expect(Context.last.sources[0]!.stop).toHaveBeenCalledOnce();
  player.close();
});

test("late audio starts immediately instead of adding another pause after the TTS/network gap", async () => {
  const player = new WavSpeech(); await player.prepare();
  const first = player.play(new ArrayBuffer(48), new AbortController().signal, vi.fn());
  await vi.advanceTimersByTimeAsync(45);
  Context.last.sources[0]!.onended?.(); await first;
  Context.last.currentTime = 4; // Previous audio finished at 2.04 seconds.
  const next = player.play(new ArrayBuffer(48), new AbortController().signal, vi.fn(), { pauseBeforeMs: 250 });
  await vi.advanceTimersByTimeAsync(45);
  expect(Context.last.sources[1]!.start).toHaveBeenCalledWith(4.04);
  Context.last.sources[1]!.onended?.(); await next; player.close();
});

test.each([{ pauseBeforeMs: -1 }, { pauseBeforeMs: 1001 }, { rate: 2 }, { rate: Number.NaN }])(
  "rejects invalid speech timing %j", async delivery => {
    const player = new WavSpeech(); await player.prepare();
    await expect(player.play(new ArrayBuffer(48), new AbortController().signal, vi.fn(), delivery))
      .rejects.toThrow("invalid_voice_audio");
    expect(Context.last.sources).toHaveLength(0); player.close();
  });
