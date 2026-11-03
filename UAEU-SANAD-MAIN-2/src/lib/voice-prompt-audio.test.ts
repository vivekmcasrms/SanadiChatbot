import { afterEach, expect, test, vi } from "vitest";
import { VoicePromptAudio } from "./voice-prompt-audio";

vi.mock("./auth-token", () => ({ apiUrl: (path: string) => path, getAuthToken: () => null }));
function prepared(cuesEnabled = false) {
  const wav = new Uint8Array(48);
  wav.set(new TextEncoder().encode("RIFF")); wav.set(new TextEncoder().encode("WAVE"), 8);
  return { text: "Prepared server voice", audioBase64: btoa(String.fromCharCode(...wav)), cuesEnabled, initialCount: 2, waitingCount: 2 };
}
afterEach(() => vi.unstubAllGlobals());
test("ready welcome is in browser memory; no new request is needed on microphone click", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(prepared())));
  vi.stubGlobal("fetch", fetcher);
  const audio = new VoicePromptAudio();
  await audio.prepare("mira", "en");
  expect(audio.get("mira", "en", "welcome")[0]?.text).toBe("Prepared server voice");
  expect(audio.get("mira", "ar", "welcome")).toEqual([]);
  await audio.prepare("mira", "en");
  expect(fetcher).toHaveBeenCalledOnce();
  expect(audio.enabled).toBe(false);
});
test("enabled preparation fetches bounded public clips in both languages, never student messages", async () => {
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(prepared(true))));
  vi.stubGlobal("fetch", fetcher);
  const audio = new VoicePromptAudio();
  await audio.prepare("suhail", "ar");
  expect(audio.enabled).toBe(true);
  for (const language of ["en", "ar"] as const) {
    expect(audio.get("suhail", language, "initial")).toHaveLength(2);
    expect(audio.get("suhail", language, "waiting")).toHaveLength(2);
  }
  expect(fetcher).toHaveBeenCalledTimes(9);
  for (const call of fetcher.mock.calls) expect((call[1] as RequestInit).body).not.toContain("message");
});
test.each([204, 401, 503])("optional preparation response %s keeps the existing welcome fallback", async status => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status })));
  const audio = new VoicePromptAudio();
  await expect(audio.prepare("mira", "en")).resolves.toBeUndefined();
  expect(audio.get("mira", "en", "welcome")).toEqual([]);
  expect(audio.enabled).toBe(false);
});
test("End Call aborts optional warm-up without touching another request", async () => {
  let signal!: AbortSignal;
  const fetcher = vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    signal = init.signal!;
    signal.addEventListener("abort", () => reject(new DOMException("Interrupted", "AbortError")));
  }));
  vi.stubGlobal("fetch", fetcher);
  const audio = new VoicePromptAudio();
  const loading = audio.prepare("mira", "en");
  audio.cancel();
  await loading;
  expect(signal.aborted).toBe(true);
  expect(fetcher).toHaveBeenCalledOnce();
});

test("a question pauses the queue without cancelling and regenerating the in-flight public cue", async () => {
  let complete!: (response: Response) => void;
  let signal!: AbortSignal;
  let calls = 0;
  const fetcher = vi.fn((_url: string, init: RequestInit) => {
    if (++calls === 2) {
      signal = init.signal!;
      return new Promise<Response>(resolve => { complete = resolve; });
    }
    return Promise.resolve(new Response(JSON.stringify(prepared(true))));
  });
  vi.stubGlobal("fetch", fetcher);
  const audio = new VoicePromptAudio();
  const loading = audio.prepare("mira", "en");
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  audio.pause();
  audio.pause(); // Repeated questions cannot abort the same generation repeatedly.
  expect(signal.aborted).toBe(false);
  complete(new Response(JSON.stringify(prepared(true))));
  await loading;
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(audio.get("mira", "en", "initial")).toHaveLength(1);
  expect(audio.get("mira", "ar", "initial")).toEqual([]);
  await audio.prepare("mira", "en");
  expect(fetcher).toHaveBeenCalledTimes(9);
  const requests = fetcher.mock.calls.map(call => JSON.parse(call[1].body as string));
  expect(requests.filter(body => body.kind === "initial" && body.index === 0 && body.language === "en")).toHaveLength(1);
});

test("a paused welcome finishes caching without starting a cue", async () => {
  let complete!: (response: Response) => void;
  let signal!: AbortSignal;
  const fetcher = vi.fn((_url, init: RequestInit) => {
    signal = init.signal!;
    return new Promise<Response>(resolve => { complete = resolve; });
  });
  vi.stubGlobal("fetch", fetcher);
  const audio = new VoicePromptAudio();
  const loading = audio.prepare("mira", "en");
  audio.pause();
  expect(signal.aborted).toBe(false);
  complete(new Response(JSON.stringify(prepared(true))));
  await loading;
  expect(fetcher).toHaveBeenCalledOnce();
  expect(audio.get("mira", "en", "welcome")).toHaveLength(1);
});

test("opening the microphone while welcome preparation runs never cancels or duplicates that work", async () => {
  let complete!: (response: Response) => void;
  let signal!: AbortSignal;
  const fetcher = vi.fn((_url, init: RequestInit) => {
    signal = init.signal!;
    return new Promise<Response>(resolve => { complete = resolve; });
  });
  vi.stubGlobal("fetch", fetcher);
  const audio = new VoicePromptAudio();
  const loading = audio.prepare("mira", "en");
  await audio.prepare("mira", "en");
  expect(fetcher).toHaveBeenCalledOnce();
  expect(signal.aborted).toBe(false);
  complete(new Response(JSON.stringify(prepared())));
  await loading;
  expect(audio.get("mira", "en", "welcome")).toHaveLength(1);
});

test.each(["en", "ar"] as const)("%s greeting preparation follows the ready welcome even with acknowledgments disabled", async language => {
  const fetcher = vi.fn(async (path: string) => path.endsWith("/prepare")
    ? new Response(JSON.stringify({ ...prepared(), greetingCount: 3 }))
    : new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  const audio = new VoicePromptAudio();
  await audio.prepare("mira", language);
  expect(audio.get("mira", language, "welcome")).toHaveLength(1);
  expect(audio.enabled).toBe(false);
  expect(fetcher.mock.calls.map(call => call[0])).toEqual([
    "/api/voice/call/prepare", "/api/voice/call/greeting", "/api/voice/call/greeting", "/api/voice/call/greeting",
  ]);
  await audio.prepare("mira", language);
  expect(fetcher).toHaveBeenCalledTimes(4);
});

test("a ready welcome never waits for greetings, and a question pauses remaining greeting preparation", async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn((path: string) => path.endsWith("/prepare")
    ? Promise.resolve(new Response(JSON.stringify({ ...prepared(), greetingCount: 3 })))
    : new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  const audio = new VoicePromptAudio();
  const warming = audio.prepare("suhail", "ar");
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(audio.get("suhail", "ar", "welcome")).toHaveLength(1);
  audio.pause();
  finish(new Response(null, { status: 204 }));
  await warming;
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test("failed optional greeting preparation keeps the welcome and existing processing cues", async () => {
  const fetcher = vi.fn(async (path: string) => path.endsWith("/greeting")
    ? new Response(null, { status: 503 })
    : new Response(JSON.stringify({ ...prepared(true), greetingCount: 3 })));
  vi.stubGlobal("fetch", fetcher);
  const audio = new VoicePromptAudio();
  await audio.prepare("mira", "en");
  expect(audio.get("mira", "en", "welcome")).toHaveLength(1);
  expect(audio.get("mira", "en", "initial")).toHaveLength(2);
  expect(audio.get("mira", "ar", "waiting")).toHaveLength(2);
  expect(audio.enabled).toBe(true);
});

test.each(["en", "ar"] as const)("full %s greeting is kept in browser memory and replaces per-sentence warm-up", async language => {
  const fetcher = vi.fn(async (path: string) => new Response(JSON.stringify({ ...prepared(),
    ...(path.endsWith("/prepare") ? { greetingReplyAvailable: true, greetingCount: 3 } : {}) })));
  vi.stubGlobal("fetch", fetcher);
  const audio = new VoicePromptAudio();
  await audio.prepare("suhail", language);
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(["/api/voice/call/prepare", "/api/voice/call/greeting-reply"]);
  expect(audio.get("suhail", language, "greetingReply")).toHaveLength(1);
  expect(audio.get("mira", language, "greetingReply")).toEqual([]);
  await audio.prepare("suhail", language);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test("full greeting preparation never holds up the ready welcome and can pause without losing its result", async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn((path: string) => path.endsWith("/prepare")
    ? Promise.resolve(new Response(JSON.stringify({ ...prepared(true), greetingReplyAvailable: true, greetingCount: 3 })))
    : new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  const audio = new VoicePromptAudio();
  const warming = audio.prepare("mira", "en");
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(audio.get("mira", "en", "welcome")).toHaveLength(1);
  expect(audio.get("mira", "en", "greetingReply")).toEqual([]);
  expect(audio.supportsGreetingReply("mira", "en")).toBe(true);
  expect(audio.supportsGreetingReply("suhail", "en")).toBe(false);
  expect(audio.supportsGreetingReply("mira", "ar")).toBe(false);
  audio.pause();
  finish(new Response(JSON.stringify(prepared())));
  await warming;
  expect(audio.get("mira", "en", "greetingReply")).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test("unavailable full greeting audio leaves the existing sentence preparation available", async () => {
  const fetcher = vi.fn(async (path: string) => path.endsWith("/prepare")
    ? new Response(JSON.stringify({ ...prepared(), greetingReplyAvailable: true, greetingCount: 2 }))
    : new Response(null, { status: path.endsWith("/greeting-reply") ? 503 : 204 }));
  vi.stubGlobal("fetch", fetcher);
  const audio = new VoicePromptAudio();
  await audio.prepare("mira", "ar");
  expect(audio.get("mira", "ar", "welcome")).toHaveLength(1);
  expect(audio.get("mira", "ar", "greetingReply")).toEqual([]);
  expect(fetcher.mock.calls.map(call => call[0])).toEqual([
    "/api/voice/call/prepare", "/api/voice/call/greeting-reply", "/api/voice/call/greeting", "/api/voice/call/greeting",
  ]);
});
