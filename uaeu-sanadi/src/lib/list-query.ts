/**
 * Shared list infrastructure.
 *
 * Every large list in Sanadi follows the same contract:
 *   search -> filter -> sort -> paginate -> return only the current page.
 *
 * Page slicing always happens in Postgres (`.range()`), never in the browser,
 * so a unit with 20 cases and a unit with 20,000 cases cost the same to open.
 */

/** Page sizes offered in the UI. Dense operational lists default to 25. */
export const PAGE_SIZE_OPTIONS = [20, 25, 50, 100] as const;

export type PageResult<T> = {
  items: T[];
  /** Exact total for the current filter set, or null when counting is skipped. */
  total: number | null;
  page: number;
  pageSize: number;
  pageCount: number;
};

export function clampPage(page: unknown, fallback = 1): number {
  const n = Number(page);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

export function clampPageSize(size: unknown, fallback = 20): number {
  const n = Number(size);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(5, Math.floor(n)));
}

/** Inclusive Postgres range for the requested page. */
export function pageRange(page: number, pageSize: number): { from: number; to: number } {
  const from = (clampPage(page) - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function pageResult<T>(
  items: T[],
  total: number | null,
  page: number,
  pageSize: number,
): PageResult<T> {
  return {
    items,
    total,
    page: clampPage(page),
    pageSize,
    pageCount: total == null ? (items.length === pageSize ? clampPage(page) + 1 : clampPage(page)) : Math.max(1, Math.ceil(total / pageSize)),
  };
}

export const emptyPage = <T,>(page = 1, pageSize = 20): PageResult<T> => ({
  items: [] as T[],
  total: 0,
  page,
  pageSize,
  pageCount: 1,
});

/**
 * Builds a safe `ilike` pattern. Wildcards, commas and parentheses are stripped
 * because PostgREST `or()` filters are comma separated — a raw user string must
 * never be able to alter the filter expression.
 */
export function likePattern(term: string): string {
  const cleaned = term.replace(/[%_,()*]/g, " ").trim().slice(0, 80);
  return `%${cleaned}%`;
}

export function normalizeSearch(term: string | null | undefined): string | null {
  const cleaned = (term ?? "").trim();
  return cleaned.length >= 2 ? cleaned.slice(0, 80) : null;
}

export type DateRange = "any" | "today" | "7d" | "30d" | "90d";

/** ISO lower bound for a named range, or null for "any". */
export function dateRangeStart(range: DateRange | string | null | undefined): string | null {
  const now = Date.now();
  switch (range) {
    case "today": {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    case "7d":
      return new Date(now - 7 * 86_400_000).toISOString();
    case "30d":
      return new Date(now - 30 * 86_400_000).toISOString();
    case "90d":
      return new Date(now - 90 * 86_400_000).toISOString();
    default:
      return null;
  }
}
