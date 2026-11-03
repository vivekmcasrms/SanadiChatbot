/**
 * Learning Center — where Sanadi's proposed improvements wait for a human.
 *
 * Sanadi observes corrections and detects repeats, but nothing here changes
 * how students are served until someone approves it, and only safe areas
 * (routing, wording, clarification, knowledge gaps) can ever be approved.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MetricCard } from "@/components/MetricCard";
import { toastError } from "@/lib/errors/toast";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { RoutingImprovements } from "@/components/learning/RoutingImprovements";
import {
  decideLearningCandidateFn,
  getLearningCenterFn,
  runLearningDetectionFn,
  toggleLearnedRuleFn,
} from "@/lib/learning/learning.functions";
import { CANDIDATE_LABELS, type CandidateType } from "@/lib/learning/types";

export const Route = createFileRoute("/_authenticated/learning")({
  head: () => ({
    meta: [
      { title: "Learning Center — Sanadi | UAEU" },
      {
        name: "description",
        content:
          "Review the improvements Sanadi proposes from staff corrections and student feedback, and approve, edit, reject or defer each one.",
      },
      { property: "og:title", content: "Learning Center — Sanadi | UAEU" },
      {
        property: "og:description",
        content: "Human-approved learning: Sanadi proposes, people decide.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LearningPage,
});

type Candidate = Record<string, any>;

function LearningPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { session, loading } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftPhrases, setDraftPhrases] = useState("");
  const [note, setNote] = useState("");

  const query = useQuery({
    queryKey: ["learning-center", session?.user.id],
    enabled: Boolean(session?.user.id) && !loading,
    retry: false,
    queryFn: () => getLearningCenterFn({ data: undefined as never }),
  });

  const decide = useMutation({
    mutationFn: (vars: {
      candidateId: string;
      decision: "APPROVE" | "REJECT" | "DEFER";
      note?: string;
      edits?: { title?: string; triggerPhrases?: string[] };
    }) => decideLearningCandidateFn({ data: vars }),
    onSuccess: () => {
      toast.success(ar ? "تم تسجيل القرار" : "Decision recorded");
      setEditing(null);
      setNote("");
      void queryClient.invalidateQueries({ queryKey: ["learning-center"] });
    },
    onError: (e: unknown) => toastError(e),
  });

  const detect = useMutation({
    mutationFn: () => runLearningDetectionFn({ data: undefined as never }),
    onSuccess: (r: any) => {
      toast.success(
        ar
          ? `تم فحص الإشارات: ${r?.details?.created ?? 0} اقتراح جديد`
          : `Signals reviewed: ${r?.details?.created ?? 0} new proposal(s)`,
      );
      void queryClient.invalidateQueries({ queryKey: ["learning-center"] });
    },
    onError: (e: unknown) => toastError(e),
  });

  const toggle = useMutation({
    mutationFn: (vars: { ruleId: string; active: boolean }) => toggleLearnedRuleFn({ data: vars }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["learning-center"] }),
    onError: (e: unknown) => toastError(e),
  });

  if (loading || query.isPending) {
    return <div className="h-40 animate-pulse rounded-2xl border bg-surface" />;
  }
  if (query.isError) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
        {ar
          ? "هذه الصفحة متاحة لفرق الإشراف فقط."
          : "This page is available to oversight teams only."}
      </div>
    );
  }

  const data = query.data as any;
  const proposed = (data.candidates as Candidate[]).filter((c) => c["status"] === "PROPOSED" || c["status"] === "DEFERRED");
  const approved = (data.candidates as Candidate[]).filter((c) => c["status"] === "ACTIVE" || c["status"] === "APPROVED");
  const rejected = (data.candidates as Candidate[]).filter((c) => c["status"] === "REJECTED");
  const unitName = (id: string | null) =>
    id ? ((data.units as any[]).find((u) => u.id === id)?.[ar ? "name_ar" : "name_en"] ?? "—") : "—";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {ar ? "مركز التعلّم" : "Learning Center"}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {ar
              ? "يقترح سندي تحسينات من تصحيحات الموظفين وملاحظات الطلبة. لا يُطبّق أي تغيير قبل موافقة إنسان، ولا يمس القواعد أو الأهلية أو الصلاحيات أبدًا."
              : "Sanadi proposes improvements from staff corrections and student feedback. Nothing takes effect until a person approves it, and policy, eligibility and permissions are never learned."}
          </p>
        </div>
        {data.canReview ? (
          <Button onClick={() => detect.mutate()} disabled={detect.isPending}>
            {ar ? "فحص الأنماط الآن" : "Check for patterns now"}
          </Button>
        ) : null}
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        <MetricCard label={ar ? "إشارات جديدة" : "New signals"} value={String((data.signals as any[]).filter((s) => s.status === "NEW").length)} />
        <MetricCard label={ar ? "اقتراحات بانتظار القرار" : "Awaiting decision"} value={String(proposed.length)} />
        <MetricCard label={ar ? "قواعد مفعّلة" : "Active rules"} value={String((data.rules as any[]).filter((r) => r.active).length)} />
        <MetricCard label={ar ? "اقتراحات مرفوضة" : "Rejected"} value={String(rejected.length)} />
      </div>

      <Tabs defaultValue="proposed">
        <TabsList>
          <TabsTrigger value="signals">{ar ? "الإشارات" : "Signals"}</TabsTrigger>
          <TabsTrigger value="proposed">{ar ? "مقترحات" : "Proposed"}</TabsTrigger>
          <TabsTrigger value="routing">{ar ? "تحسينات التوجيه" : "Routing improvements"}</TabsTrigger>
          <TabsTrigger value="approved">{ar ? "معتمدة" : "Approved"}</TabsTrigger>
          <TabsTrigger value="impact">{ar ? "الأثر" : "Impact"}</TabsTrigger>
        </TabsList>

        <TabsContent value="signals" className="space-y-2 pt-4">
          {(data.signals as any[]).length === 0 ? (
            <p className="text-sm text-muted-foreground">{ar ? "لا توجد إشارات بعد." : "No signals yet."}</p>
          ) : (
            (data.signals as any[]).map((s) => (
              <div key={s.id} className="rounded-xl border bg-card p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{s.correction_type.replace(/_/g, " ").toLowerCase()}</Badge>
                  <span className="text-xs text-muted-foreground">{s.correction_source.toLowerCase()}</span>
                  {s.policy_sensitive ? (
                    <Badge variant="destructive">
                      {ar ? "لا يمكن تعلّمه (سياسة)" : "Not learnable (policy)"}
                    </Badge>
                  ) : null}
                  <span className="ms-auto text-xs text-muted-foreground">
                    {new Date(s.created_at).toLocaleDateString(ar ? "ar" : "en-GB")}
                  </span>
                </div>
                <p className="mt-2 text-muted-foreground">
                  {s.original_user_text || s.student_feedback || s.staff_comment || "—"}
                </p>
                {s.original_unit_id || s.corrected_unit_id ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {unitName(s.original_unit_id)} → {unitName(s.corrected_unit_id)}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="proposed" className="space-y-3 pt-4">
          {proposed.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {ar ? "لا توجد اقتراحات بانتظار القرار." : "Nothing is waiting for a decision."}
            </p>
          ) : (
            proposed.map((c) => (
              <article key={c["id"]} className="space-y-3 rounded-2xl border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{CANDIDATE_LABELS[c["candidate_type"] as CandidateType]?.[ar ? "ar" : "en"]}</Badge>
                  <Badge variant="outline">
                    {ar ? "أمثلة" : "Examples"}: {c["evidence_count"]}
                  </Badge>
                  <Badge variant="outline">
                    {ar ? "الثقة" : "Confidence"}: {Math.round(Number(c["confidence"]) * 100)}%
                  </Badge>
                  <Badge variant={c["risk_level"] === "low" ? "outline" : "secondary"}>
                    {ar ? "المخاطر" : "Risk"}: {c["risk_level"]}
                  </Badge>
                  {c["status"] === "DEFERRED" ? <Badge variant="secondary">{ar ? "مؤجل" : "Deferred"}</Badge> : null}
                </div>
                <h2 className="text-base font-semibold">{c["title"]}</h2>
                <p className="text-sm text-muted-foreground">{c["description"]}</p>
                <p className="text-xs text-muted-foreground">{c["current_behaviour"]}</p>
                {(c["example_messages"] as string[])?.length ? (
                  <ul className="space-y-1 rounded-xl bg-surface p-3 text-xs text-muted-foreground">
                    {(c["example_messages"] as string[]).map((e, i) => (
                      <li key={i}>“{e}”</li>
                    ))}
                  </ul>
                ) : null}

                {data.canReview ? (
                  editing === c["id"] ? (
                    <div className="space-y-2">
                      <Input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} />
                      <Input
                        value={draftPhrases}
                        onChange={(e) => setDraftPhrases(e.target.value)}
                        placeholder={ar ? "كلمات التفعيل، مفصولة بفاصلة" : "Trigger phrases, comma separated"}
                      />
                      <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={ar ? "ملاحظة القرار (اختياري)" : "Decision note (optional)"} />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            decide.mutate({
                              candidateId: c["id"],
                              decision: "APPROVE",
                              ...(note ? { note } : {}),
                              edits: {
                                ...(draftTitle ? { title: draftTitle } : {}),
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
                          {ar ? "حفظ واعتماد" : "Save and approve"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          {ar ? "إلغاء" : "Cancel"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => decide.mutate({ candidateId: c["id"], decision: "APPROVE" })}>
                        {ar ? "اعتماد" : "Approve"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditing(c["id"]);
                          setDraftTitle(c["title"]);
                          setDraftPhrases(((c["proposed_change"]?.trigger_phrases as string[]) ?? []).join(", "));
                        }}
                      >
                        {ar ? "تعديل" : "Edit"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => decide.mutate({ candidateId: c["id"], decision: "DEFER" })}>
                        {ar ? "تأجيل" : "Defer"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => decide.mutate({ candidateId: c["id"], decision: "REJECT" })}>
                        {ar ? "رفض" : "Reject"}
                      </Button>
                    </div>
                  )
                ) : null}
              </article>
            ))
          )}
        </TabsContent>

        <TabsContent value="routing" className="pt-4">
          <RoutingImprovements />
        </TabsContent>

        <TabsContent value="approved" className="space-y-3 pt-4">
          {(data.rules as any[]).length === 0 && approved.length === 0 ? (
            <p className="text-sm text-muted-foreground">{ar ? "لا توجد قواعد معتمدة." : "No approved rules yet."}</p>
          ) : null}
          {(data.rules as any[]).map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.rule_name}</p>
                <p className="text-xs text-muted-foreground">
                  {(r.trigger_phrases ?? []).join(", ")} → {r.target_domain ?? unitName(r.target_unit_id)}
                </p>
              </div>
              <Badge variant={r.active ? "default" : "outline"}>
                {r.active ? (ar ? "مفعّلة" : "Active") : ar ? "موقوفة" : "Paused"}
              </Badge>
              {data.canReview ? (
                <Button size="sm" variant="outline" onClick={() => toggle.mutate({ ruleId: r.id, active: !r.active })}>
                  {r.active ? (ar ? "إيقاف" : "Pause") : ar ? "تفعيل" : "Activate"}
                </Button>
              ) : null}
            </div>
          ))}
          {approved.map((c) => (
            <div key={c["id"]} className="rounded-xl border bg-surface p-3 text-sm">
              <p className="font-medium">{c["title"]}</p>
              <p className="text-xs text-muted-foreground">
                {ar ? "اعتُمد في" : "Approved"}{" "}
                {c["approved_at"] ? new Date(c["approved_at"] as string).toLocaleDateString(ar ? "ar" : "en-GB") : "—"}
              </p>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="impact" className="space-y-3 pt-4">
          {(data.impact as any[]).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {ar ? "لا توجد بيانات أثر بعد." : "No impact data yet."}
            </p>
          ) : (
            (data.impact as any[]).map((i) => (
              <div key={i.id} className="rounded-xl border bg-card p-3 text-sm">
                <p className="font-medium">{i.title}</p>
                <p className="text-xs text-muted-foreground">
                  {ar ? "تصحيحات قبل الاعتماد" : "Corrections before approval"}: {i.before} ·{" "}
                  {ar ? "بعد" : "after"}: {i.after ?? (ar ? "قيد القياس" : "measuring")} ·{" "}
                  {ar ? "مرات التطبيق" : "times applied"}: {i.applied ?? 0}
                </p>
              </div>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
