export const VOICE_BAR_COUNT = 7;
export type VoiceSpectrum = { read: () => readonly number[]; close: () => void };

/** Read-only audio taps: microphone audio is never routed to the speakers. */
export function observeVoiceSpectrum(context: AudioContext, output: GainNode, stream: MediaStream): VoiceSpectrum | null {
  let microphone: MediaStreamAudioSourceNode | undefined;
  let input: AnalyserNode | undefined;
  let reply: AnalyserNode | undefined;
  let closed = false;
  const levels = Array<number>(VOICE_BAR_COUNT).fill(0);
  const close = () => {
    if (closed) return;
    closed = true;
    microphone?.disconnect();
    if (reply) { try { output.disconnect(reply); } catch { /* Tap was not connected. */ } }
    input?.disconnect();
    reply?.disconnect();
    levels.fill(0);
  };
  try {
    input = context.createAnalyser();
    reply = context.createAnalyser();
    for (const analyser of [input, reply]) {
      analyser.fftSize = 1024;
      analyser.minDecibels = -65;
      analyser.maxDecibels = -15;
      analyser.smoothingTimeConstant = .7;
    }
    microphone = context.createMediaStreamSource(stream);
    microphone.connect(input);
    output.connect(reply); // Observe after mute/volume without changing the audible route.
    const captured = new Uint8Array(input.frequencyBinCount);
    const spoken = new Uint8Array(reply.frequencyBinCount);
    const edges = [100, 200, 400, 800, 1600, 3200, 4800, 8000];
    const binHz = context.sampleRate / input.fftSize;
    const bands = edges.slice(0, -1).map((frequency, index) => [
      Math.max(1, Math.floor(frequency / binHz)),
      Math.min(captured.length, Math.ceil(edges[index + 1]! / binHz)),
    ] as const);
    return {
      close,
      read() {
        if (closed || context.state !== "running") return levels.fill(0);
        input!.getByteFrequencyData(captured);
        reply!.getByteFrequencyData(spoken);
        bands.forEach(([start, end], index) => {
          let peak = 0;
          for (let bin = start; bin < end; bin++) peak = Math.max(peak, captured[bin]!, spoken[bin]!);
          levels[index] = peak / 255;
        });
        return levels;
      },
    };
  } catch {
    close();
    return null; // A visualisation failure must never prevent a voice call.
  }
}
