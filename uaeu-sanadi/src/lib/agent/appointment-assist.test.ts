import { describe, expect, it } from "vitest";
import {
  buildAssistOffer,
  decideAppointmentAssist,
  detectAssistAcceptance,
  detectHumanPreference,
  type AppointmentAssistState,
} from "./appointment-assist.server";

const base = {
  lang: "en" as const,
  action: "book",
  anchoredDomain: null as string | null,
  prior: null as AppointmentAssistState | null,
};

describe("AI-first appointment assistance", () => {
  it("offers career capabilities once before booking", () => {
    const d = decideAppointmentAssist({ ...base, text: "I want an appointment with a career advisor", unitCode: "CAREER" });
    expect(d.kind).toBe("offer");
    if (d.kind !== "offer") return;
    expect(d.answer).toMatch(/ATS score/);
    expect(d.answer).toMatch(/review your saved CV/);
    expect(d.answer).not.toMatch(/prerequisite/i);
    expect(d.state.ai_assistance_offered).toBe(true);
    expect(d.state.awaitingAssistChoice).toBe(true);
  });

  it("goes straight to booking when the student asks for a person", () => {
    const d = decideAppointmentAssist({
      ...base,
      text: "I want a human advisor, please book it",
      unitCode: "CAREER",
    });
    expect(d.kind).toBe("proceed");
    expect(d.state.human_appointment_requested).toBe(true);
  });

  it("treats acceptance of the offer as AI assistance", () => {
    const prior: AppointmentAssistState = {
      unitCode: "CAREER",
      domain: "career",
      appointment_request_origin: "student_request",
      ai_assistance_offered: true,
      ai_assistance_accepted: null,
      ai_resolution_status: "offered",
      human_appointment_requested: false,
      human_appointment_booked: false,
      awaitingAssistChoice: true,
      offeredAt: new Date().toISOString(),
    };
    const d = decideAppointmentAssist({ ...base, text: "Check my CV first", unitCode: null, prior });
    expect(d.kind).toBe("accept");
    expect(d.state.ai_assistance_accepted).toBe(true);
    expect(d.state.ai_resolution_status).toBe("ai_assisted");
  });

  it("proceeds without persuading after the offer is declined", () => {
    const prior: AppointmentAssistState = {
      unitCode: "CAREER",
      domain: "career",
      appointment_request_origin: "student_request",
      ai_assistance_offered: true,
      ai_assistance_accepted: null,
      ai_resolution_status: "offered",
      human_appointment_requested: false,
      human_appointment_booked: false,
      awaitingAssistChoice: true,
      offeredAt: new Date().toISOString(),
    };
    const d = decideAppointmentAssist({ ...base, text: "I still want to see an advisor", unitCode: "CAREER", prior });
    expect(d.kind).toBe("proceed");
    expect(d.state.ai_resolution_status).toBe("declined");
    expect(d.state.awaitingAssistChoice).toBe(false);
  });

  it("does not offer again when the AI already helped in that domain", () => {
    const d = decideAppointmentAssist({
      ...base,
      text: "I'd rather discuss this with a career advisor",
      unitCode: "CAREER",
      anchoredDomain: "career",
    });
    expect(d.kind).toBe("proceed");
  });

  it("never offers for sensitive or formal matters", () => {
    const d = decideAppointmentAssist({ ...base, text: "I want to appeal my grade with an advisor", unitCode: "ADV" });
    expect(d.kind).toBe("proceed");
  });

  it("offers only registration capabilities for Admission & Registration", () => {
    const offer = buildAssistOffer("registration", "en", null);
    expect(offer).toMatch(/active holds/);
    expect(offer).not.toMatch(/ATS/);
  });

  it("offers in Arabic for Arabic turns", () => {
    const d = decideAppointmentAssist({ ...base, lang: "ar", text: "أريد حجز موعد مع الإرشاد المهني", unitCode: "CAREER" });
    expect(d.kind).toBe("offer");
    if (d.kind !== "offer") return;
    expect(d.answer).toMatch(/سيرتك الذاتية/);
  });

  it("reads human preference and acceptance separately", () => {
    expect(detectHumanPreference("I prefer to speak to a person")).toBe(true);
    expect(detectAssistAcceptance("I prefer to speak to a person")).toBe(false);
    expect(detectAssistAcceptance("yes please help me here")).toBe(true);
  });
});
