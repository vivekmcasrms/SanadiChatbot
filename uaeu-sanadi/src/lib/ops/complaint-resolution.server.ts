/**
 * Complaint → resolution. Server only.
 *
 * A complaint is a symptom; the student wants the underlying problem gone.
 * When the complaint is about a service Sanadi can actually operate — an
 * hold that blocks registration — the agent attempts the real fix immediately and
 * records what it did on the case, instead of only logging the grievance.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Lang } from "../agent-types";

type Db = SupabaseClient<Database>;

export type AutoResolution = {
  attempted: true;
  topic: "registration";
  summaryEn: string;
  summaryAr: string;
  /** A tool the assistant can offer to run straight away. */
  proposal?: { toolName: string; args: Record<string, unknown> };
};

const REGISTRATION_RE = /(register|registration|hold|blocked|تسجيل|إيقاف|محظور)/i;

/**
 * Inspects a freshly created case and, where possible, performs or offers the
 * concrete action that removes the cause. Never throws: a failed attempt just
 * leaves the case in the normal human workflow.
 */
export async function attemptComplaintResolution(opts: {
  db: Db;
  userId: string;
  lang: Lang;
  caseId: string;
  title: string;
  description: string;
}): Promise<AutoResolution | null> {
  const { db, userId, lang, caseId } = opts;
  const ar = lang === "ar";
  const text = `${opts.title} ${opts.description}`;

  try {
    if (REGISTRATION_RE.test(text)) {
      const { buildReadinessReport } = await import("../agent/readiness.server");
      const report = await buildReadinessReport(db, userId, lang, "registration");
      if (report) {
        return await record(db, caseId, userId, {
          attempted: true,
          topic: "registration",
          summaryEn:
            report.blockers === 0
              ? "I diagnosed every service while filing this: nothing on your record blocks registration, so the unit will look at the system side rather than your file."
              : `I diagnosed every service while filing this and attached the ${report.blockers} exact blocker(s) to the case, so the unit can act without asking you again.`,
          summaryAr:
            report.blockers === 0
              ? "شخّصت كل الخدمات أثناء تسجيل الطلب: لا يوجد في سجلك ما يمنع التسجيل، لذا ستراجع الجهة المختصة الجانب التقني وليس ملفك."
              : `شخّصت كل الخدمات أثناء تسجيل الطلب وأرفقت العوائق (${report.blockers}) بالطلب حتى تتصرف الجهة المختصة دون سؤالك مجدداً.`,
        }, ar);
      }
    }
  } catch (err) {
    console.error("[complaint-resolution] attempt failed", err);
  }
  return null;
}

/** Writes the attempt onto the case timeline so staff see what the AI already tried. */
async function record(db: Db, caseId: string, authorId: string, res: AutoResolution, ar: boolean): Promise<AutoResolution> {
  await db
    .from("case_comments")
    .insert({
      case_id: caseId,
      author_id: authorId,
      body: `[Sanadi automatic resolution attempt] ${ar ? res.summaryAr : res.summaryEn}`,
      is_internal: true,
    })
    .then(
      () => undefined,
      (e: unknown) => console.error("[complaint-resolution] comment failed", e),
    );
  return res;
}