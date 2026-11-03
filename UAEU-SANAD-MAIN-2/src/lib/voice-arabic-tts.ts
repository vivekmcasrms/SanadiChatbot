/**
 * Voice chat only: Arabic speech that does not depend on Windows / macOS voices.
 *
 * Desktop Chrome exposes no Arabic voice unless the student has installed one,
 * so `speechSynthesis` plays silence. This module first asks the voice API
 * (`POST /api/voice/speak`) for Arabic audio, then falls back to the in-page
 * Piper engine if the API is unreachable. The text chat never imports this module.
 */
import { apiUrl, getAuthToken } from "./auth-token";

const ASSET_BASE = "/voice";
const MODEL_ID = "ar_JO-kareem-low";

type PiperConfig = {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  num_speakers?: number;
};

type OrtModule = typeof import("onnxruntime-web");
type InferenceSession = import("onnxruntime-web").InferenceSession;

type Engine = { ort: OrtModule; session: InferenceSession; config: PiperConfig };

type PhonemizerModule = {
  callMain: (args: string[]) => number;
};

type PhonemizerFactory = (options: {
  print: (line: string) => void;
  printErr: (line: string) => void;
  locateFile: (file: string) => string;
  noInitialRun?: boolean;
}) => Promise<PhonemizerModule>;

let enginePromise: Promise<Engine> | null = null;
let phonemizerScript: Promise<PhonemizerFactory> | null = null;
let audioContext: AudioContext | null = null;

/** True when this browser can run the in-page engine (WebAssembly and Web Audio). */
export function arabicSpeechAvailable(): boolean {
  return typeof window !== "undefined"
    && typeof WebAssembly === "object"
    && typeof fetch === "function"
    && ("AudioContext" in window || "webkitAudioContext" in window);
}

function context(): AudioContext {
  if (!audioContext) {
    const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    audioContext = new Ctor();
  }
  return audioContext;
}

async function fetchOk(path: string): Promise<Response> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`voice_asset_unavailable:${path}`);
  return response;
}

function loadPhonemizerScript(): Promise<PhonemizerFactory> {
  // Emscripten glue built as a classic script; loading it with a <script> tag avoids
  // bundler rewrites and lets it find its .wasm/.data next to itself via locateFile.
  phonemizerScript ??= new Promise<PhonemizerFactory>((resolve, reject) => {
    const existing = (window as unknown as { createPiperPhonemize?: PhonemizerFactory }).createPiperPhonemize;
    if (existing) return resolve(existing);
    const script = document.createElement("script");
    script.src = `${ASSET_BASE}/piper/piper_phonemize.js`;
    script.async = true;
    script.onload = () => {
      const factory = (window as unknown as { createPiperPhonemize?: PhonemizerFactory }).createPiperPhonemize;
      if (factory) resolve(factory);
      else reject(new Error("voice_phonemizer_unavailable"));
    };
    script.onerror = () => reject(new Error("voice_phonemizer_unavailable"));
    document.head.appendChild(script);
  }).catch((cause: unknown) => {
    phonemizerScript = null;
    throw cause;
  });
  return phonemizerScript;
}

async function phonemeIds(text: string, voice: string): Promise<number[]> {
  const factory = await loadPhonemizerScript();
  return new Promise<number[]>((resolve, reject) => {
    let settled = false;
    const finish = (ids: number[]) => {
      if (settled) return;
      settled = true;
      resolve(ids);
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    };
    factory({
      noInitialRun: true,
      print: (line) => {
        try {
          const parsed = JSON.parse(line) as { phoneme_ids?: number[] };
          if (Array.isArray(parsed.phoneme_ids)) finish(parsed.phoneme_ids);
        } catch {
          /* non-JSON diagnostics are ignored */
        }
      },
      printErr: () => {
        /* espeak warnings are not fatal; missing ids are handled after callMain */
      },
      locateFile: (file) => `${ASSET_BASE}/piper/${file}`,
    })
      .then((module) => {
        module.callMain([
          "-l", voice,
          "--input", JSON.stringify([{ text: text.trim() }]),
          "--espeak_data", "/espeak-ng-data",
        ]);
        if (!settled) fail("voice_phonemizer_failed:no_output");
      })
      .catch((cause: unknown) => fail(cause instanceof Error ? cause.message : "voice_phonemizer_failed"));
  });
}

async function loadEngine(): Promise<Engine> {
  enginePromise ??= (async () => {
    const [ort, configResponse, modelResponse] = await Promise.all([
      import("onnxruntime-web"),
      fetchOk(`${ASSET_BASE}/piper/${MODEL_ID}.onnx.json`),
      fetchOk(`${ASSET_BASE}/piper/${MODEL_ID}.onnx`),
    ]);
    ort.env.wasm.wasmPaths = `${ASSET_BASE}/ort/`;
    // Single-threaded SIMD build: no SharedArrayBuffer / cross-origin isolation needed.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const config = (await configResponse.json()) as PiperConfig;
    const session = await ort.InferenceSession.create(await modelResponse.arrayBuffer(), {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    return { ort, session, config };
  })().catch((cause: unknown) => {
    enginePromise = null;
    throw cause;
  });
  return enginePromise;
}

/** Unlocks Web Audio on a user gesture and starts loading the offline engine. */
export function warmArabicSpeech(): void {
  if (!arabicSpeechAvailable()) return;
  try {
    void context().resume();
  } catch {
    /* ignore */
  }
  void loadEngine().catch(() => undefined);
  void loadPhonemizerScript().catch(() => undefined);
}

async function fetchCloudSpeech(text: string, agent: string, signal: AbortSignal): Promise<AudioBuffer> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = getAuthToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(apiUrl("/api/voice/speak"), {
    method: "POST",
    headers,
    credentials: "include",
    signal,
    body: JSON.stringify({ text, lang: "ar", agent }),
  });
  if (!response.ok) throw new Error("voice_speech_unavailable");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 64) throw new Error("voice_speech_empty");
  const ctx = context();
  if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
  return ctx.decodeAudioData(bytes.slice(0));
}

async function synthesize(text: string): Promise<AudioBuffer> {
  const { ort, session, config } = await loadEngine();
  const ids = await phonemeIds(text, config.espeak.voice);
  if (ids.length === 0) throw new Error("voice_phonemizer_failed:empty");
  const feeds: Record<string, import("onnxruntime-web").Tensor> = {
    input: new ort.Tensor("int64", BigInt64Array.from(ids.map((id) => BigInt(id))), [1, ids.length]),
    input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor("float32", Float32Array.from([
      config.inference.noise_scale, config.inference.length_scale, config.inference.noise_w,
    ]), [3]),
  };
  if ((config.num_speakers ?? 1) > 1) feeds["sid"] = new ort.Tensor("int64", BigInt64Array.from([0n]), [1]);
  const output = await session.run(feeds);
  const samples = output["output"]?.data as Float32Array | undefined;
  if (!samples || samples.length === 0) throw new Error("voice_synthesis_failed");
  const buffer = context().createBuffer(1, samples.length, config.audio.sample_rate);
  buffer.getChannelData(0).set(samples);
  return buffer;
}

export type ArabicPlayback = {
  /** Stops playback (or abandons synthesis) and resolves `onEnd` once. */
  stop: () => void;
};

/**
 * Speaks Arabic without using the student's installed system voices.
 * Tries the voice API first, then the in-page engine. `onStart` fires when
 * audio begins; `onEnd` exactly once when it finishes, is stopped, or both paths fail.
 */
export function speakArabic(
  text: string,
  handlers: { onStart?: () => void; onEnd?: () => void; onError?: (cause: unknown) => void },
  agent: "mira" | "suhail" = "mira",
): ArabicPlayback {
  let stopped = false;
  let ended = false;
  let source: AudioBufferSourceNode | null = null;
  const abort = new AbortController();
  const end = () => {
    if (ended) return;
    ended = true;
    handlers.onEnd?.();
  };
  const play = async (buffer: AudioBuffer) => {
    if (stopped) return end();
    const ctx = context();
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = end;
    handlers.onStart?.();
    source.start();
  };
  void (async () => {
    try {
      try {
        await play(await fetchCloudSpeech(text, agent, abort.signal));
        return;
      } catch (cause) {
        if (stopped || abort.signal.aborted) return end();
        handlers.onError?.(cause);
      }
      await play(await synthesize(text));
    } catch (cause) {
      handlers.onError?.(cause);
      end();
    }
  })();
  return {
    stop: () => {
      stopped = true;
      abort.abort();
      try {
        source?.stop();
      } catch {
        /* already finished */
      }
      end();
    },
  };
}
