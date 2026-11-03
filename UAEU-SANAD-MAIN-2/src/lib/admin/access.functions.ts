/** Typed browser clients for C# access-governance endpoints. */
import { apiFetch } from "@/lib/auth-token";

export type StaffAccessRow = {
  userId: string; fullName: string | null; email: string | null; roles: string[];
  revokedAt: string | null; revokedReason: string | null; openCases: number;
};

export type AccessAuditRow = {
  id: string; action: string; at: string; actorName: string | null;
  subjectName: string | null; reason: string | null; reassigned: number | null;
};

export async function listStaffAccessFn(): Promise<StaffAccessRow[]> {
  return apiFetch<StaffAccessRow[]>("/api/admin/access");
}

export async function revokeStaffAccessFn(opts: { data: { userId: string; reason: string; reassignOpenCases?: boolean } }): Promise<{ ok: true; reassigned: number; flagged: number }> {
  return apiFetch("/api/admin/access/revoke", { method: "POST", body: JSON.stringify({ ...opts.data, reassignOpenCases: opts.data.reassignOpenCases ?? true }) });
}

export async function restoreStaffAccessFn(opts: { data: { userId: string } }): Promise<{ ok: true }> {
  return apiFetch("/api/admin/access/restore", { method: "POST", body: JSON.stringify(opts.data) });
}

export async function listAccessAuditFn(): Promise<AccessAuditRow[]> {
  return apiFetch<AccessAuditRow[]>("/api/admin/access/audit");
}
