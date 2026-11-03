import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { apiFetch } from "./auth-token";
import { ActivityPcmEncoder, openVoiceActivity } from "./voice-activity";

vi.mock("./auth-token", () => ({ apiFetch: vi.fn(), apiUrl: (path: string) => `https://api.application.test${path}` }));
let socket: FakeSocket | undefined;
class FakeSocket {
  static OPEN = 1; static CLOSING = 2;
  readyState = 1; bufferedAmount = 0;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = 3; });
  constructor(public url: URL, public protocols: string[]) { socket = this; }
  message(value: object) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
beforeEach(() => {
  socket = undefined; vi.clearAllMocks();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("window", { location: { href: "https://app.application.test/assistant" } });
  vi.mocked(apiFetch).mockResolvedValue({ ticket: "a".repeat(64) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
async function connect() {
  const controller = new AbortController(), onEvent = vi.fn(), onError = vi.fn();
  const opening = openVoiceActivity(controller.signal, onEvent, onError);
  await vi.waitFor(() => expect(socket).toBeDefined());
  socket!.message({ type: "ready", sampleRate: 16000, frameSamples: 512 });
  return { activity: await opening, controller, onEvent, onError, ws: socket! };
}

test("VAD connects only to the configured application API using a short-lived ticket", async () => {
  const { activity, ws } = await connect();
  expect(apiFetch).toHaveBeenCalledWith("/api/voice/activity/ticket", expect.objectContaining({ method: "POST", cache: "no-store" }));
  expect(ws.url.href).toBe("wss://api.application.test/api/voice/activity");
  expect(ws.url.search).toBe("");
  expect(ws.protocols).toEqual(["sanadi-voice", `ticket.${"a".repeat(64)}`]);
  activity.close();
});

test("server speech and pause events drive activation; normal pause closure is not an error", async () => {
  const { activity, ws, onEvent, onError } = await connect();
  activity.send(new ArrayBuffer(1024));
  ws.message({ type: "activity", sequence: 0, event: "speech" });
  activity.send(new ArrayBuffer(1024));
  ws.message({ type: "activity", sequence: 1, event: "pause" });
  ws.onclose?.();
  expect(onEvent.mock.calls).toEqual([["speech", 512], ["pause", 1024]]);
  expect(onError).not.toHaveBeenCalled();
  expect(ws.close).toHaveBeenCalledOnce();
});

test("out-of-order or unsolicited server decisions are rejected", async () => {
  const { activity, ws, onEvent, onError } = await connect();
  activity.send(new ArrayBuffer(1024));
  ws.message({ type: "activity", sequence: 2, event: "speech" });
  expect(onEvent).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledOnce();
  expect(ws.close).toHaveBeenCalledOnce();
});

test("microphone backlog is bounded when server processing stalls", async () => {
  const { activity, ws, onError } = await connect();
  for (let i = 0; i < 40; i++) activity.send(new ArrayBuffer(1024));
  expect(ws.send).toHaveBeenCalledTimes(32);
  expect(onError).toHaveBeenCalledOnce();
});

test("abort closes the detector and discards late server decisions", async () => {
  const { activity, controller, ws, onEvent, onError } = await connect();
  activity.send(new ArrayBuffer(1024)); controller.abort();
  ws.message({ type: "activity", sequence: 0, event: "speech" });
  expect(onEvent).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
  expect(ws.close).toHaveBeenCalledOnce();
});

test("malformed tickets never open a socket", async () => {
  vi.mocked(apiFetch).mockResolvedValue({ ticket: "untrusted/endpoint" });
  await expect(openVoiceActivity(new AbortController().signal, vi.fn(), vi.fn())).rejects.toThrow("voice_activity_unavailable");
  expect(socket).toBeUndefined();
});

test("a stalled ticket request has a deadline before opening the microphone stream", async () => {
  vi.useFakeTimers();
  vi.mocked(apiFetch).mockImplementation((_path, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  const pending = openVoiceActivity(new AbortController().signal, vi.fn(), vi.fn());
  const checked = expect(pending).rejects.toThrow("voice_activity_unavailable");
  await vi.advanceTimersByTimeAsync(15000);
  await checked;
  expect(socket).toBeUndefined();
});

test("server disconnection reports failure instead of accepting noise locally", async () => {
  const { ws, onError } = await connect();
  ws.onclose?.();
  expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: "voice_activity_unavailable" }));
});

test.each([16000, 44100, 48000])("PCM encoding retains stream continuity at %i Hz without changing input", rate => {
  const input = Float32Array.from({ length: rate }, (_, i) => Math.sin(i * 0.07) * 0.001);
  const original = input.slice();
  const expected = new ActivityPcmEncoder(rate).encode(input);
  const encoder = new ActivityPcmEncoder(rate), actual: ArrayBuffer[] = [];
  for (let i = 0; i < input.length; i += 2048) actual.push(...encoder.encode(input.subarray(i, i + 2048)));
  expect(actual).toEqual(expected);
  expect(actual).toHaveLength(31);
  expect(input).toEqual(original);
  expect(actual.every(frame => frame.byteLength === 1024)).toBe(true);
});

test("PCM keeps quiet samples and uses bounded signed little-endian values", () => {
  const encoder = new ActivityPcmEncoder(16000);
  const input = new Float32Array(512).fill(0.0005); input[0] = -1; input[1] = 1;
  const frame = new DataView(encoder.encode(input)[0]!);
  expect(frame.getInt16(0, true)).toBe(-32768);
  expect(frame.getInt16(2, true)).toBe(32767);
  expect(frame.getInt16(4, true)).toBeGreaterThan(0);
});
