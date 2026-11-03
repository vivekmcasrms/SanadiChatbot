import { describe, it, expect } from "vitest";
import { isFollowUp } from "./context.server";
describe("guard", () => {
  it("follow-up", () => {
    expect(isFollowUp("What skills am I missing?")).toBe(true);
    expect(isFollowUp("Explain these gaps")).toBe(true);
    expect(isFollowUp("I lost my wallet on campus")).toBe(false);
    expect(isFollowUp("There is a fire")).toBe(false);
  });
});
