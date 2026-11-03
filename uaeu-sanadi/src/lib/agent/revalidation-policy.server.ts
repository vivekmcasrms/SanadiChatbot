/**
 * Per-action revalidation policy. Server only.
 *
 * Each high-impact action declares exactly which live conditions must be
 * re-read immediately before its write executes. The configuration lives in
 * `public.action_revalidation_policies` so it can be tuned without a deploy;
 * the constants below are the safe fallback when the table is unreachable.
 *
 * Principle: revalidate everything necessary, nothing irrelevant.
 */
import type { Db } from "./tools.server";

export type ResourceType = "appointment_slot";
export type RecoveryMode = "auto" | "confirm" | "none";

export type RevalidationPolicy = {
  actionCode: string;
  serviceCode: string | null;
  checkServiceWindow: boolean;
  checkHolds: boolean;
  holdTypes: string[];
  checkStudentStatus: boolean;
  checkResourceCapacity: boolean;
  resourceType: ResourceType | null;
  checkExistingAssignment: boolean;
  checkEligibility: boolean;
  checkPolicyVersion: boolean;
  checkConflictingTransaction: boolean;
  customValidationFunction: string | null;
  recoveryMode: RecoveryMode;
  enabled: boolean;
};

const base = (actionCode: string, over: Partial<RevalidationPolicy>): RevalidationPolicy => ({
  actionCode,
  serviceCode: null,
  checkServiceWindow: false,
  checkHolds: false,
  holdTypes: [],
  checkStudentStatus: false,
  checkResourceCapacity: false,
  resourceType: null,
  checkExistingAssignment: false,
  checkEligibility: false,
  checkPolicyVersion: false,
  checkConflictingTransaction: false,
  customValidationFunction: null,
  recoveryMode: "none",
  enabled: true,
  ...over,
});

/** Compiled-in fallback, identical to the seeded rows. */
export const DEFAULT_POLICIES: Record<string, RevalidationPolicy> = {
  book_appointment: base("book_appointment", {
    checkResourceCapacity: true,
    resourceType: "appointment_slot",
    checkConflictingTransaction: true,
    recoveryMode: "auto",
  }),
  issue_enrollment_letter: base("issue_enrollment_letter", {
    serviceCode: "SVC-DOC-TWIMC",
    checkServiceWindow: true,
    checkStudentStatus: true,
  }),
};

let cache: { at: number; map: Map<string, RevalidationPolicy> } | null = null;
const TTL_MS = 60_000;

/** Loads the policy for one action (DB-configured, cached, with code fallback). */
export async function loadRevalidationPolicy(
  db: Db,
  actionCode: string,
): Promise<RevalidationPolicy | null> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    const map = new Map<string, RevalidationPolicy>();
    const { data } = await db
      .from("action_revalidation_policies")
      .select(
        "action_code, service_code, check_service_window, check_holds, hold_types, check_student_status, check_resource_capacity, resource_type, check_existing_assignment, check_eligibility, check_policy_version, check_conflicting_transaction, custom_validation_function, recovery_mode, enabled",
      );
    for (const r of data ?? []) {
      map.set(r.action_code, {
        actionCode: r.action_code,
        serviceCode: r.service_code,
        checkServiceWindow: r.check_service_window,
        checkHolds: r.check_holds,
        holdTypes: r.hold_types ?? [],
        checkStudentStatus: r.check_student_status,
        checkResourceCapacity: r.check_resource_capacity,
        resourceType: (r.resource_type as ResourceType | null) ?? null,
        checkExistingAssignment: r.check_existing_assignment,
        checkEligibility: r.check_eligibility,
        checkPolicyVersion: r.check_policy_version,
        checkConflictingTransaction: r.check_conflicting_transaction,
        customValidationFunction: r.custom_validation_function,
        recoveryMode: (r.recovery_mode as RecoveryMode) ?? "none",
        enabled: r.enabled,
      });
    }
    if (map.size) cache = { at: Date.now(), map };
  }
  const fromDb = cache?.map.get(actionCode);
  const policy = fromDb ?? DEFAULT_POLICIES[actionCode] ?? null;
  if (!policy || !policy.enabled) return null;
  return policy;
}

/** Test/admin helper — drops the in-process cache. */
export function resetRevalidationPolicyCache() {
  cache = null;
}
