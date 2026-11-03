/**
 * The only writer of `conversation_state`. Every write is a compare-and-swap
 * on `state_version`; a turn that lost the race reloads the committed row,
 * merges (see mergeConcurrent) and retries, so simultaneous turns from two
 * tabs or devices never silently overwrite each other.
 */
import { mergeConcurrent, type StateRowLike } from "./state";

type Db = { from: (t: string) => any };
const COLUMNS =
  "id, conversation_id, summary, extracted_entities, pending_questions, turn_count, pending_confirmation_type, pending_confirmation_payload, state_version, state_conflicts, updated_at";

export type SaveResult = { ok: boolean; conflicts: string[]; attempts: number };

export async function saveConversationState(
  db: Db,
  base: (StateRowLike & { id?: string; state_version?: number | null }) | null,
  payload: StateRowLike & { conversation_id: string },
  maxAttempts = 3,
): Promise<SaveResult> {
  let expected = base;
  let next: StateRowLike = payload;
  const allConflicts: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (!expected?.id) {
      const { error } = await db.from("conversation_state").insert({ ...next, state_version: 1 });
      if (!error) return { ok: true, conflicts: allConflicts, attempts: attempt };
      if (error.code !== "23505") throw new Error(error.message);
      // Another turn created the row first: merge onto it.
    } else {
      const version = Number(expected.state_version ?? 0);
      const { data, error } = await db
        .from("conversation_state")
        .update({
          ...next,
          state_version: version + 1,
          state_conflicts: Number(expected["state_conflicts"] ?? 0) + (allConflicts.length ? 1 : 0),
          updated_at: new Date().toISOString(),
        })
        .eq("id", expected.id)
        .eq("state_version", version)
        .select("id");
      if (error) throw new Error(error.message);
      if (data && data.length) return { ok: true, conflicts: allConflicts, attempts: attempt };
    }
    // Lost the race — reload the committed state and merge.
    const { data: latest } = await db
      .from("conversation_state")
      .select(COLUMNS)
      .eq("conversation_id", payload.conversation_id)
      .maybeSingle();
    if (!latest) {
      expected = null;
      continue;
    }
    const { merged, conflicts } = mergeConcurrent(base, payload, latest);
    allConflicts.push(...conflicts);
    if (!allConflicts.length) allConflicts.push("concurrent_write");
    next = merged;
    expected = latest;
    console.warn(`[conversation_state] concurrent turn merged (${payload.conversation_id}): ${conflicts.join(", ") || "no key overlap"}`);
  }
  return { ok: false, conflicts: allConflicts, attempts: maxAttempts };
}
