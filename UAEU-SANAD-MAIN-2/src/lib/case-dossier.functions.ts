import { apiFetch } from "@/lib/auth-token";

export type CaseDossier = {
  case: {
    id: string; status: string; outcome_en: string | null; outcome_ar: string | null;
    created_at: string; description: string | null; ai_summary: string | null;
    ai_confidence: number | null; [key: string]: unknown;
  };
  student: { id: string; name: string; email: string | null; studentNumber: string | null; programme: string | null; cgpa: number | null; credits: number | null };
  assignedToName: string | null;
  assignment: Record<string, unknown> | null;
  conversation: { id: string; title: string | null; conversation_status: string; updated_at: string } | null;
  timeline: Array<{ id: string; at: string; actor: "student" | "ai" | "owner" | "system"; actorName: string | null; kind: string; title: string; detail: string | null; internal: boolean }>;
  alternatives: Array<{ id: string; opportunity_code: string; title_en: string; title_ar: string; available_seats: number }>;
};

const post = <T>(caseId: string, action: string, body: unknown) => apiFetch<T>(`/api/case-dossiers/${caseId}/${action}`, { method: "POST", body: JSON.stringify(body) });

export const getCaseDossierFn = ({ data }: { data: { caseId: string } }) => apiFetch<CaseDossier>(`/api/case-dossiers/${data.caseId}`);
export const addCaseNoteFn = ({ data }: { data: { caseId: string; body: string } }) => post<{ ok: true; id: string }>(data.caseId, "notes", { body: data.body });
export const sendCaseMessageFn = ({ data }: { data: { caseId: string; body: string } }) => post<{ ok: true }>(data.caseId, "messages", { body: data.body });
export const setOwnerCaseStatusFn = ({ data }: { data: { caseId: string; status: string; note?: string | undefined } }) => post<{ ok: true }>(data.caseId, "status", { status: data.status, note: data.note });
export const ownerReopenCaseFn = ({ data }: { data: { caseId: string; reason: string } }) => post<{ ok: true }>(data.caseId, "reopen", { reason: data.reason });
export const setConversationStatusFn = ({ data }: { data: { caseId: string; status: string } }) => post<{ ok: true }>(data.caseId, "conversation-status", { status: data.status });
export const ownerChangePlacementFn = ({ data }: { data: { caseId: string; assignmentId: string; newOpportunityId: string; reason: string } }) => post<{ ok: true }>(data.caseId, "placement", data);
