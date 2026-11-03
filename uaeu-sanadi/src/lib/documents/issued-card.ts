/**
 * Client-safe view of an already-issued document.
 *
 * It is built from the exact issued record (same id, reference number,
 * verification token and hash) — nothing here regenerates or re-renders a
 * second copy of the PDF, and no private storage path is ever included.
 */
import type { IssuedDocumentCard } from "../agent-types";

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Pulls the QR token out of a verification URL such as `/verify/<token>`. */
export function tokenFromVerifyUrl(url: string | null): string | null {
  if (!url) return null;
  const match = /\/verify\/([A-Za-z0-9_-]+)/.exec(url);
  return match?.[1] ?? null;
}

/** Maps a successful `issue_enrollment_letter` tool payload onto a chat card. */
export function toIssuedDocumentCard(data: unknown): IssuedDocumentCard | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as Record<string, unknown>;
  const documentId = str(raw["id"]) ?? str(raw["documentId"]);
  const referenceNumber = str(raw["referenceNumber"]);
  if (!documentId || !referenceNumber) return null;
  const verifyUrl = str(raw["verifyUrl"]);
  return {
    documentId,
    referenceNumber,
    titleEn: "To Whom It May Concern letter",
    titleAr: "شهادة إلى من يهمه الأمر",
    language: str(raw["language"]) ?? "en",
    issuedAt: str(raw["issuedAt"]) ?? new Date().toISOString(),
    verifyToken: str(raw["verifyToken"]) ?? tokenFromVerifyUrl(verifyUrl),
    verifyUrl,
    fileName: str(raw["fileName"]) ?? `${referenceNumber}.pdf`,
    documentHash: str(raw["documentHash"]),
    status: str(raw["status"]) ?? "valid",
  };
}
