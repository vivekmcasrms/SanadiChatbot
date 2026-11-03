import { expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { listMyNotificationsFn } from "./student.functions";
import { refreshStudentRecords } from "../student-records-cache";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth-token", () => ({ apiFetch }));

it("uses the server unread total independently of the displayed notification limit", async () => {
  apiFetch.mockImplementation(async (path: string) => path.endsWith("unread-count") ? { unreadCount: 231 } :
    Array.from({ length: 20 }, (_, i) => ({ id: String(i), eventType: "case_submitted", createdAt: "2026-09-29T00:00:00Z", readAt: null })));
  const result = await listMyNotificationsFn({ data: { limit: 8 } });
  expect(result.items).toHaveLength(8); expect(result.unreadCount).toBe(231);
});

it("refreshes the active bell immediately after a record is created", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const key = ["my-notifications", "bell", "student", "en"];
  client.setQueryData(key, { unreadCount: 0 });
  const observer = new QueryObserver(client, { queryKey: key, queryFn: async () => ({ unreadCount: 1 }) });
  const stop = observer.subscribe(() => {});
  try {
    await refreshStudentRecords(client, "student");
    expect(client.getQueryData(key)).toEqual({ unreadCount: 1 });
  } finally { stop(); client.clear(); }
});
