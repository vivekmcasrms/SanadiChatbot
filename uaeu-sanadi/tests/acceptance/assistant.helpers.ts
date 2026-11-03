import { expect, type Page } from "@playwright/test";

export async function openFreshAssistant(page: Page) {
  await page.goto("/assistant", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/assistant/);
  await expect(page.locator("textarea")).toBeVisible();
  const switchToEnglish = page.getByRole("button", { name: /language|اللغة/i }).filter({ hasText: "English" });
  if (await switchToEnglish.isVisible()) await switchToEnglish.click();
  const newChat = page.getByRole("button", { name: /new chat/i });
  if (await newChat.isVisible()) await newChat.click();
}

export async function sendAndWait(page: Page, message: string) {
  const completed = page.getByText("Was this helpful?", { exact: true });
  const before = await completed.count();
  const input = page.locator("textarea");
  await input.fill(message);
  await input.press("Enter");
  await expect(completed).toHaveCount(before + 1, { timeout: 90_000 });
}

export function assistantPanel(page: Page) {
  return page.locator("section").first();
}

export async function respectAssistantRateLimit(page: Page, milliseconds = 4_300) {
  await page.waitForTimeout(milliseconds);
}
