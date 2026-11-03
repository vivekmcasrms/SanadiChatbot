/**
 * Conversation continuity.
 *
 * A student must never have to start again. Everything that matters about a
 * conversation already lives in the database (messages, conversation state,
 * issued documents, cases); this answers two questions the interface needs
 * when Sanadi is reopened on any device:
 *
 *   1. Which conversation was I in?
 *   2. Where had we got to — which topic, which request, who is handling it,
 *      and what is still waiting on me?
 *
 * Thin wrapper around Sanadi.Api's ChatController.Continuity — the recap is
 * now built server-side from the caller's JWT.
 */
import { apiFetch } from "@/lib/auth-token";

export type ContinuityCase = {
  caseId: string;
  caseNumber: string;
  statusEn: string;
  statusAr: string;
  staffName: string | null;
  unitEn: string | null;
  unitAr: string | null;
};

export type ChatContinuity = {
  conversationId: string | null;
  title: string | null;
  updatedAt: string | null;
  summary: string | null;
  topicEn: string | null;
  topicAr: string | null;
  openQuestion: string | null;
  awaitingApproval: boolean;
  linkedCase: ContinuityCase | null;
  documentCount: number;
};

export async function getChatContinuityFn(
  opts?: { data?: { conversationId?: string | null } },
): Promise<ChatContinuity> {
  const params = new URLSearchParams();
  if (opts?.data?.conversationId) params.set("conversationId", opts.data.conversationId);
  const qs = params.toString();
  return apiFetch<ChatContinuity>(`/api/chats/continuity${qs ? `?${qs}` : ""}`);
}

