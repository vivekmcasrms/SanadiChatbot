import { describe, expect, it } from "vitest";
import { createSafeTokenStream, safeAssistantOutput, stripInternalFragments } from "./output-safety.server";

describe("stripInternalFragments", () => {
  it("removes leaked search metadata", () => {
    expect(stripInternalFragments('Admission requires a high school certificate.,"totalMatches":5')).toBe(
      "Admission requires a high school certificate.",
    );
  });

  it("removes internal ids and scores", () => {
    expect(stripInternalFragments('Apply online. "documentId": "abc-123", "score": 0.91')).toBe("Apply online.");
  });

  it("keeps ordinary prose with colons", () => {
    const text = "Requirements: a certificate, an ID and the fee.";
    expect(stripInternalFragments(text)).toBe(text);
  });
});

describe("safeAssistantOutput", () => {
  it("falls back when only machine output remains", () => {
    expect(safeAssistantOutput('{"totalMatches":5}', "en")).toMatch(/could not format/i);
  });

  it("cleans a mixed answer instead of falling back", () => {
    expect(safeAssistantOutput('The criteria are published by Admissions.,"totalMatches":5', "en")).toBe(
      "The criteria are published by Admissions.",
    );
  });
});

describe("createSafeTokenStream", () => {
  it("never emits a JSON fragment, even partially", () => {
    let out = "";
    const stream = createSafeTokenStream((d) => (out += d));
    for (const chunk of ["The admission criteria are listed below.", ',"totalMa', 'tches":5']) {
      stream.push(chunk);
    }
    stream.end();
    expect(out).toBe("The admission criteria are listed below.");
  });
});
