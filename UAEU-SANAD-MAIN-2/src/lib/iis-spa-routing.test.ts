import { existsSync, readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const config = readFileSync(join(projectRoot, "public/web.config"), "utf8");

describe("IIS SPA callback routing", () => {
  it("uses built-in default documents without a catch-all SPA rewrite", () => {
    // Security probe/cookie rules may use URL Rewrite; SPA deep links must not
    // depend on a catch-all rewrite (finalize-static-build publishes physical entries).
    expect(config).not.toContain("TanStack application fallback");
    expect(config).toContain('<defaultDocument enabled="true">');
    expect(config).toContain('<add value="index.html" />');
  });

  it("publishes fixed routes while limiting fallbacks to real parameter routes", () => {
    const root = mkdtempSync(join(tmpdir(), "sanadi-static-test-"));
    try {
      mkdirSync(join(root, "scripts"));
      mkdirSync(join(root, "dist/client"), { recursive: true });
      mkdirSync(join(root, "public"), { recursive: true });
      mkdirSync(join(root, "src"), { recursive: true });
      const bootstrap = 'window.bootstrap="test";';
      const entry = `<html><script>${bootstrap}</script><script src="/assets/app.js"></script></html>`;
      writeFileSync(join(root, "dist/client/index.html"), entry);
      writeFileSync(join(root, "public/web.config"), config);
      writeFileSync(
        join(root, "src/routeTree.gen.ts"),
        "export interface FileRoutesByFullPath {\n  '/': unknown\n  '/auth': unknown\n  '/auth/callback': unknown\n  '/admin': unknown\n  '/voice': unknown\n  '/requests': unknown\n  '/requests/$caseId': unknown\n  '/verify/$token': unknown\n  '/verify-document/$token': unknown\n  '/submit/$type': unknown\n  '/api/chat/stream': unknown\n}\n",
      );
      writeFileSync(
        join(root, ".env"),
        [
          "VITE_API_BASE_URL=https://api.example.test",
          "VITE_FONT_STYLESHEET_URL=https://fonts.googleapis.com/css2",
          "VITE_FONT_FILES_ORIGIN=https://fonts.gstatic.com",
          "",
        ].join("\n"),
      );
      // Resolve vite from the real project while keeping the script under a temp tree.
      symlinkSync(join(projectRoot, "node_modules"), join(root, "node_modules"), "junction");
      const script = join(root, "scripts/finalize-static-build.mjs");
      copyFileSync(join(projectRoot, "scripts/finalize-static-build.mjs"), script);
      execFileSync(process.execPath, [script], { cwd: root });
      expect(readFileSync(join(root, "dist/client/auth/index.html"), "utf8")).toBe(entry);
      expect(readFileSync(join(root, "dist/client/auth/callback/index.html"), "utf8")).toBe(entry);
      for (const path of ["admin", "requests", "voice"])
        expect(readFileSync(join(root, `dist/client/${path}/index.html`), "utf8")).toBe(entry);
      for (const path of ["admin/GET", "admin/actuator/gateway/routes", "auth/WEB-INF/web.xml", "api/chat/stream"])
        expect(existsSync(join(root, "dist/client", path))).toBe(false);
      const assetConfig = readFileSync(join(root, "dist/client/assets/web.config"), "utf8");
      expect(assetConfig).toContain('cacheControlMaxAge="365.00:00:00"');
      expect(config).not.toContain('cacheControlMaxAge="365.00:00:00"');
      expect(readFileSync(join(root, "dist/client/auth/callback/web.config"), "utf8"))
        .toContain('value="no-store"');
      const built = readFileSync(join(root, "dist/client/web.config"), "utf8");
      expect(built).not.toContain("%VITE_");
      expect(built).not.toContain("%CSP_SCRIPT_HASHES%");
      expect(built).toContain(`'sha256-${createHash("sha256").update(bootstrap).digest("base64")}'`);
      expect(built.match(/script-src ([^;]+)/)?.[1]).not.toContain("'unsafe-inline'");
      for (const path of ["requests", "verify", "verify-document", "submit"])
        expect(built).toContain(`<location path="${path}">`);
      for (const path of ["auth", "admin", "voice", "api/chat/stream"])
        expect(built).not.toContain(`<location path="${path}">`);
      expect(built).toContain("Reject legacy and system probes");
      expect(assetConfig).toContain('<remove name="Cache-Control" />');
      const surveyConfig = readFileSync(join(root, "dist/client/survey/web.config"), "utf8");
      expect(surveyConfig).toContain("https://sandboxsurvey.customerpulse.gov.ae");
      expect(surveyConfig).toContain(`'sha256-${createHash("sha256").update(bootstrap).digest("base64")}'`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
