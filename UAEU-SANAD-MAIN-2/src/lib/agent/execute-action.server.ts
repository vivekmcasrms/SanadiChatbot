/**
 * Shared execution path for a student-confirmed action.
 * Used both by the explicit confirmation button (executeConfirmedAction)
 * and by the orchestrator when the student types "confirm" in chat.
 */
import type { ActionReceipt, ChatAttachment, IssuedDocumentCard, ProposedAction } from "../agent-types";
import { toIssuedDocumentCard } from "../documents/issued-card";
import { runOnce } from "../quality/idempotency.server";
import { actionCompletionKey, isOneTimeAction } from "./one-time-actions";
import { attachToCase } from "./attachments.server";
import { authorizeTool, loadGovernance, toolByName, type Db } from "./tools.server";
import type { RecoveryClassification } from "./recovery.server";
import type { PreflightResult } from "./preflight.server";

export type PerformActionInput = {
  db: Db;
  userId: string;
  roles: string[];
  toolName: string;
  args: Record<string, unknown>;
  conversationId: string | null;
  lang: "en" | "ar";
  /** Files the student shared in chat; copied onto the created case as evidence. */
  attachments?: ChatAttachment[];
  /** When false the caller is responsible for writing the assistant message. */
  insertMessage?: boolean;
  /** Timestamp of the prefetched context the plan was based on. */
  snapshotAt?: string | null;
  /** Correlation id shared with the turn's telemetry. */
  traceId?: string | null;
  /** Chat message the action button belongs to — anchors duplicate protection. */
  messageId?: string | null;
  /** Identity of the specific action button inside that message. */
  actionKey?: string | null;
};

export type PerformActionResult = {
  receipt: ActionReceipt | null;
  message: string;
  /** The exact issued document, when this action produced one. */
  document?: IssuedDocumentCard | null;
  /** Present when live state moved and Sanadi recovered instead of writing. */
  recovery?: {
    classification: RecoveryClassification;
    proposedAction: ProposedAction | null;
  } | null;
};

/** Writes the detailed revalidation audit record. Never throws. */
async function recordRevalidation(
  db: Db,
  input: PerformActionInput,
  preflight: PreflightResult,
  outcome: {
    result: "passed" | "blocked";
    classification?: RecoveryClassification | null;
    recoveryAction?: unknown;
    confirmationRequired?: boolean;
    transactionResult: string;
  },
) {
  const firstFailed = preflight.checks.find((c) => !c.passed);
  try {
    await db.from("action_revalidation_events").insert({
      trace_id: input.traceId ?? null,
      action_code: input.toolName,
      student_id: input.userId,
      actor_id: input.userId,
      service_code: preflight.policy?.serviceCode ?? null,
      snapshot_at: input.snapshotAt ?? null,
      executed_at: preflight.checkedAt,
      checks: preflight.checks as never,
      authoritative_source:
        firstFailed?.source ??
        preflight.checks
          .map((c) => c.source)
          .filter(Boolean)
          .join(", "),
      original_value: (firstFailed ? { value: firstFailed.original ?? null } : null) as never,
      live_value: (firstFailed ? { value: firstFailed.live ?? null } : null) as never,
      changed: Boolean(firstFailed),
      revalidation_result: outcome.result === "passed" ? "passed" : (preflight.code ?? "blocked"),
      recovery_classification: outcome.classification ?? null,
      recovery_action: (outcome.recoveryAction ?? null) as never,
      student_confirmation_required: Boolean(outcome.confirmationRequired),
      transaction_result: outcome.transactionResult,
      duration_ms: preflight.durationMs,
    });
  } catch {
    /* telemetry must never block an execution decision */
  }
}

export async function performConfirmedAction(
  input: PerformActionInput,
): Promise<PerformActionResult> {
  const { db, userId, lang } = input;
  const roles = input.roles.length ? input.roles : ["student"];
  const tool = toolByName(input.toolName);
  if (!tool) throw new Error("Unknown action.");

  const governance = await loadGovernance(db);
  const gov = governance.get(tool.name);
  const auth = authorizeTool(tool, gov, roles);
  if (!auth.allowed) throw new Error("You are not permitted to perform this action.");

  const risk = gov?.risk ?? tool.risk;
  const humanApproval = gov?.humanApprovalRequired ?? tool.humanApprovalRequired;

  // Permanent duplicate protection for one-time actions: the same button in
  // the same chat message can only ever produce one record, no matter how many
  // clicks, refreshes, retries or tabs it is pressed from.
  const oneTime = isOneTimeAction(tool.name);
  const completionKey = oneTime
    ? actionCompletionKey({
        studentId: userId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        actionKey: input.actionKey ?? tool.name,
        toolName: tool.name,
      })
    : null;

  if (completionKey) {
    const { data: done } = await db
      .from("chat_action_completions")
      .select("reference_number, result_message, receipt")
      .eq("idempotency_key", completionKey)
      .maybeSingle();
    if (done) {
      return {
        receipt: (done.receipt ?? null) as ActionReceipt | null,
        message:
          lang === "ar"
            ? `تم تقديم هذا الطلب مسبقاً${done.reference_number ? ` بالرقم المرجعي ${done.reference_number}` : ""}، ولم يتم تكراره.`
            : `This was already submitted${done.reference_number ? ` as ${done.reference_number}` : ""}, so it was not created again.`,
      };
    }
  }

  let createdRequestId: string | null = null;
  const outcome = await runOnce<PerformActionResult>(
    db,
    {
      operationType: `action:${tool.name}`,
      userId,
      payload: input.args,
      entityType: "action_request",
      windowMinutes: 10,
    },
    async () => {
      const snapshot = await (async (): Promise<PerformActionResult> => {
        const { data: requestRow } = await db
          .from("action_requests")
          .insert({
            student_id: userId,
            conversation_id: input.conversationId,
            action_type: tool.name,
            risk_level: risk,
            proposed_payload: input.args as never,
            student_confirmation_required: true,
            student_confirmed_at: new Date().toISOString(),
            human_approval_required: humanApproval || risk === "level_3",
            execution_status:
              humanApproval || risk === "level_3" ? "awaiting_approval" : "executing",
          })
          .select("id")
          .single();
        createdRequestId = requestRow?.id ?? null;

        if (humanApproval || risk === "level_3") {
          await db.from("audit_logs").insert({
            actor_id: userId,
            action: "action.awaiting_approval",
            entity_type: "action_request",
            entity_id: requestRow?.id ?? null,
            metadata: { tool: tool.name, risk },
          });
          return {
            receipt: null,
            message:
              lang === "ar"
                ? "تم تسجيل طلبك وهو بانتظار موافقة موظف مختص قبل التنفيذ."
                : "Your request has been recorded and is awaiting staff approval before it is carried out.",
          };
        }

        // Real-time revalidation: the prefetched turn context is a snapshot, so
        // the conditions this specific action depends on — and only those — are
        // re-read from the database immediately before the write.
        if (!tool.readOnly) {
          const { revalidateBeforeExecution } = await import("./preflight.server");
          const preflight = await revalidateBeforeExecution({
            db,
            userId,
            toolName: tool.name,
            args: input.args,
            lang,
          });
          await db.from("audit_logs").insert({
            actor_id: userId,
            action: preflight.ok ? "action.revalidated" : "action.revalidation_failed",
            entity_type: "action_request",
            entity_id: requestRow?.id ?? null,
            metadata: {
              tool: tool.name,
              code: preflight.code,
              checks: preflight.checks,
              checkedAt: preflight.checkedAt,
              durationMs: preflight.durationMs,
            } as never,
          });
          if (!preflight.ok) {
            const { recoverFromLiveChange } = await import("./recovery.server");
            const recovery = await recoverFromLiveChange({
              db,
              userId,
              lang,
              toolName: tool.name,
              args: input.args,
              preflight,
            });
            await db
              .from("action_requests")
              .update({
                execution_status: "failed",
                execution_result: {
                  revalidation: preflight.code,
                  recovery: recovery.classification,
                } as never,
              })
              .eq("id", requestRow?.id ?? "");
            await recordRevalidation(db, input, preflight, {
              result: "blocked",
              classification: recovery.classification,
              recoveryAction: recovery.proposedAction ?? recovery.detail,
              confirmationRequired: recovery.classification === "STUDENT_CONFIRMATION_REQUIRED",
              transactionResult: "not_started",
            });
            if (input.conversationId && input.insertMessage !== false) {
              await db.from("messages").insert({
                conversation_id: input.conversationId,
                user_id: userId,
                role: "assistant",
                content: recovery.message,
                language: lang,
                metadata: {
                  revalidation: preflight.code,
                  recovery: recovery.classification,
                } as never,
              });
            }
            return {
              receipt: null,
              message: recovery.message,
              recovery: {
                classification: recovery.classification,
                proposedAction: recovery.proposedAction,
              },
            };
          }
          await recordRevalidation(db, input, preflight, {
            result: "passed",
            transactionResult: "committed",
          });
        }

        const started = Date.now();
        const result = await tool.run(
          { db, userId, lang, roles, conversationId: input.conversationId },
          input.args,
        );

        await db.from("agent_tool_executions").insert({
          conversation_id: input.conversationId,
          tool_id: gov?.toolId ?? null,
          tool_name: tool.name,
          requested_by_profile_id: userId,
          input_payload: input.args as never,
          output_payload: (result.ok ? result.data : { error: result.error }) as never,
          execution_status: result.ok ? "succeeded" : "failed",
          authorization_result: "allowed",
          confirmation_status: "confirmed",
          approval_status: "not_required",
          risk_level: risk,
          duration_ms: Date.now() - started,
          completed_at: new Date().toISOString(),
          error_message: result.error ?? null,
        });

        if (!result.ok) {
          await db
            .from("action_requests")
            .update({
              execution_status: "failed",
              execution_result: { error: result.error } as never,
            })
            .eq("id", requestRow?.id ?? "");

          // The transaction itself may have lost a race for the last seat, bed
          // or slot even though the pre-checks passed a moment earlier. Treat
          // that exactly like a live-state change and try to recover.
          const raceCode = raceCodeFor(tool.name, result.error ?? "");
          if (raceCode) {
            const [{ recoverFromLiveChange }, { loadRevalidationPolicy }] = await Promise.all([
              import("./recovery.server"),
              import("./revalidation-policy.server"),
            ]);
            const policy = await loadRevalidationPolicy(db, tool.name);
            const preflight = {
              ok: false,
              code: raceCode,
              message: raceMessage(raceCode, lang),
              checks: [
                {
                  name: "transaction_outcome",
                  passed: false,
                  source: "database transaction",
                  original: "available",
                  live: "taken",
                  changed: true,
                },
              ],
              checkedAt: new Date().toISOString(),
              policy,
              durationMs: 0,
            } satisfies PreflightResult;
            const recovery = await recoverFromLiveChange({
              db,
              userId,
              lang,
              toolName: tool.name,
              args: input.args,
              preflight,
            });
            await recordRevalidation(db, input, preflight, {
              result: "blocked",
              classification: recovery.classification,
              recoveryAction: recovery.proposedAction ?? recovery.detail,
              confirmationRequired: recovery.classification === "STUDENT_CONFIRMATION_REQUIRED",
              transactionResult: "rolled_back",
            });
            if (input.conversationId && input.insertMessage !== false) {
              await db.from("messages").insert({
                conversation_id: input.conversationId,
                user_id: userId,
                role: "assistant",
                content: recovery.message,
                language: lang,
                metadata: { revalidation: raceCode, recovery: recovery.classification } as never,
              });
            }
            return {
              receipt: null,
              message: recovery.message,
              recovery: {
                classification: recovery.classification,
                proposedAction: recovery.proposedAction,
              },
            };
          }
          throw new Error(result.error ?? "The action could not be completed.");
        }

        const ref = result.reference;
        const receiptNumber = `RCPT-${Date.now().toString(36).toUpperCase()}`;
        const submittedAt = new Date().toISOString();
        const firstResponse = ref?.expectedFirstResponseHours
          ? new Date(Date.now() + ref.expectedFirstResponseHours * 3600_000).toISOString()
          : null;
        const resolution = ref?.expectedResolutionDays
          ? new Date(Date.now() + ref.expectedResolutionDays * 86_400_000).toISOString()
          : null;

        await db.from("action_receipts").insert({
          receipt_number: receiptNumber,
          student_id: userId,
          action_request_id: requestRow?.id ?? null,
          case_id: ref?.caseId ?? null,
          suggestion_id: ref?.suggestionId ?? null,
          appointment_id: ref?.appointmentId ?? null,
          reference_number: ref?.referenceNumber ?? null,
          action_type: tool.name,
          responsible_unit_id: ref?.unitId ?? null,
          responsible_unit_name: ref?.unitName ?? null,
          submitted_at: submittedAt,
          expected_first_response_at: firstResponse,
          expected_resolution_at: resolution,
          current_status: "submitted",
          next_step_en: ref?.nextStepEn ?? null,
          next_step_ar: ref?.nextStepAr ?? null,
          tracking_url: ref?.trackingUrl ?? null,
          language: lang,
          payload: input.args as never,
        });

        await db
          .from("action_requests")
          .update({
            execution_status: "completed",
            execution_result: (result.data ?? {}) as never,
            executed_at: submittedAt,
            receipt_number: receiptNumber,
          })
          .eq("id", requestRow?.id ?? "");

        await db.from("audit_logs").insert({
          actor_id: userId,
          action: "action.executed",
          entity_type: "action_request",
          entity_id: requestRow?.id ?? null,
          metadata: {
            tool: tool.name,
            risk,
            receipt: receiptNumber,
            reference: ref?.referenceNumber ?? null,
          },
        });

        let attached = 0;
        if (ref?.caseId && input.attachments?.length) {
          attached = await attachToCase(db, ref.caseId, userId, input.attachments, lang);
        }

        let message =
          lang === "ar"
            ? `تم التنفيذ. الرقم المرجعي ${ref?.referenceNumber ?? receiptNumber}${ref?.unitName ? ` لدى ${ref.unitName}` : ""}. ${ref?.nextStepAr ?? ""}`
            : `Done. Your reference number is ${ref?.referenceNumber ?? receiptNumber}${ref?.unitName ? ` with ${ref.unitName}` : ""}. ${ref?.nextStepEn ?? ""}`;
        if (attached > 0) {
          message +=
            lang === "ar"
              ? ` تم إرفاق ${attached} مستند بالحالة وإشعار الجهة المختصة لمراجعته.`
              : ` ${attached} document${attached > 1 ? "s were" : " was"} attached to the case and the responsible unit has been notified to review it.`;
        }

        if (input.conversationId && input.insertMessage !== false) {
          await db.from("messages").insert({
            conversation_id: input.conversationId,
            user_id: userId,
            role: "assistant",
            content: message,
            language: lang,
            metadata: {
              receiptNumber,
              reference: ref?.referenceNumber ?? null,
              actionType: tool.name,
            } as never,
          });
        }

        return {
          receipt: {
            receiptNumber,
            referenceNumber: ref?.referenceNumber ?? null,
            actionType: tool.name,
            responsibleUnit: ref?.unitName ?? null,
            submittedAt,
            expectedFirstResponseAt: firstResponse,
            expectedResolutionAt: resolution,
            nextStep: (lang === "ar" ? ref?.nextStepAr : ref?.nextStepEn) ?? null,
            trackingUrl: ref?.trackingUrl ?? null,
          },
          message,
          document: toIssuedDocumentCard(result.data),
        };
      })();
      return { entityId: createdRequestId, snapshot };
    },
  );

  // Only a confirmed success becomes immutable; a failure leaves the button
  // available so the student can retry.
  if (completionKey && outcome.snapshot?.receipt) {
    await db
      .from("chat_action_completions")
      .insert({
        student_id: userId,
        conversation_id: input.conversationId,
        message_id: input.messageId ?? null,
        action_key: input.actionKey ?? tool.name,
        action_type: tool.name,
        reference_number:
          outcome.snapshot.receipt.referenceNumber ?? outcome.snapshot.receipt.receiptNumber,
        result_message: outcome.snapshot.message,
        receipt: outcome.snapshot.receipt as never,
        idempotency_key: completionKey,
      })
      // A concurrent click that got here first already wrote the row.
      .then(undefined, () => undefined);
  }

  if (outcome.replayed && outcome.snapshot) {
    return {
      receipt: outcome.snapshot.receipt,
      message:
        lang === "ar"
          ? `${outcome.snapshot.message} (تم استلام هذا الطلب مسبقاً ولم يتم تكراره.)`
          : `${outcome.snapshot.message} (This request was already received; it was not submitted twice.)`,
    };
  }
  return outcome.snapshot ?? { receipt: null, message: "" };
}

/**
 * Maps a losing-transaction error onto the same live-state change codes the
 * pre-checks use, so the student gets a recovery instead of a raw failure.
 */
function raceCodeFor(toolName: string, error: string): string | null {
  const e = error.toUpperCase();
  if (
    /SEATS_FULL|NO LONGER OPEN|OPPORTUNITY_CLOSED/.test(e) ||
    (toolName === "confirm_internship_assignment" && /SEAT/.test(e))
  )
    return "seat_unavailable";
  if (/BED_UNAVAILABLE|HOSTEL_UNAVAILABLE|AVAILABLE BED/.test(e)) return "bed_unavailable";
  if (
    /SLOT_UNAVAILABLE|SLOT_NOT_FOUND|NO LONGER AVAILABLE/.test(e) &&
    toolName === "book_appointment"
  )
    return "slot_unavailable";
  if (/NO_AVAILABLE_SEATS/.test(e)) return "transfer_capacity_full";
  if (/DUPLICATE_ASSIGNMENT|ALREADY HOLD|DUPLICATE_ALLOCATION/.test(e))
    return "existing_assignment";
  if (/DUPLICATE_APPOINTMENT|CONFLICTING_APPOINTMENT/.test(e)) return "duplicate_appointment";
  return null;
}

function raceMessage(code: string, lang: "en" | "ar"): string {
  const map: Record<string, { en: string; ar: string }> = {
    seat_unavailable: {
      en: "Your selected internship placement has just filled.",
      ar: "امتلأ التدريب الذي اخترته للتو.",
    },
    bed_unavailable: {
      en: "That room was taken a moment ago.",
      ar: "تم حجز هذه الغرفة قبل لحظات.",
    },
    slot_unavailable: { en: "That appointment was just taken.", ar: "تم حجز هذا الموعد للتو." },
    transfer_capacity_full: {
      en: "The transfer seats for that programme have just been filled.",
      ar: "امتلأت مقاعد التحويل لهذا البرنامج للتو.",
    },
    existing_assignment: {
      en: "A placement is already recorded for you, so nothing was created twice.",
      ar: "لديك تخصيص مسجّل بالفعل، لذلك لم يتم إنشاء أي تكرار.",
    },
    duplicate_appointment: {
      en: "You are already booked into that appointment.",
      ar: "لديك حجز في هذا الموعد بالفعل.",
    },
  };
  const entry = map[code];
  return entry
    ? entry[lang]
    : lang === "ar"
      ? "تغيّرت المعلومات للتو."
      : "The information changed just now.";
}

const CONFIRM_RE =
  /^(?:yes|yep|yeah|ok(?:ay)?|sure|confirm(?:ed|ing)?|i confirm|please (?:do|proceed|submit|confirm)|go ahead|proceed|do it|submit(?: it)?|approved?|agreed?|نعم|أجل|اي نعم|موافق(?:ة)?|أوافق|اوافق|أكد|اكد|تأكيد|تاكيد|تفضل|نفذ|استمر|ارسل|أرسل|قدمه|قدم الطلب)[\s.!،؛]*$/i;

const DECLINE_RE =
  /^(?:no|nope|cancel|stop|don'?t|do not|never ?mind|not now|لا|كلا|إلغاء|الغاء|توقف|ليس الآن|لا شكرا|لا شكراً)[\s.!،؛]*$/i;

/** Does this short reply confirm the pending action? */
export function isConfirmationReply(text: string): boolean {
  return CONFIRM_RE.test(text.trim());
}

/** Does this short reply decline the pending action? */
export function isDeclineReply(text: string): boolean {
  return DECLINE_RE.test(text.trim());
}
