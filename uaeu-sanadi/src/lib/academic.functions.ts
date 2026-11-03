import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Db } from "./student-context.server";
import { loadStudentSnapshot, type StudentSnapshot } from "./student-context.server";
import { loadAcademicCourses, type AcademicCourses } from "./academic-record.server";

export type AcademicRecord = {
  snapshot: StudentSnapshot;
  courses: AcademicCourses;
};

/**
 * The signed-in student's verified academic record. RLS scopes every read to
 * the caller, so one student can never load another student's data.
 */
export const getMyAcademicRecord = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AcademicRecord> => {
    const db = context.supabase as Db;
    const snapshot = await loadStudentSnapshot(db, context.userId);
    const courses = await loadAcademicCourses(db, context.userId, snapshot.programId);
    return { snapshot, courses };
  });
