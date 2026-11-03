/**
 * Voice chat only: stages the in-browser Arabic speech engine under public/voice so the
 * UI serves it from its own origin (the production CSP allows no third-party downloads).
 *
 *   public/voice/ort/ort-wasm-simd.wasm          onnxruntime-web runtime (from node_modules)
 *   public/voice/piper/piper_phonemize.{js,wasm,data}  espeak-ng phonemizer (from node_modules)
 *   public/voice/piper/ar_JO-kareem-low.onnx{,.json}   Piper Arabic voice (already staged)
 *
 * Runs before `vite dev` / `vite build` (see package.json). Copies are skipped when the
 * target already exists. Builds never fetch voice assets from third-party hosts.
 */
import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "public", "voice");

const MODEL = "ar_JO-kareem-low";

async function exists(path) {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

async function copy(from, to) {
  if (await exists(to)) return;
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
  console.log(`voice-assets: copied ${to.replace(root, "")}`);
}

// Both packages restrict "exports", so resolve them through node_modules directly.
const ortDist = join(root, "node_modules", "onnxruntime-web", "dist");
const piperBuild = join(root, "node_modules", "@diffusionstudio", "piper-wasm", "build");

await copy(join(ortDist, "ort-wasm-simd.wasm"), join(target, "ort", "ort-wasm-simd.wasm"));
for (const file of ["piper_phonemize.js", "piper_phonemize.wasm", "piper_phonemize.data"]) {
  await copy(join(piperBuild, file), join(target, "piper", file));
}

for (const file of [`${MODEL}.onnx.json`, `${MODEL}.onnx`]) {
  if (!await exists(join(target, "piper", file)))
    console.warn(`voice-assets: missing local public/voice/piper/${file}; Arabic browser speech may be unavailable.`);
}
