import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const projectFile = (path: string) => new URL(`../../${path}`, import.meta.url);
const source = (path: string) => readFileSync(projectFile(path), "utf8");

describe("WebInspect UI remediations", () => {
  it("publishes and links the privacy policy", () => {
    expect(source("src/routes/index.tsx")).toContain('to="/privacy"');
    expect(source("src/routes/privacy.tsx")).toContain("Privacy Policy");
    expect(source("src/routes/privacy.tsx")).toContain("سياسة الخصوصية");
  });

  it("keeps /auth free of credential fields and disables demo password autocomplete", () => {
    // Production auth is SSO-only (no email/password form on /auth).
    const authPage = source("src/components/AuthPage.tsx");
    expect(authPage).not.toMatch(/type=["']password["']/);
    expect(authPage).not.toContain('autoComplete="email"');
    expect(authPage).not.toContain('autoComplete="current-password"');
    const demo = source("src/routes/demo.tsx");
    expect(demo).toContain('autoComplete="off"');
    expect(demo).not.toContain('autoComplete="current-password"');
  });

  it("does not ship the obsolete ExcelJS bundle reported by the scan", () => {
    expect(source("package.json").toLowerCase()).not.toContain("exceljs");
    expect(source("package-lock.json").toLowerCase()).not.toContain("exceljs");
    expect(existsSync(projectFile("public/robots.txt"))).toBe(false);
  });
});
