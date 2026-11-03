import { beforeEach, describe, expect, it, vi } from "vitest";

const inserted: Record<string, unknown>[] = [];
let auditFails = 0;
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserted.push(row);
        return { error: null };
      },
    }),
  },
}));

import { DataUnavailableError, classifyError, failureMessage, must, notFound } from "@/lib/result";
import { auditInsert, checked, guardService } from "./handle.server";
import { runExceptionScenario } from "./scenarios.server";

beforeEach(() => {
  inserted.length = 0;
  auditFails = 0;
});

describe("result model", () => {
  it("a failed query throws instead of returning empty data", () => {
    expect(() => must({ data: null, error: { code: "08006", message: "connection lost" } }, "holds")).toThrow(DataUnavailableError);
  });

  it("a successful empty query is a real empty result", () => {
    expect(must({ data: [], error: null }, "holds")).toEqual([]);
    expect(notFound().status).toBe("not_found");
  });

  it("classifies timeout, permission and invalid input", () => {
    expect(classifyError(Object.assign(new Error("statement timeout"), { code: "57014" })).type).toBe("timeout");
    expect(classifyError({ code: "42501", message: "permission denied" }).status).toBe("forbidden");
    expect(classifyError({ code: "22P02", message: "invalid input syntax" }).status).toBe("invalid");
    expect(classifyError(new Error("boom")).status).toBe("unavailable");
  });

  it("hold lookup failure says it could not verify, never 'no hold found'", () => {
    const msg = failureMessage("holds", "unavailable", "en");
    expect(msg).toBe("I couldn't verify your hold status right now. Please try again.");
    expect(msg).not.toMatch(/no hold/i);
  });
});

describe("guardService", () => {
  it("records component, type, trace and recovery without a stack trace", async () => {
    const err = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    const res = await guardService("holds", async () => { throw err; }, { lang: "en", traceId: "TR-T1" });
    expect(res.status).toBe("unavailable");
    expect(res.retryable).toBe(true);
    expect(res.internal_error_code).toBe("holds.timeout");
    const ev = inserted.at(-1)!;
    expect(ev["component"]).toBe("holds");
    expect(ev["exception_type"]).toBe("timeout");
    expect(ev["trace_id"]).toBe("TR-T1");
    expect(ev["recovered"]).toBe(false);
    expect(ev["recovery_action"]).toBe("told_student_to_retry");
    expect(String(ev["detail"])).not.toMatch(/\n\s+at /);
  });
});

describe("mutation checks", () => {
  it("a strict mutation failure throws so the action is not reported as done", async () => {
    await expect(checked(Promise.resolve({ error: { code: "23514" } }), "staff_operations", "cases", true)).rejects.toThrow(DataUnavailableError);
  });
  it("a failed audit write is retried, then recorded as an exception", async () => {
    const db = { from: () => ({ insert: async () => { auditFails += 1; return { error: { code: "42P01" } }; } }) };
    expect(await auditInsert(db, { action: "x.test" })).toBe(false);
    expect(auditFails).toBe(2);
    expect(inserted.at(-1)?.["component"]).toBe("audit");
  });
});

describe("controlled failure scenarios", () => {
  for (const scenario of ["db_timeout", "rag_unavailable", "library_unavailable", "hostel_transaction_failure", "transfer_data_failure", "notification_write_failure"] as const) {
    it(`${scenario} is reported as unavailable with a plain message`, async () => {
      const r = await runExceptionScenario({} as never, scenario, "00000000-0000-0000-0000-000000000000", "en");
      expect(r.pass).toBe(true);
      expect(r.studentMessage).toMatch(/couldn't verify/);
      expect(inserted.at(-1)?.["is_test"]).toBe(true);
    });
  }
});

describe("staff mutation failure", () => {
  it("a failed primary case update throws so the UI shows failure, not success", async () => {
    await expect(
      checked(Promise.resolve({ error: { code: "08006", message: "connection lost" } }), "staff_operations", "cases", true),
    ).rejects.toThrow();
    expect(inserted.at(-1)?.["component"]).toBe("staff_operations");
  });
});
