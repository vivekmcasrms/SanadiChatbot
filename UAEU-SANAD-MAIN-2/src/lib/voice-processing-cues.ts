import type { VoicePrompt } from "./voice-prompt-audio";

type Input = { enabled: boolean; skip: boolean; signal: AbortSignal; initial: VoicePrompt[]; waiting: VoicePrompt[] };
type Player = (clip: VoicePrompt, signal: AbortSignal) => Promise<void>;

/** Voice-only timers. No chat calls, tools, mutations, transcript edits or final-response queue. */
export class VoiceProcessingCues {
  private cancelTurn: (() => void) | null = null;
  private finishTurn: (() => Promise<void> | undefined) | null = null;
  private previous = new Map<string, string>();

  constructor(private play: Player, private stopAudio: () => void) {}

  cancel() { this.cancelTurn?.(); this.cancelTurn = null; this.finishTurn = null; }

  // A ready reply stops future waiting messages, but lets the current clip finish.
  // User interruption, End Call and errors still use cancel() to stop immediately.
  finish() { return this.finishTurn?.(); }

  start(input: Input) {
    this.cancel();
    if (!input.enabled || input.skip || input.signal.aborted) return;
    const started = Date.now();
    const controller = new AbortController();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let playing = false, finished = false, nextWaitingAt = started + 3000;
    let playback: Promise<void> | undefined;
    const used = new Set<string>();
    const clearTimers = () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
    const cancel = () => {
      finished = true;
      clearTimers();
      controller.abort();
      input.signal.removeEventListener("abort", cancel);
      if (playing) { playing = false; this.stopAudio(); }
    };
    this.cancelTurn = cancel;
    this.finishTurn = () => {
      finished = true;
      clearTimers();
      if (playing) return playback;
      input.signal.removeEventListener("abort", cancel);
      return undefined;
    };
    input.signal.addEventListener("abort", cancel, { once: true });
    const schedule = (action: () => void, delay: number) => {
      if (controller.signal.aborted || finished) return;
      const timer = setTimeout(() => { timers.delete(timer); if (!controller.signal.aborted && !finished) action(); }, delay);
      timers.add(timer);
    };
    const select = (clips: VoicePrompt[], kind: string) => {
      const available = clips.filter(c => !used.has(c.id));
      const key = clips[0]?.id.split("/").slice(0, 2).join("/") + "/" + kind;
      const chosen = available.find(c => c.id !== this.previous.get(key)) ?? available[0];
      if (chosen) { used.add(chosen.id); this.previous.set(key, chosen.id); }
      return chosen;
    };
    const speak = (clip: VoicePrompt) => {
      playing = true;
      // Cancellation/error of an optional cue must never cancel the business turn.
      playback = Promise.resolve().then(() => {
        if (!controller.signal.aborted && !finished) return this.play(clip, controller.signal);
        return undefined;
      }).catch(() => { cancel(); }).finally(() => {
        playing = false;
        if (controller.signal.aborted) return;
        if (finished) { input.signal.removeEventListener("abort", cancel); return; }
        schedule(waiting, Math.max(600, nextWaitingAt - Date.now()));
      });
    };
    const waiting = () => {
      if (playing || controller.signal.aborted || finished) return;
      if (Date.now() < nextWaitingAt) { schedule(waiting, nextWaitingAt - Date.now()); return; }
      const clip = select(input.waiting, "waiting");
      if (!clip) return; // Never repeat a waiting phrase within the same request.
      nextWaitingAt = Date.now() + 12_000;
      speak(clip);
    };
    // Give already-ready results one short event-loop grace period; do not add a business delay.
    schedule(() => {
      const clip = select(input.initial, "initial");
      if (clip) speak(clip);
      else schedule(waiting, Math.max(0, nextWaitingAt - Date.now()));
    }, 150);
  }
}
