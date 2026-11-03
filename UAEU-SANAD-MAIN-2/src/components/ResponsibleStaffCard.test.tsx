import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { ResponsibleStaffCard } from "./ResponsibleStaffCard";

const state = vi.hoisted(() => ({ data: {} as Record<string, unknown>, lang: "en" }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: state.data }) }));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ lang: state.lang }) }));
vi.mock("@/lib/auth-token", () => ({ apiFetch: vi.fn() }));
beforeEach(() => {
  state.lang = "en";
  state.data = { caseNumber: "REQ-TEST", unitNameEn: "Transportation Services", unitEmail: "unit@example.test", staffName: null, staffEmail: null, staffRoleEn: null, escalated: false };
});
const render = () => renderToStaticMarkup(<ResponsibleStaffCard caseId="test" />);

it("keeps all marked fields and the actual reference visible while assignment is pending", () => {
  const html = render();
  for (const field of ["Responsible staff member", "Role", "Unit", "University email", "Reference", "REQ-TEST", "Transportation Services", "Awaiting assignment", "unit@example.test"])
    expect(html).toContain(field);
  expect(html).not.toContain("has been escalated");
});

it("loads the assigned person's name, role, email and unit without a pending-assignment message", () => {
  Object.assign(state.data, { staffName: "Test Officer", staffEmail: "officer@example.test", staffRoleEn: "Transport Officer" });
  const html = render();
  for (const value of ["Test Officer", "Transport Officer", "mailto:officer@example.test", "Transportation Services", "REQ-TEST"])
    expect(html).toContain(value);
  expect(html).not.toContain("Awaiting assignment");
});

it("only shows escalation text when the backend reports an escalation", () => {
  state.data.escalated = true;
  expect(render()).toContain("has been escalated");
});

it("keeps a configured role visible in Arabic when its translation is missing", () => {
  state.lang = "ar";
  Object.assign(state.data, { staffName: "Test Officer", staffRoleEn: "Transport Officer", staffRoleAr: null });
  expect(render()).toContain("Transport Officer");
});
