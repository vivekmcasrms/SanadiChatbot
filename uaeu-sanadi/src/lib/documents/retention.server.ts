/**
 * Retention cleanup for issued student letters, in a strict order so a PDF can
 * never be orphaned:
 *
 *   1-2. claim due files and mark them cleanup-pending (rows stay)
 *   3.   remove the file from storage
 *   4.   verify it is really gone
 *   5.   record the outcome: success clears the file path; failure keeps all
 *        metadata, marks the row failed (retried with backoff) and raises a
 *        system-health incident for admins
 *   6-7. only rows whose file is confirmed removed AND whose verification has
 *        ended are purged, leaving the minimal deletion audit record.
 */
import { runFileCleanup, type CleanupDeps } from "./cleanup";

const BUCKET = "student-letters";

export async function sweepExpiredDocuments(
  limit = 200,
): Promise<{ processed: number; details: Record<string, number> }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { reportFailure } = await import("@/lib/exceptions/handle.server");
  const bucket = supabaseAdmin.storage.from(BUCKET);

  const deps: CleanupDeps = {
    claim: async (n) => {
      const { data, error } = await supabaseAdmin.rpc("claim_document_file_cleanup", { _limit: n });
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{ id: string; reference_number: string; file_path: string; attempts: number }>;
    },
    removeFile: async (path) => {
      const { error } = await bucket.remove([path]);
      if (error) throw new Error(error.message);
    },
    fileExists: async (path) => {
      const slash = path.lastIndexOf("/");
      const dir = slash >= 0 ? path.slice(0, slash) : "";
      const name = path.slice(slash + 1);
      const { data, error } = await bucket.list(dir, { search: name, limit: 100 });
      if (error) throw new Error(error.message);
      return (data ?? []).some((o) => o.name === name);
    },
    complete: async (id, removed, err) => {
      const { error } = await supabaseAdmin.rpc("complete_document_file_cleanup", {
        _id: id,
        _removed: removed,
        _error: err ?? "",
      });
      if (error) throw new Error(error.message);
    },
    alert: async (ref, attempts, err) => {
      await reportFailure("document_generation", new Error(`File cleanup failed for ${ref} (attempt ${attempts}): ${err}`), {
        recovery: "retry_scheduled",
      });
    },
    purge: async (n) => {
      const { data, error } = await supabaseAdmin.rpc("purge_expired_documents", { _limit: n });
      if (error) throw new Error(error.message);
      return (data ?? []).length;
    },
  };

  const r = await runFileCleanup(deps, limit);
  return { processed: r.filesRemoved + r.failed + r.purged, details: { ...r } };
}

/** Removes one file right away (student withdrawal); the sweep retries on failure. */
export async function removeDocumentFileNow(id: string, path: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const bucket = supabaseAdmin.storage.from(BUCKET);
  const { error } = await bucket.remove([path]);
  const slash = path.lastIndexOf("/");
  const { data: left } = await bucket.list(slash >= 0 ? path.slice(0, slash) : "", { search: path.slice(slash + 1) });
  const gone = !error && !(left ?? []).some((o) => o.name === path.slice(slash + 1));
  await supabaseAdmin.rpc("complete_document_file_cleanup", {
    _id: id,
    _removed: gone,
    _error: gone ? "" : (error?.message ?? "file still present after removal"),
  });
  return gone;
}
