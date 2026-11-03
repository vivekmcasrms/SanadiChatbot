/** Server functions for the unit-scoped Service Owner workspace. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { caseVisibilityFilter, loadOwnerWorkspace, resolveScope, canDo } from "./owner/workspace.server";
import { loadOwnerOperations } from "./ops/owner-operations.server";
import { IN_PROGRESS_STATUSES, OPEN_STATUSES, WAITING_STATUSES } from "./lists/case-status";

const OPEN_EXCLUDE = "(closed,resolved,withdrawn,rejected,duplicate)";

/** Which units the signed-in owner supervises, and what they may do in each. */
export const getOwnerWorkspaceFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => loadOwnerWorkspace(context.supabase, context.userId));

const unitInput = (d: unknown) =>
  z.object({ unitId: z.string().uuid().nullish() }).parse(d ?? {});

/** Everything the owner's unit overview needs, scoped to one unit at a time. */
export const getOwnerUnitOverviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(unitInput)
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const ws = await loadOwnerWorkspace(db, context.userId);
    const scope = resolveScope(ws, data.unitId ?? null);
    const visibility = caseVisibilityFilter(scope, context.userId);

    const { data: cases } = await db
      .from("cases")
      .select(
        "id, case_number, case_type, title, status, urgency, is_sensitive, service_unit_id, assigned_to, created_at, last_activity_at, resolution_due_at, routing_service_code, routing_topic, root_cause_code, routing_reason_en, routing_reason_ar, routing_confidence",
      )
      .or(visibility)
      .not("status", "in", OPEN_EXCLUDE)
      .order("urgency", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200);

    const rows = cases ?? [];
    const ids = rows.map((c) => c.id);
    const { data: states } = ids.length
      ? await db
          .from("case_automation_state")
          .select("case_id, attention_category, attention_reason_en, attention_reason_ar, next_action_en, next_action_ar, next_action_at, automation_paused")
          .in("case_id", ids)
      : { data: [] as never[] };

    const stateFor = new Map((states ?? []).map((s) => [s.case_id, s]));
    const now = Date.now();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const items = rows.map((c) => {
      const st = stateFor.get(c.id) ?? null;
      const due = c.resolution_due_at ? new Date(c.resolution_due_at).getTime() : null;
      return {
        ...c,
        automation: st,
        needsAttention: Boolean(st?.attention_category || st?.automation_paused),
        breached: due != null && due < now,
        lowConfidenceRouting: Number(c.routing_confidence ?? 1) < 0.6,
      };
    });

    const aiManaged = items.filter((i) => i.automation && !i.needsAttention);
    const atRisk = items.filter((i) => {
      const due = i.resolution_due_at ? new Date(i.resolution_due_at).getTime() : null;
      return due != null && !i.breached && due - now <= 8 * 3_600_000;
    });

    return {
      unitIds: scope,
      cases: items,
      attention: items.filter((i) => i.needsAttention),
      aiManaged,
      recent: [...items]
        .sort(
          (a, b) =>
            new Date(b.last_activity_at ?? b.created_at).getTime() -
            new Date(a.last_activity_at ?? a.created_at).getTime(),
        )
        .slice(0, 8),
      counts: {
        open: items.length,
        attention: items.filter((i) => i.needsAttention).length,
        aiManaged: aiManaged.length,
        atRisk: atRisk.length,
        breached: items.filter((i) => i.breached).length,
        waitingStudent: items.filter((i) => i.status === "awaiting_student" || i.status === "student_confirmation").length,
        newToday: items.filter((i) => new Date(i.created_at).getTime() >= startOfDay.getTime()).length,
      },
    };
  });

/** Unit-specific operational insights — never university-wide AI metrics. */
export const getOwnerUnitInsightsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(unitInput)
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const ws = await loadOwnerWorkspace(db, context.userId);
    const scope = resolveScope(ws, data.unitId ?? null);
    const empty = {
      totalCases: 0,
      byType: [] as { type: string; count: number }[],
      automationRate: null as number | null,
      slaCompliance: null as number | null,
      avgResolutionHours: null as number | null,
      topTopics: [] as { label: string; count: number }[],
      topRootCauses: [] as { label: string; count: number }[],
    };
    if (!scope.length) return empty;

    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data: rows } = await db
      .from("cases")
      .select(
        "id, case_type, status, created_at, resolved_at, resolution_due_at, routing_topic, root_cause_code, service_unit_id",
      )
      .in("service_unit_id", scope)
      .gte("created_at", since)
      .limit(1000);

    const cases = rows ?? [];
    if (!cases.length) return empty;

    const ids = cases.map((c) => c.id);
    const { data: states } = await db
      .from("case_automation_state")
      .select("case_id, attention_category, automation_paused")
      .in("case_id", ids);
    const stateFor = new Map((states ?? []).map((s) => [s.case_id, s]));

    const automated = cases.filter((c) => {
      const st = stateFor.get(c.id);
      return st && !st.attention_category && !st.automation_paused;
    }).length;

    const resolved = cases.filter((c) => c.resolved_at);
    const withinSla = resolved.filter(
      (c) => !c.resolution_due_at || new Date(c.resolved_at!).getTime() <= new Date(c.resolution_due_at).getTime(),
    );
    const durations = resolved.map(
      (c) => (new Date(c.resolved_at!).getTime() - new Date(c.created_at).getTime()) / 3_600_000,
    );

    const tally = (values: (string | null)[]) => {
      const map = new Map<string, number>();
      for (const v of values) {
        if (!v) continue;
        map.set(v, (map.get(v) ?? 0) + 1);
      }
      return [...map.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
    };

    return {
      totalCases: cases.length,
      byType: tally(cases.map((c) => c.case_type)).map((t) => ({ type: t.label, count: t.count })),
      automationRate: Math.round((automated / cases.length) * 100),
      slaCompliance: resolved.length ? Math.round((withinSla.length / resolved.length) * 100) : null,
      avgResolutionHours: durations.length
        ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
        : null,
      topTopics: tally(cases.map((c) => c.routing_topic)),
      topRootCauses: tally(cases.map((c) => c.root_cause_code)),
    };
  });

/** Follow-up and SLA views, restricted to the selected unit. */
export const getOwnerUnitOperationsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(unitInput)
  .handler(async ({ data, context }) => {
    const ws = await loadOwnerWorkspace(context.supabase, context.userId);
    const scope = resolveScope(ws, data.unitId ?? null);
    return loadOwnerOperations(context.supabase, scope);
  });

/** Student conversations attached to the unit's cases. */
export const getOwnerUnitChatsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(unitInput)
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const ws = await loadOwnerWorkspace(db, context.userId);
    const scope = resolveScope(ws, data.unitId ?? null);
    if (!scope.length) return [];

    const { data: cases } = await db
      .from("cases")
      .select("id, case_number, title, status")
      .in("service_unit_id", scope)
      .order("last_activity_at", { ascending: false })
      .limit(100);
    const caseRows = cases ?? [];
    if (!caseRows.length) return [];

    const { data: convos } = await db
      .from("conversations")
      .select("id, title, language, conversation_status, related_case_id, updated_at")
      .in(
        "related_case_id",
        caseRows.map((c) => c.id),
      )
      .order("updated_at", { ascending: false })
      .limit(50);

    const caseFor = new Map(caseRows.map((c) => [c.id, c]));
    return (convos ?? []).map((cv) => ({
      id: cv.id,
      title: cv.title,
      language: cv.language,
      status: cv.conversation_status,
      updatedAt: cv.updated_at,
      caseId: cv.related_case_id,
      caseNumber: cv.related_case_id ? (caseFor.get(cv.related_case_id)?.case_number ?? null) : null,
      caseTitle: cv.related_case_id ? (caseFor.get(cv.related_case_id)?.title ?? null) : null,
    }));
  });

/**
 * Flag a case as wrongly routed and hand it to the correct unit.
 * The feedback row is the training signal for routing rules; the reassignment
 * is only performed when the owner is permitted to do it for that unit.
 */
export const reportMisroutingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        correctedUnitId: z.string().uuid().nullish(),
        reason: z.string().min(5).max(1000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const ws = await loadOwnerWorkspace(db, context.userId);

    const { data: row } = await db
      .from("cases")
      .select("id, case_number, service_unit_id, routing_service_code, routing_topic")
      .eq("id", data.caseId)
      .maybeSingle();
    if (!row) throw new Error("Case not found");

    const unitId = row.service_unit_id ?? "";
    const permission = canDo(ws, unitId, "report_misrouting");
    if (!permission) throw new Error("You are not permitted to report routing for this case");

    const { error: feedbackError } = await db.from("case_routing_feedback").insert({
      case_id: data.caseId,
      reported_by: context.userId,
      original_unit_id: row.service_unit_id,
      corrected_unit_id: data.correctedUnitId ?? null,
      original_service_code: row.routing_service_code,
      original_topic: row.routing_topic,
      reason: data.reason,
    });
    if (feedbackError) throw new Error(feedbackError.message);

    let reassigned = false;
    if (data.correctedUnitId && data.correctedUnitId !== row.service_unit_id) {
      if (!canDo(ws, unitId, "reassign_unit")) {
        throw new Error("Routing feedback recorded, but you are not permitted to reassign this case");
      }
      const { error } = await db
        .from("cases")
        .update({
          service_unit_id: data.correctedUnitId,
          assigned_to: null,
          status: "submitted",
          human_review_required: true,
          routing_reason_en: `Reassigned by the service owner: ${data.reason}`,
          routing_reason_ar: `أعاد مالك الخدمة التوجيه: ${data.reason}`,
          routing_confidence: 1,
          last_activity_at: new Date().toISOString(),
        })
        .eq("id", data.caseId);
      if (error) throw new Error(error.message);
      await db.from("case_status_history").insert({
        case_id: data.caseId,
        to_status: "submitted",
        changed_by: context.userId,
        note: `Reassigned to the correct unit — ${data.reason}`,
      });
      reassigned = true;
    }

    // Governed learning: record the correction. Routing only changes for
    // future students after an administrator approves a proposal.
    const { noteRuleOutcome } = await import("@/lib/learning/rules.server");
    void noteRuleOutcome({
      caseId: data.caseId,
      success: false,
      reason: data.reason,
      correctedTarget: data.correctedUnitId ?? null,
    });
    const { recordLearningSignal } = await import("@/lib/learning/signals.server");
    await recordLearningSignal({
      correctionType: "ROUTING_CORRECTION",
      source: "STAFF",
      caseId: data.caseId,
      originalUnitId: row.service_unit_id,
      correctedUnitId: data.correctedUnitId ?? null,
      originalDomain: row.routing_topic,
      originalIntent: row.routing_service_code,
      staffComment: data.reason,
      originalUserText: null,
      outcome: reassigned ? "reassigned" : "reported",
      confidence: 0.75,
    });

    return { ok: true, reassigned };
  });

/**
 * Lean Service Owner dashboard: "what is happening in my service?".
 *
 * Every number is a live database count inside the caller's owned units —
 * nothing is hard-coded, seeded or university-wide.
 */
export const getOwnerDashboardFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ unitId: z.string().uuid().nullish(), days: z.number().int().min(1).max(365).catch(30) })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const ws = await loadOwnerWorkspace(db, context.userId);
    const scope = resolveScope(ws, data.unitId ?? null);

    const empty = {
      unitIds: [] as string[],
      since: new Date().toISOString(),
      byType: { query: 0, complaint: 0, suggestion: 0, alert: 0, service_request: 0 },
      byStatus: { open: 0, inProgress: 0, waitingStudent: 0, resolved: 0, closed: 0 },
      total: 0,
      attention: 0,
      recent: [] as {
        id: string;
        case_number: string;
        case_type: string;
        title: string;
        status: string;
        urgency: string;
        created_at: string;
        last_activity_at: string | null;
      }[],
    };
    const visibility = caseVisibilityFilter(scope, context.userId);

    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const scoped = () => db.from("cases").select("id", { count: "exact", head: true }).or(visibility);
    const base = () => scoped().gte("created_at", since);

    const types = ["query", "complaint", "suggestion", "alert", "service_request"] as const;
    const [typeCounts, total, open, inProgress, waiting, resolved, closed, attention, recent] = await Promise.all([
      Promise.all(types.map((t) => base().eq("case_type", t as never))),
      base(),
      // Status counts describe the live queue, using the same status groups as
      // the Needs Your Attention list, so the dashboard can never disagree.
      scoped().in("status", OPEN_STATUSES as never[]),
      scoped().in("status", IN_PROGRESS_STATUSES as never[]),
      scoped().in("status", WAITING_STATUSES as never[]),
      scoped().eq("status", "resolved" as never),
      scoped().eq("status", "closed" as never),
      // "Needs your attention" is exactly what the queue of the same name
      // lists: every open request in the unit. One definition, one number.
      scoped().in("status", OPEN_STATUSES as never[]),


      db
        .from("cases")
        .select("id, case_number, case_type, title, status, urgency, created_at, last_activity_at")
        .or(visibility)
        .order("urgency", { ascending: false })
        .order("last_activity_at", { ascending: false, nullsFirst: false })
        .limit(8),
    ]);

    const byType = { query: 0, complaint: 0, suggestion: 0, alert: 0, service_request: 0 } as Record<string, number>;
    types.forEach((t, i) => {
      byType[t] = typeCounts[i]?.count ?? 0;
    });

    return {
      unitIds: scope,
      since,
      byType: byType as typeof empty.byType,
      byStatus: {
        open: open.count ?? 0,
        inProgress: inProgress.count ?? 0,
        waitingStudent: waiting.count ?? 0,
        resolved: resolved.count ?? 0,
        closed: closed.count ?? 0,
      },
      total: total.count ?? 0,
      attention: attention.count ?? 0,
      recent: (recent.data ?? []) as typeof empty.recent,
    };
  });
