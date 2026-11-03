import { describe, expect, it, vi } from "vitest";
import { documentLifecycle } from "./lifecycle";
import { runFileCleanup, type CleanupDeps } from "./cleanup";

const now = new Date("2026-10-28T12:00:00Z").getTime();
const doc = (over = {}) => ({
  documentStatus: "valid", deletedAt: null, hasFile: true,
  retentionExpiresAt: "2026-11-20T00:00:00Z", expiresAt: "2027-01-20T00:00:00Z", ...over,
});

describe("file availability vs verification validity", () => {
  it("before 30-day expiry: file downloadable and verification valid", () => {
    const l = documentLifecycle(doc(), now);
    expect([l.fileAvailable, l.verifiable, l.listed, l.fileState]).toEqual([true, true, true, "available"]);
  });
  it("exactly at retention expiry: file no longer available", () => {
    const l = documentLifecycle(doc({ retentionExpiresAt: "2026-10-28T12:00:00Z" }), now);
    expect(l.fileAvailable).toBe(false);
    expect(l.fileState).toBe("expired");
  });
  it("after expiry: still listed read-only and verification still valid until its date", () => {
    const l = documentLifecycle(doc({ retentionExpiresAt: "2026-10-14T00:00:00Z", hasFile: false }), now);
    expect([l.listed, l.fileAvailable, l.verifiable, l.validity]).toEqual([true, false, true, "valid"]);
  });
  it("verification ends at the validity date", () => {
    const l = documentLifecycle(doc({ expiresAt: "2026-10-28T12:00:00Z" }), now);
    expect([l.validity, l.verifiable]).toEqual(["expired", false]);
  });
  it("revoked: not downloadable, not verifiable", () => {
    const l = documentLifecycle(doc({ documentStatus: "revoked" }), now);
    expect([l.validity, l.verifiable, l.fileAvailable, l.fileState]).toEqual(["revoked", false, false, "revoked"]);
  });
  it("never shows 'deleted in 0 days'", () => {
    expect(documentLifecycle(doc({ retentionExpiresAt: "2026-10-28T18:00:00Z" }), now).daysUntilDeletion).toBe(1);
  });
  it("withdrawn by student is hidden and not verifiable", () => {
    const l = documentLifecycle(doc({ documentStatus: "deleted_by_student", deletedAt: "2026-10-27T00:00:00Z" }), now);
    expect([l.listed, l.verifiable]).toEqual([false, false]);
  });
});

function deps(over: Partial<CleanupDeps> = {}) {
  const calls: string[] = [];
  const d: CleanupDeps = {
    claim: vi.fn(async () => { calls.push("claim"); return [{ id: "d1", reference_number: "REF-1", file_path: "u/a.pdf", attempts: 1 }]; }),
    removeFile: vi.fn(async () => { calls.push("remove"); }),
    fileExists: vi.fn(async () => { calls.push("verify"); return false; }),
    complete: vi.fn(async (_id, ok) => { calls.push(ok ? "complete:ok" : "complete:failed"); }),
    alert: vi.fn(async () => { calls.push("alert"); }),
    purge: vi.fn(async () => { calls.push("purge"); return 1; }),
    ...over,
  };
  return { d, calls };
}

describe("ordered cleanup", () => {
  it("removes and verifies the file before recording success and purging", async () => {
    const { d, calls } = deps();
    const r = await runFileCleanup(d);
    expect(calls).toEqual(["claim", "remove", "verify", "complete:ok", "purge"]);
    expect(r.filesRemoved).toBe(1);
  });
  it("storage failure keeps metadata, marks failed and alerts", async () => {
    const { d, calls } = deps({ removeFile: vi.fn(async () => { throw new Error("storage down"); }) });
    const r = await runFileCleanup(d);
    expect(d.complete).toHaveBeenCalledWith("d1", false, "storage down");
    expect(calls).toContain("alert");
    expect(r.failed).toBe(1);
  });
  it("orphan prevention: a file still present after removal is not reported as removed", async () => {
    const { d } = deps({ fileExists: vi.fn(async () => true) });
    await runFileCleanup(d);
    expect(d.complete).toHaveBeenCalledWith("d1", false, "file still present after removal");
    expect(d.complete).not.toHaveBeenCalledWith("d1", true);
  });
});
