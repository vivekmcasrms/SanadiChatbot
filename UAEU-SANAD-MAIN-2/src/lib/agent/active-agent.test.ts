import { describe, expect, it } from "vitest";
import { selectActiveAgent } from "./active-agent.server";
import { detectDomainsWithContext } from "./context.server";
import type { ServiceDomain } from "./context.server";

function agentFor(message: string, active: ServiceDomain | null = null, lang: "en" | "ar" = "en") {
  const detected = detectDomainsWithContext(message, active);
  return selectActiveAgent({ message, domains: detected.domains, anchored: detected.anchored, lang });
}

describe("active agent label", () => {
  const cases: [string, string][] = [
    ["What kind of jobs can I apply for?", "career"],
    ["Find me a book about control systems.", "library"],
    ["The buses are always late.", "complaint"],
    ["I suggest adding more technology companies for internships.", "suggestion"],
    ["I lost my wallet on campus.", "alert_report"],
    ["Create my enrolment letter.", "document"],
    ["What courses do I have left?", "academic"],
    ["Can you book me a career counselling appointment?", "appointment"],
  ];

  it.each(cases)("routes %s", (message, key) => {
    expect(agentFor(message).key).toBe(key);
  });

  it("never inherits the previous agent for a new explicit request", () => {
    expect(agentFor("What skills am I missing?", null).key).toBe("career");
    expect(agentFor("Find me a book about control systems.", "career").key).toBe("library");
    expect(agentFor("Create my enrolment letter.", "career").key).toBe("document");
  });

  it("keeps the agent for a genuine follow-up", () => {
    expect(agentFor("Is the first one available online?", "library").key).toBe("library");
  });

  it("uses Arabic agent names in an Arabic conversation", () => {
    expect(agentFor("ابحث لي عن كتاب عن التحكم", null, "ar").displayName).toBe("وكيل المكتبة");
  });
});
