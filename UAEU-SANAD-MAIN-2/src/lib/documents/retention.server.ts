/**
 * Automatic permanent deletion of issued student letters.
 *
 * A To Whom It May Concern letter lives for the configured retention window
 * (30 days from issuance by default). Once that window elapses the letter is
 * permanently deleted: the database row and its verification token disappear and
 * the stored PDF is removed from storage. Only a minimal audit record survives in
 * `document_deletion_records`.
 *
 * The sweep is bounded (a fixed batch per run), idempotent and safe to retry:
 * deleted rows can never be selected again, and the audit insert is de-duplicated
 * on the document id.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BUCKET = "student-letters";

export async function sweepExpiredDocuments(
  limit = 200,
): Promise<{ processed: number; details: Record<string, number> }> {
  const { data, error } = await supabaseAdmin.rpc("purge_expired_documents", { _limit: limit });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{ id: string; reference_number: string; file_path: string | null }>;
  const paths = rows.map((r) => r.file_path).filter((p): p is string => !!p);

  let filesRemoved = 0;
  if (paths.length > 0) {
    const { data: removed } = await supabaseAdmin.storage.from(BUCKET).remove(paths);
    filesRemoved = removed?.length ?? 0;
  }

  return { processed: rows.length, details: { permanentlyDeleted: rows.length, filesRemoved } };
}
