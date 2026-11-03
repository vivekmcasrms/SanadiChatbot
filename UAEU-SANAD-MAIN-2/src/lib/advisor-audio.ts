/** Endpointing operates only during an explicitly requested microphone turn. */
export class UtteranceGate {
  private voicedMs = 0;
  private silenceMs = 0;
  private totalMs = 0;
  update(rms: number, milliseconds: number): "continue" | "complete" | "empty" {
    this.totalMs += milliseconds;
    if (rms >= 0.015) {
      this.voicedMs += milliseconds;
      this.silenceMs = 0;
    } else this.silenceMs += milliseconds;
    if (this.voicedMs >= 250 && this.silenceMs >= 900) return "complete";
    if (this.totalMs >= 10_000 && this.voicedMs < 250) return "empty";
    return this.totalMs >= 45_000 ? "complete" : "continue";
  }
  get hasSpeech() { return this.voicedMs >= 250; }
}

/** Complete 16 kHz mono PCM WAV; no truncated MediaRecorder container fragments. */
export function questionWav(chunks: Float32Array[], inputRate: number): Blob {
  const input = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.length; }
  const ratio = inputRate / 16000;
  const count = Math.floor(input.length / ratio);
  const data = new ArrayBuffer(44 + count * 2);
  const view = new DataView(data);
  const write = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  write(0, "RIFF"); view.setUint32(4, data.byteLength - 8, true); write(8, "WAVE");
  write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j] ?? 0;
    const value = Math.max(-1, Math.min(1, sum / (end - start)));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return new Blob([data], { type: "audio/wav" });
}

const loaded = new WeakSet<AudioContext>();

export function recordQuestion(context: AudioContext, signal: AbortSignal, onLevel: (level: number) => void,
  onStarted: () => void): { audio: Promise<Blob | null>; finish: () => void } {
  let finish = () => {};
  const audio = new Promise<Blob | null>((resolve, reject) => {
    let stream: MediaStream | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let processor: AudioWorkletNode | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const chunks: Float32Array[] = [];
    const gate = new UtteranceGate();
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (processor) { processor.port.onmessage = null; processor.disconnect(); }
      source?.disconnect();
      stream?.getTracks().forEach(track => track.stop());
      onLevel(0);
    };
    const end = (error?: unknown) => {
      if (done) return;
      done = true;
      cleanup();
      if (error) reject(error);
      else resolve(gate.hasSpeech ? questionWav(chunks, context.sampleRate) : null);
      chunks.length = 0;
    };
    const abort = () => end(new DOMException("Interrupted", "AbortError"));
    finish = () => end();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia || !context.audioWorklet)
          throw new Error("microphone_not_supported");
        // No capture while loading code. Cancelled permission requests never retain a mic.
        if (!loaded.has(context)) {
          await context.audioWorklet.addModule("/advisor-recorder.js");
          loaded.add(context);
        }
        if (done) return;
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (done) { stream.getTracks().forEach(track => track.stop()); return; }
        source = context.createMediaStreamSource(stream);
        processor = new AudioWorkletNode(context, "advisor-recorder");
        processor.port.onmessage = (event: MessageEvent<Float32Array>) => {
          if (done) return;
          const samples = event.data;
          chunks.push(samples);
          const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
          onLevel(Math.min(1, rms * 12));
          const decision = gate.update(rms, samples.length * 1000 / context.sampleRate);
          if (decision !== "continue") end();
        };
        source.connect(processor);
        processor.connect(context.destination); // Worklet produces silence.
        timer = setTimeout(() => end(), 46_000);
        onStarted();
      } catch (error) { end(error); }
    })();
  });
  return { audio, finish: () => finish() };
}

/** A generation barrier prevents late ASR/agent/TTS responses from speaking after interruption. */
export class VoiceTurns {
  private current: AbortController | null = null;
  begin(): AbortController {
    this.cancel();
    return this.current = new AbortController();
  }
  cancel() { this.current?.abort(); this.current = null; }
  isCurrent(turn: AbortController) { return this.current === turn && !turn.signal.aborted; }
}
