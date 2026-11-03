import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState =
  | "ready"
  | "listening"
  | "processing"
  | "transcript_ready"
  | "unavailable"
  | "denied";

function encodeWav(chunks: Float32Array[], inputRate: number, targetRate = 16000): Blob {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  const ratio = inputRate / targetRate;
  const outLength = ratio > 1 ? Math.floor(merged.length / ratio) : merged.length;
  const samples = new Int16Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const value = merged[ratio > 1 ? Math.floor(i * ratio) : i] ?? 0;
    const clamped = Math.max(-1, Math.min(1, value));
    samples[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  const rate = ratio > 1 ? targetRate : inputRate;
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (pos: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(pos + i, text.charCodeAt(i));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);
  new Int16Array(buffer, 44).set(samples);
  return new Blob([buffer], { type: "audio/wav" });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < buffer.length; i += step) {
    binary += String.fromCharCode(...buffer.subarray(i, i + step));
  }
  return btoa(binary);
}

/**
 * Microphone capture that produces a complete 16 kHz mono WAV per recording.
 * Audio stays in memory: it is handed to the caller once and then dropped.
 */
export function useVoiceRecorder(options: {
  onRecorded: (audioBase64: string) => void | Promise<void>;
  onDenied?: () => void;
  onUnavailable?: () => void;
  /** Recording ended with too little audio to transcribe. */
  onEmpty?: () => void;
  maxSeconds?: number;
}) {
  const { onRecorded, onDenied, onUnavailable, onEmpty, maxSeconds = 90 } = options;
  const [state, setState] = useState<VoiceState>("ready");
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);

  const cbRef = useRef({ onRecorded, onDenied, onUnavailable, onEmpty });
  cbRef.current = { onRecorded, onDenied, onUnavailable, onEmpty };
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const teardown = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    nodeRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void ctxRef.current?.close().catch(() => undefined);
    nodeRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;
    setLevel(0);
  }, []);

  const finish = useCallback(
    async (cancelled: boolean) => {
      const rate = ctxRef.current?.sampleRate ?? 48000;
      const chunks = chunksRef.current;
      chunksRef.current = [];
      teardown();
      setSeconds(0);
      if (cancelled) {
        setState("ready");
        return;
      }
      const blob = encodeWav(chunks, rate);
      if (blob.size < 4096) {
        setState("ready");
        cbRef.current.onEmpty?.();
        return;
      }
      setState("processing");
      try {
        const base64 = await blobToBase64(blob);
        await cbRef.current.onRecorded(base64);
        setState("transcript_ready");
      } catch {
        setState("ready");
      }
    },
    [teardown],
  );

  const stop = useCallback(() => {
    if (!streamRef.current) return;
    void finish(cancelledRef.current);
  }, [finish]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (!streamRef.current) {
      setState("ready");
      return;
    }
    void finish(true);
  }, [finish]);

  const start = useCallback(async () => {
    if (typeof window === "undefined") return;
    const AudioCtor =
      window.AudioContext ??
      ((window as unknown as Record<string, unknown>)["webkitAudioContext"] as
        | typeof AudioContext
        | undefined);
    if (!navigator.mediaDevices?.getUserMedia || !AudioCtor) {
      setState("unavailable");
      cbRef.current.onUnavailable?.();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      const name = (error as { name?: string })?.name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setState("denied");
        cbRef.current.onDenied?.();
      } else {
        setState("unavailable");
        cbRef.current.onUnavailable?.();
      }
      return;
    }

    cancelledRef.current = false;
    chunksRef.current = [];
    const ctx = new AudioCtor();
    const source = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (event) => {
      const data = event.inputBuffer.getChannelData(0);
      chunksRef.current.push(new Float32Array(data));
      let peak = 0;
      for (let i = 0; i < data.length; i += 32) peak = Math.max(peak, Math.abs(data[i] ?? 0));
      setLevel(Math.min(1, peak * 2.2));
    };
    source.connect(node);
    // Keep the processor graph alive without monitoring through speakers.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);
    streamRef.current = stream;
    ctxRef.current = ctx;
    sourceRef.current = source;
    nodeRef.current = node;
    setSeconds(0);
    setState("listening");
    timerRef.current = setInterval(() => {
      setSeconds((prev) => {
        const next = prev + 1;
        if (next >= maxSeconds) void finish(false);
        return next;
      });
    }, 1000);
  }, [finish, maxSeconds]);

  useEffect(() => () => teardown(), [teardown]);

  const reset = useCallback(() => setState("ready"), []);

  return { state, level, seconds, start, stop, cancel, reset };
}
