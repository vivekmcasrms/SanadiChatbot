import { apiFetch } from "@/lib/auth-token";
import type { PageResult } from "@/lib/list-query";

export type OwnerCaseRow = {
  id: string; service_unit_id: string | null; case_number: string; case_type: string;
  title: string; status: string; urgency: string; created_at: string;
  last_activity_at: string | null; resolution_due_at: string | null;
  routing_reason_en: string | null; routing_reason_ar: string | null;
  routing_confidence: number | null; attention_reason_en: string | null;
  attention_reason_ar: string | null; student_id: string | null; student_name: string | null;
  needsAttention: boolean; breached: boolean; lowConfidenceRouting: boolean;
};

export type OwnerCasesPage = PageResult<OwnerCaseRow> & {
  unitIds: string[];
  counts: { open: number; newCount: number; inProgress: number; waitingStudent: number;
    completed: number; attention: number; breached: number };
};

export type OwnerChatRow = {
  id: string; title: string | null; language: string | null; status: string | null;
  updatedAt: string; caseId: string | null; caseNumber: string | null; caseTitle: string | null;
};

type PageInput = {
  unitId?: string | null | undefined; page?: number | undefined;
  pageSize?: number | undefined; search?: string | undefined;
};

const query = (data: Record<string, unknown>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  return params.toString();
};

/** The API resolves the caller's unit scope before applying any UI filters. */
export const listOwnerCasesFn = ({ data }: {
  data: PageInput & {
    type?: string | undefined; status?: string | undefined;
    sla?: "all" | "on_track" | "attention" | "critical" | "breached" | undefined;
    automation?: "all" | "ai" | "human" | undefined; priority?: string | undefined;
    range?: string | undefined; sort?: "activity" | "created" | "due" | "priority" | undefined;
  };
}) => apiFetch<OwnerCasesPage>(`/api/owner-lists/cases?${query(data)}`);

export const listOwnerChatsFn = ({ data }: {
  data: PageInput & { filter?: "all" | "attention" | "escalated" | "linked" | undefined };
}) => apiFetch<PageResult<OwnerChatRow>>(`/api/owner-lists/chats?${query(data)}`);
