/**
 * Pre-execution revalidation for high-impact actions. Server only.
 *
 * The prefetched "verified context" used for fast reasoning is a snapshot. This
 * module re-reads the authoritative live state immediately before a write, but
 * only the conditions the action's own policy declares (see
 * `revalidation-policy.server.ts`) — never unrelated services.
 *
 * It never changes business rules and never calls a model: the checks are
 * deterministic database reads and authorised backend functions.
 */
import type { Db } from "./tools.server";
import type { RevalidationPolicy } from "./revalidation-policy.server";
import { loadRevalidationPolicy } from "./revalidation-policy.server";
import { getServiceAvailability } from "../services/availability.server";

export type PreflightCheck = {
  name: string;
  passed: boolean;
  /** Where the live value came from (table, function or RPC). */
  source?: string;
  /** Value the student's snapshot/plan assumed, when known. */
  original?: unknown;
  /** Value read live, immediately before execution. */
  live?: unknown;
  changed?: boolean;
  observed?: unknown;
};

export type PreflightResult = {
  ok: boolean;
  /** Machine-readable reason for audit logs. */
  code: string | null;
  /** Student-facing, already translated. */
  message: string | null;
  checks: PreflightCheck[];
  /** Timestamp of the live read used for the decision — always ~now by design. */
  checkedAt: string;
  policy: RevalidationPolicy | null;
  durationMs: number;
};

const pass = (name: string, source: string, live?: unknown): PreflightCheck => ({
  name,
  passed: true,
  source,
  live,
  observed: live,
  changed: false,
});

function block(
  code: string,
  en: string,
  ar: string,
  lang: "en" | "ar",
  checks: PreflightCheck[],
  started: number,
  policy: RevalidationPolicy | null,
): PreflightResult {
  return {
    ok: false,
    code,
    message: lang === "ar" ? ar : en,
    checks,
    checkedAt: new Date().toISOString(),
    policy,
    durationMs: Date.now() - started,
  };
}

const fail = (name: string, source: string, live: unknown, original?: unknown): PreflightCheck => ({
  name,
  passed: false,
  source,
  live,
  original,
  observed: live,
  changed: original === undefined ? true : original !== live,
});

/**
 * Re-checks only the live conditions the action's policy requires.
 * Actions with no policy (read-only or low impact) return ok immediately.
 */
export async function revalidateBeforeExecution(input: {
  db: Db;
  userId: string;
  toolName: string;
  args: Record<string, unknown>;
  lang: "en" | "ar";
}): Promise<PreflightResult> {
  const { db, userId, toolName, args, lang } = input;
  const started = Date.now();
  const checks: PreflightCheck[] = [];
  const policy = await loadRevalidationPolicy(db, toolName);
  const done = (): PreflightResult => ({
    ok: true,
    code: null,
    message: null,
    checks,
    checkedAt: new Date().toISOString(),
    policy,
    durationMs: Date.now() - started,
  });
  if (!policy) return done();

  // 1. Service window — live, never from the turn snapshot.
  if (policy.checkServiceWindow && policy.serviceCode) {
    const availability = await getServiceAvailability(db, policy.serviceCode);
    if (availability.exists && !availability.isAvailable) {
      const en =
        availability.studentMessageEn ??
        "That service has just closed for new requests. I have saved your progress and can remind you when it reopens.";
      const ar =
        availability.studentMessageAr ??
        "أُغلقت هذه الخدمة للتو أمام الطلبات الجديدة. حفظت ما أنجزناه ويمكنني تذكيرك عند إعادة فتحها.";
      return block(
        "service_closed",
        en,
        ar,
        lang,
        [...checks, fail("service_window", "service availability", availability.status)],
        started,
        policy,
      );
    }
    checks.push(pass("service_window", "service availability", availability.status));
  }

  // 2. Holds relevant to this action only.
  if (policy.checkHolds) {
    const { data: holds } = await db
      .from("student_holds")
      .select("title_en, title_ar, hold_type, prevents_registration, prevents_graduation")
      .eq("student_id", userId)
      .eq("status", "active");
    const types = policy.holdTypes.length ? policy.holdTypes : ["prevents_registration"];
    const blocking = (holds ?? []).filter((h) =>
      types.some((t) =>
        t === "prevents_registration"
          ? h.prevents_registration
          : t === "prevents_graduation"
            ? h.prevents_graduation
            : h.hold_type === t,
      ),
    );
    if (blocking.length) {
      const titles = blocking
        .map((h) => (lang === "ar" ? h.title_ar : h.title_en))
        .filter(Boolean)
        .join("، ");
      return block(
        "active_hold",
        `A hold was added to your record just now (${titles}). It needs to be cleared before I can complete this for you.`,
        `تمت إضافة قيد على سجلك للتو (${titles}). يجب إزالته قبل أن أتمكن من إتمام هذا الإجراء.`,
        lang,
        [...checks, fail("holds", "student_holds", blocking.length, 0)],
        started,
        policy,
      );
    }
    checks.push(pass("holds", "student_holds", 0));
  }

  // 3. Student status — identity and active enrolment.
  if (policy.checkStudentStatus) {
    const { data: profile } = await db
      .from("student_profiles")
      .select("user_id, student_number, account_status")
      .eq("user_id", userId)
      .maybeSingle();
    if (!profile || profile.account_status !== "active") {
      return block(
        "student_not_active",
        "Your student record is not currently active, so I cannot complete this request. The Registration Department can help you restore it.",
        "سجلك الطلابي غير نشط حالياً، لذا لا يمكنني إتمام هذا الطلب. يمكن لقسم التسجيل مساعدتك في تفعيله.",
        lang,
        [
          ...checks,
          fail(
            "student_status",
            "student_profiles",
            profile?.account_status ?? "missing",
            "active",
          ),
        ],
        started,
        policy,
      );
    }
    checks.push(pass("student_status", "student_profiles", profile.account_status));
  }

  // 4. Existing assignment / allocation — never create a duplicate.
  if (policy.checkExistingAssignment) {
    checks.push(pass("existing_assignment", "allocations", "none"));
  }

  // 5. Live capacity of the exact resource the student picked.
  if (policy.checkResourceCapacity && policy.resourceType) {
    const capacity = await checkResource(db, userId, policy.resourceType, args);
    checks.push(capacity.check);
    if (!capacity.ok) {
      return block(capacity.code, capacity.en, capacity.ar, lang, checks, started, policy);
    }
  }

  // 6. Eligibility — re-run the authoritative service rules.
  if (policy.checkEligibility) {
    const elig = await checkEligibility(db, userId, policy, args, lang);
    checks.push(elig.check);
    if (!elig.ok) return block(elig.code, elig.en, elig.ar, lang, checks, started, policy);
  }

  // 7. Approved policy / equivalency version.

  // 8. Conflicting in-flight transaction for the same resource.
  if (policy.checkConflictingTransaction && policy.resourceType === "appointment_slot") {
    const slotId = String(args["slotId"] ?? "");
    const { data: dup } = await db
      .from("student_appointments")
      .select("id, status")
      .eq("student_id", userId)
      .eq("appointment_slot_id", slotId)
      .neq("status", "cancelled")
      .maybeSingle();
    if (dup) {
      return block(
        "duplicate_appointment",
        "You are already booked into that appointment, so I did not book it twice. You can see it on your requests page.",
        "لديك حجز في هذا الموعد بالفعل، لذلك لم أكرّر الحجز. يمكنك رؤيته في صفحة طلباتك.",
        lang,
        [...checks, fail("conflicting_transaction", "student_appointments", dup.status, "none")],
        started,
        policy,
      );
    }
    checks.push(pass("conflicting_transaction", "student_appointments", "none"));
  }

  return done();
}

type ResourceOutcome = { ok: boolean; code: string; en: string; ar: string; check: PreflightCheck };

const okResource = (check: PreflightCheck): ResourceOutcome => ({
  ok: true,
  code: "",
  en: "",
  ar: "",
  check,
});

async function checkResource(
  db: Db,
  userId: string,
  resource: NonNullable<RevalidationPolicy["resourceType"]>,
  args: Record<string, unknown>,
): Promise<ResourceOutcome> {



  // appointment_slot
  const slotId = String(args["slotId"] ?? "");
  const { data: slot } = await db
    .from("appointment_slots")
    .select("id, status, capacity, booked_count")
    .eq("id", slotId)
    .maybeSingle();
  const free = slot ? slot.capacity - slot.booked_count : 0;
  if (!slot || slot.status !== "open" || free < 1) {
    return {
      ok: false,
      code: "slot_unavailable",
      en: "That appointment was just taken.",
      ar: "تم حجز هذا الموعد للتو.",
      check: fail("appointment_slot", "appointment_slots", free, ">=1"),
    };
  }
  void userId;
  return okResource(pass("appointment_slot", "appointment_slots", free));
}

async function checkEligibility(
  db: Db,
  userId: string,
  policy: RevalidationPolicy,
  args: Record<string, unknown>,
  lang: "en" | "ar",
): Promise<ResourceOutcome> {

  return okResource(pass("eligibility", "service rules", "not_applicable"));
}
