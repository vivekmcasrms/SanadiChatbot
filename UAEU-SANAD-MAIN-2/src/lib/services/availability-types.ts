/** Client-safe availability contracts shared by server engines and UI. */

export const UNIVERSITY_TIMEZONE = "Asia/Dubai";

export const SERVICE_CODES = {
  career: "SVC-CAREER-COUNSEL",
  letter: "SVC-DOC-TWIMC",
  withdrawal: "SVC-WITHDRAWAL",
  complaint: "SVC-COMPLAINT",
  suggestion: "SVC-SUGGESTION",
  query: "SVC-GENERAL-QUERY",
} as const;

export type ServiceKey = keyof typeof SERVICE_CODES;

export type AvailabilityStatus =
  | "open"
  | "closed"
  | "opens_soon"
  | "closing_soon"
  | "temporarily_suspended"
  | "always_available"
  | "admin_disabled";

export type AvailabilityType =
  | "always_available"
  | "date_range"
  | "term_based"
  | "multiple_windows"
  | "temporarily_closed"
  | "admin_disabled";

export type ServiceAvailability = {
  serviceId: string | null;
  serviceCode: string | null;
  serviceNameEn: string | null;
  serviceNameAr: string | null;
  exists: boolean;
  isAvailable: boolean;
  status: AvailabilityStatus;
  availabilityType: string;
  currentWindowId: string | null;
  nextWindowId: string | null;
  opensAt: string | null;
  closesAt: string | null;
  nextOpenAt: string | null;
  nextCloseAt: string | null;
  reasonEn: string | null;
  reasonAr: string | null;
  studentMessageEn: string | null;
  studentMessageAr: string | null;
  remindersEnabled: boolean;
  preliminaryCheckAllowed: boolean;
  timezone: string;
};
