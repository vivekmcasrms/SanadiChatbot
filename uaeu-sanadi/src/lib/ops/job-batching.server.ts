/**
 * Shared batching helpers for scheduled jobs.
 *
 * Jobs page through rows with keyset pagination (stable even when processing
 * changes row status), load related rows in grouped `in (...)` lookups instead
 * of one query per row, and stop at a time budget so a run always finishes
 * and records how far it got. Pure helpers live in job-batching.ts.
 */
export { chunk, makeJobStats, type JobStats } from "./job-batching";

type Row = { id: string };
type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Iterate every matching row in pages ordered by id.
 * `fetchPage(afterId, size)` must apply `.order("id")` and `.gt("id", afterId)` when afterId is set.
 */
export async function* pagedRows<T extends Row>(
  fetchPage: (afterId: string | null, size: number) => PromiseLike<PageResult<T>>,
  opts: { pageSize?: number; maxRows?: number; deadline?: number; onPage?: () => void; onTruncate?: () => void } = {},
): AsyncGenerator<T[]> {
  const size = opts.pageSize ?? 500;
  const maxRows = opts.maxRows ?? 20_000;
  let afterId: string | null = null;
  let seen = 0;
  for (;;) {
    if (opts.deadline && Date.now() > opts.deadline) {
      opts.onTruncate?.();
      return;
    }
    const { data, error } = await fetchPage(afterId, size);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    if (!rows.length) return;
    opts.onPage?.();
    seen += rows.length;
    yield rows;
    if (rows.length < size) return;
    if (seen >= maxRows) {
      opts.onTruncate?.();
      return;
    }
    afterId = rows[rows.length - 1]?.id ?? null;
    if (!afterId) return;
  }
}
