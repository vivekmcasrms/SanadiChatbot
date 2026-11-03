/** Reveal the confirmed reply at audible playback, not when synthesis is still pending. */
export class VoiceReplyPresentation<T> {
  private started = false;
  private pending: T | undefined;
  constructor(private readonly show: (result: T) => void) {}
  result(result: T) {
    this.pending = result;
    if (this.started) this.flush();
  }
  start() {
    this.started = true;
    this.flush();
  }
  // Keep confirmed service outcomes accessible even if audio fails or the user interrupts.
  finish() { this.flush(); }
  private flush() {
    if (this.pending === undefined) return;
    const result = this.pending;
    this.pending = undefined;
    this.show(result);
  }
}
