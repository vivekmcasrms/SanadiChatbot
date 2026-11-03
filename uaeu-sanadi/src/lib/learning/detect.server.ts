import { activeRoleHolders, filterActiveUsers } from "@/lib/authz/roles.server";
/**
 * Detection step: turn repeated signals into proposals for a human to decide.
 * Runs as a scheduled job and on demand from the Learning Center.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { emitNotification } from "../ops/notify.server";
import { groupSignalsIntoCandidates, type SignalRow } from "./patterns";
import { DEFAULT_PATTERN_THRESHOLD } from "./types";

const SIGNAL_COLUMNS =
  "id, correction_type, original_domain, corrected_domain, original_intent, corrected_intent, original_unit_id, corrected_unit_id, original_user_text, staff_comment, student_feedback, reason_code, policy_sensitive, case_id";

async function configuredThreshold(): Promise<number> {
  try {
    const res = (await supabaseAdmin
      .from("ai_settings")
      .select("learning_pattern_threshold")
      .limit(1)
      .maybeSingle()) as unknown as {
      data: { learning_pattern_threshold?: number | null } | null;
    };
    const value = res.data?.learning_pattern_threshold;
    return typeof value === "number" && value >= 2 ? value : DEFAULT_PATTERN_THRESHOLD;
  } catch {
    return DEFAULT_PATTERN_THRESHOLD;
  }
}

export async function detectLearningCandidates(opts: { windowDays?: number } = {}) {
  const since = new Date(Date.now() - (opts.windowDays ?? 90) * 86_400_000).toISOString();
  const [{ data: signals }, { data: units }] = await Promise.all([
    supabaseAdmin
      .from("learning_signals")
      .select(SIGNAL_COLUMNS)
      .in("status", ["NEW", "CLUSTERED"])
      .gte("created_at", since)
      .limit(2000),
    supabaseAdmin.from("service_units").select("id, name_en"),
  ]);

  const names = new Map((units ?? []).map((u) => [u.id as string, u.name_en as string]));
  const threshold = await configuredThreshold();
  const drafts = groupSignalsIntoCandidates((signals ?? []) as SignalRow[], {
    threshold,
    unitName: (id) => names.get(id) ?? "another unit",
  });

  let created = 0;
  let updated = 0;
  for (const draft of drafts) {
    const { data: existing } = await supabaseAdmin
      .from("learning_candidates")
      .select("id, status, evidence_count")
      .eq("candidate_type", draft.candidate_type)
      .eq("pattern_key", draft.pattern_key)
      .maybeSingle();

    // A decided proposal is never silently resurrected or rewritten.
    if (existing && ["APPROVED", "ACTIVE", "REJECTED"].includes(existing.status as string)) continue;

    const payload = {
      candidate_type: draft.candidate_type,
      pattern_key: draft.pattern_key,
      title: draft.title,
      description: draft.description,
      current_behaviour: draft.current_behaviour,
      pattern: draft.pattern as Record<string, never>,
      evidence_count: draft.evidence_count,
      affected_domains: draft.affected_domains,
      affected_units: draft.affected_units,
      example_messages: draft.example_messages,
      proposed_change: draft.proposed_change as Record<string, never>,
      confidence: draft.confidence,
      risk_level: draft.risk_level,
      baseline_metrics: { corrections_in_window: draft.evidence_count, window_days: opts.windowDays ?? 90 },
    };

    let candidateId = existing?.id as string | undefined;
    if (candidateId) {
      await supabaseAdmin.from("learning_candidates").update(payload).eq("id", candidateId);
      updated += 1;
    } else {
      const { data: inserted } = await supabaseAdmin
        .from("learning_candidates")
        .insert(payload)
        .select("id")
        .single();
      candidateId = inserted?.id as string | undefined;
      created += 1;
      if (candidateId && draft.confidence >= 0.8) await notifyAdmins(draft.title, candidateId);
    }

    if (candidateId) {
      await supabaseAdmin
        .from("learning_signals")
        .update({ status: "CLUSTERED", candidate_id: candidateId })
        .in("id", draft.signalIds);
    }
  }

  return { processed: signals?.length ?? 0, details: { created, updated, threshold } };
}

async function notifyAdmins(title: string, candidateId: string) {
  const admins = (await activeRoleHolders(["system_admin", "service_manager"])).map((user_id) => ({ user_id }));
  for (const a of admins ?? []) {
    await emitNotification({
      eventType: "learning_candidate_ready",
      entityType: "learning_candidate",
      entityId: candidateId,
      recipientId: a.user_id as string,
      language: "en",
      vars: { title },
      actionUrl: "/learning",
      dedupeKey: `learning-candidate:${candidateId}:${a.user_id}`,
    });
  }
}
