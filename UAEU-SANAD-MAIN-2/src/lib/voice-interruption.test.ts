import { afterEach, expect, test, vi } from "vitest";
import { VoiceInterruptionFilter } from "./voice-interruption";

afterEach(() => vi.unstubAllEnvs());
function frame(level: number) {
  const pcm = new ArrayBuffer(1024), view = new DataView(pcm);
  for (let i = 0; i < 512; i++) view.setInt16(i * 2, Math.round(level * 32767) * (i % 2 ? -1 : 1), true);
  return pcm;
}
const silent = (pcm: ArrayBuffer) => new Uint8Array(pcm).every(value => value === 0);

test("quiet normal listening is identical and never gated", () => {
  const gate = new VoiceInterruptionFilter(), quiet = frame(0.0005);
  expect(gate.filter(quiet, false)).toBe(quiet);
});

test("sustained faint sound cannot enter VAD during a reply or mutate the original", () => {
  const gate = new VoiceInterruptionFilter(), faint = frame(0.005), original = faint.slice(0);
  for (let i = 0; i < 400; i++) expect(silent(gate.filter(faint, true))).toBe(true);
  expect(faint).toEqual(original);
});

test("brief peaks do not accumulate into an interruption", () => {
  const gate = new VoiceInterruptionFilter();
  for (let i = 0; i < 20; i++) {
    expect(silent(gate.filter(frame(0.1), true))).toBe(true);
    expect(silent(gate.filter(frame(0.1), true))).toBe(true);
    expect(silent(gate.filter(frame(0.005), true))).toBe(true);
  }
});

test("strong sustained input reaches server VAD unchanged after confirmation", () => {
  const gate = new VoiceInterruptionFilter(), loud = frame(0.06);
  expect(silent(gate.filter(loud, true))).toBe(true);
  expect(silent(gate.filter(loud, true))).toBe(true);
  expect(gate.filter(loud, true)).toBe(loud);
});

test("quieter syllables after a sustained onset remain audible to server speech detection", () => {
  const gate = new VoiceInterruptionFilter();
  const onset = frame(0.06), consonant = frame(0.008), vowel = frame(0.03);
  gate.filter(onset, true); gate.filter(onset, true); gate.filter(onset, true);
  for (const pcm of [consonant, consonant, vowel, consonant, vowel, consonant, consonant, vowel])
    expect(gate.filter(pcm, true)).toBe(pcm);
});

test("unconfirmed admission expires and isolated peaks cannot keep surroundings admitted", () => {
  const gate = new VoiceInterruptionFilter();
  const onset = frame(0.06), faint = frame(0.005);
  gate.filter(onset, true); gate.filter(onset, true); gate.filter(onset, true);
  for (let i = 0; i < 12; i++) {
    const pcm = i % 3 === 0 ? onset : faint;
    expect(gate.filter(pcm, true)).toBe(pcm);
  }
  for (let i = 0; i < 20; i++) {
    expect(silent(gate.filter(onset, true))).toBe(true);
    expect(silent(gate.filter(faint, true))).toBe(true);
  }
});

test("returning to listening clears an admitted interruption before the next reply", () => {
  const gate = new VoiceInterruptionFilter(), onset = frame(0.06), quiet = frame(0.005);
  gate.filter(onset, true); gate.filter(onset, true); gate.filter(onset, true);
  expect(gate.filter(quiet, false)).toBe(quiet);
  expect(silent(gate.filter(quiet, true))).toBe(true);
  expect(silent(gate.filter(onset, true))).toBe(true);
});

test("finishing or explicitly interrupting a reply immediately restores quiet listening", () => {
  const gate = new VoiceInterruptionFilter(), quiet = frame(0.0005);
  gate.filter(frame(0.06), true); gate.filter(frame(0.06), true);
  expect(gate.filter(quiet, false)).toBe(quiet);
  expect(silent(gate.filter(frame(0.06), true))).toBe(true);
});

test("feature flag restores the previous PCM path exactly", () => {
  vi.stubEnv("VITE_VOICE_CLOSE_INTERRUPTION", "false");
  const gate = new VoiceInterruptionFilter();
  for (const level of [0, 0.0005, 0.005, 0.06]) {
    const pcm = frame(level);
    expect(gate.filter(pcm, true)).toBe(pcm);
  }
});

test("configured sensitivity applies only to interruptions", () => {
  vi.stubEnv("VITE_VOICE_INTERRUPTION_MIN_RMS", "0.05");
  const gate = new VoiceInterruptionFilter(), pcm = frame(0.03);
  for (let i = 0; i < 20; i++) expect(silent(gate.filter(pcm, true))).toBe(true);
  expect(gate.filter(pcm, false)).toBe(pcm);
});

test.each(["", "invalid", "0", "-1", "1", "Infinity"])("invalid sensitivity %s retains the default", value => {
  vi.stubEnv("VITE_VOICE_INTERRUPTION_MIN_RMS", value);
  const gate = new VoiceInterruptionFilter();
  for (let i = 0; i < 10; i++) expect(silent(gate.filter(frame(0.005), true))).toBe(true);
  gate.filter(frame(0.03), true); gate.filter(frame(0.03), true);
  expect(silent(gate.filter(frame(0.03), true))).toBe(false);
});
