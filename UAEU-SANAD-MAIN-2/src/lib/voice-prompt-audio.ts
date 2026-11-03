import { apiUrl, getAuthToken } from "./auth-token";
import type { AdvisorIdentity, AdvisorLanguage } from "./advisor-client";

export type VoicePrompt = { id: string; text: string; wav: ArrayBuffer };
type Cached = VoicePrompt & { expires: number };
type Prepared = { text: string; audioBase64: string; cuesEnabled?: boolean; initialCount?: number; waitingCount?: number;
  greetingCount?: number; greetingReplyAvailable?: boolean };

/** Public fixed clips in memory only. Preparation is optional and never refreshes authentication. */
export class VoicePromptAudio {
  enabled = false;
  private entries = new Map<string, Cached>();
  private preparedGreetings = new Map<string, number>();
  private greetingCounts = new Map<string, number>();
  private greetingReplies = new Set<string>();
  private warming: AbortController | null = null;
  private warmingSelection: string | null = null;
  private paused = false;
  private counts = { initial: 0, waiting: 0 };

  get(agent: AdvisorIdentity, language: AdvisorLanguage, kind: "welcome" | "initial" | "waiting" | "greetingReply") {
    const prefix = `${agent}/${language}/${kind}`;
    return [...this.entries.values()].filter(clip => clip.id.startsWith(prefix) && clip.expires > Date.now());
  }

  supportsGreetingReply(agent: AdvisorIdentity, language: AdvisorLanguage) {
    return this.greetingReplies.has(`${agent}/${language}`);
  }

  // Starting a question stops the queue, not a public clip already being generated.
  // Finishing that one clip avoids abort/restart churn on the shared speech server.
  pause() { this.paused = true; }
  cancel() { this.paused = true; this.warming?.abort(); this.warming = null; this.warmingSelection = null; }

  async prepare(agent: AdvisorIdentity, language: AdvisorLanguage, signal?: AbortSignal) {
    if (signal?.aborted) return;
    if (this.warming && !this.warming.signal.aborted && this.warmingSelection === `${agent}/${language}`) {
      this.paused = false;
      return;
    }
    this.cancel();
    this.paused = false;
    const task = new AbortController();
    this.warming = task;
    this.warmingSelection = `${agent}/${language}`;
    const abort = () => task.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) task.abort();
    const post = (path: string, body: object) => {
      const token = getAuthToken();
      return fetch(apiUrl(path), {
        method: "POST", credentials: "include", cache: "no-store", signal: task.signal,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
    };
    const load = async (path: string, body: object, id: string) => {
      const response = await post(path, body);
      if (!response.ok || response.status === 204) return null;
      const value = await response.json() as Prepared;
      task.signal.throwIfAborted();
      if (typeof value.text !== "string" || !value.text.trim() || value.text.length > 500 ||
        typeof value.audioBase64 !== "string" || value.audioBase64.length > 11_000_000) return null;
      const wav = Uint8Array.from(atob(value.audioBase64), c => c.charCodeAt(0));
      if (wav.length <= 44 || new TextDecoder().decode(wav.subarray(0, 4)) !== "RIFF" ||
        new TextDecoder().decode(wav.subarray(8, 12)) !== "WAVE") return null;
      this.entries.set(id, { id, text: value.text, wav: wav.buffer, expires: Date.now() + 15 * 60_000 });
      return value;
    };
    try {
      // Welcome always gets priority. A ready welcome skips synthesis and audio download on click.
      if (!this.get(agent, language, "welcome").length) {
        const welcome = await load("/api/voice/call/prepare", { agent, language, includeAudio: true }, `${agent}/${language}/welcome`);
        if (!welcome) return; // Older servers retain their original websocket welcome.
        this.enabled = welcome.cuesEnabled === true;
        this.counts = {
          initial: Math.min(8, Math.max(0, welcome.initialCount ?? 0)),
          waiting: Math.min(5, Math.max(0, welcome.waitingCount ?? 0)),
        };
        this.greetingCounts.set(`${agent}/${language}`, Math.min(8, Math.max(0, welcome.greetingCount ?? 0)));
        if (welcome.greetingReplyAvailable === true) this.greetingReplies.add(`${agent}/${language}`);
        else this.greetingReplies.delete(`${agent}/${language}`);
      }
      if (this.paused) return;
      if (this.greetingReplies.has(`${agent}/${language}`) && !this.get(agent, language, "greetingReply").length)
        await load("/api/voice/call/greeting-reply", { agent, language }, `${agent}/${language}/greetingReply`);
      // Prepare fixed greeting audio after the welcome, independently of optional acknowledgments.
      // One public chunk at a time: starting a real question pauses the rest of this queue.
      for (let index = 0; !this.get(agent, language, "greetingReply").length && index < (this.greetingCounts.get(`${agent}/${language}`) ?? 0); index++) {
        task.signal.throwIfAborted();
        if (this.paused) return;
        const id = `${agent}/${language}/greeting/${index}`;
        if ((this.preparedGreetings.get(id) ?? 0) > Date.now()) continue;
        const response = await post("/api/voice/call/greeting", { agent, language, index });
        task.signal.throwIfAborted();
        if (!response.ok) break; // Existing welcome, cues and live speech remain available.
        this.preparedGreetings.set(id, Date.now() + 15 * 60_000);
      }
      if (!this.enabled || this.paused) return;
      // Serial warm-up pauses between clips while the actual question runs.
      const languages: AdvisorLanguage[] = [language, language === "ar" ? "en" : "ar"];
      for (let index = 0; index < Math.max(this.counts.initial, this.counts.waiting); index++)
        for (const kind of ["initial", "waiting"] as const)
          for (const spoken of languages) {
            task.signal.throwIfAborted();
            if (this.paused) return;
            if (index >= this.counts[kind]) continue;
            const id = `${agent}/${spoken}/${kind}/${index}`;
            if ((this.entries.get(id)?.expires ?? 0) > Date.now()) continue;
            if (!await load("/api/voice/call/cue", { agent, language: spoken, kind, index }, id)) return;
          }
    } catch { /* Optional presentation must never interrupt a chat, surface an error, or delay an answer. */ }
    finally {
      signal?.removeEventListener("abort", abort);
      if (this.warming === task) { this.warming = null; this.warmingSelection = null; }
    }
  }
}
