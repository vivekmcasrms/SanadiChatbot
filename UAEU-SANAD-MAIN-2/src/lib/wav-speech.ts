import { observeVoiceSpectrum, type VoiceSpectrum } from "./voice-spectrum";

/** Decode the next complete sentence while the previous one plays. No browser TTS fallback. */
export class WavSpeech {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private decoding = Promise.resolve();
  private generation = 0;
  private scheduledUntil = 0;
  private muted = false;
  private pending = new Set<() => void>();
  private meter: VoiceSpectrum | null = null;

  get spectrum() { return this.meter; }

  observe(stream: MediaStream) {
    this.meter?.close();
    this.meter = this.context && this.gain ? observeVoiceSpectrum(this.context, this.gain, stream) : null;
  }

  async prepare() {
    const Constructor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) throw new Error("voice_audio_unsupported");
    if (!this.context || this.context.state === "closed") {
      this.context = new Constructor({ latencyHint: "interactive" });
      this.gain = this.context.createGain();
      this.gain.gain.value = this.muted ? 0 : 1;
      this.gain.connect(this.context.destination);
    }
    await this.context.resume();
    if (this.context.state !== "running") throw new Error("voice_audio_blocked");
  }

  play(wav: ArrayBuffer, signal: AbortSignal, onStart: () => void,
    delivery: { pauseBeforeMs?: number; rate?: number } = {}): Promise<void> {
    const pause = delivery.pauseBeforeMs ?? 0, rate = delivery.rate ?? 1;
    if (!Number.isSafeInteger(pause) || pause < 0 || pause > 1000 || !Number.isFinite(rate) || rate < .98 || rate > 1.02)
      return Promise.reject(new Error("invalid_voice_audio"));
    const context = this.context, gain = this.gain, generation = this.generation;
    if (!context || !gain || context.state !== "running") return Promise.reject(new Error("voice_audio_blocked"));
    // The API permits only playing + one prefetched sentence.
    if (this.pending.size >= 2) return Promise.reject(new Error("invalid_voice_audio"));
    return new Promise((resolve, reject) => {
      let source: AudioBufferSourceNode | null = null, settled = false;
      let startTimer: ReturnType<typeof setTimeout> | undefined;
      const settle = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(startTimer);
        signal.removeEventListener("abort", abort);
        this.pending.delete(abort);
        if (source) {
          source.onended = null;
          if (error) { try { source.stop(); } catch { /* already ended */ } }
          source.disconnect();
        }
        if (error) reject(error); else resolve();
      };
      const abort = () => settle(new DOMException("Interrupted", "AbortError"));
      this.pending.add(abort);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) { abort(); return; }
      // Serialize decoding/scheduling, not playback: predecode and schedule ahead without gaps.
      this.decoding = this.decoding.then(async () => {
        if (settled || generation !== this.generation) return;
        const buffer = await context.decodeAudioData(wav);
        if (settled || signal.aborted || generation !== this.generation) return;
        if (context.state !== "running") throw new Error("voice_audio_blocked");
        if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > 120)
          throw new Error("tts_invalid_audio");
        source = context.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = rate;
        source.connect(gain);
        const readyAt = context.currentTime + 0.04;
        // Network/TTS waiting already counts as a gap; do not add the pause again to late audio.
        const start = this.scheduledUntil === 0 ? readyAt + pause / 1000
          : Math.max(readyAt, this.scheduledUntil + pause / 1000);
        this.scheduledUntil = start + buffer.duration / rate;
        source.onended = () => settle();
        source.start(start);
        startTimer = setTimeout(() => { if (!settled) onStart(); }, Math.max(0, (start - context.currentTime) * 1000));
      }).catch(error => settle(error));
    });
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.gain) this.gain.gain.value = muted ? 0 : 1;
  }

  stop() {
    this.generation++;
    for (const abort of [...this.pending]) abort();
    this.decoding = Promise.resolve();
    this.scheduledUntil = 0;
  }

  close() {
    this.stop();
    this.meter?.close();
    this.meter = null;
    this.gain?.disconnect();
    const context = this.context;
    this.context = null;
    this.gain = null;
    this.muted = false;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }
}
