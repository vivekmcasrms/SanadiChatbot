import { apiUrl } from "@/lib/auth-token";
import { getDocumentDownloadUrl } from "@/lib/documents.functions";

function resolveDownloadUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) {
    const signedUrl = new URL(url);
    const configuredApi = new URL(apiUrl("/"));
    // Behind TLS termination the API may see HTTP internally. Its own signed
    // storage links must use the public API origin configured for the browser.
    if (
      signedUrl.hostname === configuredApi.hostname &&
      /^\/(?:storage\/v1|api\/v1\/storage)\/object\/sign\//.test(signedUrl.pathname)
    ) {
      return `${configuredApi.origin}${signedUrl.pathname}${signedUrl.search}${signedUrl.hash}`;
    }
    return url;
  }
  if (url.startsWith("/storage/")) return apiUrl(url);
  if (url.startsWith("/object/")) return apiUrl(`/storage/v1${url}`);
  return apiUrl(url.startsWith("/") ? url : `/${url}`);
}

/** Save the already-issued PDF without opening a popup after an async request. */
export async function downloadIssuedDocument(documentId: string): Promise<void> {
  const { url, fileName } = await getDocumentDownloadUrl({
    data: { documentId, mode: "download" },
  });
  // The short-lived URL carries its own authorization; do not forward credentials.
  const response = await fetch(resolveDownloadUrl(url), {
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) {
    throw new Error(`Document download failed (HTTP ${response.status}).`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  try {
    link.href = objectUrl;
    link.download = fileName;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Allow the browser to consume the download before releasing its bytes.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}
