/** Idempotency guard for every state-changing operation. Server only. */
import { createHash } from "crypto";
import type { Db } from "../agent/tools.server";

export type IdempotentOutcome<T> = { replayed: boolean; entityId: string | null; snapshot: T | null };

export function requestHash(operationType: string, userId: string, payload: unknown): string {
  return createHash("sha256").update(`${operationType}|${userId}|${JSON.stringify(payload ?? {})}`).digest("hex");
}

export function idempotencyKey(operationType: string, userId: string, payload: unknown, windowMinutes = 10): string {
  const bucket = Math.floor(Date.now() / (windowMinutes * 60_000));
  return createHash("sha256")
    .update(`${requestHash(operationType, userId, payload)}|${bucket}`)
    .digest("hex")
    .slice(0, 48);
}

/**
 * Runs `execute` at most once per idempotency key. A retry inside the window
 * returns the stored snapshot instead of creating a second record.
 */
export async function runOnce<T>(
  db: Db,
  opts: { operationType: string; userId: string; payload: unknown; entityType?: string; windowMinutes?: number },
  execute: () => Promise<{ entityId: string | null; snapshot: T }>,
): Promise<IdempotentOutcome<T> & { snapshot: T | null }> {
  const key = idempotencyKey(opts.operationType, opts.userId, opts.payload, opts.windowMinutes ?? 10);
  const hash = requestHash(opts.operationType, opts.userId, opts.payload);

  const { data: existing } = await db
    .from("operation_idempotency")
    .select("id, status, entity_id, response_snapshot")
    .eq("idempotency_key", key)
    .maybeSingle();

  if (existing && existing.status === "completed") {
    return { replayed: true, entityId: existing.entity_id, snapshot: (existing.response_snapshot ?? null) as T | null };
  }

  const { data: claim, error: claimError } = await db
    .from("operation_idempotency")
    .insert({
      idempotency_key: key,
      operation_type: opts.operationType,
      user_profile_id: opts.userId,
      request_hash: hash,
      entity_type: opts.entityType ?? null,
      status: "in_progress",
    })
    .select("id")
    .maybeSingle();

  // Unique-violation: a concurrent request already owns this key.
  if (claimError && !claim) {
    const { data: winner } = await db
      .from("operation_idempotency")
      .select("entity_id, response_snapshot, status")
      .eq("idempotency_key", key)
      .maybeSingle();
    if (winner?.status === "completed") {
      return { replayed: true, entityId: winner.entity_id, snapshot: (winner.response_snapshot ?? null) as T | null };
    }
  }

  const result = await execute();
  const rowId = claim?.id ?? existing?.id ?? null;
  if (rowId) {
    await db
      .from("operation_idempotency")
      .update({
        status: "completed",
        entity_id: result.entityId,
        response_snapshot: (result.snapshot ?? null) as never,
      })
      .eq("id", rowId);
  }
  return { replayed: false, entityId: result.entityId, snapshot: result.snapshot };
}
