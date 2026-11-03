import { expect, test } from "@playwright/test";
import { restoreManagedSession } from "./auth";
import {
  assistantPanel,
  openFreshAssistant,
  respectAssistantRateLimit,
  sendAndWait,
} from "./assistant.helpers";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page, context, baseURL }) => {
  await restoreManagedSession(page, context, baseURL ?? "http://localhost:8080");
  await openFreshAssistant(page);
});

test.afterEach(async ({ page }) => {
  await respectAssistantRateLimit(page);
});

test("library ordinal follow-up stays with the Library Agent", async ({ page }) => {
  const panel = assistantPanel(page);
  await sendAndWait(page, "Find me a good book on deep learning.");
  await expect(panel.getByText(/Library catalogue results \(\d+ matches\)/)).toBeVisible();

  await respectAssistantRateLimit(page);
  await sendAndWait(page, "Is the first one available online?");
  await expect(panel).not.toContainText("Book this appointment");
  await expect(panel).not.toContainText("You chose Monday");
  await expect(panel).toContainText(/library|catalogue|online|availability/i);
});

test("appointment slots remain sequential and ambiguous service replies clarify", async ({ page }) => {
  const panel = assistantPanel(page);
  await sendAndWait(page, "I want to book a career counselling appointment.");

  const text = await panel.innerText();
  for (const number of [1, 2, 3, 4, 5]) {
    expect(text).toMatch(new RegExp(`(^|\\n)${number}\\.\\s`));
  }
  expect(text).toContain("Reply with the option number or preferred time");

  await respectAssistantRateLimit(page);
  await sendAndWait(page, "Career counselling session");
  await expect(panel).toContainText(/More than one offered appointment matches|Which would you like/i);
  await expect(panel).toContainText(/option number|advisor's name/i);
  await expect(panel).not.toContainText("Best-fit roles");
  await expect(panel.getByRole("button", { name: "Book this appointment" })).toHaveCount(0);
});

test("ATS result is delivered inside chat with a deterministic state", async ({ page }) => {
  const panel = assistantPanel(page);
  await sendAndWait(page, "What is my ATS score?");
  await expect(panel.getByText("Career snapshot")).toBeVisible();

  const atsScore = panel.getByText("ATS score", { exact: true });
  const uploadCv = panel.getByRole("button", { name: "Upload CV" });
  await expect(atsScore.or(uploadCv)).toBeVisible();
  await expect(panel.getByRole("link", { name: "Full analysis" })).toBeVisible();
  await expect(page).toHaveURL(/\/assistant/);
});

test("course textbook help combines Blackboard, enrolments, and catalogue results", async ({ page }) => {
  const panel = assistantPanel(page);
  await sendAndWait(page, "Where can I get the textbook for my course?");
  await expect(panel).toContainText(/Blackboard/i);
  await expect(panel).toContainText("Routed to: Library Services");
  await expect(panel).not.toContainText("Routed to: Admission & Registration");

  const noActiveCourses = panel.getByText(/don't see any courses registered/i);
  const catalogueResults = panel.getByText(/Library catalogue results \(\d+ matches\)/);
  await expect(noActiveCourses.or(catalogueResults)).toBeVisible();
  if (await catalogueResults.isVisible()) {
    await expect(panel).toContainText(/[A-Z]{2,5}\d{3}/);
  } else {
    await expect(panel).toContainText(/can't look up specific course textbooks/i);
  }
});

test("lost property offers an FMD notification without executing it", async ({ page }) => {
  const panel = assistantPanel(page);
  await sendAndWait(page, "I lost my blue wallet near the main gate on campus.");
  await expect(panel).toContainText(/Lost property|Security incidents/i);
  await expect(panel).toContainText("Responsible unit: FMD");
  const action = panel.getByRole("button", { name: /Notify FMD now/i });
  await expect(action).toBeVisible();
  await action.click();
  await expect(page.getByRole("dialog")).toContainText("FMD");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
});

test("career-hours feedback is a suggestion, not a career analysis", async ({ page }) => {
  const panel = assistantPanel(page);
  await sendAndWait(
    page,
    "It would be helpful if career counselling stayed open later during recruitment season.",
  );
  await expect(panel.getByRole("button", { name: "Submit this suggestion" })).toBeVisible();
  await expect(panel).not.toContainText("Best-fit roles");
  await expect(panel).not.toContainText("Career snapshot");
});