/** Staff-only read of the handover package attached to a case. */
import { apiFetch } from "@/lib/auth-token";

export type HandoverPackage = {
  caseNumber: string | null;
  studentName: string | null;
  studentNumber: string | null;
  studentEmail: string | null;
  unitEn: string | null;
  unitAr: string | null;
  interactionType: string | null;
  summary: string | null;
  conversation: { role: "student" | "sanadi"; text: string; at: string }[];
  verifiedData: Record<string, string | number | boolean | null>;
  actionsTaken: { what: string; reference: string | null; at: string | null }[];
  unresolvedIssue: string | null;
  recommendedAction: string | null;
  priority: string | null;
  attachments: { kind: string; label: string }[];
};

export async function getCaseHandoverFn(opts: { data: { caseId: string } }): Promise<HandoverPackage | null> {
  return apiFetch<HandoverPackage | null>(`/api/cases/${encodeURIComponent(opts.data.caseId)}/handover`);
}
