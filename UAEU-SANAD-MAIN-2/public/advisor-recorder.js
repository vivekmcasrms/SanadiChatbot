// Captures mono PCM only while the user explicitly opens the microphone.
class AdvisorRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(2048);
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      this.samples[this.offset++] = sample;
      if (this.offset === this.samples.length) {
        this.port.postMessage(this.samples, [this.samples.buffer]);
        this.samples = new Float32Array(2048);
        this.offset = 0;
      }
    }
    // Outputs remain silent: never monitor the microphone through the speakers.
    return true;
  }
}
registerProcessor("advisor-recorder", AdvisorRecorder);
