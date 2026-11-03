import type { QueryClient } from "@tanstack/react-query";

/** Chat replies/actions can create records used by other student screens. */
export async function refreshStudentRecords(client: QueryClient, userId: string | undefined) {
  if (!userId) return;
  await Promise.all([
    ["my-notifications"],
    ["my-documents", userId],
    ["my-chats", userId],
    ["cases", "active", userId],
    ["cases", "mine", userId],
    ["suggestions", "mine", userId],
    ["metrics", "student", userId],
  ].map((queryKey) => client.invalidateQueries({ queryKey })));
}
