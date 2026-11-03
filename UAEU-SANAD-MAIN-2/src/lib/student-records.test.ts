import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { listMyChats } from "./chat-history.functions";
import { listAllMyActiveCases } from "./lists/student-lists.functions";
import { allPages } from "./lists/all-pages";
import { refreshStudentRecords } from "./student-records-cache";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth-token", () => ({ apiFetch }));
beforeEach(() => apiFetch.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("student history lists", () => {
  it("loads chats beyond the old 30-chat limit and beyond the first API page", async () => {
    apiFetch.mockImplementation(async (path: string) => {
      expect(path.startsWith("/api/chats/paged?")).toBe(true);
      const p = new URLSearchParams(path.split("?")[1]);
      expect(p.get("filter")).toBe("all");
      const page = Number(p.get("page"));
      const count = page === 1 ? 100 : 7;
      return { items: Array.from({ length: count }, (_, i) => ({ id: `chat-${(page - 1) * 100 + i}` })), total: 107, page, pageSize: 100 };
    });
    const chats = await listMyChats();
    expect(chats).toHaveLength(107);
    expect(chats.at(-1)?.id).toBe("chat-106");
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("loads all active cases through the owner-scoped API instead of limiting to three", async () => {
    apiFetch.mockImplementation(async (path: string) => {
      expect(path.startsWith("/api/student-lists/cases?")).toBe(true);
      const p = new URLSearchParams(path.split("?")[1]);
      expect(p.get("tab")).toBe("active");
      expect(p.has("uid")).toBe(false);
      const page = Number(p.get("page"));
      return { items: Array.from({ length: page === 1 ? 100 : 4 }, (_, i) => ({ id: `case-${(page - 1) * 100 + i}` })), total: 104, page, pageSize: 100, pageCount: 2 };
    });
    expect(await listAllMyActiveCases()).toHaveLength(104);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("does not report a partially loaded list as complete when a later page fails", async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({ items: [{ id: "one" }], pageCount: 2 })
      .mockRejectedValueOnce(new Error("server unavailable"));
    await expect(allPages(fetchPage)).rejects.toThrow("server unavailable");
  });

  it("does not duplicate rows if records move between pages during a refresh", async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({ items: [{ id: "one" }, { id: "two" }], pageCount: 2 })
      .mockResolvedValueOnce({ items: [{ id: "two" }, { id: "three" }], pageCount: 2 });
    expect(await allPages(fetchPage)).toEqual([{ id: "one" }, { id: "two" }, { id: "three" }]);
  });
});

it("chat creation refreshes the student's records without invalidating another account or unrelated screens", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const docsKey = ["my-documents", "student", "", 1, 10];
  const records = [
    docsKey, ["my-documents", "student", "old-search", 2, 10],
    ["my-chats", "student"], ["my-chats", "student", "", "all", 1, 20],
    ["cases", "active", "student"], ["cases", "mine", "student", "", "all", 1],
    ["suggestions", "mine", "student"], ["metrics", "student", "student"],
  ];
  for (const key of records) client.setQueryData(key, []);
  client.setQueryData(["my-documents", "another-student"], []);
  client.setQueryData(["library"], []);
  const observer = new QueryObserver(client, {
    queryKey: docsKey, queryFn: async () => [{ referenceNumber: "new-chat-letter" }],
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await refreshStudentRecords(client, "student");
    expect(client.getQueryData(docsKey)).toEqual([{ referenceNumber: "new-chat-letter" }]);
    for (const key of records.slice(1)) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(["my-documents", "another-student"])?.isInvalidated).toBe(false);
    expect(client.getQueryState(["library"])?.isInvalidated).toBe(false);
  } finally {
    unsubscribe();
    client.clear();
  }
});
