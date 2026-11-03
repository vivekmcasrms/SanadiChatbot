import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@tanstack/react-start/server", () => ({ getRequestHost: () => null }));
import { demoEnvironmentEnabled, isProductionHost } from "./demo-environment";

afterEach(() => { delete process.env["ENABLE_DEMO_ACCESS"]; });

describe("demo environment guard", () => {
  it("is off on the production site even when the demo flag is on", () => {
    process.env["ENABLE_DEMO_ACCESS"] = "true";
    expect(demoEnvironmentEnabled("sanadi.online")).toBe(false);
    expect(demoEnvironmentEnabled("www.sanadi.online")).toBe(false);
    expect(demoEnvironmentEnabled("uaeu-sanadi.lovable.app")).toBe(false);
  });
  it("is off when the host is unknown", () => {
    process.env["ENABLE_DEMO_ACCESS"] = "true";
    expect(demoEnvironmentEnabled(null)).toBe(false);
  });
  it("is off on preview when the flag is not set", () => {
    expect(demoEnvironmentEnabled("id-preview--x.lovable.app")).toBe(false);
  });
  it("is on only for a non-production host with the flag set", () => {
    process.env["ENABLE_DEMO_ACCESS"] = "true";
    expect(demoEnvironmentEnabled("id-preview--x.lovable.app")).toBe(true);
  });
  it("recognises production hosts with ports", () => {
    expect(isProductionHost("sanadi.online:443")).toBe(true);
  });
});
