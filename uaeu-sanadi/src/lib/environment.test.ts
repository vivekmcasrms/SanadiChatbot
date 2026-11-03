import { afterEach, describe, expect, it } from "vitest";
import { normaliseSanadiEnv } from "./environment";
import { assertOutboundAllowed, outboundAllowed, serverEnv } from "./environment.server";

const original = process.env["SANADI_ENV"];
afterEach(() => {
  if (original === undefined) delete process.env["SANADI_ENV"];
  else process.env["SANADI_ENV"] = original;
});

describe("sanadi environment", () => {
  it("defaults to production when unset", () => {
    delete process.env["SANADI_ENV"];
    expect(serverEnv()).toBe("PRODUCTION");
    expect(outboundAllowed("email").allowed).toBe(true);
    expect(() => assertOutboundAllowed("university_system_write")).not.toThrow();
  });

  it("recognises TEST in any casing", () => {
    expect(normaliseSanadiEnv("test")).toBe("TEST");
    expect(normaliseSanadiEnv(" Test ")).toBe("TEST");
    expect(normaliseSanadiEnv("staging")).toBe("PRODUCTION");
    expect(normaliseSanadiEnv(undefined)).toBe("PRODUCTION");
  });

  it("blocks outbound side effects in the test environment", () => {
    process.env["SANADI_ENV"] = "TEST";
    expect(serverEnv()).toBe("TEST");
    for (const channel of ["email", "sms", "university_system_write", "external_api_write"] as const) {
      const decision = outboundAllowed(channel);
      expect(decision.allowed).toBe(false);
      expect(() => assertOutboundAllowed(channel)).toThrow(/TEST environment/);
    }
  });
});
