/**
 * Separate lifecycle dimensions for an issued document. Pure.
 *
 * File availability (retention, default 30 days) and verification validity
 * (the letter's own validity date, e.g. 90 days) are different things: once
 * the PDF is removed the letter stays in the student's history read-only, and
 * its QR verification keeps working until the validity date.
 */
export type LifecycleInput = {
  documentStatus: string; // valid | revoked | deleted_by_student | expired
  deletedAt: string | null;
  expiresAt: string | null; // verification validity end
  retentionExpiresAt: string | null; // file availability end
  hasFile: boolean;
};
export type FileState = "available" | "expired" | "revoked" | "withdrawn";
export type Lifecycle = {
  /** Verification validity: independent of whether the PDF still exists. */
  validity: "valid" | "expired" | "revoked";
  retention: "active" | "past_retention" | "unknown";
  fileState: FileState;
  physicallyDeleted: boolean;
  fileAvailable: boolean;
  verifiable: boolean;
  daysUntilDeletion: number | null;
  /** Whether the student's history should show it (read-only when the file is gone). */
  listed: boolean;
};

export function documentLifecycle(d: LifecycleInput, now = Date.now()): Lifecycle {
  const ts = (v: string | null) => (v ? new Date(v).getTime() : null);
  const ret = ts(d.retentionExpiresAt);
  const exp = ts(d.expiresAt);
  const withdrawn = Boolean(d.deletedAt) || d.documentStatus === "deleted_by_student";
  const revoked = d.documentStatus === "revoked";
  // At the exact expiry instant the window has ended.
  const retention = ret == null ? "unknown" : ret > now ? "active" : "past_retention";
  const validity: Lifecycle["validity"] = revoked
    ? "revoked"
    : withdrawn || d.documentStatus === "expired" || exp == null || exp <= now
      ? "expired"
      : "valid";
  const fileAvailable = !withdrawn && !revoked && retention === "active" && d.hasFile;
  const fileState: FileState = revoked ? "revoked" : withdrawn ? "withdrawn" : fileAvailable ? "available" : "expired";
  return {
    validity,
    retention,
    fileState,
    physicallyDeleted: withdrawn,
    fileAvailable,
    verifiable: validity === "valid" && !withdrawn,
    daysUntilDeletion: fileAvailable && ret != null ? Math.max(1, Math.ceil((ret - now) / 86_400_000)) : null,
    listed: !withdrawn,
  };
}
