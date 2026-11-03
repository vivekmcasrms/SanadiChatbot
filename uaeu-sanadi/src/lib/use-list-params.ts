/**
 * URL-backed list state (search, filters, sort, page).
 *
 * Keeping list state in the URL means a Service Owner who opens a case and
 * comes back keeps their page, search, filters and sort — and the view is
 * linkable/bookmarkable, e.g. /owner-console?tab=cases&status=escalated&page=2.
 * Any filter or search change resets to page 1 so a stale page number can never
 * produce an empty screen.
 */
import { useCallback, useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { clampPage, clampPageSize } from "@/lib/list-query";

export type ListParamDefaults = Record<string, string | number>;

export type ListParams<D extends ListParamDefaults> = {
  values: D;
  page: number;
  pageSize: number;
  /** Update filters/search/sort — always returns to page 1. */
  setFilter: (patch: Partial<Record<keyof D & string, string | number>>) => void;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  reset: () => void;
};

/**
 * @param prefix namespaces the params so several lists can live on one route
 *               (e.g. `q` for cases and `chat_q` for chats).
 */
export function useListParams<D extends ListParamDefaults>(
  defaults: D,
  prefix = "",
): ListParams<D> {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  // Generic across routes: params are namespaced strings, so the strict
  // per-route search typing is intentionally relaxed here.
  const navigate = useNavigate() as unknown as (opts: {
    replace?: boolean;
    search: (prev: Record<string, unknown>) => Record<string, unknown>;
  }) => Promise<void>;
  const key = useCallback((name: string) => `${prefix}${name}`, [prefix]);

  const values = useMemo(() => {
    const out = {} as D;
    for (const [name, fallback] of Object.entries(defaults)) {
      const raw = search[key(name)];
      if (typeof fallback === "number") {
        const n = Number(raw);
        (out as Record<string, string | number>)[name] = Number.isFinite(n) ? n : fallback;
      } else {
        (out as Record<string, string | number>)[name] =
          typeof raw === "string" && raw.length ? raw : fallback;
      }
    }
    return out;
  }, [defaults, key, search]);

  const page = clampPage(search[key("page")] ?? 1);
  const pageSize = clampPageSize(search[key("pageSize")] ?? (defaults["pageSize"] as number | undefined) ?? 20);

  const apply = useCallback(
    (patch: Record<string, string | number | undefined>) => {
      void navigate({
        replace: true,
        search: (prev: Record<string, unknown>) => {
          const next: Record<string, unknown> = { ...prev };
          for (const [name, value] of Object.entries(patch)) {
            const k = key(name);
            const fallback = (defaults as Record<string, string | number>)[name];
            if (value === undefined || value === "" || value === fallback) delete next[k];
            else next[k] = value;
          }
          return next;
        },
      });
    },
    [defaults, key, navigate],
  );

  return {
    values,
    page,
    pageSize,
    setFilter: (patch) => apply({ ...patch, page: undefined } as Record<string, string | number | undefined>),
    setPage: (next) => apply({ page: clampPage(next) === 1 ? undefined : clampPage(next) }),
    setPageSize: (size) => apply({ pageSize: clampPageSize(size), page: undefined }),
    reset: () =>
      apply(
        Object.fromEntries([
          ...Object.keys(defaults).map((k2) => [k2, undefined]),
          ["page", undefined],
        ]) as Record<string, undefined>,
      ),
  };
}
