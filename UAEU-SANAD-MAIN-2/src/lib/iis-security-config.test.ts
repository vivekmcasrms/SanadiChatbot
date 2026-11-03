import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const configUrl = new URL("../../public/web.config", import.meta.url);
const robotsUrl = new URL("../../public/robots.txt", import.meta.url);
const config = readFileSync(configUrl, "utf8");

describe("IIS security configuration", () => {
  it("disables directory listing and rejects ambiguous paths and hidden sources", () => {
    expect(config).toContain('<directoryBrowse enabled="false" />');
    expect(config).toContain('<add sequence="..;" />');
    expect(config).toContain('allowDoubleEscaping="false"');
    expect(config).toContain('<add segment=".git" />');
    expect(config).toContain('<add segment=".env" />');
  });

  it("does not publish a revealing robots file", () => {
    expect(existsSync(robotsUrl)).toBe(false);
  });

  it("sets the report-required browser protections", () => {
    for (const required of [
      "Content-Security-Policy",
      "frame-ancestors 'none'",
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Strict-Transport-Security",
      'name="Cache-Control" value="no-store"',
    ]) {
      expect(config).toContain(required);
    }
  });

  it("permits only hashed bootstrap scripts and does not re-enable legacy XSS filters", () => {
    const scripts = config.match(/script-src ([^;]+)/)?.[1];
    expect(scripts).toContain("%CSP_SCRIPT_HASHES%");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(config).toContain('<remove name="X-XSS-Protection" />');
    expect(config).not.toContain('<add name="X-XSS-Protection"');
  });

  it("disables TRACE and OPTIONS only on the static UI host", () => {
    expect(config).toContain('<add verb="TRACE" allowed="false" />');
    expect(config).toContain('<add verb="OPTIONS" allowed="false" />');
  });
});
