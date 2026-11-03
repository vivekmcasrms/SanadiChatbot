import { describe, expect, it } from "vitest";
import { GOVERNANCE_NAV, ADMIN_NAV } from "@/lib/nav";
import { SETTINGS_TABS, SETTINGS_DESTINATIONS } from "./settings-map";
import { jobsLevel, latencyLevel, overallLevel } from "./system-health";

describe("admin structure", () => {
  it("admin menu has exactly the seven requested sections", () => {
    expect(GOVERNANCE_NAV.map((g) => g.labelEn)).toEqual([
      "Dashboard",
      "Units & Performance",
      "Requests & Cases",
      "Services & Availability",
      "Knowledge Center",
      "Reports",
      "Settings",
    ]);
  });

  it("settings has the seven requested tabs", () => {
    expect(SETTINGS_TABS.map((t) => t.labelEn)).toEqual([
      "Organisation",
      "Access & Roles",
      "Services",
      "AI",
      "Arabic",
      "Jobs",
      "Integrations",
    ]);
  });

  it("keeps every page that the old Administration menu linked to", () => {
    for (const to of [
      "/admin", "/learning", "/arabic-quality", "/data-audit", "/permissions", "/acceptance",
      "/evaluation", "/notifications", "/ai-ops", "/appointment-availability", "/job-runs",
    ]) {
      expect(SETTINGS_DESTINATIONS).toContain(to);
    }
  });

  it("no menu lists /admin twice and the old /knowledge page is gone from menus", () => {
    const links = ADMIN_NAV.flatMap((g) => g.items.map((i) => i.to));
    expect(links.filter((l) => l === "/admin")).toHaveLength(1);
    expect(links).not.toContain("/knowledge");
  });

  it("system health flags the 8s latency target and missing job runs", () => {
    expect(latencyLevel(7900)).toBe("ok");
    expect(latencyLevel(10_000)).toBe("warning");
    expect(jobsLevel(0, 0)).toBe("critical");
    expect(overallLevel([{ key: "ai", level: "warning", valueEn: "", valueAr: "" }])).toBe("warning");
  });
});
