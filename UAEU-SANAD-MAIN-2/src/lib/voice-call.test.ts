import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { openVoiceCall, finishVoiceTurn } from "./voice-call";

vi.mock("./auth-token", () => ({ apiUrl: (path: string) => `http://localhost:5281${path}` }));
vi.mock("./advisor-ticket", () => ({ voiceRoomTicket: vi.fn(async () => "ab".repeat(32)) }));
class Socket {
  static OPEN = 1; static CLOSING = 2; static last: Socket;
  readyState = 1;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: Record<string, unknown>[] = [];
  constructor() { Socket.last = this; }
  send(message: string) { this.sent.push(JSON.parse(message)); }
  close() { this.readyState = 3; this.onclose?.(); }
  message(message: object) { this.onmessage?.({ data: JSON.stringify(message) }); }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { location: { href: "http://localhost:8080" } });
  vi.stubGlobal("WebSocket", Socket);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test.each(["en", "ar"] as const)("starts a %s welcome without sending a fake question or conversation", async language => {
  const events = vi.fn(), disconnect = vi.fn();
  const opening = openVoiceCall(new AbortController().signal, events, disconnect);
  await Promise.resolve();
  Socket.last.message({ type: "ready", audio: "wav" });
  const call = await opening, socket = Socket.last;
  call.greet({ turnId: "welcome", agent: "mira", language });
  expect(socket.sent).toEqual([{ type: "greet", turnId: "welcome", agent: "mira", language }]);
  socket.message({ type: "audio", turnId: "welcome", agent: "mira", language, sequence: 0, bytes: 48, text: "Welcome" });
  socket.onmessage?.({ data: new ArrayBuffer(48) });
  call.played("welcome", 0);
  socket.message({ type: "done", turnId: "welcome", endCall: false });
  expect(events.mock.calls.map(([event]) => event.type)).toEqual(["audio", "done"]);
  expect(disconnect).not.toHaveBeenCalled();
  expect(socket.readyState).toBe(Socket.OPEN);
  call.end();
});

test("language switches travel with each turn without closing the call", async () => {
  const opening = openVoiceCall(new AbortController().signal, vi.fn(), vi.fn());
  await Promise.resolve();
  Socket.last.message({ type: "ready", audio: "wav" });
  const call = await opening, socket = Socket.last;
  const input = { agent: "mira" as const, conversationId: null, introduce: false };
  call.turn({ ...input, turnId: "english", message: "Hello", language: "en" });
  call.interrupt("english");
  call.turn({ ...input, turnId: "arabic", message: "مرحبا", language: "ar" });
  expect(socket.sent.filter(event => event.type === "turn").map(event => event.language)).toEqual(["en", "ar"]);
  expect(socket.readyState).toBe(Socket.OPEN);
  call.end();
});

test("two turns and interruption share one connection; End Call closes it and ignores late frames", async () => {
  const events = vi.fn(), disconnect = vi.fn();
  const opening = openVoiceCall(new AbortController().signal, events, disconnect);
  await Promise.resolve();
  Socket.last.message({ type: "ready", audio: "wav" });
  const call = await opening, socket = Socket.last;
  const input = { agent: "mira" as const, conversationId: null, introduce: false, message: "Hello" };
  call.turn({ ...input, turnId: "first" });
  socket.message({ type: "done", turnId: "first" });
  expect(socket.readyState).toBe(Socket.OPEN);
  call.turn({ ...input, turnId: "second" });
  call.interrupt("second");
  expect(socket.readyState).toBe(Socket.OPEN);
  expect(socket.sent.map(e => e.type)).toEqual(["turn", "turn", "interrupt"]);
  call.end();
  expect(socket.sent.at(-1)?.type).toBe("end");
  expect(socket.readyState).toBe(3);
  socket.message({ type: "done", turnId: "second" });
  expect(events).toHaveBeenCalledTimes(1);
  expect(disconnect).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("connection failure retains its useful error instead of becoming a silent abort", async () => {
  const result = expect(openVoiceCall(new AbortController().signal, vi.fn(), vi.fn()))
    .rejects.toThrow("voice_call_disconnected");
  await Promise.resolve();
  Socket.last.onerror?.();
  await result;
});

test("idle call heartbeat stays alive and cleans up when cancelled", async () => {
  const controller = new AbortController(), disconnect = vi.fn();
  const opening = openVoiceCall(controller.signal, vi.fn(), disconnect);
  await Promise.resolve();
  Socket.last.message({ type: "ready", audio: "wav" });
  await opening;
  for (let i = 0; i < 4; i++) {
    await vi.advanceTimersByTimeAsync(25000);
    expect(Socket.last.sent.at(-1)?.type).toBe("ping");
    Socket.last.message({ type: "pong" });
  }
  expect(disconnect).not.toHaveBeenCalled();
  controller.abort();
  expect(Socket.last.readyState).toBe(3);
  expect(vi.getTimerCount()).toBe(0);
});

test("lost connection ends once without replaying the user's question", async () => {
  const disconnect = vi.fn();
  const opening = openVoiceCall(new AbortController().signal, vi.fn(), disconnect);
  await Promise.resolve();
  Socket.last.message({ type: "ready", audio: "wav" });
  const call = await opening;
  call.turn({ turnId: "one", agent: "suhail", conversationId: null, introduce: true, message: "Hello" });
  await vi.advanceTimersByTimeAsync(75000);
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(Socket.last.sent.filter(e => e.type === "turn")).toHaveLength(1);
  expect(Socket.last.readyState).toBe(3);
});

const audioHeader = (turnId: string, sequence = 0) => ({
  type: "audio", turnId, sequence, bytes: 48, text: "مرحباً بك.", language: "ar", agent: "mira",
});

test("validated speech timing accompanies audio while the text result stays unchanged", async () => {
  const events = vi.fn(), disconnect = vi.fn();
  const opening = openVoiceCall(new AbortController().signal, events, disconnect);
  await Promise.resolve(); Socket.last.message({ type: "ready", audio: "wav" });
  const call = await opening;
  call.turn({ turnId: "reply", agent: "mira", language: "ar", message: "سؤالي", conversationId: null, introduce: false });
  const response = { answer: "الإجابة الأصلية", proposedActions: [], citations: [] };
  Socket.last.message({ type: "result", turnId: "reply", language: "ar", response });
  Socket.last.message({ ...audioHeader("reply"), pauseBeforeMs: 800, rate: .98 });
  Socket.last.onmessage?.({ data: new ArrayBuffer(48) });
  expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: "result", response }));
  expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: "audio", pauseBeforeMs: 800, rate: .98 }));
  expect(disconnect).not.toHaveBeenCalled(); call.end();
});

test.each([{ pauseBeforeMs: -1 }, { pauseBeforeMs: 1001 }, { pauseBeforeMs: "500" }, { rate: 0 }, { rate: 2 }])(
  "rejects out-of-range speech delivery metadata %j", async delivery => {
    const events = vi.fn(), disconnect = vi.fn();
    const opening = openVoiceCall(new AbortController().signal, events, disconnect);
    await Promise.resolve(); Socket.last.message({ type: "ready", audio: "wav" });
    const call = await opening;
    call.turn({ turnId: "reply", agent: "mira", language: "ar", message: "سؤالي", conversationId: null, introduce: false });
    Socket.last.message({ ...audioHeader("reply"), ...delivery });
    expect(disconnect).toHaveBeenCalledWith(expect.objectContaining({ message: "invalid_voice_audio" }));
    expect(events).not.toHaveBeenCalled();
  });

test.each([
  { selected: "en", reply: "ar", message: "ما هي حالتي الأكاديمية؟" },
  { selected: "ar", reply: "en", message: "What is my academic status?" },
] as const)("plays the server-confirmed $reply reply with $selected selected", async ({ selected, reply, message }) => {
  const events = vi.fn(), disconnect = vi.fn();
  const opening = openVoiceCall(new AbortController().signal, events, disconnect);
  await Promise.resolve();
  Socket.last.message({ type: "ready", audio: "wav" });
  const call = await opening, socket = Socket.last;
  call.turn({ turnId: "current", agent: "mira", language: selected, message,
    conversationId: null, introduce: false });
  socket.message({ type: "transcript", turnId: "current", text: message, language: reply });
  socket.message({ type: "result", turnId: "current", response: { answer: message }, language: reply });
  socket.message({ ...audioHeader("current"), language: reply });
  const wav = new ArrayBuffer(48);
  socket.onmessage?.({ data: wav });
  expect(disconnect).not.toHaveBeenCalled();
  call.played("current", 0);
  socket.message({ type: "done", turnId: "current" });

  expect(disconnect).not.toHaveBeenCalled();
  expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: "audio", language: reply, wav }));
  expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: "done" }));
  expect(socket.sent.at(-1)).toEqual({ type: "played", turnId: "current", sequence: 0 });
  expect(socket.readyState).toBe(Socket.OPEN);
  call.end();
});

test("a stale transcript cannot relabel the current turn's audio", async () => {
  const events = vi.fn(), disconnect = vi.fn();
  const opening = openVoiceCall(new AbortController().signal, events, disconnect);
  await Promise.resolve();
  Socket.last.message({ type: "ready", audio: "wav" });
  const call = await opening, socket = Socket.last;
  const input = { agent: "mira" as const, language: "en" as const, message: "Hello", conversationId: null, introduce: false };
  call.turn({ ...input, turnId: "old" });
  call.interrupt("old");
  call.turn({ ...input, turnId: "new" });
  socket.message({ type: "transcript", turnId: "old", text: "مرحبا", language: "ar" });
  socket.message({ ...audioHeader("new"), language: "en" });
  socket.onmessage?.({ data: new ArrayBuffer(48) });
  expect(events).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "audio", turnId: "new", language: "en" }));
  expect(disconnect).not.toHaveBeenCalled();
  call.end();
});

test.each(["en", "unsupported"])("rejects %s when it contradicts the confirmed reply language", async language => {
  const events = vi.fn(), disconnect = vi.fn();
  const opening = openVoiceCall(new AbortController().signal, events, disconnect);
  await Promise.resolve();
  Socket.last.message({ type: "ready", audio: "wav" });
  const call = await opening, socket = Socket.last;
  call.turn({ turnId: "current", agent: "mira", language: "en", message: "مرحبا", conversationId: null, introduce: false });
  socket.message({ type: "transcript", turnId: "current", text: "مرحبا", language: "ar" });
  socket.message({ type: "transcript", turnId: "current", text: "مرحبا", language });
  expect(disconnect).toHaveBeenCalledWith(expect.objectContaining({ message: "invalid_voice_message" }));
  expect(events).toHaveBeenCalledTimes(1);
});

test.each([
  { agent: "suhail", language: "ar" },
  { agent: "mira", language: "en" },
])("rejects audio with a different selection: $agent/$language", async selection => {
  const events = vi.fn(), disconnect = vi.fn();
  const opening = openVoiceCall(new AbortController().signal, events, disconnect);
  await Promise.resolve();
  Socket.last.message({ type: "ready", audio: "wav" });
  const call = await opening, socket = Socket.last;
  call.turn({ turnId: "selected", agent: "mira", language: "ar", message: "مرحبا",
    conversationId: null, introduce: false });
  socket.message({ ...audioHeader("selected"), ...selection });
  socket.onmessage?.({ data: new ArrayBuffer(48) });
  expect(events).not.toHaveBeenCalled();
  expect(disconnect).toHaveBeenCalledWith(expect.objectContaining({ message: "invalid_voice_audio" }));
});

test("agent and language switches discard old audio while accepting the new selection on one socket", async () => {
  const events = vi.fn(), disconnect = vi.fn();
  const opening = openVoiceCall(new AbortController().signal, events, disconnect);
  await Promise.resolve();
  Socket.last.message({ type: "ready", audio: "wav" });
  const call = await opening, socket = Socket.last;
  const selections = [
    { agent: "mira", language: "ar" }, { agent: "suhail", language: "ar" },
    { agent: "suhail", language: "en" }, { agent: "mira", language: "en" },
    { agent: "mira", language: "ar" },
  ] as const;
  for (const [index, selection] of selections.entries()) {
    const turnId = String(index);
    call.turn({ turnId, ...selection, message: "Hello", conversationId: null, introduce: false });
    if (index) socket.onmessage?.({ data: new ArrayBuffer(48) }); // Old header's trailing binary.
    socket.message({ ...audioHeader(turnId), ...selection });
    socket.onmessage?.({ data: new ArrayBuffer(48) });
    call.played(turnId, 0);
    expect(events).toHaveBeenCalledTimes(index + 1);
    expect(events.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ turnId, ...selection }));
    socket.message({ ...audioHeader(turnId, 1), ...selection });
    call.interrupt(turnId);
    expect(socket.readyState).toBe(Socket.OPEN);
  }
  expect(disconnect).not.toHaveBeenCalled();
  call.end();
});

test.each(["en", "ar"])("%s farewell closes the socket only after every audio chunk finishes", async language => {
  const disconnect = vi.fn(), listen = vi.fn();
  let complete!: Promise<void>;
  let finishFirst!: () => void, finishLast!: () => void;
  const playback = Promise.all([
    new Promise<void>(resolve => { finishFirst = resolve; }),
    new Promise<void>(resolve => { finishLast = resolve; }),
  ]).then(() => {});
  const opening = openVoiceCall(new AbortController().signal, event => {
    if (event.type === "done") complete = finishVoiceTurn(playback, () => true, event.endCall, () => call.end(), listen);
  }, disconnect);
  await Promise.resolve();
  Socket.last.message({ type: "ready", audio: "wav" });
  const call = await opening, socket = Socket.last;
  call.turn({ turnId: "thanks", agent: "mira", language: language as "en" | "ar",
    message: language === "en" ? "Thank you" : "شكرا", conversationId: "existing", introduce: false });
  socket.message({ type: "done", turnId: "thanks", endCall: true });
  await Promise.resolve();
  expect(socket.readyState).toBe(Socket.OPEN);
  finishFirst(); await Promise.resolve();
  expect(socket.readyState).toBe(Socket.OPEN);
  finishLast(); await complete;
  expect(socket.sent.at(-1)).toEqual({ type: "end" });
  expect(socket.readyState).toBe(3);
  expect(listen).not.toHaveBeenCalled();
  expect(disconnect).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test.each(["en", "ar"] as const)("forwards the %s closing result before audio without closing the socket early", async language => {
  const events = vi.fn(), disconnect = vi.fn();
  const opening = openVoiceCall(new AbortController().signal, events, disconnect);
  await Promise.resolve();
  Socket.last.message({ type: "ready", audio: "wav" });
  const call = await opening, socket = Socket.last;
  call.turn({ turnId: "thanks", agent: "mira", language, message: language === "en" ? "Thank you" : "شكراً",
    conversationId: "existing", introduce: false });
  const response = { answer: language === "en" ? "You're welcome!" : "العفو!", conversationId: "existing" };
  socket.message({ type: "result", turnId: "thanks", language, response, endCall: true });
  expect(events).toHaveBeenCalledExactlyOnceWith({ type: "result", turnId: "thanks", language, response, endCall: true });
  expect(socket.readyState).toBe(Socket.OPEN);
  expect(socket.sent.some(event => event.type === "end")).toBe(false);
  expect(disconnect).not.toHaveBeenCalled();
  call.end();
});

test("interrupting a farewell discards its pending automatic hang-up", async () => {
  const end = vi.fn(), listen = vi.fn();
  let current = true, played!: () => void;
  const playback = new Promise<void>(resolve => { played = resolve; });
  const completion = finishVoiceTurn(playback, () => current, true, end, listen);
  current = false; // User speech begins a new turn; old queued audio is stopped.
  played(); await completion;
  expect(end).not.toHaveBeenCalled();
  expect(listen).not.toHaveBeenCalled();
});

test("normal replies return to listening after playback and never hang up", async () => {
  const end = vi.fn(), listen = vi.fn();
  await finishVoiceTurn(Promise.resolve(), () => true, false, end, listen);
  expect(listen).toHaveBeenCalledTimes(1);
  expect(end).not.toHaveBeenCalled();
});

test("failed farewell playback does not silently end a call", async () => {
  const end = vi.fn(), listen = vi.fn();
  await expect(finishVoiceTurn(Promise.reject(new Error("audio failed")), () => true, true, end, listen))
    .rejects.toThrow("audio failed");
  expect(end).not.toHaveBeenCalled();
  expect(listen).not.toHaveBeenCalled();
});

test("complete WAV frames carry the question language and identity; playback acknowledgements keep the socket open", async () => {
  const events = vi.fn(), disconnect = vi.fn();
  const opening = openVoiceCall(new AbortController().signal, events, disconnect);
  await Promise.resolve();
  Socket.last.message({ type: "ready", audio: "wav" });
  const call = await opening, socket = Socket.last;
  call.turn({ turnId: "one", agent: "mira", conversationId: null, introduce: true, message: "مرحبا" });
  socket.message(audioHeader("one"));
  expect(events).not.toHaveBeenCalled();
  const wav = new ArrayBuffer(48);
  socket.onmessage?.({ data: wav });
  expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: "audio", language: "ar", agent: "mira", wav }));
  call.played("one", 0);
  expect(socket.sent.at(-1)).toEqual({ type: "played", turnId: "one", sequence: 0 });
  socket.message({ type: "done", turnId: "one" });
  expect(socket.readyState).toBe(Socket.OPEN);
  expect(disconnect).not.toHaveBeenCalled();
  call.end();
});

test("late cancelled WAV is discarded even when its header arrived before interruption", async () => {
  const events = vi.fn(), disconnect = vi.fn();
  const opening = openVoiceCall(new AbortController().signal, events, disconnect);
  await Promise.resolve();
  Socket.last.message({ type: "ready", audio: "wav" });
  const call = await opening, socket = Socket.last;
  const input = { agent: "mira" as const, conversationId: null, introduce: false, message: "Hello" };
  call.turn({ ...input, turnId: "old" });
  socket.message(audioHeader("old"));
  call.interrupt("old");
  call.turn({ ...input, turnId: "new" });
  socket.onmessage?.({ data: new ArrayBuffer(48) });
  call.played("old", 0);
  expect(events).not.toHaveBeenCalled();
  expect(socket.sent.some(e => e.type === "played")).toBe(false);
  socket.message(audioHeader("new"));
  socket.onmessage?.({ data: new ArrayBuffer(48) });
  expect(events).toHaveBeenCalledTimes(1);
  expect(events.mock.calls[0][0].turnId).toBe("new");
  expect(disconnect).not.toHaveBeenCalled();
  call.end();
});

test("truncated WAV fails without playing partial audio", async () => {
  const events = vi.fn(), disconnect = vi.fn();
  const opening = openVoiceCall(new AbortController().signal, events, disconnect);
  await Promise.resolve();
  Socket.last.message({ type: "ready", audio: "wav" });
  const call = await opening, socket = Socket.last;
  call.turn({ turnId: "one", agent: "mira", conversationId: null, introduce: false, message: "Hello" });
  socket.message(audioHeader("one"));
  socket.onmessage?.({ data: new ArrayBuffer(46) });
  expect(disconnect).toHaveBeenCalledWith(expect.objectContaining({ message: "invalid_voice_audio" }));
  expect(events).not.toHaveBeenCalled();
  expect(socket.readyState).toBe(3);
});

test("an old API requesting browser TTS is rejected instead of mixing playback pipelines", async () => {
  const opening = openVoiceCall(new AbortController().signal, vi.fn(), vi.fn());
  const failure = expect(opening).rejects.toThrow("voice_audio_protocol_required");
  await Promise.resolve();
  Socket.last.message({ type: "ready" });
  await failure;
});
