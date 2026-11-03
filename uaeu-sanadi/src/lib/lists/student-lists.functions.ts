/**
 * Student list queries (My Requests, My Suggestions, My Alerts).
 *
 * All filtering, searching, sorting and page slicing happens in Postgres under
 * the student's own RLS scope, so a student with 5 requests and one with 500
 * pay the same cost to open the page. Only list-card fields are returned; the
 * full case record is loaded when the case detail page opens.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { statusesFor } from "@/lib/lists/case-status";
import {
  clampPage,
  clampPageSize,
  dateRangeStart,
  likePattern,
  normalizeSearch,
  pageRange,
  pageResult,
  type PageResult,
} from "@/lib/list-query";

const CLOSED_STATUSES = ["resolved", "closed"] as const;

const baseInput = z.object({
  page: z.number().int().min(1).max(10_000).catch(1),
  pageSize: z.number().int().min(5).max(100).catch(20),
  search: z.string().max(120).optional(),
});

export type MyCaseRow = {
  id: string;
  case_number: string;
  title: string;
  status: string;
  urgency: string;
  case_type: string;
  created_at: string;
  last_activity_at: string | null;
  removable: boolean;
  /** Meeting confirmed by staff on this same case, when one exists. */
  meeting_at: string | null;
  meeting_mode: string | null;
  meeting_location: string | null;
};

const casesInput = baseInput.extend({
  tab: z.enum(["active", "resolved", "all"]).catch("active"),
  type: z.string().max(30).optional(),
  /** Plain-language status group key (see src/lib/lists/case-status.ts). */
  status: z.string().max(30).optional(),
  sort: z.enum(["recent", "oldest", "activity"]).catch("recent"),
  range: z.string().max(10).optional(),
});

/** Page of the signed-in student's own cases (query/complaint/alert/service request). */
export const listMyCasesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => casesInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<PageResult<MyCaseRow>> => {
    const { supabase, userId } = context;
    const page = clampPage(data.page);
    const pageSize = clampPageSize(data.pageSize);
    const { from, to } = pageRange(page, pageSize);

    let q = supabase
      .from("cases")
      .select(
        "id, case_number, title, status, urgency, case_type, created_at, last_activity_at, meeting_at, meeting_mode, meeting_location",
        { count: "exact" },
      )
      .eq("student_id", userId)
      .is("student_hidden_at", null);

    // An explicit plain-language status filter wins over the legacy tab split,
    // so "Resolved" and "Closed" work as dropdown filters instead of tabs.
    const statusGroup = data.status && data.status !== "all" ? statusesFor(data.status) : null;
    if (statusGroup?.length) {
      q = q.in("status", statusGroup as never);
    } else {
      if (data.tab === "active") q = q.not("status", "in", `(${CLOSED_STATUSES.join(",")})`);
      if (data.tab === "resolved") q = q.in("status", [...CLOSED_STATUSES]);
    }
    if (data.type && data.type !== "all") q = q.eq("case_type", data.type as MyCaseRow["case_type"] as never);

    const since = dateRangeStart(data.range);
    if (since) q = q.gte("created_at", since);

    const term = normalizeSearch(data.search);
    if (term) {
      const like = likePattern(term);
      q = q.or(`case_number.ilike.${like},title.ilike.${like}`);
    }

    q =
      data.sort === "oldest"
        ? q.order("created_at", { ascending: true })
        : data.sort === "activity"
          ? q.order("last_activity_at", { ascending: false, nullsFirst: false })
          : q.order("created_at", { ascending: false });

    const { data: rows, count, error } = await q.range(from, to);
    if (error) throw new Error(error.message);

    const items: MyCaseRow[] = (rows ?? []).map((c) => ({
      id: c.id,
      case_number: c.case_number,
      title: c.title,
      status: c.status,
      urgency: c.urgency,
      case_type: c.case_type,
      created_at: c.created_at,
      last_activity_at: c.last_activity_at ?? null,
      // Complaints keep a permanent record; the student can hide the rest.
      removable: c.case_type !== "complaint" && (CLOSED_STATUSES as readonly string[]).includes(c.status),
      meeting_at: c.meeting_at ?? null,
      meeting_mode: c.meeting_mode ?? null,
      meeting_location: c.meeting_location ?? null,
    }));

    return pageResult(items, count ?? null, page, pageSize);
  });

export type MySuggestionRow = {
  id: string;
  reference_number: string;
  title: string;
  status: string;
  created_at: string;
  outcome_summary: string | null;
  implementation_target_date: string | null;
  latestUpdateEn: string | null;
  latestUpdateAr: string | null;
};

const suggestionsInput = baseInput.extend({
  status: z.string().max(30).optional(),
  sort: z.enum(["recent", "oldest"]).catch("recent"),
});

/** Page of the student's own suggestions, with the latest visible update batched in. */
export const listMySuggestionsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => suggestionsInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<PageResult<MySuggestionRow>> => {
    const { supabase, userId } = context;
    const page = clampPage(data.page);
    const pageSize = clampPageSize(data.pageSize);
    const { from, to } = pageRange(page, pageSize);

    let q = supabase
      .from("suggestions")
      .select(
        "id, reference_number, title, status, created_at, outcome_summary, implementation_target_date",
        { count: "exact" },
      )
      .eq("student_id", userId)
      .is("student_hidden_at", null);

    if (data.status && data.status !== "all") q = q.eq("status", data.status as never);

    const term = normalizeSearch(data.search);
    if (term) {
      const like = likePattern(term);
      q = q.or(`reference_number.ilike.${like},title.ilike.${like}`);
    }

    q = q.order("created_at", { ascending: data.sort === "oldest" });

    const { data: rows, count, error } = await q.range(from, to);
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((r) => r.id);
    // One batched query for the page — never one query per card.
    const { data: updates } = ids.length
      ? await supabase
          .from("suggestion_updates")
          .select("suggestion_id, update_text_en, update_text_ar, created_at")
          .in("suggestion_id", ids)
          .eq("visible_to_student", true)
          .order("created_at", { ascending: false })
      : { data: [] as { suggestion_id: string; update_text_en: string | null; update_text_ar: string | null }[] };

    const latest = new Map<string, { en: string | null; ar: string | null }>();
    for (const u of updates ?? []) {
      if (!latest.has(u.suggestion_id)) latest.set(u.suggestion_id, { en: u.update_text_en, ar: u.update_text_ar });
    }

    const items: MySuggestionRow[] = (rows ?? []).map((s) => ({
      id: s.id,
      reference_number: s.reference_number,
      title: s.title,
      status: s.status,
      created_at: s.created_at,
      outcome_summary: s.outcome_summary ?? null,
      implementation_target_date: s.implementation_target_date ?? null,
      latestUpdateEn: latest.get(s.id)?.en ?? null,
      latestUpdateAr: latest.get(s.id)?.ar ?? null,
    }));

    return pageResult(items, count ?? null, page, pageSize);
  });

export type MyAlertRow = {
  id: string;
  title_en: string;
  title_ar: string;
  body_en: string | null;
  body_ar: string | null;
  severity: string;
  alert_type: string | null;
  action_url: string | null;
  deadline: string | null;
  is_read: boolean;
  generated_at: string;
  unit_en: string | null;
  unit_ar: string | null;
};

const alertsInput = baseInput.extend({
  filter: z.enum(["all", "unread", "critical"]).catch("all"),
  range: z.string().max(10).optional(),
});

/** Page of the student's active alerts, most severe and most recent first. */
export const listMyAlertsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => alertsInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<PageResult<MyAlertRow>> => {
    const { supabase, userId } = context;
    const page = clampPage(data.page);
    const pageSize = clampPageSize(data.pageSize);
    const { from, to } = pageRange(page, pageSize);

    let q = supabase
      .from("student_alerts")
      .select(
        "id, title_en, title_ar, body_en, body_ar, severity, alert_type, action_url, deadline, is_read, generated_at, service_units:source_unit_id (name_en, name_ar)",
        { count: "exact" },
      )
      .eq("student_id", userId)
      .eq("status", "active");

    if (data.filter === "unread") q = q.eq("is_read", false);
    if (data.filter === "critical") q = q.in("severity", ["critical", "high"]);

    const since = dateRangeStart(data.range);
    if (since) q = q.gte("generated_at", since);

    const term = normalizeSearch(data.search);
    if (term) {
      const like = likePattern(term);
      q = q.or(`title_en.ilike.${like},title_ar.ilike.${like}`);
    }

    const {
      data: rows,
      count,
      error,
    } = await q
      .order("severity", { ascending: false })
      .order("generated_at", { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);

    const items: MyAlertRow[] = (
      (rows ?? []) as unknown as (Omit<MyAlertRow, "unit_en" | "unit_ar"> & {
        service_units: { name_en: string; name_ar: string } | null;
      })[]
    ).map((a) => ({
      id: a.id,
      title_en: a.title_en,
      title_ar: a.title_ar,
      body_en: a.body_en,
      body_ar: a.body_ar,
      severity: a.severity,
      alert_type: a.alert_type,
      action_url: a.action_url,
      deadline: a.deadline,
      is_read: a.is_read,
      generated_at: a.generated_at,
      unit_en: a.service_units?.name_en ?? null,
      unit_ar: a.service_units?.name_ar ?? null,
    }));

    return pageResult(items, count ?? null, page, pageSize);
  });
