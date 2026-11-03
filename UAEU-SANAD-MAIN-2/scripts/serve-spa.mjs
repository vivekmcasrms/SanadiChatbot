import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const clientRoot = resolve(projectRoot, "dist", "client");
const entryPath = resolve(clientRoot, "index.html");
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "127.0.0.1";
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function sendFile(response, filePath, method) {
  return readFile(filePath).then((body) => {
    response.writeHead(200, {
      "Content-Length": body.length,
      "Content-Type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(method === "HEAD" ? undefined : body);
  });
}

createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }

  const requestedPath = resolve(clientRoot, `.${pathname}`);
  const relativePath = relative(clientRoot, requestedPath);
  const staysInClient = relativePath !== ".." && !relativePath.startsWith(`..${sep}`);
  if (staysInClient) {
    try {
      if ((await stat(requestedPath)).isFile()) {
        await sendFile(response, requestedPath, request.method);
        return;
      }
    } catch {
      // App routes are handled by the SPA fallback below.
    }
  }

  // Only extensionless UI routes fall back. Missing assets and API URLs stay 404s.
  if (staysInClient && !extname(pathname) && !pathname.startsWith("/api/")) {
    await sendFile(response, entryPath, request.method);
    return;
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
}).listen(port, host, () => {
  console.log(`Sanadi UI available at http://${host}:${port}`);
});
