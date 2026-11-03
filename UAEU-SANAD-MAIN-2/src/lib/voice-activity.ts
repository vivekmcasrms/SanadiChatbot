import { apiFetch, apiUrl } from "./auth-token";

export type VoiceActivityEvent = "continue" | "speech" | "pause";
export type VoiceActivity = { send: (pcm: ArrayBuffer) => void; close: () => void };

/** Only transport: the application API classifies speech. No browser model or external service. */
export async function openVoiceActivity(signal: AbortSignal,
  onEvent: (event: VoiceActivityEvent, frameEndSample?: number) => void, onError: (error: Error) => void): Promise<VoiceActivity> {
  signal.throwIfAborted();
  const request = new AbortController();
  const abortRequest = () => request.abort();
  signal.addEventListener("abort", abortRequest, { once: true });
  const deadline = setTimeout(abortRequest, 15000);
  let reply: { ticket: string };
  try {
    reply = await apiFetch<{ ticket: string }>("/api/voice/activity/ticket", {
      method: "POST", cache: "no-store", signal: request.signal,
    });
  } catch {
    signal.throwIfAborted();
    throw new Error("voice_activity_unavailable");
  } finally {
    clearTimeout(deadline); signal.removeEventListener("abort", abortRequest);
  }
  signal.throwIfAborted();
  if (typeof reply?.ticket !== "string" || !/^[a-f0-9]{64}$/i.test(reply.ticket))
    throw new Error("voice_activity_unavailable");
  const url = new URL(apiUrl("/api/voice/activity"), window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url, ["sanadi-voice", `ticket.${reply.ticket}`]);
  return new Promise((resolve, reject) => {
    let ready = false, closed = false, sent = 0, received = 0, lastReply = Date.now();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer); clearInterval(heartbeat);
      signal.removeEventListener("abort", abort);
      if (socket.readyState < WebSocket.CLOSING) socket.close();
    };
    const fail = () => {
      if (closed) return;
      close();
      const error = new Error("voice_activity_unavailable");
      if (ready) onError(error); else reject(error);
    };
    const abort = () => {
      close();
      if (!ready) reject(new DOMException("Interrupted", "AbortError"));
    };
    const timer = setTimeout(fail, 15000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    socket.onerror = fail;
    socket.onclose = () => { if (!closed) fail(); };
    socket.onmessage = message => {
      if (closed) return;
      try {
        if (typeof message.data !== "string" || message.data.length > 1024) { fail(); return; }
        const event = JSON.parse(message.data);
        if (!ready) {
          if (event.type !== "ready" || event.sampleRate !== 16000 || event.frameSamples !== 512) { fail(); return; }
          ready = true; clearTimeout(timer);
          heartbeat = setInterval(() => {
            if (sent > received && Date.now() - lastReply > 5000) fail();
          }, 1000);
          resolve({
            send: pcm => {
              if (closed) return;
              // Bound queued microphone data to about one second; never build an unbounded backlog.
              if (pcm.byteLength !== 1024 || socket.readyState !== WebSocket.OPEN ||
                  socket.bufferedAmount > 32768 || sent - received >= 32) { fail(); return; }
              try { socket.send(pcm); sent++; } catch { fail(); }
            },
            close,
          });
          return;
        }
        if (event.type !== "activity" || event.sequence !== received || received >= sent ||
            !["continue", "speech", "pause"].includes(event.event)) { fail(); return; }
        received++; lastReply = Date.now();
        // A pause is a normal server close, not a dropped connection.
        if (event.event === "pause") close();
        // Capture-relative PCM position, independent of response/network delay.
        onEvent(event.event as VoiceActivityEvent, (event.sequence + 1) * 512);
      } catch { fail(); }
    };
  });
}

/** A separate 16 kHz PCM copy for VAD. Original microphone samples remain untouched for STT. */
export class ActivityPcmEncoder {
  private pending = new Float32Array(0);
  private position = 0;
  private frame = new ArrayBuffer(1024);
  private view = new DataView(this.frame);
  private frameSamples = 0;
  constructor(private readonly inputRate: number) {
    if (!Number.isFinite(inputRate) || inputRate < 8000 || inputRate > 192000)
      throw new Error("voice_activity_unavailable");
  }
  encode(chunk: Float32Array): ArrayBuffer[] {
    const input = new Float32Array(this.pending.length + chunk.length);
    input.set(this.pending); input.set(chunk, this.pending.length);
    const frames: ArrayBuffer[] = [];
    const ratio = this.inputRate / 16000;
    while (true) {
      const start = Math.floor(this.position);
      const end = Math.max(start + 1, Math.floor(this.position + ratio));
      if (end > input.length) break;
      let sum = 0;
      for (let i = start; i < end; i++) sum += input[i]!;
      const value = Math.max(-1, Math.min(1, sum / (end - start)));
      if (!Number.isFinite(value)) throw new Error("voice_activity_unavailable");
      this.view.setInt16(this.frameSamples++ * 2,
        Math.round(value * (value < 0 ? 32768 : 32767)), true);
      this.position += ratio;
      if (this.frameSamples === 512) {
        frames.push(this.frame); this.frame = new ArrayBuffer(1024); this.frameSamples = 0;
        this.view = new DataView(this.frame);
      }
    }
    const consumed = Math.floor(this.position);
    this.pending = input.slice(consumed);
    this.position -= consumed;
    return frames;
  }
}
