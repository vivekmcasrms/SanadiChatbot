import { auditInsert } from "@/lib/exceptions/handle.server";
/**
 * The single backend pipeline for every student interaction.
 *
 *   classifyInteraction() → determineRouting() → determineSla()
 *   → create/update record → orchestrate action → acknowledge
 *
 * Chat tools and the direct shortcuts both call `submitInteraction`, so a
 * complaint typed into the assistant and the same complaint filed through
 * "Report a Problem" produce identical service, unit, SLA, owner and workflow.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { classifyInteraction } from "./classify.server";
import { complaintBrief, structureComplaint } from "./complaint-structure";
import type { EntryChannel, InteractionClassification, InteractionType } from "./types";
import { SERVICE_UNIT_CODES, type ServiceCode } from "@/lib/ops/classify.server";

export type SubmitInteractionInput = {
  studentId: string;
  lang: "en" | "ar";
  title: string;
  description: string;
  shortcutHint?: InteractionType | null;
  channel: EntryChannel;
  conversationId?: string | null;
  categoryId?: string | null;
  unitId?: string | null;
  urgencyHint?: "low" | "medium" | "high" | "critical" | null;
  sensitiveHint?: boolean | null;
  desiredResolution?: string | null;
  incidentDate?: string | null;
  confidentiality?: string | null;
  isAnonymous?: boolean;
  expectedBenefit?: string | null;
  location?: string | null;
};

export type SubmitInteractionResult = {
  kind: "case" | "suggestion";
  id: string;
  reference: string;
  interactionType: InteractionType;
  classification: InteractionClassification;
  trackingUrl: string;
  acknowledgementEn: string;
  acknowledgementAr: string;
  emergencyContacts: { label: string; phone: string | null; url: string | null }[];
  linkedSuggestionId: string | null;
  /** The single operational detail worth asking for, when one is genuinely missing. */
  clarifyingQuestionEn?: string | null;
  clarifyingQuestionAr?: string | null;
};

async function unitForService(service: string, fallback: string | null): Promise<string | null> {
  const codes = SERVICE_UNIT_CODES[service as ServiceCode] ?? [];
  if (codes.length) {
    const { data } = await supabaseAdmin
      .from("service_units")
      .select("id, code")
      .in("code", codes)
      .eq("is_active", true);
    for (const code of codes) {
      const hit = (data ?? []).find((r) => r.code === code);
      if (hit) return hit.id;
    }
  }
  return fallback;
}

/** Approved emergency pathways — configured institutionally, never invented. */
export async function loadEmergencyContacts(lang: "en" | "ar") {
  const { data } = await supabaseAdmin
    .from("emergency_contacts")
    .select("label_en, label_ar, phone, url, is_active, sort_order")
    .eq("is_active", true)
    .order("sort_order")
    .limit(8);
  return (data ?? []).map((c) => ({
    label: (lang === "ar" ? c.label_ar : c.label_en) ?? c.label_en,
    phone: c.phone ?? null,
    url: c.url ?? null,
  }));
}

function ack(type: InteractionType, reference: string, unitEn: string, unitAr: string) {
  switch (type) {
    case "alert":
      return {
        en: `Your alert ${reference} has been raised with ${unitEn} and prioritised for immediate attention.`,
        ar: `تم رفع تنبيهك ${reference} إلى ${unitAr} ومنحه أولوية للاستجابة الفورية.`,
      };
    case "complaint":
      return {
        en: `Your complaint ${reference} has been received and routed to ${unitEn}.`,
        ar: `تم استلام شكواك ${reference} وتوجيهها إلى ${unitAr}.`,
      };
    case "suggestion":
      return {
        en: `Your suggestion ${reference} has been received and sent to ${unitEn} for review.`,
        ar: `تم استلام اقتراحك ${reference} وإرساله إلى ${unitAr} للمراجعة.`,
      };
    default:
      return {
        en: `Your request ${reference} has been logged with ${unitEn}.`,
        ar: `تم تسجيل طلبك ${reference} لدى ${unitAr}.`,
      };
  }
}

/** Classification preview without writing anything (used by the shortcut forms). */
export function previewInteraction(input: {
  title: string;
  description: string;
  shortcutHint?: InteractionType | null;
  urgencyHint?: "low" | "medium" | "high" | "critical" | null;
}) {
  return classifyInteraction(input);
}

/**
 * Mirror a suggestion into the case queue of the responsible service unit.
 * A suggestion always needs a human decision, so the case is created with
 * human review required and handed to the normal intake automation
 * (assignment, SLA, owner notification).
 */
async function createSuggestionCase(opts: {
  studentId: string;
  suggestionId: string;
  title: string;
  description: string;
  unitId: string | null;
  lang: "en" | "ar";
  channel: EntryChannel;
  conversationId: string | null;
  classification: InteractionClassification;
}): Promise<{ id: string; case_number: string } | null> {
  const c = opts.classification;
  const { data, error } = await supabaseAdmin
    .from("cases")
    .insert({
      case_number: "",
      student_id: opts.studentId,
      case_type: "suggestion" as never,
      service_unit_id: opts.unitId,
      title: opts.title,
      description: opts.description,
      status: "submitted",
      urgency: (c.priority === "critical" ? "high" : c.priority) as never,
      severity: c.severity,
      language: opts.lang as never,
      entry_channel: opts.channel,
      current_responsible_actor: "service_owner",
      automation_level: "human_review",
      human_review_required: true,
      attention_reason: "A student suggestion needs a decision from the service owner",
      linked_suggestion_id: opts.suggestionId,
      related_conversation_id: opts.conversationId,
      routing_service_code: c.serviceCode,
      routing_topic: c.topic,
      routing_reason_en: c.reasonEn,
      routing_reason_ar: c.reasonAr,
      routing_confidence: c.confidence,
      ai_confidence: c.confidence,
    })
    .select("id, case_number")
    .maybeSingle();

  if (error || !data) {
    console.error("[interactions] suggestion case creation failed", error);
    return null;
  }

  await supabaseAdmin.from("case_status_history").insert({
    case_id: data.id,
    to_status: "submitted",
    changed_by: opts.studentId,
    note: `Suggestion routed for review — ${c.reasonEn}`.slice(0, 500),
  });

  try {
    const { intakeCase } = await import("@/lib/automation/case-manager.server");
    await intakeCase(data.id);
  } catch (err) {
    console.error("[interactions] suggestion case intake failed", err);
  }
  return data;
}

export async function submitInteraction(input: SubmitInteractionInput): Promise<SubmitInteractionResult> {
  const title = input.title.trim().slice(0, 160);
  const description = input.description.trim().slice(0, 8000);

  const classification = classifyInteraction({
    title,
    description,
    shortcutHint: input.shortcutHint ?? null,
    urgencyHint: input.urgencyHint ?? null,
    sensitiveHint: input.sensitiveHint ?? null,
  });

  // An explicitly supplied unit (shortcut form selection or a verified
  // emergency-register unit) wins over content-based routing.
  const unitId = input.unitId ?? (await unitForService(classification.serviceCode, null));
  const { data: unitRow } = unitId
    ? await supabaseAdmin.from("service_units").select("name_en, name_ar").eq("id", unitId).maybeSingle()
    : { data: null };
  const unitEn = unitRow?.name_en ?? "Student Services";
  const unitAr = unitRow?.name_ar ?? "خدمات الطلبة";

  /* ---------------- suggestion branch ---------------- */
  if (classification.interactionType === "suggestion") {
    const { data: created, error } = await supabaseAdmin
      .from("suggestions")
      .insert({
        student_id: input.studentId,
        reference_number: "",
        title,
        description,
        expected_benefit: input.expectedBenefit?.trim() || null,
        service_unit_id: unitId,
        is_anonymous: Boolean(input.isAnonymous),
        language: input.lang,
        status: "submitted",
        entry_channel: input.channel,
        related_conversation_id: input.conversationId ?? null,
        routing_service_code: classification.serviceCode,
        routing_reason_en: classification.reasonEn,
        routing_reason_ar: classification.reasonAr,
        routing_confidence: classification.confidence,
      })
      .select("id, reference_number")
      .single();
    if (error) throw new Error(error.message);

    try {
      const ops = await import("@/lib/ops/suggestion-actions.server");
      await ops.intakeSuggestion(created.id);
    } catch (err) {
      console.error("[interactions] suggestion intake failed", err);
    }

    // A suggestion is a tracked interaction like any other: it gets a case in
    // the responsible unit so the Service Owner sees it under "Needs your
    // attention", can reply to the student inside the thread, and can close
    // the loop. The suggestion record keeps the improvement backlog.
    const companion = await createSuggestionCase({
      studentId: input.studentId,
      suggestionId: created.id,
      title,
      description,
      unitId,
      lang: input.lang,
      channel: input.channel,
      conversationId: input.conversationId ?? null,
      classification,
    });

    await auditInsert(supabaseAdmin, {
      actor_id: input.studentId,
      action: "interaction.suggestion.created",
      entity_type: "suggestion",
      entity_id: created.id,
      metadata: {
        reference: created.reference_number,
        case_id: companion?.id ?? null,
        channel: input.channel,
        classification: classification as never,
      } as never,
    });

    const text = ack("suggestion", created.reference_number, unitEn, unitAr);
    return {
      kind: "suggestion",
      id: created.id,
      reference: created.reference_number,
      interactionType: "suggestion",
      classification,
      trackingUrl: companion ? `/requests/${companion.id}` : "/requests",
      acknowledgementEn: text.en,
      acknowledgementAr: text.ar,
      emergencyContacts: [],
      linkedSuggestionId: created.id,
    };
  }

  /* ---------------- case branch (query / complaint / alert) ---------------- */
  const caseType = classification.interactionType;

  // A complaint reaches the officer as structured, actionable information:
  // what happened, where, when, how often, the impact and the action asked for.
  const structured =
    caseType === "complaint"
      ? structureComplaint({
          title,
          description,
          priority: classification.priority,
          incidentDate: input.incidentDate ?? null,
          desiredResolution: input.desiredResolution ?? null,
          location: input.location ?? null,
        })
      : null;

  const { data: created, error } = await supabaseAdmin
    .from("cases")
    .insert({
      case_number: "",
      student_id: input.studentId,
      case_type: caseType as never,
      category_id: input.categoryId ?? null,
      service_unit_id: unitId,
      title,
      description,
      status: "submitted",
      urgency: classification.priority as never,
      severity: classification.severity,
      language: input.lang as never,
      entry_channel: input.channel,
      shortcut_hint: input.shortcutHint ?? null,
      current_responsible_actor: "ai",
      automation_level: classification.automationLevel,
      alert_type: classification.alertType,
      alert_location: input.location?.slice(0, 200) ?? null,
      is_sensitive: classification.isSensitive,
      sensitivity_level: classification.isSensitive ? "restricted" : "normal",
      human_review_required: classification.humanAttentionRequired,
      attention_reason: classification.attentionReason,
      confidentiality: input.confidentiality ?? "standard",
      incident_date:
        input.incidentDate ||
        (/^\d{4}-\d{2}-\d{2}/.test(structured?.occurredAt ?? "") ? structured!.occurredAt!.slice(0, 10) : null),
      desired_resolution: input.desiredResolution?.trim() || structured?.requestedAction || null,
      structured_details: (structured as never) ?? null,
      ai_summary: structured ? complaintBrief(structured, "en") : null,
      related_conversation_id: input.conversationId ?? null,
      routing_service_code: classification.serviceCode,
      routing_topic: classification.topic,
      root_cause_code: classification.rootCauseCode,
      routing_reason_en: classification.reasonEn,
      routing_reason_ar: classification.reasonAr,
      routing_confidence: classification.confidence,
      ai_confidence: classification.confidence,
    })
    .select("id, case_number")
    .single();
  if (error) throw new Error(error.message);

  await supabaseAdmin.from("case_status_history").insert({
    case_id: created.id,
    to_status: "submitted",
    changed_by: input.studentId,
    note: classification.reasonEn,
  });

  // Classification → routing → assignment → SLA → acknowledgement.
  // Downstream automation (assignment, notifications, AI triage) runs after the
  // student already has a reference number; the scheduled sweep retries it if
  // this call is cut short.
  const automation = (async () => {
    try {
      const { intakeCase } = await import("@/lib/automation/case-manager.server");
      await intakeCase(created.id);
    } catch (err) {
      console.error("[interactions] case intake failed", err);
    }
  })();
  if (caseType === "alert") await automation;
  else void automation;

  // Alerts never wait in a normal queue: high and critical severities escalate
  // immediately along the configured path for the responsible unit.
  if (caseType === "alert" && (classification.severity === "high" || classification.severity === "critical")) {
    try {
      const { escalateCase } = await import("@/lib/ops/routing.server");
      await escalateCase({
        caseId: created.id,
        reason: `Alert severity ${classification.severity}: ${classification.alertType ?? "unclassified"}`,
        triggerType: "alert_severity",
      });
    } catch (err) {
      console.error("[interactions] alert escalation failed", err);
    }
    await supabaseAdmin
      .from("cases")
      .update({ escalated_at: new Date().toISOString(), current_responsible_actor: "service_owner" })
      .eq("id", created.id);
  }

  // A complaint that also contains an improvement idea should not force the
  // student to submit twice — we link a secondary suggestion instead.
  let linkedSuggestionId: string | null = null;
  if (classification.secondarySuggestion && caseType === "complaint") {
    const { data: sugg } = await supabaseAdmin
      .from("suggestions")
      .insert({
        student_id: input.studentId,
        reference_number: "",
        title: title.slice(0, 140),
        description,
        service_unit_id: unitId,
        language: input.lang,
        status: "submitted",
        entry_channel: input.channel,
        related_conversation_id: input.conversationId ?? null,
        routing_service_code: classification.serviceCode,
        routing_reason_en: `Derived from complaint ${created.case_number}: ${classification.reasonEn}`,
        routing_reason_ar: classification.reasonAr,
        routing_confidence: classification.confidence,
      })
      .select("id")
      .maybeSingle();
    if (sugg?.id) {
      linkedSuggestionId = sugg.id;
      await supabaseAdmin.from("cases").update({ linked_suggestion_id: sugg.id }).eq("id", created.id);
      try {
        const ops = await import("@/lib/ops/suggestion-actions.server");
        await ops.intakeSuggestion(sugg.id);
      } catch {
        /* retried by the scheduled sweep */
      }
    }
  }

  // The staff member who picks this up must never have to ask the student to
  // repeat anything: build the handover package as soon as the case exists.
  {
    const { buildHandoverSafely } = await import("@/lib/ops/handover.server");
    await buildHandoverSafely(created.id);
  }

  await auditInsert(supabaseAdmin, {
    actor_id: input.studentId,
    action: `interaction.${caseType}.created`,
    entity_type: "case",
    entity_id: created.id,
    metadata: {
      case_number: created.case_number,
      channel: input.channel,
      classification: classification as never,
    } as never,
  });

  const text = ack(caseType, created.case_number, unitEn, unitAr);
  return {
    kind: "case",
    id: created.id,
    reference: created.case_number,
    interactionType: caseType,
    classification,
    trackingUrl: `/requests/${created.id}`,
    acknowledgementEn: text.en,
    acknowledgementAr: text.ar,
    emergencyContacts: classification.isEmergency ? await loadEmergencyContacts(input.lang) : [],
    linkedSuggestionId,
    clarifyingQuestionEn: structured?.missingQuestionEn ?? null,
    clarifyingQuestionAr: structured?.missingQuestionAr ?? null,
  };
}

/**
 * Query → Complaint conversion. Keeps the original case and its history rather
 * than making the student re-enter everything.
 */
export async function escalateQueryToComplaint(opts: {
  caseId: string;
  studentId: string;
  reason: string;
}): Promise<{ ok: boolean; reference?: string }> {
  const { data: c } = await supabaseAdmin
    .from("cases")
    .select("id, case_number, student_id, case_type, title, description")
    .eq("id", opts.caseId)
    .maybeSingle();
  if (!c || c.student_id !== opts.studentId) return { ok: false };
  if (c.case_type === "complaint") return { ok: true, reference: c.case_number };

  const classification = classifyInteraction({
    title: c.title,
    description: `${c.description ?? ""}\n${opts.reason}`,
    shortcutHint: "complaint",
  });

  await supabaseAdmin
    .from("cases")
    .update({
      case_type: "complaint" as never,
      urgency: classification.priority as never,
      severity: classification.severity,
      current_responsible_actor: "ai",
      status: "submitted",
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", c.id);

  await supabaseAdmin.from("case_status_history").insert({
    case_id: c.id,
    to_status: "submitted",
    changed_by: opts.studentId,
    note: `Converted from query to complaint: ${opts.reason}`.slice(0, 500),
  });

  try {
    const { routeCase } = await import("@/lib/ops/routing.server");
    await routeCase(c.id);
  } catch (err) {
    console.error("[interactions] re-route after conversion failed", err);
  }

  return { ok: true, reference: c.case_number };
}

/** Track who the clock is currently waiting on — used for fair SLA measurement. */
export async function setResponsibleActor(
  caseId: string,
  actor: "ai" | "student" | "service_owner" | "external_party" | "system",
  opts?: { pauseSla?: boolean },
): Promise<void> {
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("cases")
    .update({
      current_responsible_actor: actor,
      last_activity_at: now,
      ...(opts?.pauseSla != null
        ? { sla_paused_at: opts.pauseSla ? now : null, ...(opts.pauseSla ? { sla_state: "paused" } : {}) }
        : {}),
    })
    .eq("id", caseId);
}
