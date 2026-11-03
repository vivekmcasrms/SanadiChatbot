import { describe, expect, it } from "vitest";
import { categoriseNotification, matchesTab } from "./student-categories";
import { conversationFromPayload, dismissalScope, mergeNotifications, type StudentNotification } from "./student.functions";

const n = (o: Partial<StudentNotification>): StudentNotification => ({
  id: "1", eventType: "case_status_changed", title: "Status Updated", body: "", actionUrl: null,
  createdAt: "2026-10-28T10:00:00.000Z", readAt: null, caseId: "c1", caseReference: "R-1",
  category: "requests", conversationId: null, source: "event", ...o,
});

describe("unified student notifications", () => {
  it("files each scenario under the right tab", () => {
    expect(categoriseNotification("appointment_booked", null)).toBe("appointments");
    expect(categoriseNotification("case_status_changed", "complaint")).toBe("complaints");
    expect(matchesTab("complaints", null, "requests")).toBe(true);
    expect(categoriseNotification("information_requested", "service_request")).toBe("requests");
    expect(categoriseNotification("document_ready", null)).toBe("documents");
    expect(categoriseNotification("case_resolved", "query")).toBe("requests");
    expect(matchesTab("alerts", null, "alerts")).toBe(true);
    expect(matchesTab("alerts", null, "requests")).toBe(false);
  });

  it("unread tab shows only unread items", () => {
    expect(matchesTab("documents", null, "unread")).toBe(true);
    expect(matchesTab("documents", "2026-10-28T10:00:00Z", "unread")).toBe(false);
  });

  it("collapses duplicate rows for the same event, keeping the unread copy", () => {
    const out = mergeNotifications(
      [n({ id: "a", readAt: "2026-10-28T10:01:00Z" }), n({ id: "b", createdAt: "2026-10-28T10:00:30.000Z" })],
      [],
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("b");
  });

  it("keeps distinct events and alerts, newest first", () => {
    const out = mergeNotifications(
      [n({ id: "a" })],
      [n({ id: "alert:x", source: "alert", eventType: "university_alert", caseId: null, category: "alerts", createdAt: "2026-10-28T11:00:00.000Z" })],
    );
    expect(out.map((x) => x.id)).toEqual(["alert:x", "a"]);
  });

  it("reads a conversation link only when recorded", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    expect(conversationFromPayload({ conversation_id: id }, null, null)).toBe(id);
    expect(conversationFromPayload({}, "case", "x")).toBeNull();
  });

  it("delete-all covers both sources, and single deletes only the rows asked for", () => {
    const alertUuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const eventUuid = "11111111-2222-3333-4444-555555555555";
    expect(dismissalScope([], true)).toEqual({ alertIds: null, eventIds: null });
    expect(dismissalScope([`alert:${alertUuid}`, eventUuid, "junk"], false)).toEqual({
      alertIds: [alertUuid],
      eventIds: [eventUuid],
    });
    expect(dismissalScope([], false)).toEqual({ alertIds: [], eventIds: [] });
  });
});

