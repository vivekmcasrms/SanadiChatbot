// Isolated composer check: real Web Audio WAV playback, fake recognition and intercepted APIs/WebSocket.
// Tests lifecycle/transport, not deployed Chatterbox voice quality or actual university transactions.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function wav(seconds, voiced = seconds) {
  const rate = 16000, count = seconds * rate, bytes = Buffer.alloc(44 + count * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36);
  bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(i < voiced * rate
    ? Math.round(Math.sin(i / rate * Math.PI * 440) * 8000) : 0, 44 + i * 2);
  return bytes;
}
await mkdir("test-results/voice", { recursive: true });
const inputFile = resolve("test-results/voice/composer.wav");
await writeFile(inputFile, wav(5, 2));
const chat = "00000000-0000-4000-8000-000000000002";
const expectedApiOrigin = process.env.VOICE_TEST_API_ORIGIN || "http://localhost:5281";
function response(answer) {
  return {
    answer, conversationId: chat, messageId: crypto.randomUUID(), agent: "knowledge", classification: {},
    verified: true, proposedActions: [], nextSteps: ["Your existing service cards stay here."], toolsUsed: [], activity: [],
    citations: [], intents: [], clarifyingQuestion: null, responseType: "answer", receipt: null,
    issuedDocument: null, careerInsight: null, libraryResults: null, caseResult: null, followUp: null,
  };
}
const browser = await chromium.launch({ channel: "msedge", headless: true, args: [
  "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${inputFile}`,
] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["microphone"] });
  const starts = [];
  let closed = 0, typed = 0, tickets = 0, refreshes = 0, sockets = 0, interruptions = 0;
  const played = [];
  await context.addInitScript(() => {
    window.__micCalls = 0;
    window.__recognitions = [];
    window.__recognitionFailure = null;
    window.__ttsUtterances = [];
    window.__micStreams = [];
    const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.__mediaConstraints = constraints;
      const stream = await getMedia(constraints);
      window.__micStreams.push(stream);
      return stream;
    };
    window.__audioSources = [];
    window.__gains = [];
    const createSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = createSource.call(this);
      const entry = { stopped: false, ended: false, start: null, duration: null };
      window.__audioSources.push(entry);
      const start = source.start.bind(source), stop = source.stop.bind(source);
      source.start = (...args) => { entry.start = args[0]; entry.duration = source.buffer.duration; return start(...args); };
      source.stop = (...args) => { entry.stopped = true; return stop(...args); };
      source.addEventListener("ended", () => { entry.ended = true; });
      return source;
    };
    const createGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () {
      const gain = createGain.call(this); window.__gains.push(gain); return gain;
    };
    Object.defineProperty(window, "speechSynthesis", { value: {
      getVoices: () => [], cancel() {}, resume() {},
      speak() { throw new Error("Browser TTS must not run during WAV playback"); },
    } });
    window.SpeechRecognition = class {
      constructor() { this.active = false; window.__recognitions.push(this); }
      start() {
        this.active = true;
        window.__micCalls++;
        this.onstart?.();
      }
      stop() { clearTimeout(this.timer); this.active = false; this.onend?.(); }
      abort() { clearTimeout(this.timer); this.active = false; }
    };
  });
  await context.routeWebSocket(/\/api\/voice\/call$/, ws => {
    sockets++;
    ws.onClose(() => closed++);
    ws.send(JSON.stringify({ type: "ready", audio: "wav" }));
    ws.onMessage(data => {
      // Audio must never reach the failing server STT path.
      expect(typeof data).toBe("string");
      const start = JSON.parse(data);
      if (start.type === "end") return;
      if (start.type === "played") { played.push(start); return; }
      if (start.type === "ping") { ws.send(JSON.stringify({ type: "pong" })); return; }
      if (start.type === "interrupt") {
        interruptions++;
        // A late frame from cancelled generation must never be spoken.
        const stale = wav(1);
        ws.send(JSON.stringify({ type: "audio", sequence: 2, bytes: stale.length, turnId: start.turnId,
          text: "Stale reply.", language: "en", agent: "mira" }));
        ws.send(stale);
        return;
      }
      expect(start.type).toBe("turn");
      expect(start.message).toBeTruthy();
      starts.push(start);
      const language = /[\u0600-\u06ff]/.test(start.message) ? "ar" : "en";
      const question = start.message;
      const answer = language === "en" ? "Your GPA is three point five." : "معدلك ثلاثة فاصلة خمسة.";
      const send = event => ws.send(JSON.stringify({ ...event, turnId: start.turnId }));
      send({ type: "transcript", text: question, language });
      send({ type: "result", response: response(answer), language });
      const audio = wav(starts.length === 1 ? 20 : 1.5);
      for (let sequence = 0; sequence < 2; sequence++) {
        send({ type: "audio", sequence, bytes: audio.length, text: answer, language, agent: start.agent });
        ws.send(audio);
      }
      send({ type: "done" });
    });
  });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/")) {
      // Check the compiled API address even though endpoint responses are mocked.
      // A production-mode bundle on localhost previously hid a real ticket 404.
      expect(url.origin).toBe(expectedApiOrigin);
      let body;
      if (url.pathname === "/api/v1/auth/user") body = { id: "00000000-0000-4000-8000-000000000001" };
      else if (url.pathname === "/api/route-access") body = { allowed: true, landing: "/assistant" };
      else if (url.pathname.includes("/data/")) body = [];
      else if (url.pathname.endsWith("/messages") || url.pathname.endsWith("/completed-actions")) body = [];
      else if (url.pathname.endsWith("/continuity")) body = { conversationId: null };
      else if (url.pathname.endsWith("/briefing")) body = { hasProfile: false, headline: "", facts: [] };
      else if (url.pathname.endsWith("/paged") || url.pathname.startsWith("/api/student-lists/"))
        body = { items: [], total: 0, page: 1, pageSize: 100, pageCount: 1 };
      else if (url.pathname === "/api/voice/call/ticket") {
        expect(url.search).toBe("");
        tickets++;
        // Reproduce the old API's empty response after access-token expiry.
        if (tickets === 1) return route.fulfill({ status: 200, body: "" });
        expect(route.request().headers().authorization).toMatch(/^Bearer /);
        body = { ticket: "ab".repeat(32) };
      }
      else if (url.pathname === "/api/v1/auth/token" && url.searchParams.get("grant_type") === "refresh_token") {
        refreshes++;
        body = {
          access_token: `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.test`,
          refresh_token: "test-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: "00000000-0000-4000-8000-000000000001", email: null },
        };
      }
      else if (url.pathname === "/api/chat/stream" && route.request().method() === "POST") {
        typed++;
        return route.fulfill({ contentType: "text/event-stream", body:
          `data: ${JSON.stringify({ type: "final", response: response("Typed chat still works.") })}\n\n` });
      } else return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unmocked_test_endpoint"}' });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    }
    return url.hostname === "127.0.0.1" && url.port === "8080" ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  const recognize = async (text, final = true) => {
    await expect.poll(() => page.evaluate(() => window.__recognitions.some(r => r.active))).toBe(true);
    await page.evaluate(({ text, final }) => {
      const r = window.__recognitions.findLast(r => r.active);
      r.results ??= [];
      if (r.results.at(-1)?.isFinal === false) r.results.pop();
      r.results.push({ isFinal: final, 0: { transcript: text } });
      r.onresult?.({ results: r.results });
    }, { text, final });
  };
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:8080/assistant?chat=${chat}`);
  const mic = page.getByRole("button", { name: "Start voice chat", exact: true });
  await expect(mic).toBeEnabled();
  await expect(page.getByRole("link", { name: "Voice conversation" })).toHaveCount(0);
  const activity = page.getByRole("region", { name: "Active voice chat", exact: true });
  await expect(activity).toHaveCount(0);
  expect(await page.evaluate(() => window.__micCalls)).toBe(0);
  await page.locator("textarea.composer-input").fill("Keep this typed draft");
  await mic.click();
  await expect(activity).toHaveAttribute("data-state", "listening");
  await expect(activity.getByRole("status")).toHaveText("Mira · Listening");
  await activity.screenshot({ path: "test-results/voice/active-listening.png" });
  await recognize("What is my GPA?");
  await expect(page.getByText("Your GPA is three point five.", { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(activity).toHaveAttribute("data-state", "speaking");
  await activity.getByRole("button", { name: "Mute agent audio", exact: true }).click();
  expect(await page.evaluate(() => window.__gains.at(-1).gain.value)).toBe(0);
  await activity.getByRole("button", { name: "Unmute agent audio", exact: true }).click();
  expect(await page.evaluate(() => window.__gains.at(-1).gain.value)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__audioSources.length)).toBe(2);
  const scheduled = await page.evaluate(() => window.__audioSources);
  expect(Math.abs(scheduled[1].start - scheduled[0].start - scheduled[0].duration)).toBeLessThan(0.001);
  await page.setViewportSize({ width: 390, height: 844 });
  await activity.scrollIntoViewIfNeeded();
  await activity.screenshot({ path: "test-results/voice/active-speaking-mobile.png" });
  expect(await activity.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByText("What is my GPA?", { exact: true })).toBeVisible();
  await expect(page.getByText("Your existing service cards stay here.", { exact: true })).toBeVisible();
  await expect(page.locator("textarea.composer-input")).toHaveValue("Keep this typed draft");
  expect(starts[0].agent).toBe("mira");
  expect(starts[0].conversationId).toBe(chat);
  expect(tickets).toBe(2);
  expect(refreshes).toBe(1);
  expect(new URL(page.url()).pathname).toBe("/assistant");
  expect(context.pages()).toHaveLength(1);
  expect(sockets).toBe(1);
  expect(closed).toBe(0);
  await recognize("Your GPA is three point five.");
  await page.waitForTimeout(1300);
  expect(interruptions).toBe(0);
  expect(starts).toHaveLength(1);
  await recognize("What about my courses?", false);
  await expect(page.getByRole("button", { name: "Finish speaking", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__audioSources.slice(0, 2).every(s => s.stopped))).toBe(true);
  expect(interruptions).toBe(1);
  await recognize("What about my courses?");
  await expect.poll(() => starts.length).toBe(2);
  await expect(activity).toHaveAttribute("data-state", "speaking");
  expect(starts[1].introduce).toBe(false);
  expect(sockets).toBe(1);
  expect(closed).toBe(0);
  expect(await page.evaluate(() => window.__audioSources.length)).toBe(4);
  await expect(activity).toHaveAttribute("data-state", "listening");
  expect(sockets).toBe(1);
  expect(closed).toBe(0);
  await activity.getByRole("button", { name: "End call", exact: true }).click();
  await expect(activity).toHaveCount(0);
  await expect.poll(() => closed).toBe(1);
  expect(await page.evaluate(() => window.__micStreams.every(s => s.getTracks().every(t => t.readyState === "ended")))).toBe(true);
  expect(await page.evaluate(() => window.__recognitions.every(r => !r.active))).toBe(true);
  await page.getByRole("button", { name: "Suhail", exact: true }).click();
  expect(await page.evaluate(() => window.__recognitions.every(r => !r.active))).toBe(true);
  await page.getByRole("combobox", { name: "Spoken language", exact: true }).selectOption("ar");
  await mic.click();
  await recognize("ما هو معدلي؟");
  await expect(page.getByText("معدلك ثلاثة فاصلة خمسة.", { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(activity.getByRole("status")).toHaveText("Suhail · Speaking");
  expect(starts.at(-1).agent).toBe("suhail");
  await activity.getByRole("button", { name: "End call", exact: true }).click();
  await expect(activity).toHaveCount(0);
  expect(await page.evaluate(() => window.__recognitions.every(r => !r.active))).toBe(true);
  expect(await page.evaluate(() => window.__audioSources.every(s => s.stopped || s.ended))).toBe(true);
  expect(starts[2].agent).toBe("suhail");
  expect(starts[2].lang).toBeUndefined();
  for (const [agent, language] of [
    ["Mira", "ar"], ["Suhail", "en"],
  ]) {
    await page.getByRole("button", { name: agent, exact: true }).click();
    await page.getByRole("combobox", { name: "Spoken language", exact: true }).selectOption(language);
    await mic.click();
    await recognize(language === "ar" ? "ما هو معدلي؟" : "What is my GPA?");
    await expect(activity).toHaveAttribute("data-state", "speaking");
    expect(starts.at(-1).agent).toBe(agent.toLowerCase());
    await activity.getByRole("button", { name: "End call", exact: true }).click();
  }
  await mic.click();
  await expect(activity).toHaveAttribute("data-state", "listening");
  await page.evaluate(() => window.__recognitions.findLast(r => r.active).onerror({ error: "network" }));
  await expect(page.getByText("Browser speech recognition could not connect. Check your connection or type your question.", { exact: true }))
    .toBeVisible({ timeout: 20000 });
  await expect(activity).toHaveCount(0);
  await expect(mic).toBeEnabled();
  expect(await page.evaluate(() => window.__recognitions.every(r => !r.active))).toBe(true);
  expect(await page.evaluate(() => window.__audioSources.every(s => s.stopped || s.ended))).toBe(true);
  await expect(page.getByText("The voice reply could not finish. Please try again.", { exact: true })).toHaveCount(0);
  await page.locator("textarea.composer-input").fill("A typed question");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Typed chat still works.", { exact: true })).toBeVisible().catch(async error => {
    console.log({ typed, errors, notices: await page.locator("[data-sonner-toast]").allTextContents() });
    await page.screenshot({ path: "test-results/voice/active-bar-check-failure.png", fullPage: true });
    throw error;
  });
  expect(played.filter(e => e.turnId === starts[1].turnId)).toHaveLength(2);
  expect(typed).toBe(1);
  expect(starts).toHaveLength(5);
  expect(context.pages()).toHaveLength(1);
  expect(errors).toEqual([]);
  console.log(`PASS: native WAV audio predecodes without overlap; one socket stays open across replies and spoken interruption; echo and stale speech ignored; End Call releases microphone/socket/playback; both identities/languages, mute, mobile layout, typed chat and cards preserved. API origin: ${expectedApiOrigin}`);
} finally { await browser.close(); }
