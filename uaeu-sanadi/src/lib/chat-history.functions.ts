import { auditInsert } from "@/lib/exceptions/handle.server";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { verificationPath } from "@/lib/documents/verification-url";
import type {
  ActionReceipt,
  Citation,
  CareerInsightCard,
  LibraryResultsCard,
  IssuedDocumentCard,
  ProposedAction,
  CaseResultCard,
} from "@/lib/agent-types";
import { statusLabel } from "@/lib/cases/status-labels";
import { COMPLETED_STATUSES } from "@/lib/lists/case-status";

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
export const listMyChats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ChatSummary[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return (data ?? []).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updated_at }));
  });

import {
  clampPage,
  clampPageSize,
  likePattern,
  normalizeSearch,
  pageRange,
  pageResult,
  type PageResult,
} from "@/lib/list-query";

const chatsInput = z.object({
  page: z.number().int().min(1).max(10_000).catch(1),
  pageSize: z.number().int().min(5).max(100).catch(20),
  search: z.string().max(120).optional(),
  filter: z.enum(["all", "linked", "unlinked"]).catch("all"),
});

/**
 * One page of the student's own chats, newest activity first.
 * Search and paging run in Postgres so a student with 300 conversations opens
 * the tab as quickly as one with three.
 */
export const listMyChatsPagedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => chatsInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<PageResult<ChatSummary & { caseId: string | null }>> => {
    const { supabase, userId } = context;
    const page = clampPage(data.page);
    const pageSize = clampPageSize(data.pageSize);
    const { from, to } = pageRange(page, pageSize);

    let q = supabase
      .from("conversations")
      .select("id, title, updated_at, related_case_id", { count: "exact" })
      .eq("user_id", userId);

    if (data.filter === "linked") q = q.not("related_case_id", "is", null);
    if (data.filter === "unlinked") q = q.is("related_case_id", null);

    const term = normalizeSearch(data.search);
    if (term) q = q.ilike("title", likePattern(term));

    const { data: rows, count, error } = await q
      .order("updated_at", { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);

    return pageResult(
      (rows ?? []).map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updated_at,
        caseId: c.related_case_id,
      })),
      count ?? null,
      page,
      pageSize,
    );
  });

/** Deletes one of the student's own chats (messages cascade). */
export const deleteMyChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ conversationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ deleted: boolean }> => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("conversations")
      .delete()
      .eq("id", data.conversationId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { deleted: true };
  });

/**
 * Permanently deletes every chat conversation owned by the signed-in student.
 * Ownership comes from the authenticated session only. Messages, agent runs and
 * conversation state cascade; formal case/action records keep their own rows
 * (their conversation link is simply cleared by the database).
 */
export const deleteAllMyChats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ deleted: number }> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("conversations")
      .delete()
      .eq("user_id", userId)
      .select("id");
    if (error) throw new Error(error.message);
    const deleted = (data ?? []).length;

    // Minimal audit event — no conversational content retained.
    await auditInsert(supabase, {
      actor_id: userId,
      action: "DELETE_ALL_CHATS",
      entity_type: "conversations",
      entity_id: userId,
      metadata: { deleted_count: deleted, result: "success" },
    });

    return { deleted };
  });

/**
 * Loads the full message history of one of the student's own chats, including
 * the structured parts of each assistant reply (sources, next steps, receipts
 * and any issued document) so the conversation redraws exactly as it was.
 *
 * A document card is rebuilt from the live `issued_documents` record — the same
 * document id, reference number, verification token and hash. Nothing is
 * regenerated, and no storage path ever leaves the server.
 */
export const getMyChatMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ conversationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<StoredChatMessage[]> => {
    const { supabase, userId } = context;
    const { data: conv, error: convError } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (convError) throw new Error(convError.message);
    if (!conv) throw new Error("Chat not found");

    const { data: rows, error } = await supabase
      .from("messages")
      .select("id, role, content, created_at, metadata")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    // Live document records attached to this conversation, owned by the caller.
    const { data: docs } = await supabase
      .from("issued_documents")
      .select(
        "id, message_id, reference_number, title_en, title_ar, language, issued_at, secure_verification_token, document_hash, document_status, verification_status",
      )
      .eq("student_id", userId)
      .eq("conversation_id", data.conversationId)
      .is("deleted_at", null);

    // Live case state for anything this chat created: status, responsible
    // person and outcome are refreshed every time the chat is reopened, so a
    // receipt from last week never shows stale information.
    const { data: linkedCases } = await supabase
      .from("cases")
      .select("id, case_number, status, assigned_to, outcome_en, service_units(name_en)")
      .eq("student_id", userId)
      .eq("related_conversation_id", data.conversationId)
      .limit(50);
    const staffIds = [...new Set((linkedCases ?? []).map((c) => c.assigned_to).filter(Boolean))] as string[];
    const staffNames = new Map<string, string>();
    const staffEmails = new Map<string, string>();
    if (staffIds.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: staff } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", staffIds);
      for (const p of staff ?? []) {
        staffNames.set(p.id, p.full_name ?? "");
        if (p.email) staffEmails.set(p.id, p.email);
      }
    }
    const caseByNumber = new Map(
      (linkedCases ?? []).map((c) => [
        c.case_number,
        {
          caseId: c.id,
          liveStatus: c.status as string,
          assignedStaffName: c.assigned_to ? staffNames.get(c.assigned_to) ?? null : null,
          assignedStaffEmail: c.assigned_to ? staffEmails.get(c.assigned_to) ?? null : null,
          outcome: c.outcome_en ?? null,
          unit: (c.service_units as { name_en?: string } | null)?.name_en ?? null,
        },
      ]),
    );

    const byMessage = new Map<string, IssuedDocumentCard>();
    const byId = new Map<string, IssuedDocumentCard>();
    for (const d of docs ?? []) {
      const token = d.secure_verification_token;
      const card: IssuedDocumentCard = {
        documentId: d.id,
        referenceNumber: d.reference_number,
        titleEn: d.title_en ?? "Official letter",
        titleAr: d.title_ar ?? "وثيقة رسمية",
        language: d.language ?? "en",
        issuedAt: d.issued_at ?? new Date().toISOString(),
        verifyToken: token ?? null,
        verifyUrl: token ? verificationPath(token) : null,
        fileName: `${d.reference_number}.pdf`,
        documentHash: d.document_hash ?? null,
        status: d.verification_status ?? d.document_status ?? "valid",
      };
      byId.set(d.id, card);
      if (d.message_id) byMessage.set(d.message_id, card);
    }

    return (rows ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        const meta = (m.metadata ?? {}) as Record<string, unknown>;
        const stored = meta["issuedDocument"] as { documentId?: string } | null | undefined;
        const document =
          byMessage.get(m.id) ?? (stored?.documentId ? byId.get(stored.documentId) ?? null : null);
        return {
          role: m.role as "user" | "assistant",
          content: m.content ?? "",
          messageId: typeof meta["proposalMessageId"] === "string" ? meta["proposalMessageId"] : m.id,
          metadata:
            m.role === "assistant"
              ? {
                  verified: meta["verified"] === true,
                  responseType: (meta["responseType"] as string | undefined) ?? "answer",
                  citations: Array.isArray(meta["citations"]) ? (meta["citations"] as Citation[]) : [],
                  proposedActions: Array.isArray(meta["proposedActions"])
                    ? (meta["proposedActions"] as ProposedAction[])
                    : [],
                  nextSteps: Array.isArray(meta["nextSteps"]) ? (meta["nextSteps"] as string[]) : [],
                  toolsUsed: Array.isArray(meta["toolsUsed"]) ? (meta["toolsUsed"] as string[]) : [],
                  activity: Array.isArray(meta["activity"]) ? (meta["activity"] as string[]) : [],
                  receipt: enrichReceipt((meta["receipt"] as ActionReceipt | null) ?? null, caseByNumber),
                  issuedDocument: document ?? null,
                  careerInsight: (meta["careerInsight"] as CareerInsightCard | null) ?? null,
                  libraryResults: (meta["libraryResults"] as LibraryResultsCard | null) ?? null,
                  // Refreshed from the live case so a reopened chat never
                  // shows a stale outcome, status or responsible person.
                  caseResult: refreshCaseResult(
                    (meta["caseResult"] as CaseResultCard | null) ?? null,
                    caseByNumber,
                  ),
                }
              : null,
        };
      });
  });

/** Attach the current case state to a stored receipt so reopened chats stay true. */
function enrichReceipt(
  receipt: ActionReceipt | null,
  cases: Map<
    string,
    {
      caseId: string;
      liveStatus: string;
      assignedStaffName: string | null;
      assignedStaffEmail: string | null;
      outcome: string | null;
      unit: string | null;
    }
  >,
): ActionReceipt | null {
  if (!receipt) return null;
  const live = receipt.referenceNumber ? cases.get(receipt.referenceNumber) : undefined;
  if (!live) return receipt;
  return {
    ...receipt,
    caseId: live.caseId,
    liveStatus: live.liveStatus,
    assignedStaffName: live.assignedStaffName,
    outcome: live.outcome,
    responsibleUnit: receipt.responsibleUnit ?? live.unit,
    trackingUrl: receipt.trackingUrl ?? `/requests/${live.caseId}`,
  };
}

/** Attach the current case state to a stored result card. */
function refreshCaseResult(
  card: CaseResultCard | null,
  cases: Map<
    string,
    {
      caseId: string;
      liveStatus: string;
      assignedStaffName: string | null;
      assignedStaffEmail: string | null;
      outcome: string | null;
      unit: string | null;
    }
  >,
): CaseResultCard | null {
  if (!card) return null;
  const live = cases.get(card.reference);
  if (!live) return card;
  return {
    ...card,
    caseId: live.caseId,
    statusLabel: statusLabel(live.liveStatus, "en"),
    outcome: live.outcome ?? card.outcome,
    staffName: live.assignedStaffName ?? card.staffName,
    staffEmail: live.assignedStaffEmail ?? card.staffEmail,
    unitName: card.unitName ?? live.unit,
    canObject: COMPLETED_STATUSES.includes(live.liveStatus),
    trackingUrl: `/requests/${live.caseId}`,
  };
}
