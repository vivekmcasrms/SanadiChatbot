import { useEffect, useState } from "react";
import { toastError } from "@/lib/errors/toast";
import { toast } from "sonner";
import { ShieldAlert, Undo2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import type { ActionReceipt, IssuedDocumentCard, ProposedAction } from "@/lib/agent-types";
import { executeConfirmedAction } from "@/lib/agents.functions";
import { recordApprovalDecisionFn } from "@/lib/approvals.functions";

const RISK_LABEL: Record<string, { en: string; ar: string }> = {
  level_0: { en: "Level 0 — read only", ar: "المستوى 0 — قراءة فقط" },
  level_1: { en: "Level 1 — low impact", ar: "المستوى 1 — أثر محدود" },
  level_2: { en: "Level 2 — creates an official record", ar: "المستوى 2 — ينشئ سجلاً رسمياً" },
  level_3: { en: "Level 3 — needs staff approval", ar: "المستوى 3 — يتطلب موافقة موظف" },
};

const REVERSIBLE_LABEL: Record<string, { en: string; ar: string }> = {
  yes: { en: "Yes — you can undo this yourself", ar: "نعم — يمكنك التراجع بنفسك" },
  conditional: { en: "Partly — you can withdraw it later", ar: "جزئياً — يمكنك سحبه لاحقاً" },
  no: { en: "No — this cannot be undone once done", ar: "لا — لا يمكن التراجع بعد التنفيذ" },
};

export function ActionConfirmDialog({
  action,
  open,
  conversationId,
  messageId,
  onOpenChange,
  onBusyChange,
  onConfirmed,
  language,
}: {
  action: ProposedAction | null;
  open: boolean;
  conversationId?: string | null;
  /** Chat message this action button belongs to — anchors duplicate protection. */
  messageId?: string | null;
  onBusyChange?: (busy: boolean) => void;
  /** Voice turns can use a different language from the surrounding UI. */
  language?: "en" | "ar";
  onOpenChange: (open: boolean) => void;
  onConfirmed?: (
    action: ProposedAction,
    result: {
      receipt: ActionReceipt | null;
      message: string;
      document?: IssuedDocumentCard | null;
    },
  ) => void;
}) {
  const { t, lang: uiLanguage } = useI18n();
  const lang = language ?? uiLanguage;
  const ar = lang === "ar";
  const [busy, setBusy] = useState(false);
  // When live state changed and Sanadi found a safe alternative, the dialog
  // switches to that alternative instead of dropping the student's progress.
  const [replacement, setReplacement] = useState<ProposedAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const current = replacement ?? action;
  const [requestSubject, setRequestSubject] = useState("");
  const [requestBody, setRequestBody] = useState("");
  const actionName = (current?.toolName ?? current?.key ?? "").toLowerCase();
  const hasRequestDraft = Boolean(
    current &&
      (["create_complaint", "create_enquiry", "create_suggestion", "report_alert"].includes(actionName) ||
        current.args?.["smartConcern"] === true),
  );
  const label = current ? (ar ? current.labelAr : current.labelEn) : "";
  const unit = current?.responsibleUnit ?? current?.affectedService ?? "";
  const fee = current?.fee ?? (ar ? "بدون رسوم" : "No fee");

  useEffect(() => {
    setRequestSubject(String(current?.args?.["title"] ?? ""));
    setRequestBody(String(current?.args?.["description"] ?? ""));
  }, [current?.key, current?.args?.["title"], current?.args?.["description"]]);

  /** One auditable record per decision — never a reusable blanket consent. */
  function approvalRecord(a: ProposedAction, status: "approved" | "declined") {
    return {
      data: {
        actionKey: a.toolName ?? a.key,
        status,
        affectedService: a.affectedService,
        dataShared: a.dataShared,
        expectedOutcome: a.expectedOutcome,
        responsibleUnit: a.responsibleUnit ?? a.affectedService,
        fee: a.fee ?? (ar ? "بدون رسوم" : "No fee"),
        reversible: a.reversible ?? null,
        riskLevel: a.risk,
        dataScope: Object.keys(a.args ?? {}),
        language: lang,
      },
    } as const;
  }

  function reset(nextOpen: boolean) {
    if (!nextOpen) {
      setReplacement(null);
      setNotice(null);
    }
    onOpenChange(nextOpen);
  }

  function cancel() {
    // A declined approval is part of the audit trail too.
    if (current) void recordApprovalDecisionFn(approvalRecord(current, "declined")).catch(() => {});
    reset(false);
  }

  async function handleConfirm() {
    if (!current || busy) return;
    setBusy(true);
    onBusyChange?.(true);
    let approvalId: string | null = null;
    try {
      approvalId = await recordApprovalDecisionFn(approvalRecord(current, "approved"))
        .then((r) => r.id)
        .catch(() => null);
      const result = await executeConfirmedAction({
        data: {
          toolName: current.toolName ?? current.key,
          args: (hasRequestDraft
            ? { ...current.args, title: requestSubject.trim(), description: requestBody.trim() }
            : current.args ?? {}) as Record<string, unknown>,
          conversationId: conversationId ?? null,
          lang,
          messageId: messageId ?? null,
          actionKey: current.key,
        },
      });
      const alternative = result.recovery?.proposedAction ?? null;
      if (alternative) {
        setReplacement(alternative);
        setNotice(result.message);
        toast.info(result.message);
        return;
      }
      if (approvalId) {
        void recordApprovalDecisionFn({
          data: {
            ...approvalRecord(current, "approved").data,
            approvalId,
            status: result.receipt ? "completed" : "approved",
            receiptNumber: result.receipt?.referenceNumber ?? result.receipt?.receiptNumber ?? null,
          },
        }).catch(() => {});
      }
      if (!result.receipt && result.recovery) {
        toast.info(result.message);
        reset(false);
        onConfirmed?.(current, result);
        return;
      }
      toast.success(
        result.receipt
          ? `${t("action_recorded")} ${t("receipt")}: ${result.receipt.referenceNumber ?? result.receipt.receiptNumber}`
          : result.message,
      );
      reset(false);
      onConfirmed?.(current, result);
    } catch (error) {
      if (approvalId && current) {
        void recordApprovalDecisionFn({
          data: { ...approvalRecord(current, "approved").data, approvalId, status: "failed" },
        }).catch(() => {});
      }
      toastError(error, lang);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return (
      <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : reset(false))}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          {/* The heading names the exact action — never a generic "Confirm?" */}
          <DialogTitle>{ar ? `الموافقة على: ${label}` : `Approve: ${label}`}</DialogTitle>
          <DialogDescription>
            {ar
              ? "راجع التفاصيل أدناه. لن يتم تنفيذ أي شيء قبل موافقتك."
              : "Review the details below. Nothing happens until you approve."}
          </DialogDescription>
        </DialogHeader>
        {notice ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">{notice}</p>
        ) : null}
        {current ? (
          <dl className="space-y-3 rounded-lg border bg-surface p-4 text-sm">
            <div>
              <dt className="text-muted-foreground">{ar ? "الإجراء" : "Action"}</dt>
              <dd className="font-medium">{label}</dd>
            </div>
            {hasRequestDraft ? (
              <>
                <div>
                  <dt className="mb-1 text-muted-foreground">{ar ? "موضوع الطلب" : "Request subject"}</dt>
                  <Textarea
                    value={requestSubject}
                    onChange={(event) => setRequestSubject(event.target.value)}
                    maxLength={160}
                    rows={2}
                    aria-label={ar ? "موضوع الطلب" : "Request subject"}
                  />
                </div>
                <div>
                  <dt className="mb-1 text-muted-foreground">{ar ? "نص الطلب" : "Request body"}</dt>
                  <Textarea
                    value={requestBody}
                    onChange={(event) => setRequestBody(event.target.value)}
                    maxLength={8000}
                    rows={2}
                    aria-label={ar ? "نص الطلب" : "Request body"}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {ar
                      ? "راجع الصياغة وعدّلها قبل الموافقة والإرسال."
                      : "Review or edit these details. The request is submitted only after you approve."}
                  </p>
                </div>
              </>
            ) : null}
            <div>
              <dt className="text-muted-foreground">{ar ? "البيانات المستخدمة" : "Data used"}</dt>
              <dd className="font-medium">{current.dataShared}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{ar ? "الوحدة المسؤولة" : "Responsible unit"}</dt>
              <dd className="font-medium">{unit}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{ar ? "النتيجة المتوقعة" : "Expected result"}</dt>
              <dd className="font-medium">{current.expectedOutcome}</dd>
            </div>
            {current.consequence ? (
              <div>
                <dt className="text-muted-foreground">{ar ? "ما الذي سيحدث" : "What this means"}</dt>
                <dd className="font-medium">{current.consequence}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted-foreground">{ar ? "الرسوم" : "Cost"}</dt>
              <dd className="font-medium">{fee}</dd>
            </div>
            {current.reversible ? (
              <div>
                <dt className="text-muted-foreground">{ar ? "هل يمكن التراجع؟" : "Can this be reversed?"}</dt>
                <dd className="flex items-center gap-1.5 font-medium">
                  <Undo2 className="size-3.5 text-primary" aria-hidden />
                  {REVERSIBLE_LABEL[current.reversible]?.[lang]}
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted-foreground">{t("risk_level")}</dt>
              <dd className="flex items-center gap-1.5 font-medium">
                <ShieldAlert className="size-3.5 text-warning" aria-hidden />
                {RISK_LABEL[current.risk]?.[lang] ?? current.risk}
              </dd>
            </div>
          </dl>
        ) : null}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={cancel} disabled={busy}>
            {t("cancel")}
          </Button>

          <Button
            onClick={handleConfirm}
            disabled={busy || (hasRequestDraft && (!requestSubject.trim() || !requestBody.trim()))}
          >
            {busy
              ? (ar ? "جارٍ الإرسال…" : "Submitting…")
              : hasRequestDraft
                ? ar ? "موافقة وإرسال" : "Approve and submit"
                : ar ? "موافقة" : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
