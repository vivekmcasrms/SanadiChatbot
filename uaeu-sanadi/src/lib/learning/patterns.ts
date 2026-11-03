/**
 * Pattern detection — pure. Signals become an improvement *proposal* only when
 * the same correction repeats at least `threshold` times (default 3). Nothing
 * here changes behaviour: every draft still needs a human decision.
 */
import { maskExample, sharedKeywords } from "./privacy";
import { FORBIDDEN_LEARNING_RE, DEFAULT_PATTERN_THRESHOLD, type CandidateType } from "./types";

export type SignalRow = {
  id: string;
  correction_type: string;
  original_domain: string | null;
  corrected_domain: string | null;
  original_intent: string | null;
  corrected_intent: string | null;
  original_unit_id: string | null;
  corrected_unit_id: string | null;
  original_user_text: string | null;
  staff_comment: string | null;
  student_feedback: string | null;
  reason_code: string | null;
  policy_sensitive: boolean | null;
  case_id: string | null;
};

export type CandidateDraft = {
  candidate_type: CandidateType;
  pattern_key: string;
  title: string;
  description: string;
  current_behaviour: string;
  pattern: Record<string, unknown>;
  evidence_count: number;
  affected_domains: string[];
  affected_units: string[];
  example_messages: string[];
  proposed_change: Record<string, unknown>;
  confidence: number;
  risk_level: "low" | "medium" | "high";
  signalIds: string[];
};

type Bucket = { type: CandidateType; key: string; rows: SignalRow[] };

const TYPE_MAP: Record<string, CandidateType> = {
  ROUTING_CORRECTION: "ROUTING_RULE",
  UNIT_REASSIGNMENT: "ROUTING_RULE",
  INTENT_CORRECTION: "INTENT_ALIAS",
  DOMAIN_CORRECTION: "INTENT_ALIAS",
  KNOWLEDGE_GAP: "KNOWLEDGE_GAP",
  STUDENT_CLARIFICATION: "CLARIFICATION_RULE",
  RESPONSE_QUALITY: "PROMPT_IMPROVEMENT",
  WORKFLOW_FAILURE: "WORKFLOW_IMPROVEMENT",
  FALSE_RESOLUTION: "WORKFLOW_IMPROVEMENT",
  CASE_REOPEN: "WORKFLOW_IMPROVEMENT",
};

function bucketKey(type: CandidateType, s: SignalRow): string | null {
  switch (type) {
    case "ROUTING_RULE":
      return s.corrected_unit_id ? `${s.original_unit_id ?? "none"}->${s.corrected_unit_id}` : null;
    case "INTENT_ALIAS": {
      const from = s.original_domain ?? s.original_intent ?? "none";
      const to = s.corrected_domain ?? s.corrected_intent;
      return to ? `${from}->${to}` : null;
    }
    case "KNOWLEDGE_GAP":
    case "CLARIFICATION_RULE":
    case "PROMPT_IMPROVEMENT":
      return s.original_domain ?? s.corrected_domain ?? "general";
    case "WORKFLOW_IMPROVEMENT":
      return `${s.correction_type}:${s.original_unit_id ?? s.original_domain ?? "general"}`;
    default:
      return null;
  }
}

/** A signal that touches policy, eligibility, permissions, money or SLA can never be learned. */
export function isPolicySensitive(s: Pick<SignalRow, "staff_comment" | "student_feedback" | "original_user_text">) {
  return FORBIDDEN_LEARNING_RE.test(
    `${s.staff_comment ?? ""} ${s.student_feedback ?? ""} ${s.original_user_text ?? ""}`,
  );
}

export function groupSignalsIntoCandidates(
  signals: SignalRow[],
  opts: { threshold?: number; unitName?: (id: string) => string } = {},
): CandidateDraft[] {
  const threshold = opts.threshold ?? DEFAULT_PATTERN_THRESHOLD;
  const unitName = opts.unitName ?? ((id: string) => id.slice(0, 8));
  const buckets = new Map<string, Bucket>();

  for (const s of signals) {
    if (s.policy_sensitive || isPolicySensitive(s)) continue;
    const type = TYPE_MAP[s.correction_type];
    if (!type) continue;
    const key = bucketKey(type, s);
    if (!key) continue;
    const id = `${type}|${key}`;
    const bucket = buckets.get(id) ?? { type, key, rows: [] };
    bucket.rows.push(s);
    buckets.set(id, bucket);
  }

  const drafts: CandidateDraft[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.rows.length < threshold) continue;
    drafts.push(buildDraft(bucket, unitName));
  }
  return drafts.sort((a, b) => b.evidence_count - a.evidence_count);
}

function buildDraft(bucket: Bucket, unitName: (id: string) => string): CandidateDraft {
  const rows = bucket.rows;
  const count = rows.length;
  const texts = rows.map((r) => r.original_user_text ?? "").filter(Boolean);
  const examples = texts.slice(0, 5).map((t) => maskExample(t));
  const phrases = sharedKeywords(texts);
  const domains = [
    ...new Set(rows.flatMap((r) => [r.original_domain, r.corrected_domain]).filter(Boolean) as string[]),
  ];
  const units = [
    ...new Set(rows.flatMap((r) => [r.original_unit_id, r.corrected_unit_id]).filter(Boolean) as string[]),
  ];
  const confidence = Math.min(0.95, 0.45 + 0.12 * count);
  const base = {
    pattern_key: bucket.key,
    evidence_count: count,
    affected_domains: domains,
    affected_units: units,
    example_messages: examples,
    confidence: Number(confidence.toFixed(3)),
    signalIds: rows.map((r) => r.id),
  };

  switch (bucket.type) {
    case "ROUTING_RULE": {
      const [fromId, toId] = bucket.key.split("->");
      const from = fromId && fromId !== "none" ? unitName(fromId) : "no unit";
      const to = unitName(toId ?? "");
      const pendingDomain = rows.find((r) => r.original_domain)?.original_domain ?? null;
      return {
        ...base,
        candidate_type: "ROUTING_RULE",
        title: `Route these requests to ${to} instead of ${from}`,
        description: `${count} corrections moved the same kind of request from ${from} to ${to}. Approving this teaches Sanadi to send matching requests to ${to} from the start.`,
        current_behaviour: `Sanadi currently sends these requests to ${from}.`,
        pattern: { fromUnitId: fromId, toUnitId: toId, phrases, pendingDomain },
        proposed_change: {
          kind: "routing_rule",
          rule_name: `Learned: ${to} for "${phrases.slice(0, 3).join(", ")}"`,
          trigger_phrases: phrases,
          pending_domain: pendingDomain,
          target_unit_id: toId,
          target_domain: rows.find((r) => r.corrected_domain)?.corrected_domain ?? null,
          priority: 50,
        },
        risk_level: "medium",
      };
    }
    case "INTENT_ALIAS": {
      const [from, to] = bucket.key.split("->");
      return {
        ...base,
        candidate_type: "INTENT_ALIAS",
        title: `Understand these messages as "${to}" rather than "${from}"`,
        description: `${count} students were understood as "${from}" when they meant "${to}". Approving this adds the shared wording to the "${to}" understanding, without changing any rule or eligibility.`,
        current_behaviour: `These messages are currently understood as "${from}".`,
        pattern: { from, to, phrases },
        proposed_change: {
          kind: "routing_rule",
          rule_name: `Learned intent: ${to}`,
          trigger_phrases: phrases,
          pending_domain: from === "none" ? null : from,
          target_domain: to,
          priority: 60,
        },
        risk_level: "low",
      };
    }
    case "KNOWLEDGE_GAP":
      return {
        ...base,
        candidate_type: "KNOWLEDGE_GAP",
        title: `Missing information about "${bucket.key}"`,
        description: `${count} students did not get a complete answer on this topic. This is a request for the Knowledge Center team to publish or update approved content — no answer is invented and no staff note becomes policy.`,
        current_behaviour: "Sanadi has no approved content covering these questions.",
        pattern: { topic: bucket.key, phrases },
        proposed_change: { kind: "knowledge_gap", topic: bucket.key, phrases, action: "review_and_publish_content" },
        risk_level: "low",
      };
    case "CLARIFICATION_RULE":
      return {
        ...base,
        candidate_type: "CLARIFICATION_RULE",
        title: `Ask a clarifying question for "${bucket.key}" requests`,
        description: `${count} students had to correct Sanadi after an assumption. Approving this makes Sanadi ask which service is meant before acting.`,
        current_behaviour: "Sanadi assumes the service instead of asking.",
        pattern: { domain: bucket.key, phrases },
        proposed_change: { kind: "clarification_rule", domain: bucket.key, phrases, ask_first: true },
        risk_level: "low",
      };
    case "PROMPT_IMPROVEMENT":
      return {
        ...base,
        candidate_type: "PROMPT_IMPROVEMENT",
        title: `Improve how answers about "${bucket.key}" are worded`,
        description: `${count} students marked answers on this topic as unhelpful. Approving this adjusts wording and completeness only — never the underlying rules.`,
        current_behaviour: "Answers on this topic are rated unhelpful.",
        pattern: { domain: bucket.key, phrases },
        proposed_change: { kind: "response_phrasing", domain: bucket.key, phrases },
        risk_level: "low",
      };
    default:
      return {
        ...base,
        candidate_type: "WORKFLOW_IMPROVEMENT",
        title: `Repeated workflow failure: ${bucket.key.split(":")[0]?.toLowerCase().replace(/_/g, " ")}`,
        description: `${count} cases followed the same failing path. This is flagged for a human review of the workflow; Sanadi changes nothing on its own.`,
        current_behaviour: "The current workflow repeatedly ends in a correction or reopen.",
        pattern: { key: bucket.key, cases: rows.map((r) => r.case_id).filter(Boolean).slice(0, 5) },
        proposed_change: { kind: "workflow_review", key: bucket.key },
        risk_level: "medium",
      };
  }
}
