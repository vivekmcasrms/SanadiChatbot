/**
 * Single-source URL helpers. Configure VITE_API_BASE_URL and
 * VITE_FONT_STYLESHEET_URL once; derived origins stay in sync.
 */
export function apiOriginFromBase(apiBaseUrl: string | undefined, fallbackOrigin?: string): string {
  const raw = (apiBaseUrl || fallbackOrigin || "").trim();
  if (!raw) return "";
  return new URL(raw, fallbackOrigin || "http://localhost").origin;
}

export function websocketOriginFromHttpOrigin(httpOrigin: string): string {
  if (!httpOrigin) return "";
  const url = new URL(httpOrigin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.origin;
}

export function originFromUrl(absoluteUrl: string | undefined): string {
  const raw = (absoluteUrl || "").trim();
  if (!raw) return "";
  return new URL(raw).origin;
}
