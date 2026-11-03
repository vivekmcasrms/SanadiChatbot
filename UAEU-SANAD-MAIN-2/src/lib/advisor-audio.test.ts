import { describe, expect, it } from "vitest";
import { questionWav, UtteranceGate, VoiceTurns } from "./advisor-audio";

describe("private voice endpointing", () => {
  it("does not submit silence or a short click as a question", () => {
    const silence = new UtteranceGate();
    expect(silence.update(0, 10_000)).toBe("empty");
    const click = new UtteranceGate();
    click.update(0.4, 40);
    expect(click.update(0, 10_000)).toBe("empty");
    expect(click.hasSpeech).toBe(false);
  });
  it("submits once a spoken question is followed by a natural pause", () => {
    const gate = new UtteranceGate();
    expect(gate.update(0.1, 500)).toBe("continue");
    expect(gate.update(0, 400)).toBe("continue");
    expect(gate.update(0.1, 200)).toBe("continue");
    expect(gate.update(0, 850)).toBe("continue");
    expect(gate.update(0, 60)).toBe("complete");
  });
  it("caps long recordings", () => {
    expect(new UtteranceGate().update(0.1, 45_000)).toBe("complete");
  });
  it("encodes a complete, bounded 16kHz mono WAV from device PCM", async () => {
    const blob = questionWav([new Float32Array(48_000).fill(0.5)], 48_000);
    const bytes = await blob.arrayBuffer();
    const view = new DataView(bytes);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(bytes.byteLength - 8);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(32_000);
    expect(view.getInt16(44, true)).toBe(16_384);
  });
});

describe("interruption generation barrier", () => {
  it("aborts every previous pipeline and rejects late replies", () => {
    const turns = new VoiceTurns();
    const first = turns.begin();
    const second = turns.begin();
    expect(first.signal.aborted).toBe(true);
    expect(turns.isCurrent(first)).toBe(false);
    expect(turns.isCurrent(second)).toBe(true);
    turns.cancel();
    expect(second.signal.aborted).toBe(true);
    expect(turns.isCurrent(second)).toBe(false);
  });
});
