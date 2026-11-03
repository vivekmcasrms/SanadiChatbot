import { describe, it, expect } from "vitest";
import { classifyForRouting } from "./classify.server";

const of = (title: string) => classifyForRouting({ title, description: null });

describe("emergency classification", () => {
  it("smoke in a classroom is a fire emergency", () => {
    const c = of("I can see smoke coming from one of the classrooms.");
    expect(c.serviceCode).toBe("safety_emergency");
    expect(c.topic).toBe("fire_smoke");
  });

  it("a fire alarm is a fire emergency", () => {
    expect(of("The fire alarm is going off in building F3").topic).toBe("fire_smoke");
  });

  it("feeling very sick is a medical emergency", () => {
    const c = of("I feel very sick and I need medical help");
    expect(c.serviceCode).toBe("safety_emergency");
    expect(c.topic).toBe("medical_emergency");
  });

  it("an injured student is a medical emergency", () => {
    expect(of("A student fell and is injured near the gym").topic).toBe("medical_emergency");
  });

  it("threatening behaviour is a security incident", () => {
    const c = of("Someone is threatening students outside the library");
    expect(c.serviceCode).toBe("security");
    expect(c.topic).toBe("security_incident");
  });

  it("a lost wallet is lost property, not an emergency", () => {
    const c = of("I lost my wallet on campus");
    expect(c.serviceCode).toBe("security");
    expect(c.topic).toBe("lost_property");
  });

  it("water pouring from the ceiling is a facilities fault", () => {
    const c = of("There is water pouring from the ceiling in the lecture hall");
    expect(c.serviceCode).toBe("facilities");
  });

  it("a dangerous electrical fault is a facilities hazard", () => {
    const c = of("There is a dangerous electrical fault in the lab");
    expect(c.serviceCode).toBe("facilities");
    expect(c.topic).toBe("electrical_hazard");
  });

  it("missing skills is career support, never lost property", () => {
    const c = of("What skills am I missing for a data science internship?");
    expect(c.serviceCode).toBe("career_internship");
  });

  it("lost marks is not a security case", () => {
    expect(of("I lost marks in my assignment, can I appeal?").serviceCode).not.toBe("security");
  });

  it("finding a book is a library request", () => {
    expect(of("Find me a good book on deep learning").serviceCode).toBe("library");
  });

  it("an information security course is not a security incident", () => {
    expect(of("When is the information security course offered?").serviceCode).not.toBe("security");
  });

  it("a hostel room fault stays with housing", () => {
    expect(of("The air conditioning in my hostel room is broken").serviceCode).toBe("housing");
  });
});
