import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { loadStudentSnapshot, DEFAULT_TOTAL_CREDIT_HOURS, type Db } from "./student-context.server";

export type StudentBriefing = {
  hasProfile: boolean;
  headline: string;
  facts: { label: string; value: string }[];
};

const Input = z.object({ lang: z.enum(["en", "ar"]).default("en") });

/** Personalised first screen for the assistant: what matters for this student today. */
export const getStudentBriefing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<StudentBriefing> => {
    const ar = data.lang === "ar";
    // Proactive pass: raise anything that became true since the last visit
    // before the first screen is composed.
    await import("./ops/proactive.server")
      .then((m) => m.generateProactiveAlerts(context.supabase, context.userId))
      .catch(() => undefined);
    const s = await loadStudentSnapshot(context.supabase as Db, context.userId);
    if (!s.hasProfile) {
      return {
        hasProfile: false,
        headline: ar
          ? "لم أجد سجلاً أكاديمياً مرتبطاً بحسابك بعد، لكن يمكنني الإجابة عن أسئلة الجامعة وفتح الطلبات."
          : "I could not find an academic record linked to your account yet, but I can still answer university questions and open requests.",
        facts: [],
      };
    }

    const blocking = s.holds.filter((h) => h.blocksRegistration);
    const total = s.totalCredits ?? DEFAULT_TOTAL_CREDIT_HOURS;
    const pct = Math.round((s.completedCredits / total) * 100);

    const facts: { label: string; value: string }[] = [
      {
        label: ar ? "الساعات المكتملة" : "Completed credit hours",
        value: `${s.completedCredits} / ${total}`,
      },
      { label: ar ? "التقدم نحو التخرج" : "Graduation progress", value: `${pct}%` },
      { label: ar ? "المعدل التراكمي" : "GPA", value: s.gpa != null ? String(s.gpa) : "—" },
      { label: ar ? "الإيقافات النشطة" : "Active holds", value: String(s.holds.length) },
      { label: ar ? "الطلبات المفتوحة" : "Open requests", value: String(s.openCases) },
      { label: ar ? "تنبيهات غير مقروءة" : "Unread alerts", value: String(s.unreadAlerts) },
    ];

    const headline = blocking.length
      ? ar
        ? `يوجد ${blocking.length} عائق يمنع تسجيلك — يمكنني معالجته الآن.`
        : `${blocking.length} blocker${blocking.length === 1 ? " is" : "s are"} stopping your registration — I can handle it now.`
      : ar
        ? "سجلك سليم اليوم — لا توجد عوائق نشطة."
        : "Your record is clear today — nothing is blocking you.";

    return { hasProfile: true, headline, facts };
  });
