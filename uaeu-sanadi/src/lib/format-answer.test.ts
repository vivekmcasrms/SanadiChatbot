import { describe, expect, it } from "vitest";
import { normalizeAnswer } from "./format-answer";

describe("normalizeAnswer", () => {
  it("removes malformed svg tokens and trailing braces", () => {
    expect(normalizeAnswer("svgEligible\n}}")).toBe("Eligible");
  });

  it("unwraps structured assistant JSON", () => {
    expect(normalizeAnswer('{"answer":"Not Eligible","internal":"hidden"}')).toBe("Not Eligible");
  });

  it("recovers an answer from a malformed structured fragment", () => {
    expect(normalizeAnswer('{"answer":"Not Eligible","internal":')).toBe("Not Eligible");
  });

  it("removes internal tool-output lines", () => {
    expect(normalizeAnswer("Not Eligible\ntool_output: { secret: true }")).toBe("Not Eligible");
  });
});