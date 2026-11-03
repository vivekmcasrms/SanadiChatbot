/**
 * Execution lane isolation. Server only.
 *
 * The load test showed cached fast-path answers ("what is my GPA?") degrading
 * to ~21 s at 250 concurrent users because every request — deterministic or
 * AI-heavy — competed for the same execution capacity. Model calls are the
 * expensive, slow, provider-rate-limited work, so they now run inside a bounded
 * lane. Deterministic FAST_DATA and RULE_ENGINE turns never enter that lane and
 * therefore never queue behind Career Counselling or RAG traffic.
 */

export type Lane = "fast" | "ai" | "agentic" | "background";

type LaneState = { limit: number; active: number; queue: (() => void)[]; peak: number; queued: number };

const LIMITS: Record<Lane, number> = {
  fast: 0, // unbounded: deterministic, database-only work
  ai: 24, // single-shot RAG / answer generation
  agentic: 12, // multi-step tool loops hold capacity for longer
  background: 4, // jobs, seeding, evaluation runs
};

const lanes: Record<Lane, LaneState> = {
  fast: { limit: 0, active: 0, queue: [], peak: 0, queued: 0 },
  ai: { limit: LIMITS.ai, active: 0, queue: [], peak: 0, queued: 0 },
  agentic: { limit: LIMITS.agentic, active: 0, queue: [], peak: 0, queued: 0 },
  background: { limit: LIMITS.background, active: 0, queue: [], peak: 0, queued: 0 },
};

/** Runs `fn` inside the lane's concurrency budget. The fast lane is a no-op. */
export async function withLane<T>(lane: Lane, fn: () => Promise<T>): Promise<T> {
  const state = lanes[lane];
  if (!state.limit) return fn();

  if (state.active >= state.limit) {
    state.queued += 1;
    await new Promise<void>((resolve) => state.queue.push(resolve));
  }
  state.active += 1;
  state.peak = Math.max(state.peak, state.active);
  try {
    return await fn();
  } finally {
    state.active -= 1;
    const next = state.queue.shift();
    if (next) next();
  }
}

/** Runs work in a lane and reports time spent waiting separately from work. */
export async function withLaneTiming<T>(
  lane: Lane,
  fn: () => Promise<T>,
): Promise<{ value: T; queueMs: number; workMs: number }> {
  const requestedAt = Date.now();
  let startedAt = requestedAt;
  const value = await withLane(lane, async () => {
    startedAt = Date.now();
    return fn();
  });
  return { value, queueMs: startedAt - requestedAt, workMs: Date.now() - startedAt };
}

/** Snapshot for the AI Ops performance dashboard. */
export function laneStats() {
  return Object.fromEntries(
    (Object.keys(lanes) as Lane[]).map((lane) => [
      lane,
      {
        limit: lanes[lane].limit,
        active: lanes[lane].active,
        waiting: lanes[lane].queue.length,
        peak: lanes[lane].peak,
        totalQueued: lanes[lane].queued,
      },
    ]),
  );
}
