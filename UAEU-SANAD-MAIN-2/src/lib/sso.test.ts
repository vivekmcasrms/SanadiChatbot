import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SSO_INITIATION_PATH } from "@/lib/sso";

const homeSource = readFileSync(new URL("../routes/index.tsx", import.meta.url), "utf8");
const startButtons = homeSource.match(/<Button type="button"[^>]*onClick=\{handleSsoStart\}/g) ?? [];

describe("home SSO entry points", () => {
  it("uses the exact centralized initiation endpoint", () => {
    expect(SSO_INITIATION_PATH).toBe("/api/v1/auth/sso/initiatesso");
  });

  it.each([0, 1, 2])("Start With Sanadi button #%i uses the shared SSO handler", (index) => {
    expect(startButtons[index]).toContain("onClick={handleSsoStart}");
  });

  it("also protects every additional Start With Sanadi CTA found in the page", () => {
    expect(startButtons).toHaveLength(4);
    expect(homeSource).not.toContain("ssoStartHref");
    expect(homeSource).not.toContain("to={startTo}");
  });
});
