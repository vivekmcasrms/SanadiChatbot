import { describe, expect, it } from "vitest";
import { chunk, inReminderWindow, infoRequestAction } from "./job-batching";

const NOW = Date.parse("2026-10-28T12:00:00Z");

describe("job batching", () => {
  it("chunks grouped lookups into fixed-size parts", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("reminds about appointments starting within the next 26 hours only", () => {
    expect(inReminderWindow("2026-10-29T13:00:00Z", NOW, 26)).toBe(true);
    expect(inReminderWindow("2026-10-29T15:00:00Z", NOW, 26)).toBe(false);
    expect(inReminderWindow("2026-10-28T11:00:00Z", NOW, 26)).toBe(false);
  });

  it("expires overdue information requests and reminds within the reminder days", () => {
    expect(infoRequestAction("2026-10-27T12:00:00Z", 3, NOW)).toEqual({ action: "expire" });
    expect(infoRequestAction("2026-10-30T12:00:00Z", 3, NOW)).toEqual({ action: "remind", daysLeft: 2 });
    expect(infoRequestAction("2026-11-10T12:00:00Z", 3, NOW)).toEqual({ action: "skip" });
    expect(infoRequestAction(null, 3, NOW)).toEqual({ action: "skip" });
  });
});
