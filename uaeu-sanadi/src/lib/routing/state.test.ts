import { describe, expect, it } from "vitest";
import { clearOnTopicChange, ENTITY_TTL_MS, mergeConcurrent, pendingActionExpired, pruneExpired, stampChanges, STAMPS_KEY } from "./state";
import { resolveRoute } from "./intent";
import { saveConversationState } from "./state-store.server";

const NOW = new Date("2026-10-28T18:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

describe("TTL on saved context", () => {
  it("stale transfer context is dropped after 30 minutes", () => {
    const e = { transferTarget: "BSDSAI", transferActive: ago(31), [STAMPS_KEY]: { transferTarget: ago(31), transferActive: ago(31) } };
    const r = pruneExpired(e, NOW.getTime());
    expect(r.entities["transferTarget"]).toBeNull();
    expect(r.expired).toContain("transferTarget");
  });
  it("fresh transfer context survives", () => {
    const e = { transferTarget: "BSDSAI", [STAMPS_KEY]: { transferTarget: ago(5) } };
    expect(pruneExpired(e, NOW.getTime()).entities["transferTarget"]).toBe("BSDSAI");
  });
  it("stale appointment context is dropped", () => {
    const e = { appointmentContext: { awaitingService: true }, [STAMPS_KEY]: { appointmentContext: ago(45) } };
    expect(pruneExpired(e, NOW.getTime()).entities["appointmentContext"]).toBeNull();
  });
  it("legacy unstamped context expires from the row's last update", () => {
    const e = { activeCareerTopic: "skills" };
    expect(pruneExpired(e, NOW.getTime(), ago(25)).entities["activeCareerTopic"]).toBeNull();
    expect(pruneExpired(e, NOW.getTime(), ago(5)).entities["activeCareerTopic"]).toBe("skills");
  });
  it("covers every context the brief names", () => {
    for (const k of ["transferTarget", "appointmentContext", "activeCaseReference", "activeCareerTopic", "academicProgressSnapshot"]) {
      expect(ENTITY_TTL_MS[k]).toBeGreaterThan(0);
    }
  });
  it("changed values are restamped, unchanged ones keep their stamp", () => {
    const before = { transferTarget: "A", activeCareerTopic: "x", [STAMPS_KEY]: { transferTarget: ago(10), activeCareerTopic: ago(10) } };
    const after = stampChanges(before, { ...before, transferTarget: "B" }, NOW);
    const st = after[STAMPS_KEY] as Record<string, string>;
    expect(st["transferTarget"]).toBe(NOW.toISOString());
    expect(st["activeCareerTopic"]).toBe(ago(10));
  });
  it("expired pending actions are not preserved", () => {
    expect(pendingActionExpired(ago(31), NOW.getTime())).toBe(true);
    expect(pendingActionExpired(ago(5), NOW.getTime())).toBe(false);
  });
});

describe("topic change", () => {
  const sticky = { transferTarget: { value: "Data Science", at: ago(1) } };
  it("turn 2: 'What GPA do I need?' stays in the transfer flow", () => {
    const d = resolveRoute({ text: "What GPA do I need?", sticky, now: NOW });
    expect(d.intent).toBe("program_transfer");
    expect(d.topic_changed).toBe(false);
  });
  it("turn 3: 'Find books about machine learning.' ends transfer context", () => {
    const d = resolveRoute({ text: "Find books about machine learning.", sticky, now: NOW });
    expect(d.intent).toBe("library_query");
    expect(d.topic_changed).toBe(true);
    const c = clearOnTopicChange({ transferTarget: "Data Science", transferActive: ago(1) }, d.intent);
    expect(c.entities["transferTarget"]).toBeNull();
  });
  it("an explicit case reference wins even with expired or other context", () => {
    const d = resolveRoute({ text: "Is UAEU-2026-01063 confirmed?", sticky, now: NOW });
    expect(d.intent).toBe("existing_case_followup");
    expect(d.case_reference).toBe("UAEU-2026-01063");
  });
});

describe("concurrent turns", () => {
  const base = { extracted_entities: { a: 1, b: 1 }, summary: "s0", turn_count: 2 };
  it("non-overlapping changes from two tabs are both kept", () => {
    const mine = { extracted_entities: { a: 2, b: 1 }, summary: "s0\nTurn: x -> answer", turn_count: 3 };
    const theirs = { extracted_entities: { a: 1, b: 9 }, summary: "s0\nTurn: y -> answer", turn_count: 3 };
    const { merged, conflicts } = mergeConcurrent(base, mine, theirs);
    expect(merged.extracted_entities).toMatchObject({ a: 2, b: 9 });
    expect(merged.turn_count).toBe(4);
    expect(merged.summary).toBe("s0\nTurn: y -> answer\nTurn: x -> answer");
    expect(conflicts).toEqual([]);
  });
  it("same key changed by both: committed value is kept and reported", () => {
    const mine = { extracted_entities: { a: 5, b: 1 }, turn_count: 3 };
    const theirs = { extracted_entities: { a: 7, b: 1 }, turn_count: 3 };
    const { merged, conflicts } = mergeConcurrent(base, mine, theirs);
    expect((merged.extracted_entities as any).a).toBe(7);
    expect(conflicts).toEqual(["a"]);
  });
  it("a committed pending confirmation is never replaced by a racing one", () => {
    const mine = { extracted_entities: {}, pending_confirmation_type: "create_complaint" };
    const theirs = { extracted_entities: {}, pending_confirmation_type: "book_hostel_room" };
    const { merged, conflicts } = mergeConcurrent({ extracted_entities: {} }, mine, theirs);
    expect(merged["pending_confirmation_type"]).toBe("book_hostel_room");
    expect(conflicts).toContain("pending_confirmation");
  });
});

/** In-memory table with real compare-and-swap semantics. */
function fakeDb(row: any) {
  let stored = { ...row };
  const db = {
    get row() { return stored; },
    from: () => {
      const q: any = { filters: {} as any, patch: null as any, mode: "" };
      q.update = (p: any) => ((q.patch = p), (q.mode = "update"), q);
      q.insert = async () => ({ error: { code: "23505" } });
      q.select = () => {
        if (q.mode !== "update") return ((q.mode = "select"), q);
        if (stored.state_version === q.filters.state_version) {
          stored = { ...stored, ...q.patch };
          return Promise.resolve({ data: [{ id: stored.id }], error: null });
        }
        return Promise.resolve({ data: [], error: null });
      };
      q.eq = (k: string, v: any) => ((q.filters[k] = v), q);
      q.maybeSingle = async () => ({ data: stored });
      return q;
    },
  };
  return db;
}

describe("compare-and-swap store", () => {
  it("two simultaneous turns: the second merges instead of overwriting", async () => {
    const start = { id: "s1", conversation_id: "c1", state_version: 4, state_conflicts: 0, extracted_entities: { a: 1, b: 1 }, summary: "s0", turn_count: 2 };
    const db = fakeDb(start);
    const r1 = await saveConversationState(db as never, start, { conversation_id: "c1", extracted_entities: { a: 2, b: 1 }, summary: "s0\nTurn: x -> answer", turn_count: 3 });
    const r2 = await saveConversationState(db as never, start, { conversation_id: "c1", extracted_entities: { a: 1, b: 3 }, summary: "s0\nTurn: y -> answer", turn_count: 3 });
    expect(r1).toMatchObject({ ok: true, attempts: 1 });
    expect(r2.ok).toBe(true);
    expect(r2.attempts).toBe(2);
    expect(db.row.state_version).toBe(6);
    expect(db.row.extracted_entities).toMatchObject({ a: 2, b: 3 });
    expect(db.row.turn_count).toBe(4);
    expect(db.row.state_conflicts).toBe(1);
  });
});
