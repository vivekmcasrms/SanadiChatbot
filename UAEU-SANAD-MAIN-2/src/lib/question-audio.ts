import { ActivityPcmEncoder, openVoiceActivity, type VoiceActivity } from "./voice-activity";
import { VoiceInterruptionFilter } from "./voice-interruption";

/** Resample captured microphone PCM for local multilingual recognition. */
export function questionSamples(chunks: Float32Array[], inputRate: number, startSample = 0): Float32Array {
  const length = chunks.reduce((size, chunk) => size + chunk.length, 0);
  const input = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.length; }
  const ratio = inputRate / 16000;
  const output = new Float32Array(Math.max(0, Math.floor((length - startSample) / ratio)));
  for (let i = 0; i < output.length; i++) {
    const start = startSample + Math.floor(i * ratio);
    const end = Math.min(length, Math.max(start + 1, startSample + Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j] ?? 0;
    output[i] = sum / (end - start);
  }
  return output;
}

/** Observe the already echo-cancelled mic track; never play it or stop the call-owned track. */
export async function captureQuestionAudio(track: MediaStreamTrack, signal: AbortSignal, onPause: () => void,
  onSpeech?: () => void, onError?: (error: Error) => void, isReplying?: () => boolean) {
  const context = new AudioContext();
  let source: MediaStreamAudioSourceNode | null = null;
  let recorder: AudioWorkletNode | null = null;
  let chunks: Float32Array[] = [];
  let samples = 0, startSample = 0, echoEnd = 0, marked = false, closed = false;
  let pauseReported = false, speechReported = false;
  let activity: VoiceActivity | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener("abort", close);
    if (recorder) { recorder.port.onmessage = null; recorder.disconnect(); }
    source?.disconnect();
    activity?.close();
    void context.close().catch(() => {});
  };
  signal.addEventListener("abort", close, { once: true });
  try {
    signal.throwIfAborted();
    const encoder = new ActivityPcmEncoder(context.sampleRate);
    const interruption = new VoiceInterruptionFilter();
    await context.audioWorklet.addModule("/advisor-recorder.js");
    signal.throwIfAborted();
    await context.resume();
    signal.throwIfAborted();
    activity = await openVoiceActivity(signal, (event, frameEndSample) => {
      if (closed) return;
      if (event === "speech" && !speechReported) {
        // Keep two seconds before confirmed onset for quiet/initial words, but do
        // not transcribe the entire preceding idle recording. Use the processed
        // frame position, not callback time, so network delay cannot cut speech.
        if (frameEndSample !== undefined)
          startSample = Math.max(startSample, Math.min(samples,
            Math.floor(Math.max(0, frameEndSample - 2 * 16000) * context.sampleRate / 16000)));
        speechReported = true;
        onSpeech?.();
      } else if (event === "pause" && speechReported && !pauseReported) {
        pauseReported = true;
        onPause();
      }
    }, error => {
      if (closed) return;
      close();
      onError?.(error);
    });
    signal.throwIfAborted();
    if (closed) throw new Error("voice_activity_unavailable");
    source = context.createMediaStreamSource(new MediaStream([track]));
    recorder = new AudioWorkletNode(context, "advisor-recorder");
    recorder.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (closed || samples >= context.sampleRate * 60) return;
      const chunk = event.data;
      chunks.push(chunk);
      samples += chunk.length;
      // Restrict only automatic interruption during an active reply. Once speech
      // is accepted, normal continuation/endpoint detection resumes. STT keeps
      // the original samples, including the beginning of the user's question.
      try {
        for (const frame of encoder.encode(chunk)) {
          if (closed) break;
          activity!.send(interruption.filter(frame, !speechReported && isReplying?.() === true));
        }
      } catch {
        close();
        onError?.(new Error("voice_activity_unavailable"));
      }
    };
    source.connect(recorder);
    recorder.connect(context.destination); // The existing recorder worklet outputs only silence.
    return {
      markEcho() { if (!marked) echoEnd = samples; },
      markUserSpeech() {
        if (marked) return;
        marked = true;
        // Preserve the words spoken before the browser delivers its first interim result.
        startSample = Math.max(startSample, Math.min(echoEnd, samples - Math.ceil(context.sampleRate * 2)));
      },
      finish() {
        close();
        const result = speechReported
          ? questionSamples(chunks, context.sampleRate, startSample) : new Float32Array();
        chunks = [];
        return result;
      },
      cancel() { close(); chunks = []; },
    };
  } catch (error) { close(); throw error; }
}
