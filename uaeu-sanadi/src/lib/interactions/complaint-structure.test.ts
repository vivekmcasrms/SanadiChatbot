import { describe, expect, it } from "vitest";
import { complaintBrief, structureComplaint } from "./complaint-structure";

const NOW = new Date("2026-09-12T10:00:00Z");

describe("structureComplaint", () => {
  it("turns a bus complaint into actionable fields", () => {
    const s = structureComplaint({
      title: "Campus Bus Delays",
      description:
        "The buses are always late, and today I had to walk all the way back to my hostel because the bus did not arrive.",
      priority: "high",
      now: NOW,
    });
    expect(s.complaintType).toBe("transport_bus_delay");
    expect(s.categoryPath).toBe("Transportation > Bus Delay");
    expect(s.frequency).toBe("recurring");
    expect(s.occurredAt).toBe("2026-09-12");
    expect(s.impact).toMatch(/walk/i);
    expect(s.requestedAction).toMatch(/review the affected bus schedule/i);
    expect(s.urgency).toBe("high");
  });

  it("asks one focused question only when the essential detail is missing", () => {
    const vague = structureComplaint({ title: "Bus", description: "The bus is always late.", now: NOW });
    expect(vague.missingQuestionEn).toBe("Which bus route or pickup point was affected?");

    const detailed = structureComplaint({
      title: "Bus",
      description: "Route 12 from the hostel gate is always late.",
      now: NOW,
    });
    expect(detailed.route).toBe("12");
    expect(detailed.missingQuestionEn).toBeNull();
  });

  it("keeps the student's own requested resolution when they gave one", () => {
    const s = structureComplaint({
      title: "Bus",
      description: "Route 5 keeps being late.",
      desiredResolution: "Add an extra bus at 7am",
      now: NOW,
    });
    expect(s.requestedAction).toBe("Add an extra bus at 7am");
  });

  it("writes a bilingual officer brief without raw artifacts", () => {
    const s = structureComplaint({ title: "Bus", description: "Route 3 late yesterday.", now: NOW });
    const en = complaintBrief(s, "en");
    expect(en).toMatch(/Category: Transportation > Bus Delay/);
    expect(en).not.toMatch(/svg|null|undefined/);
    expect(complaintBrief(s, "ar")).toMatch(/التصنيف/);
  });
});
