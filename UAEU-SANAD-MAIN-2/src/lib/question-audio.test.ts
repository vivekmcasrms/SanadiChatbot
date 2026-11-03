import { afterEach, expect, test, vi } from "vitest";
import { captureQuestionAudio, questionSamples } from "./question-audio";
import { openVoiceActivity, type VoiceActivityEvent } from "./voice-activity";
vi.mock("./auth-token", () => ({ apiFetch: vi.fn(), apiUrl: (path: string) => path }));
vi.mock("./voice-activity", async importOriginal => ({
  ...await importOriginal<typeof import("./voice-activity")>(), openVoiceActivity: vi.fn(),
}));

afterEach(() => vi.unstubAllGlobals());
test("48 kHz audio is downsampled to 16 kHz without gaps between worklet chunks", () => {
  expect([...questionSamples([new Float32Array([1, 1]), new Float32Array([1, 0, 0, 0])], 48000)]).toEqual([1, 0]);
});
test("an identified echo prefix can be excluded while preserving the following question", () => {
  expect([...questionSamples([new Float32Array([0.5, 0.5, 1, 1])], 16000, 2)]).toEqual([1, 1]);
});

// Synthetic PCM exercises activation timing and capture integrity, not STT accuracy.
async function microphone(rate = 48000, isReplying?: () => boolean) {
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  let context!: MockAudioContext;
  let recorder!: MockRecorder;
  class MockAudioContext {
    sampleRate = rate;
    destination = {};
    audioWorklet = { addModule: vi.fn(async () => {}) };
    resume = vi.fn(async () => {});
    close = vi.fn(async () => {});
    createMediaStreamSource = vi.fn(() => source);
    constructor() { context = this; }
  }
  class MockRecorder {
    port: { onmessage: ((event: MessageEvent<Float32Array>) => void) | null } = { onmessage: null };
    connect = vi.fn();
    disconnect = vi.fn();
    constructor() { recorder = this; }
  }
  vi.stubGlobal("AudioContext", MockAudioContext);
  vi.stubGlobal("AudioWorkletNode", MockRecorder);
  vi.stubGlobal("MediaStream", class { constructor(public tracks: MediaStreamTrack[]) {} });
  const stop = vi.fn();
  const controller = new AbortController();
  const onSpeech = vi.fn();
  const onPause = vi.fn();
  const onError = vi.fn();
  let serverEvent!: (event: VoiceActivityEvent, frameEndSample?: number) => void;
  let serverError!: (error: Error) => void;
  const activity = { send: vi.fn(), close: vi.fn() };
  vi.mocked(openVoiceActivity).mockImplementation(async (_signal, event, error) => {
    serverEvent = event; serverError = error; return activity;
  });
  const capture = await captureQuestionAudio({ stop } as unknown as MediaStreamTrack,
    controller.signal, onPause, onSpeech, onError, isReplying);
  const original: Float32Array[] = [];
  const send = (samples: Float32Array) => {
    original.push(samples.slice());
    recorder.port.onmessage?.({ data: samples } as MessageEvent<Float32Array>);
  };
  const feed = (milliseconds: number, amplitude = 0) => {
    let remaining = Math.round(rate * milliseconds / 1000);
    while (remaining > 0) {
      const size = Math.min(remaining, Math.round(rate / 100));
      const samples = new Float32Array(size);
      for (let i = 0; i < size; i++) samples[i] = i % 2 ? -amplitude : amplitude;
      send(samples);
      remaining -= size;
    }
  };
  return { capture, controller, recorder, context, source, stop, onSpeech, onPause, original, feed, send, activity, serverEvent, serverError, onError };
}

test("loud object sounds cannot activate without server speech detection", async () => {
  const mic = await microphone();
  for (let i = 0; i < 20; i++) { mic.feed(40, 0.5); mic.feed(60); mic.serverEvent("continue"); }
  expect(mic.onSpeech).not.toHaveBeenCalled();
  expect(mic.activity.send).toHaveBeenCalled();
  expect(mic.capture.finish()).toHaveLength(0);
});

test("during a reply faint input is masked only in VAD, while confirmed speech retains original STT samples", async () => {
  const mic = await microphone(48000, () => true);
  mic.feed(500, 0.005);
  expect(mic.activity.send.mock.calls.every(([pcm]) => new Uint8Array(pcm).every(value => value === 0))).toBe(true);
  expect(mic.onSpeech).not.toHaveBeenCalled();
  mic.feed(500, 0.12); // Alternating 48 kHz test samples lose amplitude when averaged to 16 kHz.
  expect(mic.activity.send.mock.calls.some(([pcm]) => new Uint8Array(pcm).some(value => value !== 0))).toBe(true);
  expect(mic.onSpeech).not.toHaveBeenCalled(); // Loudness alone cannot interrupt.
  mic.serverEvent("speech");
  expect(mic.onSpeech).toHaveBeenCalledOnce();
  mic.activity.send.mockClear();
  mic.feed(500, 0.0005);
  expect(mic.activity.send.mock.calls.some(([pcm]) => new Uint8Array(pcm).some(value => value !== 0))).toBe(true);
  mic.feed(1000); mic.serverEvent("pause");
  expect(mic.capture.finish()).toEqual(questionSamples(mic.original, 48000));
});

test("speech with quieter syllables can reach VAD during playback without losing the question onset", async () => {
  const mic = await microphone(48000, () => true);
  mic.feed(96, 0.12);
  mic.activity.send.mockClear();
  mic.feed(256, 0.012);
  expect(mic.activity.send.mock.calls).toHaveLength(8);
  expect(mic.activity.send.mock.calls.every(([pcm]) => new Uint8Array(pcm).some(value => value !== 0))).toBe(true);
  expect(mic.onSpeech).not.toHaveBeenCalled(); // The level check is still not a speech detector.
  mic.serverEvent("speech");
  expect(mic.onSpeech).toHaveBeenCalledOnce();
  mic.feed(500, 0.0005); mic.serverEvent("pause");
  expect(mic.capture.finish()).toEqual(questionSamples(mic.original, 48000));
  expect(mic.stop).not.toHaveBeenCalled();
});

test("ordinary listening resumes inside the same capture after the reply finishes", async () => {
  let replying = true;
  const mic = await microphone(48000, () => replying);
  mic.feed(320, 0.0005);
  expect(mic.activity.send.mock.calls.every(([pcm]) => new Uint8Array(pcm).every(value => value === 0))).toBe(true);
  replying = false;
  mic.activity.send.mockClear();
  mic.feed(320, 0.0005);
  expect(mic.activity.send.mock.calls.every(([pcm]) => new Uint8Array(pcm).some(value => value !== 0))).toBe(true);
  mic.serverEvent("speech");
  expect(mic.onSpeech).toHaveBeenCalledOnce();
  mic.capture.cancel();
});

test.each([44100, 48000])("server detection accepts quiet voice without a local volume cutoff at %i Hz", async rate => {
  const mic = await microphone(rate);
  mic.feed(300, 0.0005);
  mic.serverEvent("speech"); mic.serverEvent("speech");
  expect(mic.onSpeech).toHaveBeenCalledOnce();
  mic.feed(1100);
  expect(mic.onPause).not.toHaveBeenCalled();
  mic.serverEvent("pause"); mic.serverEvent("pause");
  expect(mic.onPause).toHaveBeenCalledOnce();
  expect(mic.capture.finish()).toEqual(questionSamples(mic.original, rate));
  expect(mic.stop).not.toHaveBeenCalled();
});

test("the complete original recording is retained before server activation", async () => {
  const mic = await microphone();
  mic.feed(400, 0.001); mic.feed(200, 0.025);
  mic.serverEvent("speech");
  mic.feed(300, 0.003); mic.feed(1100);
  mic.serverEvent("pause");
  const expected = questionSamples(mic.original, 48000);
  expect(mic.capture.finish()).toEqual(expected);
  expect(mic.context.close).toHaveBeenCalledOnce();
  expect(mic.activity.close).toHaveBeenCalledOnce();
});

test.each([16000, 44100, 48000])("idle audio is excluded using the VAD frame position, not late callback time at %i Hz", async rate => {
  const mic = await microphone(rate);
  mic.feed(7000, 0.001); // Idle surroundings before the intended utterance.
  mic.feed(800, 0.03); // The callback arrives 544 ms after the detected onset frame.
  const frameEndSample = 227 * 512; // 7.264 seconds at the server's 16 kHz rate.
  mic.serverEvent("speech", frameEndSample);
  expect(mic.onSpeech).toHaveBeenCalledOnce();
  mic.feed(400, 0.02); mic.feed(1000);
  mic.serverEvent("pause", 0);
  const start = Math.floor((frameEndSample / 16000 - 2) * rate);
  expect(mic.capture.finish()).toEqual(questionSamples(mic.original, rate, start));
  expect(start).toBeLessThan(7 * rate); // Retain the beginning of actual speech.
  expect(mic.stop).not.toHaveBeenCalled();
});

test("short and quiet utterances retain their first samples with VAD timing", async () => {
  const mic = await microphone();
  mic.feed(400, 0.0005);
  mic.serverEvent("speech", 12 * 512);
  mic.feed(1000); mic.serverEvent("pause");
  expect(mic.capture.finish()).toEqual(questionSamples(mic.original, 48000));
});

test("server detection failure stops capture and never falls back to volume activation", async () => {
  const mic = await microphone();
  mic.feed(500, 0.2);
  const failure = new Error("voice_activity_unavailable");
  mic.serverError(failure);
  mic.serverEvent("speech");
  expect(mic.onError).toHaveBeenCalledExactlyOnceWith(failure);
  expect(mic.onSpeech).not.toHaveBeenCalled();
  expect(mic.capture.finish()).toHaveLength(0);
  expect(mic.stop).not.toHaveBeenCalled();
});

test("abort ignores queued microphone and server callbacks without stopping the owned track", async () => {
  const mic = await microphone();
  const queued = mic.recorder.port.onmessage!;
  mic.controller.abort();
  queued({ data: new Float32Array(48000).fill(0.02) } as MessageEvent<Float32Array>);
  mic.serverEvent("speech"); mic.serverError(new Error("voice_activity_unavailable"));
  expect(mic.onSpeech).not.toHaveBeenCalled();
  expect(mic.onError).not.toHaveBeenCalled();
  expect(mic.activity.send).not.toHaveBeenCalled();
  expect(mic.activity.close).toHaveBeenCalledOnce();
  expect(mic.recorder.port.onmessage).toBeNull();
  expect(mic.stop).not.toHaveBeenCalled();
});
