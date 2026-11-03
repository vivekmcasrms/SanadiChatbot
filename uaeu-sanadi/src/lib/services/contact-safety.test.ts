import { describe, expect, it } from "vitest";
import { isPublishableEmail, publishableEmail } from "./contact-safety";

describe("directory contact safety", () => {
  it("suppresses demo .local addresses", () => {
    expect(isPublishableEmail("housing@demo.uaeu.local")).toBe(false);
  });
  it("keeps real university addresses", () => {
    expect(isPublishableEmail("housing@uaeu.ac.ae")).toBe(true);
  });
  it("missing contact stays missing — nothing invented", () => {
    expect(publishableEmail(null, "x@demo.uaeu.local")).toBeNull();
  });
  it("falls back to the next valid address", () => {
    expect(publishableEmail("a@test.local", "lib@uaeu.ac.ae")).toBe("lib@uaeu.ac.ae");
  });
});
