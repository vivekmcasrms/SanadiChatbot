import type { Classification } from "../agent-types";
import type { ServiceDomain } from "./context.server";

export type WorkflowPlan = {
  id: string;
  version: number;
  domain: ServiceDomain;
  prefetchTools: string[];
  allowedTools: string[];
  confirmationBoundary: "none" | "before_write";
  reason: string;
};

const PLANS: WorkflowPlan[] = [
  { id: "appointment-booking", version: 1, domain: "appointments", prefetchTools: ["list_appointment_slots"], allowedTools: ["book_appointment"], confirmationBoundary: "before_write", reason: "available slots are retrieved before generation" },
  { id: "career-analysis", version: 1, domain: "career", prefetchTools: ["analyze_career_fit"], allowedTools: ["analyze_career_fit", "get_career_cv_status", "get_ats_score", "generate_career_action_plan", "review_my_cv", "get_interview_preparation", "request_career_counsellor"], confirmationBoundary: "none", reason: "career scores and evidence are deterministic" },
  { id: "complaint-intake", version: 1, domain: "cases", prefetchTools: [], allowedTools: ["find_my_university_records", "find_university_service", "create_complaint", "escalate_to_human"], confirmationBoundary: "before_write", reason: "routing and SLA are backend-governed" },
];

export function selectWorkflowPlan(
  domains: ServiceDomain[],
  classification: Classification,
  message: string,
): WorkflowPlan | null {
  if (domains.length !== 1) return null;
  if (classification.intent === "complaint" && domains[0] === "cases") {
    return PLANS.find((p) => p.id === "complaint-intake") ?? null;
  }
  const domain = domains[0];
  if (!domain) return null;
  const plan = PLANS.find((p) => p.domain === domain) ?? null;
  if (plan?.id === "appointment-booking" && !/(book|available|slot|appointment|حجز|متاح|موعد)/i.test(message)) return null;
  if (plan?.id === "career-analysis" && !/(match|fit|career|role|وظيف|مهني)/i.test(message)) return null;
  return plan;
}

export function workflowState(plan: WorkflowPlan | null) {
  return plan ? { workflowPlanId: plan.id, workflowPlanVersion: plan.version, workflowStep: "present_verified_options", confirmationBoundary: plan.confirmationBoundary } : {};
}