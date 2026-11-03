import { apiFetch } from "@/lib/auth-token";

export type RemovalResult = { requested: number; removed: number; skipped: number };

function toResult(value: unknown): RemovalResult {
  const v = (value ?? {}) as Record<string, unknown>;
  return {
    requested: Number(v['requested'] ?? 0),
    removed: Number(v['removed'] ?? 0),
    skipped: Number(v['skipped'] ?? 0),
  };
}

/**
 * Hides eligible resolved/closed cases from the signed-in student's My Requests view.
 * Ownership and live eligibility are enforced inside the database function using
 * auth.uid(); ids sent by the browser only narrow the selection, they never widen it.
 */
export async function removeMyRequests(opts: { data: { ids?: string[]; scope: "selected" | "all_resolved" } }): Promise<RemovalResult> {
  const data = opts.data;
  const result = await apiFetch("/api/v1/rpc/remove_my_requests", { method: "POST", body: JSON.stringify(data.scope === "selected" ? { _case_ids: data.ids ?? [], _scope: data.scope } : { _scope: data.scope }) });
  return toResult(result);
}

/** Hides eligible suggestions from the signed-in student's My Requests view. */
export async function removeMySuggestions(opts: { data: { ids?: string[]; scope: "selected" | "all_suggestions" } }): Promise<RemovalResult> {
  const data = opts.data;
  const result = await apiFetch("/api/v1/rpc/remove_my_suggestions", { method: "POST", body: JSON.stringify(data.scope === "selected" ? { _suggestion_ids: data.ids ?? [], _scope: data.scope } : { _scope: data.scope }) });
  return toResult(result);
}
