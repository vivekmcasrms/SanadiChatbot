/**
 * Cache for stable, non-personal institutional data only.
 * Personal academic data, holds, cases, payments and appointment availability
 * are never cached — those categories are rejected here by design.
 */
import type { Db } from "../agent/tools.server";

const FORBIDDEN = new Set([
  "student_snapshot",
  "holds",
  "cases",
  "complaints",
  "payments",
  "appointment_availability",
  "personal",
]);

type Entry = { value: unknown; expiresAt: number; version: string | null };

const memory = new Map<string, Entry>();
let hits = 0;
let misses = 0;

export function cacheStats() {
  return { hits, misses, entries: memory.size };
}

export async function getCached<T>(
  db: Db,
  opts: { key: string; category: string; ttlSeconds: number; language?: "en" | "ar"; load: () => Promise<T> },
): Promise<T> {
  if (FORBIDDEN.has(opts.category)) return opts.load();
  const lang = opts.language ?? "en";
  const memKey = `${opts.key}:${lang}`;
  const now = Date.now();
  const hit = memory.get(memKey);
  if (hit && hit.expiresAt > now) {
    hits += 1;
    return hit.value as T;
  }
  misses += 1;
  const value = await opts.load();
  memory.set(memKey, { value, expiresAt: now + opts.ttlSeconds * 1000, version: null });
  // Cache bookkeeping must never sit on the request's critical path.
  void (async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("response_cache_metadata")
    .upsert(
      {
        cache_key: opts.key,
        data_category: opts.category,
        language: lang,
        payload: {} as never,
        expires_at: new Date(now + opts.ttlSeconds * 1000).toISOString(),
        invalidated_at: null,
        invalidation_reason: null,
      },
      { onConflict: "cache_key,language" },
    )
    .then(
      () => undefined,
      () => undefined,
    );
  })();
  return value;
}

/** Called when institutional content changes (approval, deactivation, new version). */
export async function invalidateCache(db: Db, categoryOrKey: string, reason: string): Promise<number> {
  let removed = 0;
  for (const key of [...memory.keys()]) {
    if (key.startsWith(categoryOrKey)) {
      memory.delete(key);
      removed += 1;
    }
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("response_cache_metadata")
    .update({ invalidated_at: new Date().toISOString(), invalidation_reason: reason })
    .or(`cache_key.ilike.${categoryOrKey}%,data_category.eq.${categoryOrKey}`)
    .then(
      () => undefined,
      () => undefined,
    );
  return removed;
}
