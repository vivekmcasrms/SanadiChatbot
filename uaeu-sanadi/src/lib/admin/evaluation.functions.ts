/**
 * Testing & Measurement for Admin.
 *
 * Three parts, all built on real records:
 *  - baselines: what the traditional (pre-Sanadi) process costs, entered by an
 *    administrator; nothing is guessed or seeded.
 *  - measurements: computed inside Postgres by `evaluation_metrics` over live
 *    cases, messages, SLA state, information requests and provenance rows.
 *  - indicators & readiness: derived here, and deliberately withheld
 *    ("Insufficient data") whenever the sample behind a percentage is too small
 *    or a baseline is missing.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Below this many completed cases a percentage or average is not reported. */
export const MIN_SAMPLE = 5;

export type Baseline = {
  id: string;
  universityServiceId: string;
  steps: number | null;
  forms: number | null;
  visits: number | null;
  fieldsRequested: number | null;
  avgProcessingHours: number | null;
  staffTouchpoints: number | null;
  channels: string[];
  notes: string | null;
  updatedAt: string;
};

export type ServiceRow = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  baseline: Baseline | null;
  /** Live case counts for this service inside the reporting range. */
  cases: number;
  completed: number;
  avgResolutionHours: number | null;
};

export type PilotSession = {
  id: string;
  universityServiceId: string | null;
  serviceLabel: string | null;
  participantRole: string;
  participantCount: number;
  testedOn: string;
  completedSuccessfully: boolean;
  timeTakenMinutes: number | null;
  issues: string | null;
  satisfactionRating: number | null;
  comments: string | null;
};

export type Metrics = {
  range: { from: string; to: string };
  volumes: {
    interactions: number;
    chat_messages: number;
    conversations: number;
    cases: number;
    queries: number;
    complaints: number;
    suggestions: number;
    alerts: number;
    requests: number;
  };
  handling: { ai_resolved: number; human_escalated: number; resolved: number; closed: number; open: number };
  timing: {
    first_response_sample: number;
    avg_first_response_hours: number | null;
    resolution_sample: number;
    avg_resolution_hours: number | null;
  };
  sla: { sample: number; met: number };
  effort: {
    staff_touchpoints: number;
    student_entered_fields: number;
    information_requests: number;
    reused_known_fields: number;
    status_transitions: number;
    in_person_visits: number;
  };
  reviews: { decided_sample: number; reopen_or_objection: number };
  evidence: {
    baselines: number;
    pilot_sessions: number;
    pilot_participants: number;
    handovers: number;
    exception_events: number;
    /** Component-tagged failures (silent-failure handling), attached server-side. */
    exception_breakdown?: { components: Record<string, number>; recovered: number; unrecovered: number; tests: number; testsPassed: number };
    approvals: number;
    action_receipts: number;
    reviews_by_kind: Record<string, number>;
    provenance_fields: number;
    issued_documents: number;
    revoked_accounts: number;
    assistant_conversations: number;
  };
};

/** A number we can defend, or an explicit statement that we cannot. */
export type Indicator = {
  key: string;
  labelEn: string;
  labelAr: string;
  /** Percentage (0-100) or null when the sample is too small. */
  value: number | null;
  unit: "percent" | "hours" | "count";
  sample: number;
  baselineValue?: number | null;
  currentValue?: number | null;
  reasonEn?: string;
  reasonAr?: string;
};

export type CriterionStatus = "complete" | "partial" | "not_complete" | "not_applicable";

export type Criterion = {
  key: string;
  labelEn: string;
  labelAr: string;
  status: CriterionStatus;
  evidenceEn: string[];
  evidenceAr: string[];
  missingEn: string[];
  missingAr: string[];
};

export type EvaluationSnapshot = {
  metrics: Metrics;
  services: ServiceRow[];
  pilots: PilotSession[];
  indicators: Indicator[];
  readiness: Criterion[];
};

const rangeInput = z.object({ from: z.string().nullish(), to: z.string().nullish() });

type RpcClient = {
  rpc: (fn: "has_role" | "is_manager", args: Record<string, unknown>) => PromiseLike<{ data: unknown }>;
};

async function assertManager(context: { supabase: unknown; userId: string }) {
  const db = context.supabase as RpcClient;
  const [{ data: admin }, { data: manager }] = await Promise.all([
    db.rpc("has_role", { _user_id: context.userId, _role: "system_admin" }),
    db.rpc("is_manager", { _user_id: context.userId }),
  ]);
  if (!admin && !manager) throw new Error("Forbidden");
}

function pct(numerator: number, denominator: number, sample: number): number | null {
  if (denominator <= 0 || sample < MIN_SAMPLE) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function reduction(before: number | null | undefined, after: number | null | undefined): number | null {
  if (before == null || after == null || before <= 0) return null;
  return Math.round(((before - after) / before) * 1000) / 10;
}

function buildIndicators(m: Metrics, services: ServiceRow[]): Indicator[] {
  const completed = m.handling.resolved + m.handling.closed;
  const totalCases = m.volumes.cases ?? 0;
  const withBaseline = services.filter((s) => s.baseline && s.cases > 0);
  const sampled = withBaseline.reduce((n, s) => n + s.cases, 0);

  const avg = (pick: (s: ServiceRow) => number | null | undefined) => {
    const vals = withBaseline.map(pick).filter((v): v is number => v != null);
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  // "After" values come from live records only.
  const casesWithBaseline = withBaseline.reduce((n, s) => n + s.cases, 0);
  const transitionsPerCase = totalCases > 0 ? m.effort.status_transitions / totalCases : null;
  const fieldsPerCase = totalCases > 0 ? m.effort.student_entered_fields / totalCases : null;
  const visitsPerCase = totalCases > 0 ? m.effort.in_person_visits / totalCases : null;
  const baselineSteps = avg((s) => s.baseline?.steps ?? null);
  const baselineFields = avg((s) => s.baseline?.fieldsRequested ?? null);
  const baselineVisits = avg((s) => s.baseline?.visits ?? null);
  const baselineHours = avg((s) => s.baseline?.avgProcessingHours ?? null);

  const enough = casesWithBaseline >= MIN_SAMPLE;
  const noBaseline = { reasonEn: "No baseline recorded yet", reasonAr: "لم يتم تسجيل خط أساس بعد" };
  const smallSample = { reasonEn: `Fewer than ${MIN_SAMPLE} comparable cases`, reasonAr: `أقل من ${MIN_SAMPLE} حالات قابلة للمقارنة` };
  const gate = (v: number | null, base: number | null) =>
    base == null ? { value: null, ...noBaseline } : !enough ? { value: null, ...smallSample } : { value: v };

  const list: Indicator[] = [
    {
      key: "steps",
      labelEn: "Reduction in steps",
      labelAr: "تقليل الخطوات",
      unit: "percent",
      sample: sampled,
      baselineValue: baselineSteps,
      currentValue: transitionsPerCase,
      ...gate(reduction(baselineSteps, transitionsPerCase), baselineSteps),
    } as Indicator,
    {
      key: "fields",
      labelEn: "Reduction in fields requested",
      labelAr: "تقليل الحقول المطلوبة",
      unit: "percent",
      sample: sampled,
      baselineValue: baselineFields,
      currentValue: fieldsPerCase,
      ...gate(reduction(baselineFields, fieldsPerCase), baselineFields),
    } as Indicator,
    {
      key: "visits",
      labelEn: "Reduction in in-person visits",
      labelAr: "تقليل الزيارات الحضورية",
      unit: "percent",
      sample: sampled,
      baselineValue: baselineVisits,
      currentValue: visitsPerCase,
      ...gate(reduction(baselineVisits, visitsPerCase), baselineVisits),
    } as Indicator,
    {
      key: "processing_time",
      labelEn: "Reduction in processing time",
      labelAr: "تقليل زمن المعالجة",
      unit: "percent",
      sample: m.timing.resolution_sample ?? 0,
      baselineValue: baselineHours,
      currentValue: m.timing.avg_resolution_hours ?? null,
      ...(baselineHours == null
        ? { value: null, ...noBaseline }
        : (m.timing.resolution_sample ?? 0) < MIN_SAMPLE
          ? { value: null, ...smallSample }
          : { value: reduction(baselineHours, m.timing.avg_resolution_hours ?? null) }),
    } as Indicator,
    {
      key: "automation",
      labelEn: "Automation rate (resolved without staff)",
      labelAr: "نسبة الأتمتة (مغلقة دون تدخل موظف)",
      unit: "percent",
      sample: completed,
      value: pct(m.handling.ai_resolved, completed, completed),
      ...(completed < MIN_SAMPLE ? smallSample : {}),
    },
    {
      key: "escalation",
      labelEn: "Escalation rate",
      labelAr: "نسبة التصعيد",
      unit: "percent",
      sample: totalCases,
      value: pct(m.handling.human_escalated, totalCases, totalCases),
      ...(totalCases < MIN_SAMPLE ? smallSample : {}),
    },
    {
      key: "resolution",
      labelEn: "Resolution rate",
      labelAr: "نسبة الإنجاز",
      unit: "percent",
      sample: totalCases,
      value: pct(completed, totalCases, totalCases),
      ...(totalCases < MIN_SAMPLE ? smallSample : {}),
    },
    {
      key: "sla",
      labelEn: "SLA compliance",
      labelAr: "الالتزام بمستوى الخدمة",
      unit: "percent",
      sample: m.sla.sample,
      value: pct(m.sla.met, m.sla.sample, m.sla.sample),
      ...(m.sla.sample < MIN_SAMPLE ? smallSample : {}),
    },
    {
      key: "repeat_info",
      labelEn: "Repeat-information reduction",
      labelAr: "خفض تكرار طلب المعلومات",
      unit: "percent",
      sample: m.effort.reused_known_fields + m.effort.information_requests,
      value: pct(
        m.effort.reused_known_fields,
        m.effort.reused_known_fields + m.effort.information_requests,
        m.effort.reused_known_fields + m.effort.information_requests,
      ),
      ...(m.effort.reused_known_fields + m.effort.information_requests < MIN_SAMPLE ? smallSample : {}),
    },
    {
      key: "reopen",
      labelEn: "Reopen / objection rate",
      labelAr: "نسبة إعادة الفتح أو الاعتراض",
      unit: "percent",
      sample: m.reviews.decided_sample,
      value: pct(m.reviews.reopen_or_objection, m.reviews.decided_sample, m.reviews.decided_sample),
      ...(m.reviews.decided_sample < MIN_SAMPLE ? smallSample : {}),
    },
  ];
  return list;
}

function crit(
  key: string,
  labelEn: string,
  labelAr: string,
  checks: { en: string; ar: string; ok: boolean }[],
  opts?: { notApplicable?: boolean; naEn?: string; naAr?: string },
): Criterion {
  if (opts?.notApplicable) {
    return {
      key,
      labelEn,
      labelAr,
      status: "not_applicable",
      evidenceEn: opts.naEn ? [opts.naEn] : [],
      evidenceAr: opts.naAr ? [opts.naAr] : [],
      missingEn: [],
      missingAr: [],
    };
  }
  const met = checks.filter((c) => c.ok);
  const missing = checks.filter((c) => !c.ok);
  const status: CriterionStatus = missing.length === 0 ? "complete" : met.length === 0 ? "not_complete" : "partial";
  return {
    key,
    labelEn,
    labelAr,
    status,
    evidenceEn: met.map((c) => c.en),
    evidenceAr: met.map((c) => c.ar),
    missingEn: missing.map((c) => c.en),
    missingAr: missing.map((c) => c.ar),
  };
}

function buildReadiness(m: Metrics, services: ServiceRow[], pilots: PilotSession[]): Criterion[] {
  const ev = m.evidence;
  const kinds: Record<string, number> = m.evidence.reviews_by_kind ?? {};
  const completed = m.handling.resolved + m.handling.closed;
  const baselines = services.filter((s) => s.baseline).length;
  const n = (v: number | undefined) => v ?? 0;

  return [
    crit("governance", "Governance & Permissions", "الحوكمة والصلاحيات", [
      { en: "Published permissions matrix for student, staff and admin", ar: "مصفوفة صلاحيات منشورة", ok: true },
      { en: `Access withdrawal in use (${ev.revoked_accounts} revoked accounts)`, ar: `سحب الصلاحية مُفعّل (${ev.revoked_accounts})`, ok: ev.revoked_accounts > 0 },
    ]),
    crit("journey", "Customer Journey", "رحلة المتعامل", [
      { en: `${m.volumes.cases} requests captured end to end`, ar: `${m.volumes.cases} طلبًا موثقًا من البداية للنهاية`, ok: m.volumes.cases > 0 },
      { en: `${completed} requests reached a recorded outcome`, ar: `${completed} طلبًا وصل إلى نتيجة مسجلة`, ok: completed > 0 },
    ]),
    crit("nlp", "Natural Language", "اللغة الطبيعية", [
      { en: `${ev.assistant_conversations} assistant conversations`, ar: `${ev.assistant_conversations} محادثة مع المساعد`, ok: ev.assistant_conversations > 0 },
      { en: `${m.volumes.chat_messages} chat messages in range`, ar: `${m.volumes.chat_messages} رسالة خلال الفترة`, ok: m.volumes.chat_messages > 0 },
    ]),
    crit("ask_once", "Ask Once", "اسأل مرة واحدة", [
      { en: `${ev.provenance_fields} student fields reused from authorised sources`, ar: `${ev.provenance_fields} حقلاً أُعيد استخدامه من مصادر معتمدة`, ok: ev.provenance_fields > 0 },
    ]),
    crit("transparency", "Transparency & Trust", "الشفافية والثقة", [
      { en: `${ev.action_receipts} action receipts issued`, ar: `${ev.action_receipts} إيصال إجراء`, ok: ev.action_receipts > 0 },
      { en: `${ev.issued_documents} verifiable documents issued`, ar: `${ev.issued_documents} وثيقة قابلة للتحقق`, ok: ev.issued_documents > 0 },
    ]),
    crit("approvals", "Approvals", "الموافقات", [
      { en: `${ev.approvals} action-specific approvals recorded`, ar: `${ev.approvals} موافقة محددة مسجلة`, ok: ev.approvals > 0 },
    ]),
    crit("continuity", "Continuity", "الاستمرارية", [
      { en: `${m.volumes.conversations} conversations restored across sessions`, ar: `${m.volumes.conversations} محادثة تُستعاد بين الجلسات`, ok: m.volumes.conversations > 0 },
      { en: `${ev.handovers} handover packages prepared for staff`, ar: `${ev.handovers} حزمة تسليم للموظفين`, ok: ev.handovers > 0 },
    ]),
    crit("exceptions", "Exceptions", "الاستثناءات", [
      { en: `${ev.exception_events} exceptions detected and recovered`, ar: `${ev.exception_events} استثناء تم رصده ومعالجته`, ok: ev.exception_events > 0 },
      ...(ev.exception_breakdown
        ? [
            {
              en: `Service failures by component: ${Object.entries(ev.exception_breakdown.components).map(([k, v]) => `${k} ${v}`).join(", ") || "none"} (${ev.exception_breakdown.recovered} recovered, ${ev.exception_breakdown.unrecovered} told to retry)`,
              ar: `أعطال الخدمات حسب المكوّن: ${Object.entries(ev.exception_breakdown.components).map(([k, v]) => `${k} ${v}`).join("، ") || "لا يوجد"} (${ev.exception_breakdown.recovered} تمت معالجته، ${ev.exception_breakdown.unrecovered} طُلب إعادة المحاولة)`,
              ok: true,
            },
            {
              en: `${ev.exception_breakdown.testsPassed} of ${ev.exception_breakdown.tests} controlled failure tests showed a plain-language message`,
              ar: `${ev.exception_breakdown.testsPassed} من ${ev.exception_breakdown.tests} اختبار أعطال مضبوط عرض رسالة واضحة`,
              ok: ev.exception_breakdown.tests > 0 && ev.exception_breakdown.testsPassed === ev.exception_breakdown.tests,
            },
          ]
        : []),
    ]),
    crit("human", "Human Intervention", "التدخل البشري", [
      { en: `${m.handling.human_escalated} requests routed to a named staff member`, ar: `${m.handling.human_escalated} طلبًا وُجّه إلى موظف محدد`, ok: m.handling.human_escalated > 0 },
    ]),
    crit("payment", "Payment", "الدفع", [], {
      notApplicable: true,
      naEn: "No Sanadi service charges a fee, so no payment step exists.",
      naAr: "لا توجد خدمة برسوم في سند، لذلك لا توجد خطوة دفع.",
    }),
    crit("objection", "Result & Objection", "النتيجة والاعتراض", [
      { en: `${completed} results presented to students`, ar: `${completed} نتيجة عُرضت على الطلبة`, ok: completed > 0 },
      {
        en: `${n(kinds["objection"]) + n(kinds["correction"]) + n(kinds["question"]) + n(kinds["reopen"])} questions, corrections or objections handled`,
        ar: `${n(kinds["objection"]) + n(kinds["correction"]) + n(kinds["question"]) + n(kinds["reopen"])} استفسار أو تصحيح أو اعتراض`,
        ok: Object.values(kinds).some((v) => n(v) > 0),
      },
    ]),
    crit("testing", "Testing & Measurement", "الاختبار والقياس", [
      { en: `${baselines} service baselines recorded`, ar: `${baselines} خط أساس مسجل`, ok: baselines > 0 },
      { en: `${pilots.length} pilot testing sessions recorded`, ar: `${pilots.length} جلسة اختبار مسجلة`, ok: pilots.length > 0 },
      { en: `${completed} completed requests available for measurement`, ar: `${completed} طلبًا مكتملًا متاحًا للقياس`, ok: completed >= MIN_SAMPLE },
    ]),
  ];
}

/** Everything the evaluation page needs, computed from live records. */
export const getEvaluationSnapshotFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => rangeInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<EvaluationSnapshot> => {
    await assertManager(context);
    const args: Record<string, string> = {};
    if (data.from) args["_from"] = new Date(data.from).toISOString();
    if (data.to) args["_to"] = new Date(`${data.to}T23:59:59`).toISOString();

    const { data: raw, error } = await context.supabase.rpc("evaluation_metrics", args as never);
    if (error) throw new Error(error.message);
    const metrics = raw as unknown as Metrics;

    {
      const { supabaseAdmin: adminDb } = await import("@/integrations/supabase/client.server");
      const { data: exRows, error: exErr } = await adminDb
        .from("exception_events")
        .select("component, recovered, is_test, student_message")
        .not("component", "is", null)
        .gte("created_at", metrics.range.from)
        .lte("created_at", metrics.range.to)
        .limit(5000);
      if (exErr) throw new Error("Exception evidence is unavailable.");
      const b = { components: {} as Record<string, number>, recovered: 0, unrecovered: 0, tests: 0, testsPassed: 0 };
      for (const r of exRows ?? []) {
        if (r.is_test) {
          b.tests += 1;
          if (r.student_message) b.testsPassed += 1;
          continue;
        }
        b.components[r.component as string] = (b.components[r.component as string] ?? 0) + 1;
        if (r.recovered) b.recovered += 1; else b.unrecovered += 1;
      }
      metrics.evidence.exception_breakdown = b;
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: svc }, { data: bases }, { data: sessions }, { data: caseRows }] = await Promise.all([
      supabaseAdmin.from("university_services").select("id, code, name_en, name_ar").eq("is_active", true).order("name_en"),
      supabaseAdmin.from("service_baselines").select("*"),
      supabaseAdmin.from("pilot_test_sessions").select("*").order("tested_on", { ascending: false }).limit(500),
      supabaseAdmin
        .from("cases")
        .select("university_service_id, status, created_at, resolved_at, closed_at")
        .eq("is_demo", false)
        .is("deleted_at", null)
        .gte("created_at", metrics.range.from)
        .lte("created_at", metrics.range.to)
        .limit(20000),
    ]);

    const baselineByService = new Map<string, Baseline>();
    for (const b of bases ?? []) {
      baselineByService.set(b.university_service_id, {
        id: b.id,
        universityServiceId: b.university_service_id,
        steps: b.steps,
        forms: b.forms,
        visits: b.visits,
        fieldsRequested: b.fields_requested,
        avgProcessingHours: b.avg_processing_hours == null ? null : Number(b.avg_processing_hours),
        staffTouchpoints: b.staff_touchpoints,
        channels: b.channels ?? [],
        notes: b.notes,
        updatedAt: b.updated_at,
      });
    }

    const agg = new Map<string, { cases: number; completed: number; hours: number[] }>();
    for (const c of caseRows ?? []) {
      const key = c.university_service_id;
      if (!key) continue;
      const row = agg.get(key) ?? { cases: 0, completed: 0, hours: [] };
      row.cases += 1;
      const done = c.status === "resolved" || c.status === "closed";
      if (done) {
        row.completed += 1;
        const end = c.resolved_at ?? c.closed_at;
        if (end) row.hours.push((new Date(end).getTime() - new Date(c.created_at).getTime()) / 3_600_000);
      }
      agg.set(key, row);
    }

    const services: ServiceRow[] = (svc ?? []).map((s) => {
      const a = agg.get(s.id);
      const hours = a?.hours ?? [];
      return {
        id: s.id,
        code: s.code,
        nameEn: s.name_en,
        nameAr: s.name_ar,
        baseline: baselineByService.get(s.id) ?? null,
        cases: a?.cases ?? 0,
        completed: a?.completed ?? 0,
        avgResolutionHours: hours.length ? Math.round((hours.reduce((x, y) => x + y, 0) / hours.length) * 100) / 100 : null,
      };
    });

    const pilots: PilotSession[] = (sessions ?? []).map((p) => ({
      id: p.id,
      universityServiceId: p.university_service_id,
      serviceLabel: p.service_label,
      participantRole: p.participant_role,
      participantCount: p.participant_count,
      testedOn: p.tested_on,
      completedSuccessfully: p.completed_successfully,
      timeTakenMinutes: p.time_taken_minutes == null ? null : Number(p.time_taken_minutes),
      issues: p.issues,
      satisfactionRating: p.satisfaction_rating,
      comments: p.comments,
    }));

    return {
      metrics,
      services,
      pilots,
      indicators: buildIndicators(metrics, services),
      readiness: buildReadiness(metrics, services, pilots),
    };
  });

const baselineInput = z.object({
  universityServiceId: z.string().uuid(),
  steps: z.number().int().min(0).nullable(),
  forms: z.number().int().min(0).nullable(),
  visits: z.number().int().min(0).nullable(),
  fieldsRequested: z.number().int().min(0).nullable(),
  avgProcessingHours: z.number().min(0).nullable(),
  staffTouchpoints: z.number().int().min(0).nullable(),
  channels: z.array(z.string().max(60)).max(20),
  notes: z.string().max(2000).nullish(),
});

/** Store (or replace) the traditional-process baseline for one service. */
export const saveBaselineFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => baselineInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertManager(context);
    const { error } = await context.supabase.from("service_baselines").upsert(
      {
        university_service_id: data.universityServiceId,
        steps: data.steps,
        forms: data.forms,
        visits: data.visits,
        fields_requested: data.fieldsRequested,
        avg_processing_hours: data.avgProcessingHours,
        staff_touchpoints: data.staffTouchpoints,
        channels: data.channels,
        notes: data.notes ?? null,
        recorded_by: context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "university_service_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteBaselineFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertManager(context);
    const { error } = await context.supabase.from("service_baselines").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const pilotInput = z.object({
  universityServiceId: z.string().uuid().nullish(),
  serviceLabel: z.string().max(160).nullish(),
  participantRole: z.string().min(1).max(60),
  participantCount: z.number().int().min(1).max(1000),
  testedOn: z.string().min(1),
  completedSuccessfully: z.boolean(),
  timeTakenMinutes: z.number().min(0).nullable(),
  issues: z.string().max(2000).nullish(),
  satisfactionRating: z.number().int().min(1).max(5).nullable(),
  comments: z.string().max(2000).nullish(),
});

/** Record one real pilot-testing session. Nothing is generated automatically. */
export const savePilotSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => pilotInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertManager(context);
    const { error } = await context.supabase.from("pilot_test_sessions").insert({
      university_service_id: data.universityServiceId ?? null,
      service_label: data.serviceLabel ?? null,
      participant_role: data.participantRole,
      participant_count: data.participantCount,
      tested_on: data.testedOn,
      completed_successfully: data.completedSuccessfully,
      time_taken_minutes: data.timeTakenMinutes,
      issues: data.issues ?? null,
      satisfaction_rating: data.satisfactionRating,
      comments: data.comments ?? null,
      recorded_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePilotSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertManager(context);
    const { error } = await context.supabase.from("pilot_test_sessions").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
