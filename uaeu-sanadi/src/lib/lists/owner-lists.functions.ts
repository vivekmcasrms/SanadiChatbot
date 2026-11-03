/**
 * Service Owner operational lists (unit case queue, unit chats).
 *
 * Authorisation first, filters second: the server resolves which units the
 * signed-in owner actually supervises and only then applies the requested
 * filters inside that scope. A `unitId` coming from the URL can narrow the
 * scope, never widen it, and search is bounded by the same scope — searching
 * "Ahmed" as a Housing owner returns Ahmed's Housing cases only.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { caseVisibilityFilter, loadOwnerWorkspace, resolveScope } from "@/lib/owner/workspace.server";
import {
  clampPage,
  clampPageSize,
  dateRangeStart,
  emptyPage,
  likePattern,
  normalizeSearch,
  pageRange,
  pageResult,
  type PageResult,
} from "@/lib/list-query";

import {
  COMPLETED_STATUSES,
  IN_PROGRESS_STATUSES,
  NEW_STATUSES,
  OPEN_STATUSES,
  WAITING_STATUSES,
  statusesFor,
} from "@/lib/lists/case-status";



const casesInput = z.object({
  unitId: z.string().uuid().nullish(),
  page: z.number().int().min(1).max(10_000).catch(1),
  pageSize: z.number().int().min(5).max(100).catch(25),
  search: z.string().max(120).optional(),
  type: z.string().max(30).optional(),
  status: z.string().max(30).optional(),
  sla: z.enum(["all", "on_track", "attention", "critical", "breached"]).catch("all"),
  automation: z.enum(["all", "ai", "human"]).catch("all"),
  priority: z.string().max(20).optional(),
  range: z.string().max(10).optional(),
  sort: z.enum(["activity", "created", "due", "priority"]).catch("activity"),
});

export type OwnerCaseRow = {
  id: string;
  service_unit_id: string | null;
  case_number: string;
  case_type: string;
  title: string;
  status: string;
  urgency: string;
  created_at: string;
  last_activity_at: string | null;
  resolution_due_at: string | null;
  routing_reason_en: string | null;
  routing_reason_ar: string | null;
  routing_confidence: number | null;
  attention_reason_en: string | null;
  attention_reason_ar: string | null;
  student_id: string | null;
  student_name: string | null;
  needsAttention: boolean;
  breached: boolean;
  lowConfidenceRouting: boolean;
};


export type OwnerCasesPage = PageResult<OwnerCaseRow> & {
  unitIds: string[];
  /**
   * Chip counts inside the caller's authorised scope. They are produced from
   * exactly the same base filters as the visible list (unit scope, type, SLA,
   * handling, search) and differ only by status group, so a chip count can
   * never disagree with the rows on screen.
   */
  counts: {
    open: number;
    newCount: number;
    inProgress: number;
    waitingStudent: number;
    completed: number;
    attention: number;
    breached: number;
  };
};




/** One page of the owner's unit case queue: filtered, sorted and sliced in Postgres. */
export const listOwnerCasesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => casesInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<OwnerCasesPage> => {
    const db = context.supabase;
    const ws = await loadOwnerWorkspace(db, context.userId);
    const scope = resolveScope(ws, data.unitId ?? null);
    const page = clampPage(data.page);
    const pageSize = clampPageSize(data.pageSize);

    // A case assigned directly to this staff member is always visible, even
    // when it sits in a unit they do not normally supervise. A critical alert
    // must never be assigned in the database and invisible on screen.
    const visibility = caseVisibilityFilter(scope, context.userId);

    const now = new Date();
    const nowIso = now.toISOString();
    const in4h = new Date(now.getTime() + 4 * 3_600_000).toISOString();
    const in24h = new Date(now.getTime() + 24 * 3_600_000).toISOString();

    const needsState = data.automation !== "all";
    const columns =
      "id, service_unit_id, case_number, case_type, title, status, urgency, created_at, last_activity_at, resolution_due_at, routing_reason_en, routing_reason_ar, routing_confidence, student_id";
    const since = dateRangeStart(data.range);
    const term = normalizeSearch(data.search);

    /**
     * Single source of truth. Every read below — the visible page and each chip
     * count — starts here, so they can only ever differ by status group.
     */
    const base = (select: string, head: boolean) => {
      let q = db
        .from("cases")
        .select(select, { count: "exact", head })
        .or(visibility);


      if (data.type && data.type !== "all") q = q.eq("case_type", data.type as never);
      if (data.priority && data.priority !== "all") q = q.eq("urgency", data.priority as never);
      if (since) q = q.gte("created_at", since);

      switch (data.sla) {
        case "breached":
          q = q.lt("resolution_due_at", nowIso);
          break;
        case "critical":
          q = q.gte("resolution_due_at", nowIso).lt("resolution_due_at", in4h);
          break;
        case "attention":
          q = q.gte("resolution_due_at", in4h).lt("resolution_due_at", in24h);
          break;
        case "on_track":
          q = q.gte("resolution_due_at", in24h);
          break;
        default:
          break;
      }

      if (data.automation === "ai") {
        q = q.is("case_automation_state.attention_category", null).is("case_automation_state.automation_paused", false);
      } else if (data.automation === "human") {
        q = q.not("case_automation_state.attention_category", "is", null);
      }

      if (term) {
        const like = likePattern(term);
        q = q.or(`case_number.ilike.${like},title.ilike.${like},routing_topic.ilike.${like}`);
      }
      return q;
    };

    const stateJoin = needsState
      ? ", case_automation_state!inner(attention_category, attention_reason_en, attention_reason_ar, automation_paused)"
      : ", case_automation_state(attention_category, attention_reason_en, attention_reason_ar, automation_paused)";
    const countSelect = needsState ? "id, case_automation_state!inner(attention_category)" : "id";

    const countFor = (statuses: string[] | null) => {
      const q = base(countSelect, true);
      return statuses ? q.in("status", statuses as never[]) : q;
    };

    let q = base(`${columns}${stateJoin}`, false);
    const wanted = statusesFor(data.status ?? undefined);
    if (wanted) q = q.in("status", wanted as never[]);

    switch (data.sort) {
      case "created":
        q = q.order("created_at", { ascending: false });
        break;
      case "due":
        q = q.order("resolution_due_at", { ascending: true, nullsFirst: false });
        break;
      case "priority":
        // Critical → high → medium → low, oldest unresolved first inside a level.
        q = q.order("urgency", { ascending: false }).order("created_at", { ascending: true });
        break;
      default:
        // Even the activity view keeps urgent work on top: a critical alert must
        // never sit below a chatty low-priority case.
        q = q
          .order("urgency", { ascending: false })
          .order("last_activity_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false });
    }

    const { from, to } = pageRange(page, pageSize);

    const [listResult, openCount, newCount, progressCount, waitingCount, completedCount, breachedCount, attentionCount] =
      await Promise.all([
        q.range(from, to),
        countFor(OPEN_STATUSES),
        countFor(NEW_STATUSES),
        countFor(IN_PROGRESS_STATUSES),
        countFor(WAITING_STATUSES),
        countFor(COMPLETED_STATUSES),
        countFor(OPEN_STATUSES).lt("resolution_due_at", nowIso),
        db
          .from("cases")
          .select("id, case_automation_state!inner(attention_category)", { count: "exact", head: true })
          .or(visibility)
          .in("status", OPEN_STATUSES as never[])
          .not("case_automation_state.attention_category", "is", null),
      ]);

    if (listResult.error) throw new Error(listResult.error.message);

    type Row = Omit<
      OwnerCaseRow,
      | "needsAttention"
      | "breached"
      | "lowConfidenceRouting"
      | "attention_reason_en"
      | "attention_reason_ar"
      | "student_name"
    > & {
      case_automation_state:
        | {
            attention_category: string | null;
            attention_reason_en: string | null;
            attention_reason_ar: string | null;
            automation_paused: boolean | null;
          }[]
        | {
            attention_category: string | null;
            attention_reason_en: string | null;
            attention_reason_ar: string | null;
            automation_paused: boolean | null;
          }
        | null;
    };

    const nowMs = now.getTime();
    const items: OwnerCaseRow[] = ((listResult.data ?? []) as unknown as Row[]).map((c) => {
      const st = Array.isArray(c.case_automation_state) ? c.case_automation_state[0] : c.case_automation_state;
      const due = c.resolution_due_at ? new Date(c.resolution_due_at).getTime() : null;
      return {
        id: c.id,
        service_unit_id: c.service_unit_id ?? null,
        case_number: c.case_number,
        case_type: c.case_type,
        title: c.title,
        status: c.status,
        urgency: c.urgency,
        created_at: c.created_at,
        last_activity_at: c.last_activity_at ?? null,
        resolution_due_at: c.resolution_due_at ?? null,
        routing_reason_en: c.routing_reason_en ?? null,
        routing_reason_ar: c.routing_reason_ar ?? null,
        routing_confidence: c.routing_confidence ?? null,
        attention_reason_en: st?.attention_reason_en ?? null,
        attention_reason_ar: st?.attention_reason_ar ?? null,
        student_id: c.student_id ?? null,
        student_name: null,
        needsAttention: Boolean(st?.attention_category || st?.automation_paused),
        breached: due != null && due < nowMs,
        lowConfidenceRouting: Number(c.routing_confidence ?? 1) < 0.6,
      };
    });

    // Student names are resolved in one bounded lookup so a card can say who
    // is waiting without embedding profile data in the paged case query.
    const studentIds = [...new Set(items.map((i) => i.student_id).filter((v): v is string => Boolean(v)))];
    if (studentIds.length) {
      const { data: people } = await db.from("profiles").select("id, full_name").in("id", studentIds);
      const nameFor = new Map((people ?? []).map((p) => [p.id, p.full_name]));
      for (const item of items) {
        if (item.student_id) item.student_name = nameFor.get(item.student_id) ?? null;
      }
    }

    return {
      ...pageResult(items, listResult.count ?? null, page, pageSize),
      unitIds: scope,
      counts: {
        open: openCount.count ?? 0,
        newCount: newCount.count ?? 0,
        inProgress: progressCount.count ?? 0,
        waitingStudent: waitingCount.count ?? 0,
        completed: completedCount.count ?? 0,
        attention: attentionCount.count ?? 0,
        breached: breachedCount.count ?? 0,
      },
    };
  });

const chatsInput = z.object({
  unitId: z.string().uuid().nullish(),
  page: z.number().int().min(1).max(10_000).catch(1),
  pageSize: z.number().int().min(5).max(100).catch(20),
  search: z.string().max(120).optional(),
  filter: z.enum(["all", "attention", "escalated", "linked"]).catch("all"),
});

export type OwnerChatRow = {
  id: string;
  title: string | null;
  language: string | null;
  status: string | null;
  updatedAt: string;
  caseId: string | null;
  caseNumber: string | null;
  caseTitle: string | null;
};

/**
 * One page of student conversations attached to the unit's cases.
 * Conversations carry no unit column, so the authorised case window is resolved
 * first (most recent activity) and the conversation page is sliced in Postgres.
 */
export const listOwnerChatsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => chatsInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<PageResult<OwnerChatRow>> => {
    const db = context.supabase;
    const ws = await loadOwnerWorkspace(db, context.userId);
    const scope = resolveScope(ws, data.unitId ?? null);
    const page = clampPage(data.page);
    const pageSize = clampPageSize(data.pageSize);
    if (!scope.length) return emptyPage<OwnerChatRow>(page, pageSize);

    let caseQuery = db
      .from("cases")
      .select("id, case_number, title, status")
      .in("service_unit_id", scope);

    if (data.filter === "escalated") caseQuery = caseQuery.eq("status", "escalated" as never);
    if (data.filter === "attention") caseQuery = caseQuery.in("status", WAITING_STATUSES as never[]);

    const { data: cases, error: caseError } = await caseQuery
      .order("last_activity_at", { ascending: false, nullsFirst: false })
      .limit(500);
    if (caseError) throw new Error(caseError.message);

    const caseRows = cases ?? [];
    if (!caseRows.length) return emptyPage<OwnerChatRow>(page, pageSize);
    const caseIds = caseRows.map((c) => c.id);

    let q = db
      .from("conversations")
      .select("id, title, language, conversation_status, related_case_id, updated_at", { count: "exact" })
      .in("related_case_id", caseIds);

    const term = normalizeSearch(data.search);
    if (term) {
      const like = likePattern(term);
      const matchedCases = caseRows
        .filter((c) => c.case_number.toLowerCase().includes(term.toLowerCase()))
        .map((c) => c.id);
      q = matchedCases.length
        ? q.or(`title.ilike.${like},related_case_id.in.(${matchedCases.join(",")})`)
        : q.ilike("title", like);
    }

    const { from, to } = pageRange(page, pageSize);
    const { data: convos, count, error } = await q
      .order("updated_at", { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);

    const caseFor = new Map(caseRows.map((c) => [c.id, c]));
    const items: OwnerChatRow[] = (convos ?? []).map((cv) => ({
      id: cv.id,
      title: cv.title,
      language: cv.language,
      status: cv.conversation_status,
      updatedAt: cv.updated_at,
      caseId: cv.related_case_id,
      caseNumber: cv.related_case_id ? (caseFor.get(cv.related_case_id)?.case_number ?? null) : null,
      caseTitle: cv.related_case_id ? (caseFor.get(cv.related_case_id)?.title ?? null) : null,
    }));

    return pageResult(items, count ?? null, page, pageSize);
  });
