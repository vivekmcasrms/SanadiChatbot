import { describe, expect, it } from "vitest";
import {
  canAccessCase,
  defaultHostel,
  eligibleAssignees,
  isEligibleAssignee,
  isStaleChange,
  staffCapabilities,
  type StaffWorkloadRow,
} from "./staff-workspace";

const CORE = ["assign", "autoRoute", "requestInformation", "sendMessage", "changeStatus", "internalNote", "resolve", "close"] as const;

describe("consistent workspace per role", () => {
  it("owner gets every case action; reassign only with unit assignment authority", () => {
    const c = staffCapabilities(["service_owner"]);
    for (const k of CORE) expect(c[k]).toBe(true);
    expect(c.reassign).toBe(false);
    expect(staffCapabilities(["service_owner"], { unitAssigner: true }).reassign).toBe(true);
    expect(c.managerTools).toBe(false);
  });
  it("officer gets the same case actions as the owner", () => {
    const o = staffCapabilities(["service_officer"]);
    const w = staffCapabilities(["service_owner"]);
    for (const k of CORE) expect(o[k]).toBe(w[k]);
  });
  it("manager additionally reassigns and gets manager tools", () => {
    const m = staffCapabilities(["service_manager"]);
    for (const k of CORE) expect(m[k]).toBe(true);
    expect(m.reassign).toBe(true);
    expect(m.managerTools).toBe(true);
  });
  it("a student gets no staff actions", () => {
    const s = staffCapabilities(["student"]);
    for (const k of CORE) expect(s[k]).toBe(false);
  });
});

describe("unit access", () => {
  const base = { userId: "u1", roles: ["service_officer"], caseUnitId: "unit-b", assignedTo: null, permittedUnitIds: ["unit-a"] };
  it("blocks a case in an unauthorized unit", () => expect(canAccessCase(base)).toBe(false));
  it("allows a permitted unit", () => expect(canAccessCase({ ...base, permittedUnitIds: ["unit-b"] })).toBe(true));
  it("allows a case assigned to the user", () => expect(canAccessCase({ ...base, assignedTo: "u1" })).toBe(true));
  it("admin can access any unit", () => expect(canAccessCase({ ...base, roles: ["system_admin"] })).toBe(true));
});

describe("assignee picker and reassignment", () => {
  const rows: StaffWorkloadRow[] = [
    { staffId: "a", fullName: "Amna", workload: 6, activeCases: 4, isActive: true, availability: "available" },
    { staffId: "b", fullName: "Badr", workload: 2, activeCases: 1, isActive: true, availability: "available" },
    { staffId: "c", fullName: "Huda", workload: 0, activeCases: 0, isActive: false, availability: "available" },
    { staffId: "d", fullName: "Omar", workload: 0, activeCases: 0, isActive: true, availability: "on_leave" },
  ];
  it("lists only active, available staff, lightest workload first", () => {
    expect(eligibleAssignees(rows).map((r) => r.staffId)).toEqual(["b", "a"]);
  });
  it("rejects reassignment to inactive or unavailable staff", () => {
    expect(isEligibleAssignee("c", rows)).toBe(false);
    expect(isEligibleAssignee("d", rows)).toBe(false);
    expect(isEligibleAssignee("b", rows)).toBe(true);
  });
});

describe("stale data", () => {
  it("rejects a change made from an out-of-date view", () => expect(isStaleChange("staff-1", "staff-2")).toBe(true));
  it("accepts when the view matches the current assignee", () => expect(isStaleChange(null, null)).toBe(false));
  it("does not check when no expectation was sent", () => expect(isStaleChange(undefined, "x")).toBe(false));
});

describe("hostel panel default", () => {
  it("double-room student defaults to Hostel B, never A", () => expect(defaultHostel(["B", "C"])).toBe("B"));
  it("keeps an existing eligible allocation", () => expect(defaultHostel(["B", "C"], "C")).toBe("C"));
  it("single-room student defaults to Hostel A", () => expect(defaultHostel(["A"])).toBe("A"));
  it("no eligibility means no default", () => expect(defaultHostel([])).toBeNull());
});
