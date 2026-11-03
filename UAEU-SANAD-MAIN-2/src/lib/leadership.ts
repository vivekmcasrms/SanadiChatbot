import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Leadership impact aggregates.
 *
 * Everything here is computed live from database rows and is RLS-scoped to the
 * caller. Rows flagged `is_demo` are fictional demonstration data: they are
 * counted separately so a real deployment never mixes demo history with real
 * operational evidence.
 */

const CLOSED = ["resolved", "closed"];

export type UnitImpact = {
  code: string;
  nameEn: string;
  nameAr: string;
  total: number;
  aiOnly: number;
  humanTouched: number;
  avgResolutionHours: number | null;
  satisfaction: number | null;
};

export type JourneyImpact = {
  code: string;
  nameEn: string;
  nameAr: string;
  highlight: boolean;
  before: { steps: number; fields: number; approvals: number; hours: number; visits: number; touches: number; flowEn: string; flowAr: string };
  after: { steps: number; fields: number; approvals: number; hours: number; visits: number; touches: number; flowEn: string; flowAr: string };
  cases: number;
};

export type LeadershipInsights = {
  demoMode: boolean;
  demoShare: number;
  windowDays: number;
  total: number;
  aiOnly: number;
  aiWithConfirmation: number;
  humanRequired: number;
  openNow: number;
  escalated: number;
  reopened: number;
  autonomyRate: number;
  containmentRate: number;
  firstTimeResolution: number | null;
  avgAiMinutes: number | null;
  avgHumanHours: number | null;
  avgFirstResponseSeconds: number | null;
  satisfaction: number | null;
  effortScore: number | null;
  feedbackCount: number;
  perDay: { date: string; ai: number; human: number }[];
  byUnit: UnitImpact[];
  journeys: JourneyImpact[];
  savings: { steps: number; fields: number; approvals: number; hours: number; visits: number; staffTouches: number };
};

function avg(values: number[]) {
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function hours(a: string, b: string) {
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000);
}

export function useLeadershipInsights(enabled: boolean, windowDays = 30) {
  return useQuery({
    queryKey: ["leadership", "insights", windowDays],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<LeadershipInsights> => {
      const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
      const [casesRes, unitsRes, feedbackRes, baselineRes] = await Promise.all([
        supabase
          .from("cases")
          .select(
            "id, status, case_type, created_at, first_response_at, resolved_at, closed_at, human_review_required, escalation_level, reopened_count, service_unit_id, is_demo",
          )
          .gte("created_at", since)
          .limit(2000),
        supabase.from("service_units").select("id, code, name_en, name_ar"),
        supabase
          .from("case_feedback")
          .select("case_id, overall_satisfaction, effort_score, issue_fully_resolved, submitted_at")
          .gte("submitted_at", since)
          .limit(2000),
        supabase.from("service_impact_baselines").select("*").order("display_order"),
      ]);
      if (casesRes.error) throw casesRes.error;
      if (unitsRes.error) throw unitsRes.error;

      const rows = casesRes.data ?? [];
      const units = unitsRes.data ?? [];
      const feedback = feedbackRes.data ?? [];
      const baselines = baselineRes.data ?? [];

      const unitById = new Map(units.map((u) => [u.id, u]));
      const isAiOnly = (c: (typeof rows)[number]) =>
        !c.human_review_required && (c.escalation_level ?? 0) === 0 && (c.reopened_count ?? 0) === 0;

      const aiOnlyRows = rows.filter((c) => isAiOnly(c));
      const closedRows = rows.filter((c) => c.resolved_at);
      const aiClosed = closedRows.filter((c) => isAiOnly(c));
      const humanClosed = closedRows.filter((c) => !isAiOnly(c));

      // Daily split
      const dayMap = new Map<string, { ai: number; human: number }>();
      for (let i = windowDays - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
        dayMap.set(d, { ai: 0, human: 0 });
      }
      for (const c of rows) {
        const key = c.created_at.slice(0, 10);
        const slot = dayMap.get(key);
        if (!slot) continue;
        if (isAiOnly(c)) slot.ai += 1;
        else slot.human += 1;
      }

      // Per unit
      const byUnit: UnitImpact[] = [];
      const feedbackByCase = new Map(feedback.map((f) => [f.case_id, f]));
      const unitBuckets = new Map<string, typeof rows>();
      for (const c of rows) {
        if (!c.service_unit_id) continue;
        const list = unitBuckets.get(c.service_unit_id) ?? [];
        list.push(c);
        unitBuckets.set(c.service_unit_id, list);
      }
      for (const [unitId, list] of unitBuckets) {
        const u = unitById.get(unitId);
        if (!u) continue;
        const sat = list
          .map((c) => feedbackByCase.get(c.id)?.overall_satisfaction)
          .filter((v): v is number => typeof v === "number");
        byUnit.push({
          code: u.code,
          nameEn: u.name_en,
          nameAr: u.name_ar,
          total: list.length,
          aiOnly: list.filter((c) => isAiOnly(c)).length,
          humanTouched: list.filter((c) => !isAiOnly(c)).length,
          avgResolutionHours: avg(list.filter((c) => c.resolved_at).map((c) => hours(c.created_at, c.resolved_at!))),
          satisfaction: avg(sat),
        });
      }
      byUnit.sort((a, b) => b.total - a.total);

      // Zero-bureaucracy journeys
      const casesByUnitCode = new Map(byUnit.map((u) => [u.code, u.total]));
      const journeys: JourneyImpact[] = baselines.map((b) => {
        const unit = units.find((u) => u.id === b.service_unit_id);
        return {
          code: b.journey_code,
          nameEn: b.journey_en,
          nameAr: b.journey_ar,
          highlight: b.highlight,
          before: {
            steps: b.before_steps,
            fields: b.before_fields,
            approvals: b.before_approvals,
            hours: Number(b.before_processing_hours),
            visits: b.before_visits,
            touches: b.before_staff_touches,
            flowEn: b.before_flow_en,
            flowAr: b.before_flow_ar,
          },
          after: {
            steps: b.after_steps,
            fields: b.after_fields,
            approvals: b.after_approvals,
            hours: Number(b.after_processing_hours),
            visits: b.after_visits,
            touches: b.after_staff_touches,
            flowEn: b.after_flow_en,
            flowAr: b.after_flow_ar,
          },
          cases: unit ? (casesByUnitCode.get(unit.code) ?? 0) : 0,
        };
      });

      const savings = journeys.reduce(
        (acc, j) => ({
          steps: acc.steps + (j.before.steps - j.after.steps) * j.cases,
          fields: acc.fields + (j.before.fields - j.after.fields) * j.cases,
          approvals: acc.approvals + (j.before.approvals - j.after.approvals) * j.cases,
          hours: acc.hours + (j.before.hours - j.after.hours) * j.cases,
          visits: acc.visits + (j.before.visits - j.after.visits) * j.cases,
          staffTouches: acc.staffTouches + (j.before.touches - j.after.touches) * j.cases,
        }),
        { steps: 0, fields: 0, approvals: 0, hours: 0, visits: 0, staffTouches: 0 },
      );

      const sat = feedback
        .map((f) => f.overall_satisfaction)
        .filter((v): v is number => typeof v === "number");
      const effort = feedback.map((f) => f.effort_score).filter((v): v is number => typeof v === "number");
      const resolvedFirstTime = feedback.filter((f) => f.issue_fully_resolved === true).length;

      const demoCount = rows.filter((c) => c.is_demo).length;

      return {
        demoMode: demoCount > 0,
        demoShare: rows.length ? demoCount / rows.length : 0,
        windowDays,
        total: rows.length,
        aiOnly: aiOnlyRows.length,
        aiWithConfirmation: rows.filter((c) => c.human_review_required && CLOSED.includes(c.status)).length,
        humanRequired: rows.filter((c) => !isAiOnly(c)).length,
        openNow: rows.filter((c) => !CLOSED.includes(c.status)).length,
        escalated: rows.filter((c) => (c.escalation_level ?? 0) > 0).length,
        reopened: rows.filter((c) => (c.reopened_count ?? 0) > 0).length,
        autonomyRate: rows.length ? aiOnlyRows.length / rows.length : 0,
        containmentRate: closedRows.length ? aiClosed.length / closedRows.length : 0,
        firstTimeResolution: feedback.length ? resolvedFirstTime / feedback.length : null,
        avgAiMinutes: avg(aiClosed.map((c) => hours(c.created_at, c.resolved_at!) * 60)),
        avgHumanHours: avg(humanClosed.map((c) => hours(c.created_at, c.resolved_at!))),
        avgFirstResponseSeconds: avg(
          rows.filter((c) => c.first_response_at).map((c) => hours(c.created_at, c.first_response_at!) * 3600),
        ),
        satisfaction: avg(sat),
        effortScore: avg(effort),
        feedbackCount: feedback.length,
        perDay: [...dayMap.entries()].map(([date, v]) => ({ date, ...v })),
        byUnit,
        journeys,
        savings,
      };
    },
  });
}
