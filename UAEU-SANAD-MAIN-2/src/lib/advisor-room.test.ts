import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { voiceRoom } from "./advisor-room";
import { voiceRoomTicket } from "./advisor-ticket";

vi.mock("./auth-token", () => ({ apiUrl: (path: string) => `http://localhost:5281${path}` }));
vi.mock("./advisor-ticket", () => ({ voiceRoomTicket: vi.fn(async () => "ab".repeat(32)) }));
class Socket {
  static CLOSING = 2;
  static last: Socket;
  readyState = 1; binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor() { Socket.last = this; }
  send(message: string) { this.sent.push(message); }
  close() { this.readyState = 3; this.onclose?.(); }
  message(message: object) { this.onmessage?.({ data: JSON.stringify(message) }); }
}
const input = { agent: "mira" as const, conversationId: null, introduce: false, message: "ما هو معدلي؟", browserSpeech: true };
const events = () => ({ stage: vi.fn(), transcript: vi.fn(), result: vi.fn(), speech: vi.fn(async () => {}) });
beforeEach(() => {
  vi.stubGlobal("window", { location: { href: "http://localhost:8080" } });
  vi.stubGlobal("WebSocket", Socket);
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

test.each(["en", "ar"] as const)("voice room passes selected %s language in its start frame", async language => {
  const room = voiceRoom({ ...input, language }, events(), new AbortController().signal);
  await Promise.resolve();
  Socket.last.onopen?.();
  expect(JSON.parse(Socket.last.sent[0])).toMatchObject({ language });
  Socket.last.message({ type: "done" });
  await room;
});

test("browser mode requests no server audio and drains queued speech after the socket completes", async () => {
  const callbacks = events();
  let finishFirst!: () => void;
  callbacks.speech.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
  let finished = false;
  const room = voiceRoom(input, callbacks, new AbortController().signal).then(() => { finished = true; });
  await Promise.resolve();
  const socket = Socket.last;
  socket.onopen?.();
  expect(voiceRoomTicket).toHaveBeenCalledWith(expect.any(AbortSignal), true);
  expect(JSON.parse(socket.sent[0])).toMatchObject({ browserSpeech: true, message: input.message });
  socket.message({ type: "speech", text: "أهلاً.", language: "ar", agent: "mira" });
  socket.message({ type: "speech", text: "كيف أساعدك؟", language: "ar", agent: "mira" });
  socket.message({ type: "done" });
  socket.onclose?.();
  await Promise.resolve();
  expect(callbacks.speech).toHaveBeenCalledTimes(1);
  expect(finished).toBe(false);
  finishFirst();
  await room;
  expect(callbacks.speech.mock.calls).toEqual([["أهلاً.", "ar"], ["كيف أساعدك؟", "ar"]]);
});

test("a stale API sending audio cannot start a duplicate speech pipeline", async () => {
  const callbacks = events();
  const result = expect(voiceRoom(input, callbacks, new AbortController().signal))
    .rejects.toThrow("voice_browser_protocol_required");
  await Promise.resolve();
  Socket.last.message({ type: "audio", bytes: 100, text: "Hello.", language: "en" });
  await result;
  expect(callbacks.speech).not.toHaveBeenCalled();
});

test("interruption discards queued speech even after the server has sent done", async () => {
  const callbacks = events(), turn = new AbortController();
  let release!: () => void;
  callbacks.speech.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const result = expect(voiceRoom(input, callbacks, turn.signal)).rejects.toMatchObject({ name: "AbortError" });
  await Promise.resolve();
  Socket.last.message({ type: "speech", text: "First.", language: "en", agent: "mira" });
  Socket.last.message({ type: "speech", text: "Stale.", language: "en", agent: "mira" });
  Socket.last.message({ type: "done" });
  await Promise.resolve();
  turn.abort();
  release();
  await result;
  expect(callbacks.speech).toHaveBeenCalledTimes(1);
});
