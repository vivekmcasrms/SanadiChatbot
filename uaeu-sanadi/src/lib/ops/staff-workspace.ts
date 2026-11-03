/**
 * Pure rules for the unified staff case workspace. No I/O: shared by the
 * server (authorization) and the UI (which controls to show), and unit tested.
 */

export type StaffRole = "service_owner" | "service_officer" | "service_manager" | "system_admin" | string;

export type StaffCapabilities = {
  assign: boolean;
  reassign: boolean;
  autoRoute: boolean;
  requestInformation: boolean;
  sendMessage: boolean;
  changeStatus: boolean;
  internalNote: boolean;
  resolve: boolean;
  close: boolean;
  managerTools: boolean;
};

const CASE_WORKERS = ["service_owner", "service_officer", "service_manager", "system_admin"];

/**
 * Owners, officers and managers get the same case workspace. Reassigning to
 * someone else needs unit assignment authority (manager/admin, or a unit
 * member flagged as an assigner); manager tools stay with managers.
 */
export function staffCapabilities(roles: StaffRole[], opts: { unitAssigner?: boolean } = {}): StaffCapabilities {
  const worker = roles.some((r) => CASE_WORKERS.includes(r));
  const manager = roles.includes("service_manager") || roles.includes("system_admin");
  return {
    assign: worker,
    reassign: worker && (manager || Boolean(opts.unitAssigner)),
    autoRoute: worker,
    requestInformation: worker,
    sendMessage: worker,
    changeStatus: worker,
    internalNote: worker,
    resolve: worker,
    close: worker,
    managerTools: manager,
  };
}

export type CaseAccessInput = {
  userId: string;
  roles: StaffRole[];
  caseUnitId: string | null;
  assignedTo: string | null;
  permittedUnitIds: string[];
};

/** Staff see only cases assigned to them or in units they are permitted for. */
export function canAccessCase(i: CaseAccessInput): boolean {
  if (i.roles.includes("system_admin")) return true;
  if (!i.roles.some((r) => CASE_WORKERS.includes(r))) return false;
  if (i.assignedTo && i.assignedTo === i.userId) return true;
  return Boolean(i.caseUnitId && i.permittedUnitIds.includes(i.caseUnitId));
}

export type StaffWorkloadRow = {
  staffId: string;
  fullName: string | null;
  workload: number;
  activeCases: number;
  isActive: boolean;
  availability: string;
};

const UNAVAILABLE = new Set(["unavailable", "away", "on_leave", "leave", "out_of_office", "offline", "inactive"]);

/** Picker options: active, available staff of the case's unit, lightest workload first. */
export function eligibleAssignees(rows: StaffWorkloadRow[]): StaffWorkloadRow[] {
  return rows
    .filter((r) => r.isActive && !UNAVAILABLE.has(String(r.availability).toLowerCase()))
    .sort((a, b) => a.workload - b.workload || (a.fullName ?? "").localeCompare(b.fullName ?? ""));
}

export function isEligibleAssignee(staffId: string, rows: StaffWorkloadRow[]): boolean {
  return eligibleAssignees(rows).some((r) => r.staffId === staffId);
}

/**
 * Optimistic concurrency: a change based on an out-of-date view is rejected
 * so two staff members never silently overwrite each other.
 */
export function isStaleChange(expected: string | null | undefined, current: string | null | undefined): boolean {
  if (expected === undefined) return false;
  return (expected ?? null) !== (current ?? null);
}

export const STALE_MESSAGE = {
  en: "This request was just updated by someone else. The latest version is now shown — please check it and try again.",
  ar: "تم تحديث هذا الطلب للتو من قبل موظف آخر. يظهر الآن أحدث إصدار — يرجى مراجعته والمحاولة مرة أخرى.",
};

/**
 * Hostel allocation default comes from the student's authoritative
 * eligibility: the first eligible hostel, never a blind "A".
 */
export function defaultHostel(eligibleHostels: string[] | null | undefined, currentHostel?: string | null): string | null {
  const list = (eligibleHostels ?? []).filter(Boolean);
  if (currentHostel && list.includes(currentHostel)) return currentHostel;
  return list[0] ?? null;
}
