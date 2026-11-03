import { apiUrl } from "./auth-token";
import { voiceRoomTicket } from "./advisor-ticket";
import type { AdvisorIdentity, AdvisorLanguage } from "./advisor-client";
import type { AgentResponse, WorkingAgent } from "./agent-types";

export type CallEvent =
  | { type: "transcript"; turnId: string; text: string; language: AdvisorLanguage }
  | { type: "stage"; turnId: string; stage: string; agent?: WorkingAgent }
  | { type: "audio"; turnId: string; sequence: number; wav: ArrayBuffer; text: string; language: AdvisorLanguage; agent: AdvisorIdentity;
      pauseBeforeMs?: number; rate?: number }
  | { type: "result"; turnId: string; response: AgentResponse; language: AdvisorLanguage; endCall?: boolean }
  | { type: "done"; turnId: string; endCall?: boolean }
  | { type: "error"; turnId: string; error: string };
export type VoiceCall = {
  greet: (input: { turnId: string; agent: AdvisorIdentity; language: AdvisorLanguage }) => void;
  turn: (input: { turnId: string; message: string; agent: AdvisorIdentity; language?: AdvisorLanguage; conversationId: string | null; introduce: boolean }) => void;
  interrupt: (turnId: string) => void;
  played: (turnId: string, sequence: number) => void;
  end: () => void;
};

/** A farewell must finish playing, and an interrupted farewell must never close a newer turn. */
export async function finishVoiceTurn(playback: Promise<void>, isCurrent: () => boolean,
  endCall: boolean | undefined, end: () => void, listen: () => void): Promise<void> {
  await playback;
  if (!isCurrent()) return;
  if (endCall === true) end(); else listen();
}

export async function openVoiceCall(signal: AbortSignal, onEvent: (event: CallEvent) => void,
  onDisconnect: (error: Error) => void): Promise<VoiceCall> {
  const ticket = await voiceRoomTicket(signal, false, true);
  signal.throwIfAborted();
  const url = new URL(apiUrl("/api/voice/call"), window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url, ["sanadi-voice", `ticket.${ticket}`]);
  socket.binaryType = "arraybuffer";
  return new Promise((resolve, reject) => {
    let ready = false, closed = false;
    let header: (Omit<Extract<CallEvent, { type: "audio" }>, "wav"> & { bytes: number }) | null = null;
    let activeTurn: { turnId: string; agent: AdvisorIdentity; language: AdvisorLanguage | undefined;
      replyLanguage?: AdvisorLanguage } | null = null;
    let nextSequence = 0;
    let lastReceived = Date.now();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const timer = setTimeout(() => fail(new Error("voice_call_unavailable")), 15000);
    const close = () => {
      if (closed) return;
      closed = true;
      header = null;
      clearTimeout(timer);
      clearInterval(heartbeat);
      signal.removeEventListener("abort", abort);
      if (socket.readyState < WebSocket.CLOSING) socket.close();
    };
    const end = () => {
      if (closed) return;
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "end" }));
      close();
      if (!ready) reject(new DOMException("Interrupted", "AbortError"));
    };
    const abort = () => end();
    const fail = (error: Error) => {
      if (closed) return;
      const wasReady = ready;
      close();
      if (wasReady) onDisconnect(error); else reject(error);
    };
    const send = (value: object) => {
      if (closed || socket.readyState !== WebSocket.OPEN) throw new Error("voice_call_disconnected");
      socket.send(JSON.stringify(value));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    socket.onerror = () => fail(new Error("voice_call_disconnected"));
    socket.onclose = () => { if (!closed) fail(new Error("voice_call_disconnected")); };
    socket.onmessage = frame => {
      if (closed) return;
      try {
        lastReceived = Date.now();
        if (frame.data instanceof ArrayBuffer) {
          const audio = header;
          header = null;
          if (!audio || frame.data.byteLength !== audio.bytes) throw new Error("invalid_voice_audio");
          // A cancelled turn's last frame can arrive after the new question starts.
          if (audio.turnId !== activeTurn?.turnId) return;
          const expectedLanguage = activeTurn.replyLanguage ?? activeTurn.language;
          if (audio.agent !== activeTurn.agent || (expectedLanguage && audio.language !== expectedLanguage))
            throw new Error("invalid_voice_audio");
          if (audio.sequence !== nextSequence++) throw new Error("invalid_voice_audio");
          onEvent({ ...audio, wav: frame.data });
          return;
        }
        if (typeof frame.data !== "string" || header) throw new Error("invalid_voice_message");
        const event = JSON.parse(frame.data);
        if (!ready && event.type === "ready") {
          if (event.audio !== "wav") throw new Error("voice_audio_protocol_required");
          ready = true; clearTimeout(timer);
          heartbeat = setInterval(() => {
            if (Date.now() - lastReceived > 60000) { fail(new Error("voice_call_disconnected")); return; }
            try { send({ type: "ping" }); } catch (error) { fail(error as Error); }
          }, 25000);
          resolve({
            greet: input => {
              activeTurn = { turnId: input.turnId, agent: input.agent, language: input.language };
              nextSequence = 0;
              send({ type: "greet", ...input });
            },
            turn: input => {
              // Snapshot the input preference; the shared backend confirms the reply language.
              activeTurn = { turnId: input.turnId, agent: input.agent, language: input.language };
              nextSequence = 0;
              send({ type: "turn", ...input });
            },
            interrupt: turnId => {
              if (activeTurn?.turnId === turnId) activeTurn = null;
              send({ type: "interrupt", turnId });
            },
            played: (turnId, sequence) => { if (turnId === activeTurn?.turnId) send({ type: "played", turnId, sequence }); },
            end,
          });
          return;
        }
        if (ready && event.type === "pong") return;
        if (!ready || typeof event.turnId !== "string") throw new Error("invalid_voice_message");
        if (!["transcript", "stage", "audio", "result", "done", "error"].includes(event.type))
          throw new Error("invalid_voice_message");
        if (event.type === "audio") {
          if (typeof event.text !== "string" || !event.text.trim() || event.text.length > 6000
            || !["en", "ar"].includes(event.language) || !["mira", "suhail"].includes(event.agent)
            || !Number.isSafeInteger(event.sequence) || event.sequence < 0
            || (event.pauseBeforeMs !== undefined && (!Number.isSafeInteger(event.pauseBeforeMs) || event.pauseBeforeMs < 0 || event.pauseBeforeMs > 1000))
            || (event.rate !== undefined && (!Number.isFinite(event.rate) || event.rate < .98 || event.rate > 1.02))
            || !Number.isSafeInteger(event.bytes) || event.bytes <= 44 || event.bytes > 8_000_000)
            throw new Error("invalid_voice_audio");
          header = event;
          return;
        }
        if (!activeTurn || event.turnId !== activeTurn.turnId) return;
        if (event.type === "transcript") {
          if (typeof event.text !== "string" || !["en", "ar"].includes(event.language)
            || (activeTurn.replyLanguage && activeTurn.replyLanguage !== event.language)
            || (nextSequence > 0 && !activeTurn.replyLanguage && activeTurn.language && activeTurn.language !== event.language))
            throw new Error("invalid_voice_message");
          // Accept the text pipeline's language decision once, only for the current turn.
          activeTurn.replyLanguage = event.language;
        }
        onEvent(event as CallEvent);
      } catch (error) { fail(error as Error); }
    };
  });
}
