/** Ordered, orphan-safe file cleanup. Pure orchestration over injected I/O. */
export type CleanupClaim = { id: string; reference_number: string; file_path: string; attempts: number };

export type CleanupDeps = {
  claim: (limit: number) => Promise<CleanupClaim[]>;
  removeFile: (path: string) => Promise<void>;
  fileExists: (path: string) => Promise<boolean>;
  complete: (id: string, removed: boolean, error?: string) => Promise<void>;
  alert: (reference: string, attempts: number, error: string) => Promise<void>;
  purge: (limit: number) => Promise<number>;
};

export type CleanupResult = { claimed: number; filesRemoved: number; failed: number; purged: number };

export async function runFileCleanup(deps: CleanupDeps, limit = 200): Promise<CleanupResult> {
  const claims = await deps.claim(limit);
  let filesRemoved = 0;
  let failed = 0;
  for (const c of claims) {
    let error: string | null = null;
    try {
      await deps.removeFile(c.file_path);
      if (await deps.fileExists(c.file_path)) error = "file still present after removal";
    } catch (e) {
      error = (e as Error)?.message ?? String(e);
    }
    if (error) {
      failed++;
      await deps.complete(c.id, false, error);
      await deps.alert(c.reference_number, c.attempts, error).catch(() => undefined);
    } else {
      filesRemoved++;
      await deps.complete(c.id, true);
    }
  }
  // Metadata purge runs last and only touches rows whose file is confirmed gone.
  const purged = await deps.purge(limit);
  return { claimed: claims.length, filesRemoved, failed, purged };
}
