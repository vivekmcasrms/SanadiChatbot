/** Extra admission check for automatic interruption, never a distance/speaker detector.
 * Only filters the PCM copy sent to VAD; original STT samples are untouched.
 */
export class VoiceInterruptionFilter {
  private strongSamples = 0;
  private confirmationSamples = 0;
  private readonly enabled: boolean;
  private readonly minimumRms: number;

  constructor() {
    this.enabled = import.meta.env["VITE_VOICE_CLOSE_INTERRUPTION"] !== "false";
    const configured = Number(import.meta.env["VITE_VOICE_INTERRUPTION_MIN_RMS"] ?? 0.02);
    this.minimumRms = Number.isFinite(configured) && configured >= 0.001 && configured <= 0.2
      ? configured : 0.02;
  }

  filter(pcm: ArrayBuffer, replying: boolean): ArrayBuffer {
    if (!this.enabled || !replying) {
      this.strongSamples = 0;
      this.confirmationSamples = 0;
      return pcm;
    }
    // After a sustained close-input onset, let server VAD hear the quieter
    // consonants/syllables too. Re-gating every frame can prevent its speech
    // confirmation from ever completing. This bounded window cannot be extended
    // by isolated peaks; only confirmed server speech bypasses the gate afterward.
    if (this.confirmationSamples > 0) {
      this.confirmationSamples = Math.max(0, this.confirmationSamples - pcm.byteLength / 2);
      return pcm;
    }
    const view = new DataView(pcm);
    let energy = 0;
    for (let offset = 0; offset < view.byteLength; offset += 2) {
      const value = view.getInt16(offset, true) / 32768;
      energy += value * value;
    }
    const count = view.byteLength / 2;
    const rms = count ? Math.sqrt(energy / count) : 0;
    // 96 ms above threshold rejects short peaks before the existing server VAD
    // performs its own speech confirmation. Volume alone never starts a turn.
    this.strongSamples = rms >= this.minimumRms ? this.strongSamples + count : 0;
    if (this.strongSamples >= 16000 * 0.096) {
      this.strongSamples = 0;
      this.confirmationSamples = 16000 * 0.384;
      return pcm;
    }
    return new ArrayBuffer(pcm.byteLength);
  }
}
