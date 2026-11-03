// Isolated UI contract test: all API/WebSocket traffic is mocked, with no real student data.
// Run against the static build with SANADI_UI_TEST_URL (default http://127.0.0.1:8080).
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function wav(seconds) {
  const rate = 16000, count = seconds * rate, bytes = Buffer.alloc(44 + count * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36);
  bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 440) * 8000), 44 + i * 2);
  return bytes;
}
await mkdir("test-results/voice", { recursive: true });
const recording = resolve("test-results/voice/input.wav");
await writeFile(recording, wav(10));
const base = process.env.SANADI_UI_TEST_URL ?? "http://127.0.0.1:8080";
const browser = await chromium.launch({ channel: "msedge", headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${recording}`] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["microphone"] });
  let callSocket, submitted, allowedCapture = true;
  const interrupts = [], metrics = [], errors = [], unexpected = [];
  await context.routeWebSocket(/\/api\/voice\/call$/, ws => {
    callSocket = ws;
    ws.send(JSON.stringify({ type: "ready", audio: "wav", audioWindow: 2 }));
    ws.onMessage(raw => {
      const message = JSON.parse(raw);
      if (message.type === "greet") ws.send(JSON.stringify({ type: "done", turnId: message.turnId }));
      if (message.type === "interrupt") interrupts.push(message.turnId);
      if (message.type === "turn") {
        submitted = message;
        ws.send(JSON.stringify({ type: "transcript", turnId: message.turnId, text: message.message, language: message.language }));
      }
    });
  });
  await context.routeWebSocket(/\/api\/voice\/activity$/, ws => {
    let sequence = 0;
    const capture = allowedCapture;
    allowedCapture = false;
    ws.send(JSON.stringify({ type: "ready", sampleRate: 16000, frameSamples: 512 }));
    ws.onMessage(() => {
      const event = capture && sequence === 4 ? "speech" : capture && sequence === 65 ? "pause" : "continue";
      ws.send(JSON.stringify({ type: "activity", sequence: sequence++, event }));
    });
  });
  await context.addInitScript(() => {
    window.__testTracks = [];
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await get(...args); window.__testTracks.push(...stream.getTracks()); return stream;
    };
  });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/")) {
      if (url.origin === new URL(base).origin) return route.continue();
      if (url.hostname === "fonts.googleapis.com") return route.fulfill({ contentType: "text/css", body: "" });
      unexpected.push(url.origin); return route.abort();
    }
    let body = {};
    if (url.pathname === "/api/v1/auth/user") body = { id: "00000000-0000-4000-8000-000000000001", email: null };
    else if (url.pathname.includes("/data/")) body = [];
    else if (url.pathname.endsWith("/ticket")) body = { ticket: "ab".repeat(32) };
    else if (url.pathname === "/api/voice/call/prepare") return route.fulfill({ status: 204 });
    else if (url.pathname === "/api/voice/transcribe") {
      expect(route.request().postDataJSON().targetLanguage).toBeUndefined();
      body = { text: "Show course MATH 101" };
    } else if (url.pathname === "/api/voice/metrics") metrics.push(route.request().postDataJSON());
    else { unexpected.push(url.pathname); return route.fulfill({ status: 503, json: { error: "unmocked_test_endpoint" } }); }
    return route.fulfill({ json: body });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/voice`);
  await page.getByRole("button", { name: "Talk to Sanadi", exact: true }).click();
  const transcript = page.getByRole("textbox", { name: "Recognized question" });
  await expect(transcript).toHaveValue("Show course MATH 101", { timeout: 20_000 });
  expect(submitted).toBeUndefined();
  await transcript.fill("Show course MATH 102");
  await page.screenshot({ path: "test-results/voice/mobile-review.png", fullPage: true });
  await page.getByRole("button", { name: "Confirm text and send" }).click();
  await expect.poll(() => submitted?.message).toBe("Show course MATH 102");
  await page.getByRole("button", { name: "Interrupt and speak" }).click();
  await expect.poll(() => interrupts).toContain(submitted.turnId);
  callSocket.send(JSON.stringify({ type: "result", turnId: submitted.turnId, language: "en", response: { answer: "STALE RESULT" } }));
  await expect(page.getByText("STALE RESULT")).toHaveCount(0);
  await page.getByRole("button", { name: "End call", exact: true }).click();
  expect(await page.evaluate(() => window.__testTracks.every(track => track.readyState === "ended"))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => localStorage.setItem("uaeu.lang", "ar"));
  await page.setViewportSize({ width: 844, height: 390 });
  await page.reload();
  await expect(page.locator("main")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("تحدث مع سندي");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/voice/landscape-ar.png", fullPage: true });
  expect(metrics.some(metric => metric.type === "transcript_review")).toBe(true);
  expect(errors).toEqual([]); expect(unexpected).toEqual([]);
  console.log("PASS: shared call protocol, original transcript, editable identifiers, interruption, stale-result rejection, microphone cleanup, mobile and Arabic layouts. Speech/model quality is not simulated.");
} finally { await browser.close(); }
