import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { loadEnv } from "vite";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const projectRoot = resolve(import.meta.dirname, "..");
const clientDir = resolve(projectRoot, "dist", "client");
const clientEntry = resolve(clientDir, "index.html");
const buildServerDir = resolve(projectRoot, "dist", "server");

// TanStack uses a temporary server bundle to prerender the SPA shell. Verify
// that the deployable client exists before removing that build-time artifact.
await access(clientEntry);
// Hash the exact script text the HTML parser sees. This allows the TanStack
// bootstrap without granting permission to arbitrary inline JavaScript.
const shell = (await readFile(clientEntry, "utf8")).replace(/\r\n?/g, "\n").replace(/\0/g, "\uFFFD");
await writeFile(clientEntry, shell);
const scriptHashes = [...new Set([...shell.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter((match) => !/\bsrc\s*=/i.test(match[1]) && match[2])
  .map((match) => `'sha256-${createHash("sha256").update(match[2]).digest("base64")}'`))].join(" ");
// Match the Vite build mode; local previews must use the local API settings.
const mode = process.argv[2] ?? "production";
const urlEnv = loadEnv(mode, projectRoot, "VITE_");
// CSP API / WebSocket origins come from VITE_API_BASE_URL so the API host is configured once.
// Legacy VITE_CSP_* values remain accepted if an older env file is still in use.
const apiBase = urlEnv.VITE_API_BASE_URL?.trim();
const legacyApiOrigin = urlEnv.VITE_CSP_API_ORIGIN?.trim();
const legacyWebsocketOrigin = urlEnv.VITE_CSP_WEBSOCKET_ORIGIN?.trim();
if (!apiBase && !legacyApiOrigin) throw new Error("Missing UI URL setting: VITE_API_BASE_URL");
const apiOrigin = apiBase ? new URL(apiBase).origin : legacyApiOrigin;
const apiWebsocketOrigin = (() => {
  if (apiBase) {
    const websocketUrl = new URL(new URL(apiBase).origin);
    websocketUrl.protocol = new URL(apiBase).protocol === "https:" ? "wss:" : "ws:";
    return websocketUrl.origin;
  }
  return legacyWebsocketOrigin;
})();
const fontStylesheet = urlEnv.VITE_FONT_STYLESHEET_URL?.trim();
const derivedEnv = {
  ...urlEnv,
  VITE_CSP_API_ORIGIN: apiOrigin,
  VITE_CSP_WEBSOCKET_ORIGIN: apiWebsocketOrigin,
  VITE_FONT_STYLES_ORIGIN: fontStylesheet
    ? new URL(fontStylesheet).origin
    : urlEnv.VITE_FONT_STYLES_ORIGIN,
};
const iisTemplate = await readFile(resolve(projectRoot, "public", "web.config"), "utf8");
let iisConfig = iisTemplate.replace(/%(VITE_[A-Z0-9_]+)%/g, (_, key) => {
  const value = derivedEnv[key];
  if (!value) throw new Error(`Missing UI URL setting: ${key}`);
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
});
iisConfig = iisConfig.replaceAll("%CSP_SCRIPT_HASHES%", scriptHashes);
// Serve fixed routes as physical default documents. A fallback on every route
// prefix also served the SPA for nonexistent children such as /admin/GET.
// Only routes with real parameters need a scoped fallback. This uses built-in
// IIS features and does not require the optional URL Rewrite module.
const routeTree = await readFile(resolve(projectRoot, "src", "routeTree.gen.ts"), "utf8");
const routeMap = routeTree.match(/export interface FileRoutesByFullPath \{([\s\S]*?)\n\}/)?.[1];
if (!routeMap) throw new Error("Cannot find the UI route map for IIS routing.");
const routePaths = [...new Set([...routeMap.matchAll(/'([^']+)':/g)].map((match) => match[1]))]
  .filter((path) => path !== "/" && path !== "/api" && !path.startsWith("/api/"));
const staticPaths = new Set(["auth", "auth/callback", "survey"]);
const dynamicPrefixes = new Set();
for (const path of routePaths) {
  const parts = path.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === ".." || /[\\<>"&]/.test(part)))
    throw new Error(`Unsupported static route path: ${path}`);
  const parameter = parts.findIndex((part) => part.startsWith("$"));
  if (parameter < 0) staticPaths.add(parts.join("/"));
  else {
    if (parameter === 0) throw new Error(`A root parameter route needs an explicit hosting strategy: ${path}`);
    dynamicPrefixes.add(parts.slice(0, parameter).join("/"));
  }
}
for (const path of staticPaths) {
  const directory = resolve(clientDir, path);
  await mkdir(directory, { recursive: true });
  await copyFile(clientEntry, resolve(directory, "index.html"));
}
const routeFallbacks = [...dynamicPrefixes].map((path) => `
  <location path="${path}">
    <system.webServer>
      <httpErrors errorMode="Custom" existingResponse="Replace">
        <remove statusCode="404" subStatusCode="0" />
        <error statusCode="404" subStatusCode="0" path="/index.html" responseMode="ExecuteURL" />
      </httpErrors>
    </system.webServer>
  </location>`).join("\n");
iisConfig = iisConfig.replace("</configuration>", `${routeFallbacks}\n</configuration>`);
await writeFile(resolve(clientDir, "web.config"), iisConfig);
// Vite fingerprints these filenames: unchanged assets can be reused across
// visits, while each changed asset gets a new URL. Keep HTML and SSO outside
// this cache policy so deployments and session transitions remain fresh.
const assetsDir = resolve(clientDir, "assets");
await mkdir(assetsDir, { recursive: true });
await writeFile(resolve(assetsDir, "web.config"), `<?xml version="1.0" encoding="utf-8"?>
<configuration><system.webServer><staticContent>
<clientCache cacheControlMode="UseMaxAge" cacheControlMaxAge="365.00:00:00" />
</staticContent><httpProtocol><customHeaders>
<remove name="Cache-Control" /><remove name="Pragma" /><remove name="Expires" />
</customHeaders></httpProtocol></system.webServer></configuration>
`);
const callbackDir = resolve(clientDir, "auth/callback");
// Protect the ticket URL before any client JavaScript runs on IIS.
await writeFile(resolve(callbackDir, "web.config"), `<?xml version="1.0" encoding="utf-8"?>
<configuration><system.webServer><httpProtocol><customHeaders>
<remove name="Referrer-Policy" /><add name="Referrer-Policy" value="no-referrer" />
<remove name="Cache-Control" /><add name="Cache-Control" value="no-store" />
</customHeaders></httpProtocol></system.webServer></configuration>
`);
// Scope third-party Customer Pulse permissions to the physical survey entry.
const surveyDir = resolve(clientDir, "survey");
const baseCsp = iisConfig.match(/<add name="Content-Security-Policy" value="([^"]+)"/i)?.[1];
if (!baseCsp) throw new Error("Cannot find UI content security policy for survey.");
const surveyCsp = baseCsp
  .replace("script-src 'self'", "script-src 'self' https://code.jquery.com https://www.uaeu.ac.ae https://sandboxsurvey.customerpulse.gov.ae")
  .replace("connect-src 'self'", "connect-src 'self' https://api.webtest.uaeu.ac.ae https://sandboxsurvey.customerpulse.gov.ae")
  .replace("frame-src 'self'", "frame-src 'self' https://sandboxsurvey.customerpulse.gov.ae")
  .replace("style-src 'self'", "style-src 'self' https://sandboxsurvey.customerpulse.gov.ae")
  .replace("font-src 'self'", "font-src 'self' https://sandboxsurvey.customerpulse.gov.ae")
  .replace("img-src 'self'", "img-src 'self' https://sandboxsurvey.customerpulse.gov.ae");
await writeFile(resolve(surveyDir, "web.config"), `<?xml version="1.0" encoding="utf-8"?>
<configuration><system.webServer><httpProtocol><customHeaders>
<remove name="Content-Security-Policy" /><add name="Content-Security-Policy" value="${surveyCsp}" />
<remove name="Referrer-Policy" /><add name="Referrer-Policy" value="no-referrer" />
</customHeaders></httpProtocol></system.webServer></configuration>
`);
await rm(buildServerDir, { recursive: true, force: true });

console.log(`Static UI release ready: ${clientDir}`);
