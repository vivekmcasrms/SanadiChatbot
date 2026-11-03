/** Pure status rules for the admin System Health tile. */
export type HealthLevel = "ok" | "warning" | "critical" | "unknown";

export type HealthItem = {
  key: "jobs" | "ai" | "rag" | "email" | "voice" | "demo" | "cleanup" | "errors";
  level: HealthLevel;
  valueEn: string;
  valueAr: string;
};

export type SystemHealth = { checkedAt: string; overall: HealthLevel; items: HealthItem[] };

const RANK: Record<HealthLevel, number> = { ok: 0, unknown: 1, warning: 2, critical: 3 };

export function overallLevel(items: HealthItem[]): HealthLevel {
  return items.reduce<HealthLevel>((acc, i) => (RANK[i.level] > RANK[acc] ? i.level : acc), "ok");
}

/** Job health from the last 24h of runs. */
export function jobsLevel(runs: number, failed: number): HealthLevel {
  if (runs === 0) return "critical";
  if (failed === 0) return "ok";
  return failed / runs > 0.2 ? "critical" : "warning";
}

/** Assistant latency: the 8s P95 target. */
export function latencyLevel(p95Ms: number | null): HealthLevel {
  if (p95Ms == null) return "unknown";
  if (p95Ms < 8000) return "ok";
  return p95Ms < 12000 ? "warning" : "critical";
}

/** Share of retrievals with no supporting evidence. */
export function ragLevel(total: number, noEvidence: number): HealthLevel {
  if (total === 0) return "unknown";
  const r = noEvidence / total;
  if (r <= 0.2) return "ok";
  return r <= 0.4 ? "warning" : "critical";
}

export function failureLevel(total: number, failed: number): HealthLevel {
  if (total === 0) return "unknown";
  if (failed === 0) return "ok";
  return failed / total > 0.1 ? "critical" : "warning";
}

export function countLevel(n: number, warnAt = 1, criticalAt = 10): HealthLevel {
  if (n >= criticalAt) return "critical";
  if (n >= warnAt) return "warning";
  return "ok";
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? null;
}
