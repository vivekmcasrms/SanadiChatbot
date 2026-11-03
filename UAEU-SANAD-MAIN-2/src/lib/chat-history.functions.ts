/**
 * Chat history: the student's own chat list, paging, deletion and full
 * message history. Thin client wrappers around Sanadi.Api's ChatController —
 * "own chats" scoping and live case/document enrichment now happen server-side
 * from the caller's JWT (replacing the previous Supabase RLS + this file's logic).
 */
import { apiFetch } from "@/lib/auth-token";
import type {
  ActionReceipt,
  Citation,
  CareerInsightCard,
  LibraryResultsCard,
  IssuedDocumentCard,
  ProposedAction,
  CaseResultCard,
} from "@/lib/agent-types";
import { type PageResult } from "@/lib/list-query";
import { allPages } from "@/lib/lists/all-pages";

export type ChatSummary = {
  id: string;
  title: string | null;
  updatedAt: string;
};

export type StoredChatMessage = {
  role: "user" | "assistant";
  content: string;
  messageId: string;
  /** Structured parts of an assistant reply, used to rebuild the chat UI. */
  metadata: {
    verified: boolean;
    responseType: string;
    citations: Citation[];
    proposedActions: ProposedAction[];
    nextSteps: string[];
    toolsUsed: string[];
    activity: string[];
    receipt: ActionReceipt | null;
    issuedDocument: IssuedDocumentCard | null;
    careerInsight: CareerInsightCard | null;
    libraryResults: LibraryResultsCard | null;
    caseResult: CaseResultCard | null;
  } | null;
};

/** Lists the signed-in student's own chats, most recent first. */
export async function listMyChats(): Promise<ChatSummary[]> {
  return allPages((page) => listMyChatsPagedFn({ data: { page, pageSize: 100, filter: "all" } }));
}

export type ListMyChatsPagedInput = {
  page?: number;
  pageSize?: number;
  search?: string;
  filter?: "all" | "linked" | "unlinked";
};

/** One page of the student's own chats, newest activity first. */
export async function listMyChatsPagedFn(
  opts?: { data?: ListMyChatsPagedInput },
): Promise<PageResult<ChatSummary & { caseId: string | null }>> {
  const { page = 1, pageSize = 20, search, filter = "all" } = opts?.data ?? {};
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), filter });
  if (search) params.set("search", search);
  const res = await apiFetch<{
    items: (ChatSummary & { caseId: string | null })[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/api/chats/paged?${params.toString()}`);
  return {
    items: res.items,
    total: res.total,
    page: res.page,
    pageSize: res.pageSize,
    pageCount: Math.max(1, Math.ceil(res.total / res.pageSize)),
  };
}

/** Deletes one of the student's own chats (messages cascade). */
export async function deleteMyChat(opts: { data: { conversationId: string } }): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/api/chats/${opts.data.conversationId}`, { method: "DELETE" });
}

/** Permanently deletes every chat conversation owned by the signed-in student. */
export async function deleteAllMyChats(): Promise<{ deleted: number }> {
  return apiFetch<{ deleted: number }>("/api/chats", { method: "DELETE" });
}

/**
 * Loads the full message history of one of the student's own chats, including
 * the structured parts of each assistant reply (sources, next steps, receipts
 * and any issued document) so the conversation redraws exactly as it was.
 */
export async function getMyChatMessages(
  opts: { data: { conversationId: string } },
): Promise<StoredChatMessage[]> {
  return apiFetch<StoredChatMessage[]>(`/api/chats/${opts.data.conversationId}/messages`);
}
