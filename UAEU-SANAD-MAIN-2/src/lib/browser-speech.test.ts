import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { BrowserSpeech, browserSpeechError, browserVoice } from "./browser-speech";

const voice = (name: string, lang: string) => ({ name, lang, voiceURI: name } as SpeechSynthesisVoice);
class Utterance {
  constructor(public text: string) {}
  voice: SpeechSynthesisVoice | null = null;
  lang = ""; rate = 1; pitch = 1; volume = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
}
let voices: SpeechSynthesisVoice[], synth: SpeechSynthesis, spoken: Utterance[];
beforeEach(() => {
  vi.useFakeTimers();
  voices = [
    voice("Microsoft David", "en-US"), voice("Microsoft Zira", "en-US"),
    voice("Microsoft Hamdan Online", "ar-AE"), voice("Microsoft Fatima Online", "ar-AE"),
  ];
  spoken = [];
  synth = Object.assign(new EventTarget(), {
    getVoices: () => voices,
    speak: vi.fn((u: Utterance) => { spoken.push(u); u.onstart?.(); }),
    cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(),
  }) as unknown as SpeechSynthesis;
  vi.stubGlobal("window", { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance });
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test.each([
  ["en", "mira", "Microsoft Zira"], ["en", "suhail", "Microsoft David"],
  ["ar", "mira", "Microsoft Fatima Online"], ["ar", "suhail", "Microsoft Hamdan Online"],
] as const)("reply language %s and agent %s select the matching browser voice", async (language, agent, name) => {
  const player = new BrowserSpeech(), started = vi.fn();
  player.prepare();
  const done = player.speak(language === "ar" ? "أهلاً بك." : "Hello.", language, agent, new AbortController().signal, started);
  await vi.advanceTimersByTimeAsync(0);
  expect(spoken[0].voice?.name).toBe(name);
  expect(spoken[0].lang.startsWith(language)).toBe(true);
  expect(spoken[0].rate).toBe(1);
  expect(started).toHaveBeenCalledOnce();
  spoken[0].onend?.();
  await done;
});

test("missing Arabic female voice never falls back to an Arabic male or English female", async () => {
  voices = [voice("Microsoft Hamdan Online", "ar-AE"), voice("Microsoft Zira", "en-US")];
  const result = expect(new BrowserSpeech().speak("أهلاً", "ar", "mira", new AbortController().signal, () => {}))
    .rejects.toThrow("browser_voice_missing_ar_mira");
  await vi.advanceTimersByTimeAsync(3000);
  await result;
  expect(synth.speak).not.toHaveBeenCalled();
});

test("female label cannot be mistaken for male; UAE locale wins among matching voices", () => {
  expect(browserVoice([voice("Arabic Female", "ar-AE")], "ar", "suhail")).toBeUndefined();
  expect(browserVoice([voice("Microsoft Hoda", "ar-EG"), voice("Microsoft Fatima", "ar-AE")], "ar", "mira")?.lang).toBe("ar-AE");
});

test.each(["mira", "suhail"] as const)("generic browser voices can speak both languages for %s", async agent => {
  voices = [voice("Google US English", "en-US"), voice("Google العربية", "ar-SA")];
  const player = new BrowserSpeech();
  for (const [language, text] of [["ar", "أهلاً بك."], ["en", "Hello."]] as const) {
    const done = player.speak(text, language, agent, new AbortController().signal, () => {});
    await vi.advanceTimersByTimeAsync(0);
    const utterance = spoken.at(-1)!;
    expect(utterance.lang.split("-")[0]).toBe(language);
    expect(utterance.text).toBe(text);
    utterance.onend?.();
    await done;
  }
});

test("matching gender is preferred to a generic UAE voice; known opposite gender is excluded", () => {
  voices = [voice("Arabic", "ar-AE"), voice("Microsoft Hoda", "ar-EG"), voice("Microsoft Hamdan", "ar-AE")];
  expect(browserVoice(voices, "ar", "mira")?.name).toBe("Microsoft Hoda");
  expect(browserVoice(voices, "ar", "suhail")?.name).toBe("Microsoft Hamdan");
});

test("Arabic never falls back to a generic English voice", async () => {
  voices = [voice("Google US English", "en-US")];
  const result = expect(new BrowserSpeech().speak("مرحباً", "ar", "mira", new AbortController().signal, () => {}))
    .rejects.toThrow("browser_voice_missing_ar_mira");
  await vi.advanceTimersByTimeAsync(3000);
  await result;
  expect(synth.speak).not.toHaveBeenCalled();
  expect(browserSpeechError(new Error("browser_voice_missing_ar_mira"), "en")).toContain("Arabic");
});

test("Arabic voices arriving asynchronously are used without another click", async () => {
  voices = [];
  const done = new BrowserSpeech().speak("مرحباً", "ar", "suhail", new AbortController().signal, () => {});
  await vi.advanceTimersByTimeAsync(2000);
  voices = [voice("Microsoft Hamdan", "ar-AE")];
  synth.dispatchEvent(new Event("voiceschanged"));
  await vi.advanceTimersByTimeAsync(0);
  expect(spoken[0].voice?.name).toBe("Microsoft Hamdan");
  spoken[0].onend?.();
  await done;
});

test("a browser without speech synthesis receives a supported error", async () => {
  vi.stubGlobal("window", {});
  await expect(new BrowserSpeech().speak("Hello.", "en", "mira", new AbortController().signal, () => {}))
    .rejects.toThrow("browser_speech_unsupported");
});

test("switching from Listen to the microphone cancels playback without a failure error", async () => {
  const result = expect(new BrowserSpeech().speak("Hello.", "en", "mira", new AbortController().signal, () => {}))
    .rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(0);
  spoken[0].onerror?.({ error: "interrupted" });
  await result;
  expect(spoken[0].onend).toBeNull();
});

test("cancelling while browser voices load never starts a late reply", async () => {
  voices = [];
  const turn = new AbortController();
  const result = expect(new BrowserSpeech().speak("Hello.", "en", "mira", turn.signal, () => {}))
    .rejects.toMatchObject({ name: "AbortError" });
  turn.abort();
  voices = [voice("Microsoft Zira", "en-US")];
  synth.dispatchEvent(new Event("voiceschanged"));
  await vi.runAllTimersAsync();
  await result;
  expect(synth.speak).not.toHaveBeenCalled();
});

test("microphone interruption cancels browser speech and detaches late playback events", async () => {
  const turn = new AbortController(), player = new BrowserSpeech();
  const result = expect(player.speak("First reply.", "en", "mira", turn.signal, () => {}))
    .rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(0);
  turn.abort();
  await result;
  expect(synth.cancel).toHaveBeenCalledOnce();
  expect(spoken[0].onend).toBeNull();
  expect(spoken[0].onstart).toBeNull();
});

test("mute pauses the current browser voice and unmute resumes that same utterance", async () => {
  const player = new BrowserSpeech();
  const done = player.speak("Hello.", "en", "suhail", new AbortController().signal, () => {});
  await vi.advanceTimersByTimeAsync(0);
  player.setMuted(true);
  expect(synth.pause).toHaveBeenCalledOnce();
  player.setMuted(false);
  expect(synth.resume).toHaveBeenCalled();
  expect(synth.speak).toHaveBeenCalledOnce();
  spoken[0].onend?.();
  await done;
});
