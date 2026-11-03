/**
 * Chooses the ONE agent shown to the student for the current turn.
 *
 * The current message always decides. Only a genuine short follow-up keeps the
 * domain the conversation was already in, so the previously displayed agent can
 * never be inherited by a new, explicit request.
 */
import { agentDisplayName, resolveStage, stageLabel, type AgentStage } from "../agent-activity";
import type { Lang } from "../agent-types";
import { classifyInteraction } from "../interactions/classify.server";
import { detectDomains, isFollowUp } from "./context.server";

/** Reporting an incident or lost property: handled by the Alert Agent. */
const REPORT_RE =
  /\b(i (lost|found)|lost my|report(ing)? (a|an|this)?\s*(incident|issue|problem|damage)|broken|not working|out of order)\b|(فقدت|أبلغ عن|بلاغ|معطل|لا يعمل)/i;

export type ActiveAgent = {
  key: AgentStage;
  displayName: string;
  statusText: string;
  domain: string;
};

export function selectActiveAgent(args: {
  message: string;
  domains: string[];
  anchored: boolean;
  lang: Lang;
  complaint?: boolean;
  sensitive?: boolean;
}): ActiveAgent {
  const { message, lang } = args;
  const interaction = classifyInteraction({ title: message.slice(0, 120), description: message });
  const domains = args.anchored && isFollowUp(message) ? args.domains : detectDomains(message);
  const key = resolveStage(message, domains, {
    complaint: interaction.interactionType === "complaint" || args.complaint === true,
    suggestion: interaction.interactionType === "suggestion",
    alert:
      (interaction.interactionType === "alert" && !interaction.isEmergency) ||
      (interaction.interactionType !== "complaint" &&
        interaction.interactionType !== "suggestion" &&
        REPORT_RE.test(message)),
    emergency: interaction.isEmergency || args.sensitive === true,
  });
  return {
    key,
    displayName: agentDisplayName(key, lang),
    statusText: stageLabel(key, lang),
    domain: (domains[0] ?? "general").toUpperCase(),
  };
}
