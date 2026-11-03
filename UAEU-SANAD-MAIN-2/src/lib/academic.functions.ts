import { apiFetch } from "@/lib/auth-token";
import type { StudentSnapshot } from "./student-context.server";
import type { AcademicCourses } from "./academic-record.server";

export type AcademicRecord = {
  snapshot: StudentSnapshot;
  courses: AcademicCourses;
};

/**
 * The signed-in student's verified academic record. RLS scopes every read to
 * the caller, so one student can never load another student's data.
 */
export async function getMyAcademicRecord(): Promise<AcademicRecord> {
  return apiFetch<AcademicRecord>("/api/academic/me");
}
