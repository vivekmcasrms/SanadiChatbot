/**
 * Semantic intent classifier. Reads MEANING only — it never sees or decides
 * eligibility, availability or policy. Output is validated against the fixed
 * intent list; anything else, a timeout, or a provider failure falls back to
 * the offline heuristic in intent.ts.
 */
import { llmChat } from "@/lib/agent/provider.server";
import { chooseModel } from "@/lib/agent/model-routing.server";
import type { AiSettings } from "@/lib/agent/settings.server";
import type { Db } from "@/lib/agent/tools.server";
import { INTENTS, type Intent } from "./intent";

const SYSTEM = `You classify ONE message a UAEU student sent to the student-services assistant.
Return JSON only: {"intent": <one label>, "confidence": <0..1>}.
Labels and meaning:
- general_query: general question not about a specific service
- university_fact_query: a factual question about the university (people, dates, places, who teaches, future schedules)
- academic_query: the student's own studies: GPA, credits, graduation, registration, courses, holds
- career_counselling: the student's own career, suitable jobs, CV, skills, interviews
- library_query: books, borrowing, library services, finding sources
- complaint: the student reports a problem they experienced with a service
- suggestion: an idea for how the university or a service should improve (even if it mentions jobs, companies, internships or careers)
- alert: safety incident, lost/stolen property, harassment, danger
- service_request: asking for an official document/letter or administrative service
- existing_case_followup: asking about a request/case/complaint they already submitted
- objection_correction: says Sanadi or a record is wrong, or corrects the previous answer
- human_assistance: wants to speak to a human staff member
- hostel_booking: wants to book, change or ask about a hostel/student-housing room
- program_transfer: wants to transfer/change programme, major or college
- appointment: wants to book, change or cancel a meeting/appointment with a unit
Judge by intent, never by a single topic word. "The university should partner with tech companies" is suggestion, not career. "I have a problem with the bus" is complaint. Messages may be English, Arabic, Emirati Arabic or mixed.
Use the previous assistant message only to interpret short follow-ups. Low confidence (<0.5) when genuinely ambiguous.`;

export async function semanticClassify(
  db: Db,
  settings: AiSettings,
  text: string,
  previousAssistant?: string | null,
  timeoutMs = 1800,
): Promise<{ intent: Intent; confidence: number } | null> {
  try {
    const choice = await chooseModel(db, settings, "classification");
    const r = await llmChat(
      {
        provider: choice.provider,
        model: choice.model,
        temperature: 0,
        maxOutputTokens: 60,
        timeoutMs: Math.min(timeoutMs, choice.timeoutMs || timeoutMs),
        fallbackProvider: null,
        fallbackModel: null,
      },
      {
        reasoningEffort: "none",
        temperature: 0,
        maxOutputTokens: 60,
        messages: [
          { role: "system", content: SYSTEM },
          ...(previousAssistant
            ? [{ role: "assistant" as const, content: previousAssistant.slice(0, 400) }]
            : []),
          { role: "user", content: text.slice(0, 600) },
        ],
      },
    );
    return parseClassifierOutput(r.text);
  } catch {
    return null;
  }
}

export function parseClassifierOutput(raw: string): { intent: Intent; confidence: number } | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(raw.slice(start, end + 1)) as { intent?: string; confidence?: number };
    if (!j.intent || !(INTENTS as readonly string[]).includes(j.intent)) return null;
    const c = typeof j.confidence === "number" ? Math.max(0, Math.min(1, j.confidence)) : 0.6;
    return { intent: j.intent as Intent, confidence: c };
  } catch {
    return null;
  }
}
