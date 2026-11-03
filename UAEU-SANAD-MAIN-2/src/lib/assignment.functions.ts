/** Typed API client for the C# workload endpoint. */
import { apiFetch } from "@/lib/auth-token";

export type StaffWorkload = {
  staffId: string; fullName: string | null; email: string | null; workload: number;
  activeCases: number; lastAssignedAt: string | null; isActive: boolean; availability: string;
};

export async function listUnitStaffWorkloadFn(opts: { data: { unitId: string } }): Promise<StaffWorkload[]> {
  return apiFetch<StaffWorkload[]>(`/api/admin/access/workload/${encodeURIComponent(opts.data.unitId)}`);
}
