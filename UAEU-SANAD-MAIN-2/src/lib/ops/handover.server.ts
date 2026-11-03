/**
 * Context handover.
 *
 * When Sanadi hands a case to a person, the staff member must never have to
 * ask the student to repeat anything. This builds one concise package from the
 * data already captured — record, conversation, verified facts, actions taken —
 * and stores it against the case.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const MAX_CONTEXT_TURNS = 12;

export type HandoverTurn = { role: "student" | "sanadi"; text: string; at: string };

export async function buildHandover(caseId: string): Promise<void> {
  const { data: kase } = await supabaseAdmin
    .from("cases")
    .select(
      "id, case_number, student_id, case_type, title, description, urgency, severity, service_unit_id, related_conversation_id, ai_summary, ai_recommended_action, routing_reason_en, routing_topic, language, next_action_en",
    )
    .eq("id", caseId)
    .maybeSingle();
  if (!kase) return;

  const [{ data: profile }, { data: student }, { data: unit }] = await Promise.all([
    supabaseAdmin.from("profiles").select("full_name, email").eq("id", kase.student_id).maybeSingle(),
    supabaseAdmin
      .from("student_profiles")
      .select(
        "student_number, completed_credit_hours, cumulative_gpa, academic_level, expected_graduation_date, academic_programs(name_en, name_ar), colleges(name_en, name_ar)",
      )
      .eq("user_id", kase.student_id)
      .maybeSingle(),
    kase.service_unit_id
      ? supabaseAdmin.from("service_units").select("name_en, name_ar").eq("id", kase.service_unit_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Relevant conversation context: the last turns of the chat this case came from.
  let turns: HandoverTurn[] = [];
  const toolsUsed = new Set<string>();
  if (kase.related_conversation_id) {
    const { data: messages } = await supabaseAdmin
      .from("messages")
      .select("role, content, created_at, metadata")
      .eq("conversation_id", kase.related_conversation_id)
      .order("created_at", { ascending: false })
      .limit(MAX_CONTEXT_TURNS);
    turns = (messages ?? [])
      .reverse()
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role === "user" ? ("student" as const) : ("sanadi" as const),
        text: String(m.content ?? "").slice(0, 800),
        at: m.created_at,
      }));
    for (const m of messages ?? []) {
      const meta = (m.metadata ?? {}) as Record<string, unknown>;
      for (const tool of Array.isArray(meta["toolsUsed"]) ? (meta["toolsUsed"] as string[]) : []) toolsUsed.add(tool);
    }
  }

  // Actions already performed on the student's behalf.
  const [{ data: receipts }, { data: docs }, { data: evidence }] = await Promise.all([
    supabaseAdmin
      .from("action_receipts")
      .select("action_type, reference_number, created_at")
      .eq("case_id", caseId)
      .limit(20),
    supabaseAdmin
      .from("issued_documents")
      .select("reference_number, title_en, issued_at")
      .eq("student_id", kase.student_id)
      .is("deleted_at", null)
      .order("issued_at", { ascending: false })
      .limit(5),
    supabaseAdmin.from("case_evidence").select("file_name").eq("case_id", caseId).limit(20),
  ]);

  const actions = [
    ...(receipts ?? []).map((r) => ({
      what: String(r.action_type ?? "action"),
      reference: r.reference_number ?? null,
      at: r.created_at,
    })),
    ...[...toolsUsed].map((t) => ({ what: t.replace(/_/g, " "), reference: null, at: null })),
  ];

  const programme = (student?.academic_programs as { name_en?: string } | null)?.name_en ?? null;
  const college = (student?.colleges as { name_en?: string } | null)?.name_en ?? null;

  const summary =
    kase.ai_summary?.trim() ||
    `${kase.title}. ${String(kase.description ?? "").slice(0, 400)}`.trim();

  const recommended =
    kase.ai_recommended_action?.trim() ||
    kase.next_action_en?.trim() ||
    "Review the summary below, confirm the facts already verified, and reply to the student in the case thread.";

  await supabaseAdmin.from("case_handovers").upsert(
    {
      case_id: caseId,
      student_name: profile?.full_name ?? null,
      student_number: student?.student_number ?? null,
      student_email: profile?.email ?? null,
      service_unit_id: kase.service_unit_id,
      unit_name_en: unit?.name_en ?? null,
      unit_name_ar: unit?.name_ar ?? null,
      interaction_type: kase.case_type,
      summary_en: summary.slice(0, 2000),
      summary_ar: null,
      conversation_context: turns as never,
      verified_data: {
        programme,
        college,
        academic_level: student?.academic_level ?? null,
        completed_credit_hours: student?.completed_credit_hours ?? null,
        cumulative_gpa: student?.cumulative_gpa ?? null,
        expected_graduation_date: student?.expected_graduation_date ?? null,
        preferred_language: kase.language,
      } as never,
      actions_taken: actions as never,
      unresolved_issue: kase.routing_reason_en ?? kase.title,
      recommended_action: recommended.slice(0, 1000),
      priority: kase.urgency ?? "medium",
      attachments: [
        ...(evidence ?? []).map((e) => ({ kind: "evidence", label: e.file_name })),
        ...(docs ?? []).map((d) => ({ kind: "document", label: `${d.title_en ?? "Letter"} (${d.reference_number})` })),
      ] as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "case_id" },
  );
}

/** Never let handover creation break case intake. */
export async function buildHandoverSafely(caseId: string): Promise<void> {
  try {
    await buildHandover(caseId);
  } catch (err) {
    const { logException } = await import("@/lib/exceptions/handle.server");
    await logException("api_failure", { caseId, detail: String(err), context: { stage: "handover" } });
  }
}
