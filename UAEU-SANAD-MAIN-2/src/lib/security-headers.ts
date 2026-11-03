import { apiOriginFromBase, originFromUrl, websocketOriginFromHttpOrigin } from "./env-urls";

// Prefer the single API URL; keep legacy CSP vars as fallback so existing env files still work.
const API_ORIGIN = apiOriginFromBase(import.meta.env["VITE_API_BASE_URL"])
  || String(import.meta.env["VITE_CSP_API_ORIGIN"] || "").trim();
const API_WEBSOCKET_ORIGIN = websocketOriginFromHttpOrigin(API_ORIGIN)
  || String(import.meta.env["VITE_CSP_WEBSOCKET_ORIGIN"] || "").trim();
const FONT_STYLES_ORIGIN = originFromUrl(import.meta.env["VITE_FONT_STYLESHEET_URL"])
  || String(import.meta.env["VITE_FONT_STYLES_ORIGIN"] || "").trim();
const FONT_FILES_ORIGIN = String(import.meta.env["VITE_FONT_FILES_ORIGIN"] || "").trim();

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  `frame-src 'self' blob: ${API_ORIGIN}`,
  `form-action 'self' ${API_ORIGIN}`,
  // 'wasm-unsafe-eval' lets the voice chat run its in-page Arabic speech engine (WebAssembly).
  "script-src 'self' 'wasm-unsafe-eval'",
  "script-src-attr 'none'",
  `style-src 'self' 'unsafe-inline' ${FONT_STYLES_ORIGIN}`,
  `font-src 'self' data: ${FONT_FILES_ORIGIN}`,
  `img-src 'self' data: blob: ${API_ORIGIN}`,
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  `connect-src 'self' ${API_ORIGIN} ${API_WEBSOCKET_ORIGIN}`,
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

/**
 * Applies the browser security policy to every UI response. IIS applies the
 * same policy to static files through public/web.config; this covers the
 * TanStack server runtime and local production previews as well.
 */
export function withSecurityHeaders(request: Request, response: Response, scriptHashes: string[] = []): Response {
  const headers = new Headers(response.headers);
  const requestUrl = new URL(request.url);
  const localDevelopment =
    import.meta.env.DEV && (requestUrl.hostname === "localhost" || requestUrl.hostname === "127.0.0.1");
  let contentSecurityPolicy = CONTENT_SECURITY_POLICY
    .replace("script-src 'self'", `script-src 'self' ${scriptHashes.join(" ")}`.trim());
  if (localDevelopment) {
    const apiUrl = new URL(import.meta.env["VITE_API_BASE_URL"] || requestUrl.origin, requestUrl);
    const websocketOrigin = (url: URL) => {
      const websocketUrl = new URL(url.origin);
      websocketUrl.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return websocketUrl.origin;
    };
    // Allow only the configured API and this UI's live-reload connection.
    const connectOrigins = [...new Set([
      apiUrl.origin, websocketOrigin(apiUrl), websocketOrigin(requestUrl),
    ])].join(" ");
    contentSecurityPolicy = contentSecurityPolicy
      .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
      .replace("connect-src 'self'", `connect-src 'self' ${connectOrigins}`)
      .replace("frame-src 'self'", `frame-src 'self' ${apiUrl.origin}`)
      .replace("img-src 'self'", `img-src 'self' ${apiUrl.origin}`);
  }
  if (requestUrl.pathname === "/survey" || requestUrl.pathname === "/survey/") {
    // Only the public survey page may load the configured Customer Pulse widget.
    contentSecurityPolicy = contentSecurityPolicy
      .replace("script-src 'self'", "script-src 'self' https://code.jquery.com https://www.uaeu.ac.ae https://sandboxsurvey.customerpulse.gov.ae")
      .replace("connect-src 'self'", "connect-src 'self' https://api.webtest.uaeu.ac.ae https://sandboxsurvey.customerpulse.gov.ae")
      .replace("frame-src 'self'", "frame-src 'self' https://sandboxsurvey.customerpulse.gov.ae")
      .replace("style-src 'self'", "style-src 'self' https://sandboxsurvey.customerpulse.gov.ae")
      .replace("font-src 'self'", "font-src 'self' https://sandboxsurvey.customerpulse.gov.ae")
      .replace("img-src 'self'", "img-src 'self' https://sandboxsurvey.customerpulse.gov.ae");
  }
  headers.set("Content-Security-Policy", contentSecurityPolicy);
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  // X-XSS-Protection is deprecated and can create legacy-browser behavior;
  // CSP is the supported XSS mitigation.
  headers.delete("X-XSS-Protection");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (requestUrl.pathname === "/survey" || requestUrl.pathname === "/survey/") {
    headers.set("Referrer-Policy", "no-referrer");
  }
  headers.set(
    "Permissions-Policy",
    "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
  );

  if (requestUrl.protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  const contentType = headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/html")) {
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export { CONTENT_SECURITY_POLICY };

// Server-rendered HTML needs per-response hashes; static IIS pages get their
// hashes during finalize-static-build. Non-HTML streams remain untouched.
export async function withHtmlSecurityHeaders(request: Request, response: Response): Promise<Response> {
  if (!response.headers.get("content-type")?.toLowerCase().includes("text/html"))
    return withSecurityHeaders(request, response);
  const html = (await response.text()).replace(/\r\n?/g, "\n").replace(/\0/g, "\uFFFD");
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/\bsrc\s*=/i.test(match[1]) && match[2]);
  const hashes = await Promise.all(scripts.map(async (match) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(match[2]));
    return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
  }));
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("etag");
  return withSecurityHeaders(request, new Response(html, {
    status: response.status, statusText: response.statusText, headers,
  }), [...new Set(hashes)]);
}
