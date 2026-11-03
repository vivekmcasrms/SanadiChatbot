/**
 * Routing Improvements — the governed adaptive routing layer, in plain view.
 *
 * Every learned rule shows the wording it reacts to, the context it needs, the
 * route it replaces, how much evidence stands behind it, how it performed on
 * history and in shadow mode, and who allowed it to go live. Nothing about
 * policy, eligibility, permissions, money or service levels is ever learned.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MetricCard } from "@/components/MetricCard";
import { toastError } from "@/lib/errors/toast";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import {
  decideRoutingRuleFn,
  getRoutingImprovementsFn,
  runRoutingLearningFn,
} from "@/lib/learning/learning.functions";

type Rule = Record<string, any>;

const STATUS_LABEL: Record<string, { en: string; ar: string }> = {
  PROPOSED: { en: "Proposed", ar: "مقترحة" },
  SHADOW: { en: "Shadow testing", ar: "اختبار صامت" },
  VALIDATING: { en: "Validating", ar: "قيد التحقق" },
  VALIDATED: { en: "Validated", ar: "تم التحقق" },
  APPROVED: { en: "Approved", ar: "معتمدة" },
  ACTIVE: { en: "Live", ar: "مفعّلة" },
  PAUSED: { en: "Paused", ar: "موقوفة" },
  REJECTED: { en: "Rejected", ar: "مرفوضة" },
  ROLLED_BACK: { en: "Rolled back", ar: "تم التراجع" },
};

function pct(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `${Math.round(n * 100)}%` : "—";
}

export function RoutingImprovements() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { session, loading } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftPhrases, setDraftPhrases] = useState("");
  const [reason, setReason] = useState("");

  const query = useQuery({
    queryKey: ["routing-improvements", session?.user.id],
    enabled: Boolean(session?.user.id) && !loading,
    retry: false,
    queryFn: () => getRoutingImprovementsFn({ data: undefined as never }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["routing-improvements"] });
    void queryClient.invalidateQueries({ queryKey: ["learning-center"] });
  };

  const decide = useMutation({
    mutationFn: (vars: {
      ruleId: string;
      action: "ACTIVATE" | "APPROVE" | "SHADOW" | "PAUSE" | "ROLLBACK" | "REJECT" | "EDIT";
      reason?: string;
      edits?: { ruleName?: string; triggerPhrases?: string[] };
    }) => decideRoutingRuleFn({ data: vars }),
    onSuccess: () => {
      toast.success(ar ? "تم تسجيل القرار" : "Decision recorded");
      setEditing(null);
      setReason("");
      invalidate();
    },
    onError: (e: unknown) => toastError(e),
  });

  const run = useMutation({
    mutationFn: () => runRoutingLearningFn({ data: undefined as never }),
    onSuccess: (r: any) => {
      toast.success(
        ar
          ? `تم الفحص: ${r?.built?.shadowed ?? 0} قاعدة في الاختبار الصامت، ${r?.built?.proposed ?? 0} بانتظار القرار`
          : `Reviewed: ${r?.built?.shadowed ?? 0} in shadow testing, ${r?.built?.proposed ?? 0} awaiting a decision`,
      );
      invalidate();
    },
    onError: (e: unknown) => toastError(e),
  });

  if (loading || query.isPending) {
    return <div className="h-40 animate-pulse rounded-2xl border bg-surface" />;
  }
  if (query.isError) {
    return (
      <p className="text-sm text-muted-foreground">
        {ar ? "هذا القسم متاح لفرق الإشراف فقط." : "This section is available to oversight teams only."}
      </p>
    );
  }

  const data = query.data as any;
  const rules = (data.rules as Rule[]) ?? [];
  const canReview = Boolean(data.canReview);
  const unitName = (id: string | null) =>
    id ? ((data.units as any[]).find((u) => u.id === id)?.[ar ? "name_ar" : "name_en"] ?? "—") : null;

  const live = rules.filter((r) => r["status"] === "ACTIVE");
  const pipeline = rules.filter((r) => ["PROPOSED", "SHADOW", "VALIDATED", "APPROVED", "VALIDATING"].includes(r["status"]));
  const stopped = rules.filter((r) => ["PAUSED", "REJECTED", "ROLLED_BACK"].includes(r["status"]));

  const renderRule = (r: Rule) => {
    const required = (r["required_context"] ?? {}) as Record<string, unknown>;
    const contextText = Object.entries(required)
      .map(([k, v]) => `${k.replace(/_/g, " ")} = ${String(v)}`)
      .join(" · ");
    return (
      <article key={r["id"]} className="space-y-3 rounded-2xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{STATUS_LABEL[r["status"]]?.[ar ? "ar" : "en"] ?? r["status"]}</Badge>
          <Badge variant="outline">
            {ar ? "أمثلة" : "Evidence"}: {r["evidence_count"] ?? 0}
          </Badge>
          <Badge variant="outline">
            {ar ? "دقة تاريخية" : "Historical accuracy"}: {pct(r["historical_accuracy"])}
          </Badge>
          <Badge variant="outline">
            {ar ? "دقة الاختبار الصامت" : "Shadow accuracy"}: {pct(r["shadow_accuracy"])} (
            {r["shadow_samples"] ?? 0})
          </Badge>
          <Badge variant={r["risk_level"] === "low" ? "outline" : "secondary"}>
            {ar ? "المخاطر" : "Risk"}: {r["risk_level"]}
          </Badge>
          <Badge variant="outline">
            {ar ? "الثقة" : "Confidence"}: {pct(r["confidence"])}
          </Badge>
          <Badge variant="outline">
            {r["activation_mode"] === "AUTO"
              ? ar
                ? "تفعيل تلقائي مسموح"
                : "Auto-activation allowed"
              : ar
                ? "يتطلب موافقة إنسان"
                : "Human approval required"}
          </Badge>
          <Badge variant="outline">
            {ar ? "اللغة" : "Language"}: {r["source_language"] ?? "both"}
          </Badge>
        </div>

        <h3 className="text-base font-semibold">{r["rule_name"]}</h3>
        {r["description"] ? <p className="text-sm text-muted-foreground">{r["description"]}</p> : null}

        <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div>
            <dt className="font-medium text-foreground">{ar ? "الصياغة" : "Wording"}</dt>
            <dd>{((r["trigger_phrases"] ?? []) as string[]).join(" · ") || "—"}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">{ar ? "السياق المطلوب" : "Required context"}</dt>
            <dd>{contextText || (ar ? "أي سياق" : "any context")}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">{ar ? "المسار الحالي" : "Current route"}</dt>
            <dd>{r["pending_domain"] ?? (ar ? "غير محدد" : "unclear")}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">{ar ? "المسار المقترح" : "Corrected route"}</dt>
            <dd>{r["target_domain"] ?? unitName(r["target_unit_id"]) ?? "—"}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">{ar ? "مرات التطبيق" : "Times applied"}</dt>
            <dd>
              {r["applied_count"] ?? 0} · {ar ? "تأكيد" : "confirmed"} {r["success_count"] ?? 0} ·{" "}
              {ar ? "تجاوز الموظفون" : "staff overrides"} {r["failure_count"] ?? 0}
            </dd>
          </div>
          {r["rollback_reason"] ? (
            <div>
              <dt className="font-medium text-foreground">{ar ? "سبب الإيقاف" : "Why it stopped"}</dt>
              <dd>{r["rollback_reason"]}</dd>
            </div>
          ) : null}
        </dl>

        {((r["baseline_metrics"]?.reasons as string[]) ?? []).length ? (
          <ul className="space-y-1 rounded-xl bg-surface p-3 text-xs text-muted-foreground">
            {((r["baseline_metrics"]?.reasons as string[]) ?? []).map((reasonText, i) => (
              <li key={i}>• {reasonText}</li>
            ))}
          </ul>
        ) : null}

        {canReview ? (
          editing === r["id"] ? (
            <div className="space-y-2">
              <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
              <Input
                value={draftPhrases}
                onChange={(e) => setDraftPhrases(e.target.value)}
                placeholder={ar ? "الصياغة، مفصولة بفاصلة" : "Wording, comma separated"}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    decide.mutate({
                      ruleId: r["id"],
                      action: "EDIT",
                      edits: {
                        ...(draftName ? { ruleName: draftName } : {}),
                        ...(draftPhrases
                          ? {
                              triggerPhrases: draftPhrases
                                .split(",")
                                .map((p) => p.trim())
                                .filter(Boolean),
                            }
                          : {}),
                      },
                    })
                  }
                >
                  {ar ? "حفظ" : "Save"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  {ar ? "إلغاء" : "Cancel"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={ar ? "سبب القرار (اختياري)" : "Decision reason (optional)"}
              />
              <div className="flex flex-wrap gap-2">
                {r["status"] !== "ACTIVE" ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      decide.mutate({ ruleId: r["id"], action: "ACTIVATE", ...(reason ? { reason } : {}) })
                    }
                  >
                    {ar ? "تفعيل" : "Activate"}
                  </Button>
                ) : null}
                {["PROPOSED", "VALIDATED"].includes(r["status"]) ? (
                  <Button size="sm" variant="outline" onClick={() => decide.mutate({ ruleId: r["id"], action: "APPROVE" })}>
                    {ar ? "اعتماد" : "Approve"}
                  </Button>
                ) : null}
                {r["status"] === "PROPOSED" ? (
                  <Button size="sm" variant="outline" onClick={() => decide.mutate({ ruleId: r["id"], action: "SHADOW" })}>
                    {ar ? "اختبار صامت" : "Shadow test"}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(r["id"]);
                    setDraftName(r["rule_name"]);
                    setDraftPhrases(((r["trigger_phrases"] ?? []) as string[]).join(", "));
                  }}
                >
                  {ar ? "تعديل" : "Edit"}
                </Button>
                {r["status"] === "ACTIVE" ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        decide.mutate({ ruleId: r["id"], action: "PAUSE", ...(reason ? { reason } : {}) })
                      }
                    >
                      {ar ? "إيقاف مؤقت" : "Pause"}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        decide.mutate({ ruleId: r["id"], action: "ROLLBACK", ...(reason ? { reason } : {}) })
                      }
                    >
                      {ar ? "تراجع" : "Roll back"}
                    </Button>
                  </>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => decide.mutate({ ruleId: r["id"], action: "REJECT", ...(reason ? { reason } : {}) })}
                >
                  {ar ? "رفض" : "Reject"}
                </Button>
              </div>
            </div>
          )
        ) : null}
      </article>
    );
  };

  const metrics = data.metrics as any;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          {ar
            ? "يتعلّم سندي صياغة الطلبات فقط: الأسماء البديلة والمرادفات والتوجيه حسب السياق. كل قاعدة تُختبر بصمت على سجل حقيقي قبل التفعيل، ويمكن إيقافها أو التراجع عنها فورًا. القواعد والأهلية والصلاحيات والرسوم ومستويات الخدمة لا تُتعلَّم أبدًا."
            : "Sanadi only learns wording: aliases, synonyms and context-aware routing. Every rule is shadow-tested against real history before it can go live, and can be paused or rolled back instantly. Policy, eligibility, permissions, fees and service levels are never learned."}
        </p>
        {canReview ? (
          <Button onClick={() => run.mutate()} disabled={run.isPending}>
            {ar ? "فحص أنماط التوجيه" : "Check routing patterns"}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <MetricCard label={ar ? "قواعد مفعّلة" : "Live rules"} value={String(metrics?.active ?? 0)} />
        <MetricCard label={ar ? "قيد الاختبار الصامت" : "In shadow testing"} value={String(metrics?.shadow ?? 0)} />
        <MetricCard label={ar ? "مرات التطبيق" : "Times applied"} value={String(metrics?.applied ?? 0)} />
        <MetricCard
          label={ar ? "نسبة النجاح" : "Success rate"}
          value={metrics?.successRate === null ? "—" : pct(metrics?.successRate)}
        />
      </div>

      {pipeline.length ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{ar ? "بانتظار القرار أو قيد الاختبار" : "Awaiting a decision or in testing"}</h3>
          {pipeline.map(renderRule)}
        </section>
      ) : null}

      {live.length ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{ar ? "قواعد مفعّلة" : "Live rules"}</h3>
          {live.map(renderRule)}
        </section>
      ) : null}

      {stopped.length ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{ar ? "موقوفة أو مرفوضة" : "Stopped or rejected"}</h3>
          {stopped.map(renderRule)}
        </section>
      ) : null}

      {!rules.length ? (
        <p className="text-sm text-muted-foreground">
          {ar
            ? "لا توجد قواعد توجيه متعلَّمة بعد. تظهر هنا بعد تكرار التصحيحات نفسها."
            : "No learned routing rules yet. They appear here once the same correction repeats often enough."}
        </p>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{ar ? "لماذا وجّه سندي هذا الطلب هنا؟" : "Why did Sanadi route this here?"}</h3>
        {((data.decisions as any[]) ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {ar ? "لا توجد قرارات توجيه متعلَّمة بعد." : "No learned routing decisions recorded yet."}
          </p>
        ) : (
          <ul className="space-y-2">
            {(data.decisions as any[]).slice(0, 25).map((d) => (
              <li key={d.id} className="rounded-xl border bg-card p-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  “{d.matched_phrase}” → {d.selected_target ?? d.shadow_prediction ?? "—"}
                </span>{" "}
                · {d.mode === "SHADOW" ? (ar ? "اختبار صامت" : "shadow") : ar ? "مطبّقة" : "applied"} ·{" "}
                {ar ? "بدلاً من" : "instead of"} {d.previous_target ?? "—"} · {ar ? "الثقة" : "confidence"}{" "}
                {pct(d.confidence)} · {ar ? "أمثلة" : "evidence"} {d.evidence_count ?? 0} ·{" "}
                {d.activation_mode === "AUTO" ? (ar ? "تلقائي" : "auto") : ar ? "بموافقة" : "approved"} ·{" "}
                {new Date(d.created_at).toLocaleString(ar ? "ar" : "en-GB")}
                {d.outcome && d.outcome !== "PENDING" ? ` · ${d.outcome.toLowerCase()}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
