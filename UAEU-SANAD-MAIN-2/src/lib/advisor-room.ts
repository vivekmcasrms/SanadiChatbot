import { apiUrl } from "./auth-token";
import { voiceRoomTicket } from "./advisor-ticket";
import type { AgentResponse } from "./agent-types";
import type { AdvisorIdentity, AdvisorLanguage } from "./advisor-client";

type RoomInput = { agent: AdvisorIdentity; conversationId: string | null; introduce: boolean; message?: string; audio?: Blob; browserSpeech?: boolean; language?: AdvisorLanguage };
type RoomEvents = {
  stage: (stage: "transcribing" | "thinking") => void;
  transcript: (text: string, language: AdvisorLanguage) => void;
  result: (response: AgentResponse, language: AdvisorLanguage) => void;
  audio?: (wav: ArrayBuffer, text: string, language: AdvisorLanguage) => Promise<void>;
  speech?: (text: string, language: AdvisorLanguage) => Promise<void>;
};

/** One private turn room. A fresh ticket is required after interruption; never replay a question automatically. */
export async function voiceRoom(input: RoomInput, events: RoomEvents, signal: AbortSignal) {
  if (!input.audio && !input.message?.trim()) throw new Error("message_required");
  const ticket = await voiceRoomTicket(signal, input.browserSpeech);
  if (signal.aborted) throw new DOMException("Interrupted", "AbortError");
  const url = new URL(apiUrl("/api/voice/room"), window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(url, ["sanadi-voice", `ticket.${ticket}`]);
  ws.binaryType = "arraybuffer";
  await new Promise<void>((resolve, reject) => {
    let settled = false, complete = false, received = 0, total = 0;
    let header: { bytes: number; text: string; language: AdvisorLanguage } | null = null;
    let parts: Uint8Array[] = [];
    let queue = Promise.resolve();
    const timer = setTimeout(() => fail(new Error("voice_stream_timeout")), 185000);
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      ws.onmessage = null; ws.onopen = null; ws.onclose = null; ws.onerror = null;
      if (ws.readyState < WebSocket.CLOSING) ws.close();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true; cleanup(); reject(error);
    };
    const abort = () => fail(new DOMException("Interrupted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    ws.onopen = () => {
      ws.send(JSON.stringify({
        agent: input.agent, conversationId: input.conversationId, introduce: input.introduce,
        ...(input.language ? { language: input.language } : {}),
        ...(input.browserSpeech ? { browserSpeech: true } : {}),
        ...(input.message ? { message: input.message } : {}),
      }));
      if (input.audio) ws.send(input.audio);
    };
    ws.onerror = () => fail(new Error("voice_stream_failed"));
    ws.onclose = () => { if (!complete) fail(new Error("voice_stream_disconnected")); };
    ws.onmessage = event => {
      try {
        if (event.data instanceof ArrayBuffer) {
          if (input.browserSpeech) throw new Error("voice_browser_protocol_required");
          if (!header || complete) throw new Error("invalid_voice_audio");
          const bytes = new Uint8Array(event.data);
          received += bytes.byteLength; total += bytes.byteLength;
          if (received > header.bytes || total > 48_000_000) throw new Error("invalid_voice_audio");
          parts.push(bytes);
          if (received === header.bytes) {
            const wav = new Uint8Array(received);
            let offset = 0;
            for (const part of parts) { wav.set(part, offset); offset += part.length; }
            const chunk = header;
            header = null; parts = []; received = 0;
            queue = queue.then(async () => {
              if (signal.aborted || settled) return;
              if (!events.audio) throw new Error("invalid_voice_audio");
              await events.audio(wav.buffer, chunk.text, chunk.language);
            });
            void queue.catch(fail);
          }
          return;
        }
        const message = JSON.parse(String(event.data));
        if (message.type === "error") { fail(new Error(message.error ?? "voice_stream_failed")); return; }
        if (message.type === "stage") events.stage(message.stage);
        else if (message.type === "transcript") events.transcript(message.text, message.language);
        else if (message.type === "result") events.result(message.response, message.language);
        else if (message.type === "speech") {
          if (!input.browserSpeech || !events.speech || complete || typeof message.text !== "string"
            || !message.text.trim() || message.text.length > 6000
            || !["ar", "en"].includes(message.language) || message.agent !== input.agent)
            throw new Error("invalid_voice_speech");
          queue = queue.then(async () => {
            if (signal.aborted || settled) return;
            await events.speech!(message.text, message.language);
          });
          void queue.catch(fail);
        }
        else if (message.type === "audio") {
          if (input.browserSpeech) throw new Error("voice_browser_protocol_required");
          if (header || !Number.isInteger(message.bytes) || message.bytes < 44 || message.bytes > 24_000_000 ||
            !["ar", "en"].includes(message.language)) throw new Error("invalid_voice_audio");
          header = message;
        } else if (message.type === "done") {
          if (header) throw new Error("incomplete_voice_audio");
          complete = true;
          void queue.then(() => {
            if (settled) return;
            settled = true; cleanup(); resolve();
          }, fail);
        }
      } catch (error) { fail(error); }
    };
  });
}
