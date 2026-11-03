import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";

type StoredCookie = Parameters<BrowserContext["addCookies"]>[0][number];
type MintedSession = {
  storage_key?: string;
  session?: unknown;
  cookies?: StoredCookie[];
};

function readMintedSession(): MintedSession | null {
  const sessionPath = path.join(os.homedir(), ".cache/lovable-auth/session.json");
  if (!fs.existsSync(sessionPath)) return null;
  return JSON.parse(fs.readFileSync(sessionPath, "utf8")) as MintedSession;
}

export async function restoreManagedSession(
  page: Page,
  context: BrowserContext,
  baseURL: string,
) {
  const minted = readMintedSession();
  const storageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? minted?.storage_key;
  const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ??
    (minted?.session ? JSON.stringify(minted.session) : null);
  const cookiesJson = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON;
  const cookies = cookiesJson
    ? (JSON.parse(cookiesJson) as StoredCookie[])
    : (minted?.cookies ?? []);

  if (!storageKey || !sessionJson) {
    throw new Error(
      "No managed browser session is available. Run `lovable auth-session --json --self` first.",
    );
  }

  if (cookies.length) {
    await context.addCookies(
      cookies.map((cookie) => {
        const { domain: _domain, path: _path, ...rest } = cookie;
        return { ...rest, url: baseURL };
      }),
    );
  }

  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key, value),
    [storageKey, sessionJson] as const,
  );
}
