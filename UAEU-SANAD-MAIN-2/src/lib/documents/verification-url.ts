/**
 * Canonical public base URL for document verification.
 *
 * A verification link is printed on a PDF and scanned from a phone months
 * later, so it must never point at a preview/deployment host. The value is
 * configuration only (`PUBLIC_APP_URL`); when it is absent the app falls back
 * to the host actually serving the request, and finally to localhost, so no
 * environment-specific domain is hard-coded in the source.
 */
export const DEFAULT_PUBLIC_ORIGIN = import.meta.env["VITE_PUBLIC_APP_URL"];

export function publicOrigin(fallbackOrigin?: string | null): string {
  const configured = typeof process !== "undefined" ? process.env["PUBLIC_APP_URL"] : undefined;
  for (const candidate of [configured, fallbackOrigin]) {
    if (!candidate) continue;
    try {
      return new URL(candidate).origin;
    } catch {
      /* try the next candidate */
    }
  }
  return DEFAULT_PUBLIC_ORIGIN;
}


/** The one URL used by the QR code, the printed link and the "Verify" button. */
export function verificationUrl(token: string, fallbackOrigin?: string | null): string {
  return `${publicOrigin(fallbackOrigin)}/verify/${encodeURIComponent(token)}`;
}

/** Same-origin route for links rendered inside the web app. */
export function verificationPath(token: string): string {
  return `/verify/${encodeURIComponent(token)}`;
}

/**
 * Origin of the host actually serving the app, used only when no
 * `PUBLIC_APP_URL` is configured so links never point at a domain that is not
 * live yet. Returns null outside a request context.
 */
export async function currentRequestOrigin(): Promise<string | null> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const req = getRequest();
    if (!req) return null;

    // The application server may see its internal localhost URL behind the
    // deployment proxy. Prefer the original public host supplied by that
    // proxy so links embedded in PDFs remain usable outside the app.
    const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    if (forwardedHost) {
      const protocol = forwardedProto === "http" || forwardedProto === "https" ? forwardedProto : "https";
      return new URL(`${protocol}://${forwardedHost}`).origin;
    }

    const requestOrigin = new URL(req.url).origin;
    return requestOrigin.includes("localhost") ? null : requestOrigin;
  } catch {
    return null;
  }
}
