import { describe, expect, it, vi } from "vitest";
import { withSecurityHeaders, withHtmlSecurityHeaders } from "./security-headers";
import { createHash } from "node:crypto";

describe("UI security headers", () => {
  it("uses configured deployment origins in the policy", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    vi.stubEnv("VITE_FONT_STYLESHEET_URL", "https://fonts.googleapis.com/css2?family=Outfit");
    vi.stubEnv("VITE_FONT_FILES_ORIGIN", "https://fonts.gstatic.com");
    vi.resetModules();
    try {
      const { CONTENT_SECURITY_POLICY } = await import("./security-headers");
      expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self' https://api.example.test wss://api.example.test");
      expect(CONTENT_SECURITY_POLICY).toContain("frame-src 'self' blob: https://api.example.test");
      expect(CONTENT_SECURITY_POLICY).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
      expect(CONTENT_SECURITY_POLICY).not.toContain("undefined");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it.each([
    ["http://localhost:8080/", "http://127.0.0.1:5281/api/v1", "http://127.0.0.1:5281", "ws://127.0.0.1:5281", "ws://localhost:8080"],
    ["https://127.0.0.1:8080/", "https://localhost:7281/api/v1", "https://localhost:7281", "wss://localhost:7281", "wss://127.0.0.1:8080"],
  ])("derives exact development origins for %s", (ui, api, origin, apiSocket, uiSocket) => {
    vi.stubEnv("VITE_API_BASE_URL", api);
    try {
      const response = withSecurityHeaders(new Request(ui), new Response("ok"));
      const policy = response.headers.get("content-security-policy");
      expect(policy).toContain(`connect-src 'self' ${origin} ${apiSocket} ${uiSocket}`);
      expect(policy).toContain(`frame-src 'self' ${origin}`);
      expect(policy).toContain(`img-src 'self' ${origin}`);
      expect(policy).not.toContain(":*");
      expect(policy).not.toContain("undefined");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps local connection allowances out of production responses", () => {
    const response = withSecurityHeaders(new Request("https://app.example.test/"), new Response("ok"));
    const policy = response.headers.get("content-security-policy");
    expect(policy).not.toContain("localhost");
    expect(policy).not.toContain("127.0.0.1");
    expect(policy?.match(/script-src ([^;]+)/)?.[1]).not.toContain("'unsafe-inline'");
  });

  it("hashes the actual bootstrap script text while preserving the HTML and SSO policy", async () => {
    const code = 'self.test="ready";';
    const html = `<html><script>${code}</script><script src="/assets/main.js"></script></html>`;
    const response = await withHtmlSecurityHeaders(new Request("https://app.example.test/auth/callback"),
      new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "etag": "stale" } }));
    expect(response.headers.get("content-security-policy")).toContain(`'sha256-${createHash("sha256").update(code).digest("base64")}'`);
    expect(response.headers.get("content-security-policy")?.match(/script-src ([^;]+)/)?.[1]).not.toContain("'unsafe-inline'");
    expect(response.headers.has("etag")).toBe(false);
    expect(await response.text()).toBe(html);
  });

  it("protects HTML responses without allowing browser storage", async () => {
    const response = withSecurityHeaders(
      new Request("https://sanadit.uaeu.ac.ae/auth"),
      new Response("<html></html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
    );

    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.has("x-xss-protection")).toBe(false);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(await response.text()).toBe("<html></html>");
  });

  it("does not disable caching for fingerprinted non-HTML assets", () => {
    const response = withSecurityHeaders(
      new Request("https://sanadit.uaeu.ac.ae/assets/app-abc123.js"),
      new Response("export {}", {
        headers: {
          "content-type": "application/javascript",
          "cache-control": "public, max-age=31536000, immutable",
        },
      }),
    );

    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("strict-transport-security")).not.toBeNull();
  });

  it("only emits HSTS over HTTPS", () => {
    const response = withSecurityHeaders(
      new Request("http://localhost:8080/"),
      new Response("ok", { headers: { "content-type": "text/plain" } }),
    );

    expect(response.headers.has("strict-transport-security")).toBe(false);
  });
});
