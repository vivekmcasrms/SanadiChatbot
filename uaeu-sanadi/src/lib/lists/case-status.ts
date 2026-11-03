/**
 * One shared definition of the plain-language case status groups used by the
 * Service Owner surfaces. Dashboard counts, filter-chip counts and the visible
 * case list all import from here, so they can never drift apart.
 */

export const WAITING_STATUSES = ["awaiting_student", "student_confirmation"];

export const NEW_STATUSES = ["draft", "submitted", "acknowledged", "classified", "routed", "assigned"];

export const IN_PROGRESS_STATUSES = [
  "in_progress",
  "in_review",
  "ai_processing",
  "resolution_proposed",
  "escalated",
  "on_hold",
  "waiting_external",
  "reopened",
  "transferred",
];

export const COMPLETED_STATUSES = ["resolved", "closed"];

/** Open = New + In progress + Waiting for student. Resolved/Closed are never open. */
export const OPEN_STATUSES = [...NEW_STATUSES, ...IN_PROGRESS_STATUSES, ...WAITING_STATUSES];

/** Resolve a plain-language status key to concrete database statuses. */
export function statusesFor(key: string | undefined | null): string[] | null {
  switch (key) {
    case "waiting_student":
      return WAITING_STATUSES;
    case "submitted":
    case "new":
      return NEW_STATUSES;
    case "in_progress":
      return IN_PROGRESS_STATUSES;
    case "resolved":
    case "completed":
      return COMPLETED_STATUSES;
    case "all":
      return null;
    case undefined:
    case null:
    case "":
    case "open":
    case "all_open":
      return OPEN_STATUSES;
    default:
      return [key];
  }
}
