/**
 * Risk-based Supervisor invocation. Server only.
 *
 * The Supervisor agent is not removed — it is invoked when the turn carries
 * real risk. Routine factual, policy and status answers skip it, which removes
 * one full model round-trip (~4-5 s) from the majority of turns.
 */
import type { Classification, ProposedAction } from "../agent-types";

export type SupervisorDecision = {
  run: boolean;
  /** Machine-readable reason, recorded in telemetry. */
  reason: string | null;
};

/** Actions whose consequences are irreversible, financial or record-changing. */
const HIGH_IMPACT_TOOLS = new Set([
  "issue_enrollment_letter",
  "book_appointment",
  "escalate_to_human",
]);

/** Low-risk intake actions that the deterministic guardrails already cover. */
const ROUTINE_TOOLS = new Set([
  "create_suggestion",
  "mark_alert_read",
  "set_service_reminder",
]);

export function decideSupervisor(args: {
  classification: Classification;
  proposedActions: ProposedAction[];
  sensitive: boolean;
  injectionAttempt: boolean;
  confidence: number;
  confidenceThreshold: number;
  groundingConflict?: boolean;
  humanHandoff?: boolean;
  /** Post-generation evidence: at least one tool or record lookup succeeded. */
  evidenceVerified?: boolean;
  /** Number of citations attached to the drafted answer. */
  citationCount?: number;
  /** True when the model produced no usable draft to review. */
  emptyDraft?: boolean;
}): SupervisorDecision {
  const {
    classification,
    proposedActions,
    sensitive,
    injectionAttempt,
    confidence,
    confidenceThreshold,
  } = args;

  if (sensitive) return { run: true, reason: "sensitive_topic" };
  if (injectionAttempt) return { run: true, reason: "security_sensitive" };
  if (args.humanHandoff) return { run: true, reason: "human_handoff" };
  if (args.groundingConflict) return { run: true, reason: "policy_conflict" };
  if (args.emptyDraft) return { run: true, reason: "empty_draft" };
  if (classification.urgency === "critical" || classification.urgency === "high") {
    return { run: true, reason: "high_urgency" };
  }
  if (classification.intent === "complaint" && classification.sentiment === "negative") {
    return { run: true, reason: "student_dispute" };
  }

  const risky = proposedActions.filter((p) => !ROUTINE_TOOLS.has(p.toolName ?? p.key));
  // A proposal does not execute the write. When its inputs came from verified
  // tools, deterministic confirmation/preflight guards are the authority and a
  // second model rewrite adds latency without adding safety.
  if (!args.evidenceVerified && risky.some((p) => HIGH_IMPACT_TOOLS.has(p.toolName ?? p.key))) {
    return { run: true, reason: "high_impact_action" };
  }
  if (risky.some((p) => p.humanApprovalRequired)) return { run: true, reason: "approval_required" };
  if (risky.some((p) => p.risk === "level_3")) return { run: true, reason: "irreversible_action" };

  // Confidence is only a supervisor trigger when the turn is ALSO unsupported.
  // A routine factual or record answer backed by a successful tool result and
  // at least one citation is already grounded, so the classifier's prior
  // (0.6 for a plain question) must not buy a second model round-trip.
  const grounded = Boolean(args.evidenceVerified) || (args.citationCount ?? 0) > 0;
  if (!grounded && confidence < confidenceThreshold) {
    return { run: true, reason: "low_confidence_ungrounded" };
  }

  // Everything else — factual questions, routine policy answers, eligibility
  // explanations, case status, suggestion intake — is finalised in one call.
  return { run: false, reason: null };
}

