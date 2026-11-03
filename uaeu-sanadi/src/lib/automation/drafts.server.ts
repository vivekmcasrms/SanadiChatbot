/**
 * AI-drafted responses for Service Owners.
 * The AI writes the routine reply; the human reviews, edits or approves it.
 * Every human edit is captured so the system can learn where it gets things wrong.
 * Server only.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { llmChat, ProviderUnavailableError } from "@/lib/agent/provider.server";
import { loadAiSettings } from "@/lib/agent/settings.server";
import { loadOwnerPreferences } from "./policy.server";
import { recordAutomationEvent, resolveAutonomy } from "./policy.server";

const STYLE_HINT: Record<string, string> = {
  concise_formal: "Concise, formal and factual. No more than 120 words.",
  warm_supportive: "Warm and supportive, still precise. No more than 150 words.",
  detailed_procedural: "Detailed and procedural, listing the exact steps. No more than 200 words.",
};

export type DraftResult = {
  caseId: string;
  draft: string;
  language: "en" | "ar";
  autonomy: string;
  autoSendAllowed: boolean;
  reason: string;
  fallback: boolean;
};

/** Compose a student-facing reply grounded in the case record itself. */
export async function prepareDraftResponse(caseId: string, ownerId: string | null): Promise<DraftResult> {
  const { data: c } = await supabaseAdmin
    .from("cases")
    .select(
      "id, case_number, case_type, title, description, status, urgency, language, is_sensitive, ai_confidence, service_unit_id, assigned_to, resolution_due_at",
    )
    .eq("id", caseId)
    .maybeSingle();
  if (!c) throw new Error("Case not found");

  const [{ data: unit }, { data: comments }, prefs] = await Promise.all([
    c.service_unit_id
      ? supabaseAdmin.from("service_units").select("name_en, name_ar").eq("id", c.service_unit_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin
      .from("case_comments")
      .select("body, is_internal, created_at")
      .eq("case_id", caseId)
      .order("created_at", { ascending: false })
      .limit(5),
    loadOwnerPreferences(ownerId),
  ]);

  const decision = await resolveAutonomy("response_sending", {
    caseType: c.case_type,
    serviceUnitId: c.service_unit_id,
    isSensitive: c.is_sensitive,
    confidence: c.ai_confidence != null ? Number(c.ai_confidence) : null,
    ownerId,
  });

  const ar = c.language === "ar";
  const unitName = unit ? (ar ? unit.name_ar : unit.name_en) : ar ? "الوحدة المسؤولة" : "the responsible unit";

  const fallbackDraft = ar
    ? `عزيزي الطالب،\n\nبخصوص الحالة ${c.case_number} ("${c.title}") — تتولى ${unitName} متابعة طلبك حالياً، والحالة الآن: ${c.status}. سنوافيك بالمستجدات فور توفرها.\n\nمع التحية،\n${unitName}`
    : `Dear student,\n\nRegarding case ${c.case_number} ("${c.title}") — ${unitName} is handling your request. The current status is: ${c.status}. We will update you as soon as there is progress.\n\nKind regards,\n${unitName}`;

  let draft = fallbackDraft;
  let fallback = true;
  try {
    const settings = await loadAiSettings(supabaseAdmin as never);
    if (settings.aiEnabled) {
      const result = await llmChat(
        {
          provider: settings.provider,
          model: settings.modelName,
          temperature: 0.3,
          maxOutputTokens: 600,
          timeoutMs: settings.requestTimeoutMs,
        },
        {
          messages: [
            {
              role: "system",
              content:
                "You draft official replies from a United Arab Emirates University service unit to a student about their case. " +
                "Only use facts present in the case record. Never invent policy, amounts, dates or approvals. " +
                `Write in ${ar ? "Arabic" : "English"}. ${STYLE_HINT[prefs.preferred_response_style] ?? STYLE_HINT["concise_formal"]}`,
            },
            {
              role: "user",
              content: JSON.stringify({
                caseNumber: c.case_number,
                type: c.case_type,
                title: c.title,
                description: c.description,
                status: c.status,
                urgency: c.urgency,
                unit: unitName,
                resolutionDueAt: c.resolution_due_at,
                recentNotes: (comments ?? []).filter((m) => !m.is_internal).map((m) => m.body),
              }),
            },
          ],
          temperature: 0.3,
          maxOutputTokens: 600,
        },
      );
      if (result.text.trim()) {
        draft = result.text.trim();
        fallback = false;
      }
    }
  } catch (err) {
    if (!(err instanceof ProviderUnavailableError)) console.error("[automation] draft generation failed", err);
  }

  await recordAutomationEvent({
    caseId,
    action: "draft_response",
    decision,
    result: { fallback },
    summaryEn: "Response draft prepared for the Service Owner",
    summaryAr: "تم إعداد مسودة الرد لمالك الخدمة",
  });

  return {
    caseId,
    draft,
    language: ar ? "ar" : "en",
    autonomy: decision.level,
    autoSendAllowed: decision.canExecute && !prefs.require_review_for_all_student_messages,
    reason: decision.reason,
    fallback,
  };
}

function editCategory(original: string, edited: string): string {
  const o = original.trim();
  const e = edited.trim();
  if (o === e) return "approved_unchanged";
  const ratio = e.length / Math.max(o.length, 1);
  if (ratio < 0.6) return "shortened";
  if (ratio > 1.4) return "added_detail";
  return "tone_or_wording";
}

/**
 * Send a reply to the student. When the owner changed the AI text we store both
 * versions so recurring edit patterns become a measurable learning signal.
 */
export async function sendDraftResponse(opts: {
  caseId: string;
  actorId: string;
  originalDraft: string;
  finalText: string;
  reason?: string | undefined;
}): Promise<{ ok: true; edited: boolean }> {
  const edited = opts.originalDraft.trim() !== opts.finalText.trim();

  await supabaseAdmin.from("case_comments").insert({
    case_id: opts.caseId,
    author_id: opts.actorId,
    body: opts.finalText,
    is_internal: false,
  });
  await supabaseAdmin
    .from("cases")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", opts.caseId);

  if (edited) {
    await supabaseAdmin.from("ai_human_edits").insert({
      case_id: opts.caseId,
      entity_type: "case_response",
      original_ai_content: opts.originalDraft,
      edited_content: opts.finalText,
      editor_profile_id: opts.actorId,
      edit_category: editCategory(opts.originalDraft, opts.finalText),
      edit_reason: opts.reason ?? null,
    });
  }

  await recordAutomationEvent({
    caseId: opts.caseId,
    action: "response_sending",
    actorType: "human",
    actorId: opts.actorId,
    result: { edited },
    summaryEn: edited ? "Service Owner edited and sent the AI draft" : "Service Owner approved and sent the AI draft",
    summaryAr: edited ? "قام مالك الخدمة بتعديل مسودة الذكاء الاصطناعي وإرسالها" : "اعتمد مالك الخدمة مسودة الذكاء الاصطناعي وأرسلها",
  });

  return { ok: true, edited };
}