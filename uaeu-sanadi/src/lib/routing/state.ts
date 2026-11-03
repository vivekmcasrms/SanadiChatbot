/**
 * Conversation state hygiene (pure): per-entity TTLs, topic-change clearing,
 * expired pending actions, and a safe merge for concurrent turns.
 *
 * Only structured state is persisted. Raw prompts and model output never go
 * into `extracted_entities`.
 */

/** Saved context keys and how long each may influence later turns. */
export const ENTITY_TTL_MS: Record<string, number> = {
  transferTarget: 30 * 60_000,
  transferActive: 30 * 60_000,
  appointmentContext: 30 * 60_000,
  appointmentAssist: 30 * 60_000,
  activeCaseReference: 60 * 60_000,
  activeCareerTopic: 20 * 60_000,
  activeCvFile: 20 * 60_000,
  activeAcademicView: 30 * 60_000,
  academicProgressSnapshot: 30 * 60_000,
  textbookContext: 20 * 60_000,
  resolveIssueContext: 60 * 60_000,
  complaintIntake: 60 * 60_000,
  activeDomain: 30 * 60_000,
};

/** Groups cleared together when the student clearly changes topic. */
export const TOPIC_GROUPS: Record<string, string[]> = {
  program_transfer: ["transferTarget", "transferActive"],
  appointment: ["appointmentContext", "appointmentAssist"],
  career_counselling: ["activeCareerTopic", "activeCvFile"],
  academic_query: ["activeAcademicView", "academicProgressSnapshot"],
  library_query: ["textbookContext"],
};

/** A pending confirmation (Confirm/Cancel card) expires after this. */
export const PENDING_ACTION_TTL_MS = 30 * 60_000;

export const STAMPS_KEY = "entityStamps";
type Entities = Record<string, unknown>;
type Stamps = Record<string, string>;

const isEmpty = (v: unknown) =>
  v === null || v === undefined || (Array.isArray(v) && v.length === 0);

/**
 * Drops expired context. Keys with a TTL but no stamp are treated as stamped
 * at `fallbackAt` (the row's last update) so legacy state also expires.
 */
export function pruneExpired(entities: Entities, now: number, fallbackAt?: string | null): {
  entities: Entities;
  expired: string[];
} {
  const stamps = (entities[STAMPS_KEY] ?? {}) as Stamps;
  const out: Entities = { ...entities };
  const nextStamps: Stamps = { ...stamps };
  const expired: string[] = [];
  for (const [key, ttl] of Object.entries(ENTITY_TTL_MS)) {
    if (isEmpty(out[key])) {
      delete nextStamps[key];
      continue;
    }
    const at = Date.parse(stamps[key] ?? fallbackAt ?? "");
    if (!Number.isFinite(at) || now - at >= ttl) {
      out[key] = null;
      delete nextStamps[key];
      expired.push(key);
    }
  }
  out[STAMPS_KEY] = nextStamps;
  return { entities: out, expired };
}

/** Clears the context of the flow the student just left. */
export function clearOnTopicChange(entities: Entities, newIntent: string): { entities: Entities; cleared: string[] } {
  const out: Entities = { ...entities };
  const cleared: string[] = [];
  for (const [intent, keys] of Object.entries(TOPIC_GROUPS)) {
    if (intent === newIntent) continue;
    for (const k of keys) {
      if (!isEmpty(out[k])) {
        out[k] = null;
        cleared.push(k);
      }
    }
  }
  return { entities: out, cleared };
}

/** Restamps every TTL key whose value changed this turn. */
export function stampChanges(before: Entities, after: Entities, now: Date): Entities {
  const stamps: Stamps = { ...((before[STAMPS_KEY] ?? {}) as Stamps), ...((after[STAMPS_KEY] ?? {}) as Stamps) };
  for (const key of Object.keys(ENTITY_TTL_MS)) {
    if (isEmpty(after[key])) delete stamps[key];
    else if (JSON.stringify(after[key]) !== JSON.stringify(before[key]) || !stamps[key]) stamps[key] = now.toISOString();
  }
  return { ...after, [STAMPS_KEY]: stamps };
}

export function pendingActionExpired(updatedAt: string | null | undefined, now: number): boolean {
  const at = Date.parse(updatedAt ?? "");
  return Number.isFinite(at) && now - at >= PENDING_ACTION_TTL_MS;
}

export type StateRowLike = {
  extracted_entities?: unknown;
  summary?: string | null;
  turn_count?: number | null;
  [k: string]: unknown;
};

/**
 * Three-way merge for a turn that lost the compare-and-swap race.
 *  - entity keys only this turn changed → this turn's value
 *  - keys only the other turn changed → kept
 *  - keys both changed → the already-committed value is kept (first writer
 *    wins), and the key is reported as a conflict
 *  - pending confirmation: never overwrite a committed one with a different one
 *  - turn_count increments from the committed value
 */
export function mergeConcurrent(
  base: StateRowLike | null,
  mine: StateRowLike,
  theirs: StateRowLike,
): { merged: StateRowLike; conflicts: string[] } {
  const b = (base?.extracted_entities ?? {}) as Entities;
  const m = (mine.extracted_entities ?? {}) as Entities;
  const t = (theirs.extracted_entities ?? {}) as Entities;
  const conflicts: string[] = [];
  const entities: Entities = { ...t };
  const same = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  for (const key of new Set([...Object.keys(m), ...Object.keys(t)])) {
    if (key === STAMPS_KEY) continue;
    const iChanged = !same(m[key], b[key]);
    const theyChanged = !same(t[key], b[key]);
    if (iChanged && !theyChanged) entities[key] = m[key];
    else if (iChanged && theyChanged && !same(m[key], t[key])) conflicts.push(key);
  }
  entities[STAMPS_KEY] = { ...((t[STAMPS_KEY] ?? {}) as Stamps), ...Object.fromEntries(
    Object.entries((m[STAMPS_KEY] ?? {}) as Stamps).filter(([k]) => !conflicts.includes(k) && !same(m[k], b[k])),
  ) };

  const merged: StateRowLike = { ...mine, extracted_entities: entities };
  // Summary: keep the committed history and add only this turn's line.
  const myLine = String(mine.summary ?? "").split("\n").pop() ?? "";
  merged.summary = `${theirs.summary ? `${theirs.summary}\n` : ""}${myLine}`.slice(-1500);
  merged.turn_count = (theirs.turn_count ?? 0) + 1;
  const theirPending = theirs["pending_confirmation_type"] ?? null;
  const basePending = base?.["pending_confirmation_type"] ?? null;
  if (theirPending && theirPending !== basePending && mine["pending_confirmation_type"] !== theirPending) {
    merged["pending_confirmation_type"] = theirs["pending_confirmation_type"];
    merged["pending_confirmation_payload"] = theirs["pending_confirmation_payload"];
    conflicts.push("pending_confirmation");
  }
  return { merged, conflicts };
}

/** Structured summary line: the routed intent and outcome, never the raw prompt. */
export function summaryLine(intent: string, outcome: string): string {
  return `Turn: ${intent} -> ${outcome}`.slice(0, 160);
}
