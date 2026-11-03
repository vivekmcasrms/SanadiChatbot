import {describe, expect, it} from "vitest";
import catalogue from "../../../scripts/catalogue/uaeu-programmes.json";

describe("official sample programme catalogue", () => {
  it("keeps the requested Computer Science catalogue ID and 120-credit degree", () => {
    const p = catalogue.programmes.find(p => p.programme_id === "2887.2968.23014");
    expect(p?.title).toBe("Bachelor of Science in Computer Science");
    expect(p?.total_credits).toBe(120);
    expect(p?.notes).toContain("Either CHEM111 or BIOC100; not both compulsory.");
  });
  it("keeps the requested Biology catalogue ID and alternative concentrations", () => {
    const p = catalogue.programmes.find(p => p.programme_id === "2890.2902.22715");
    expect(p?.title).toBe("Bachelor of Science in Biology");
    expect(p?.total_credits).toBe(120);
    expect(p?.notes).toContain("Choose ONE 27-credit concentration: Ecology and Organismal Biology OR Cellular and Molecular Biology.");
    expect(p?.credit_categories.filter(c => c.name.includes("Concentration")).map(c => c.mandatory)).toEqual([false, false]);
  });
});