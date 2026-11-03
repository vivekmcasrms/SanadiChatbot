import { loadEnv } from "vite";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/acceptance",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  outputDir: "/tmp/sanadi-playwright/artifacts",
  reporter: [["list"], ["html", { outputFolder: "/tmp/sanadi-playwright/report", open: "never" }]],
  use: {
    baseURL: process.env.ACCEPTANCE_BASE_URL ?? loadEnv("development", process.cwd(), "VITE_").VITE_PUBLIC_APP_URL,
    viewport: { width: 1280, height: 1800 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
});