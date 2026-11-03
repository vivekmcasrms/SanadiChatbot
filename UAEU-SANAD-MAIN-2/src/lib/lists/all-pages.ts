import type { PageResult } from "@/lib/list-query";

/** Read every server page for the assistant's scrollable history/sidebar lists. */
export async function allPages<T extends { id: string }>(
  fetchPage: (page: number) => Promise<PageResult<T>>,
): Promise<T[]> {
  const items = new Map<string, T>();
  let page = 1;
  let pageCount = 1;
  do {
    const result = await fetchPage(page);
    for (const item of result.items) items.set(item.id, item);
    pageCount = result.pageCount;
    // A list can shrink while it is being read. Do not keep requesting empty pages.
    if (result.items.length === 0) break;
    page++;
  } while (page <= pageCount);
  return [...items.values()];
}
