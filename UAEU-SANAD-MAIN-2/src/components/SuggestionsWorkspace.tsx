import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusChip } from "@/components/StatusChip";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import {
  acknowledgeSuggestionFn,
  assessSuggestionFn,
  assignSuggestionFn,
  decideSuggestionFn,
  intakeSuggestionFn,
  postSuggestionUpdateFn,
} from "@/lib/suggestion-ops.functions";

function msg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

const RECOMMENDATIONS = ["approve", "pilot", "defer", "decline"] as const;

export function SuggestionsWorkspace() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [impact, setImpact] = useState("4");
  const [feasibility, setFeasibility] = useState("3");
  const [alignment, setAlignment] = useState("4");
  const [recommendation, setRecommendation] = useState<(typeof RECOMMENDATIONS)[number]>("approve");
  const [rationale, setRationale] = useState("");
  const [outcome, setOutcome] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [progress, setProgress] = useState("");

  const listQuery = useQuery({
    queryKey: ["staff-suggestions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suggestions")
        .select(
          "id, reference_number, title, description, expected_benefit, status, created_at, review_due_at, service_unit_id, assigned_staff_id, outcome_summary, implementation_target_date, vote_count",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (listQuery.data ?? []).filter((s) =>
      term ? `${s.reference_number} ${s.title}`.toLowerCase().includes(term) : true,
    );
  }, [listQuery.data, search]);

  const selected = filtered.find((s) => s.id === selectedId) ?? filtered[0] ?? null;

  const detailQuery = useQuery({
    queryKey: ["suggestion-detail", selected?.id],
    enabled: Boolean(selected?.id),
    queryFn: async () => {
      const [updates, assessments] = await Promise.all([
        supabase
          .from("suggestion_updates")
          .select("id, update_type, update_text_en, update_text_ar, visible_to_student, created_at")
          .eq("suggestion_id", selected!.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("suggestion_assessments")
          .select("id, student_impact_score, feasibility_score, strategic_alignment_score, recommendation, rationale, created_at")
          .eq("suggestion_id", selected!.id)
          .order("created_at", { ascending: false }),
      ]);
      return { updates: updates.data ?? [], assessments: assessments.data ?? [] };
    },
  });

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      toast.success(ar ? "تم" : "Done");
      void qc.invalidateQueries({ queryKey: ["staff-suggestions"] });
      void qc.invalidateQueries({ queryKey: ["suggestion-detail"] });
      void qc.invalidateQueries({ queryKey: ["metrics"] });
    } catch (e) {
      toast.error(msg(e));
    } finally {
      setBusy(false);
    }
  }

  const overdue = (s: { review_due_at: string | null; status: string }) =>
    s.review_due_at != null &&
    new Date(s.review_due_at).getTime() < Date.now() &&
    ["submitted", "assigned", "under_review"].includes(s.status);

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <div className="space-y-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={ar ? "بحث بالرقم المرجعي أو العنوان" : "Search reference or title"}
        />
        <ul className="space-y-2">
          {listQuery.isLoading ? (
            <li className="text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</li>
          ) : filtered.length ? (
            filtered.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={`w-full rounded-xl border p-3 text-start transition-colors hover:border-primary/40 ${
                    selected?.id === s.id ? "border-primary/60 bg-primary/5" : "bg-card"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold">{s.reference_number}</span>
                    <StatusChip status={s.status} />
                    {overdue(s) ? (
                      <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
                        {ar ? "متأخر" : "Overdue"}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm">{s.title}</p>
                </button>
              </li>
            ))
          ) : (
            <li className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              {ar ? "لا توجد اقتراحات" : "No suggestions yet"}
            </li>
          )}
        </ul>
      </div>

      {selected ? (
        <div className="space-y-4">
          <section className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">{selected.title}</h2>
              <StatusChip status={selected.status} />
              <span className="ms-auto text-xs text-muted-foreground">
                {ar ? "موعد المراجعة" : "Review due"}:{" "}
                {selected.review_due_at ? new Date(selected.review_due_at).toLocaleDateString() : "—"}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{selected.description}</p>
            {selected.expected_benefit ? (
              <p className="mt-2 text-xs">
                <span className="text-muted-foreground">{ar ? "الفائدة المتوقعة" : "Expected benefit"}: </span>
                {selected.expected_benefit}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={() => run(() => acknowledgeSuggestionFn({ data: { suggestionId: selected.id } }))}
              >
                {ar ? "بدء المراجعة" : "Start review"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => run(() => assignSuggestionFn({ data: { suggestionId: selected.id } }))}
              >
                {ar ? "إسناد لي" : "Assign to me"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => run(() => intakeSuggestionFn({ data: { suggestionId: selected.id } }))}
              >
                {ar ? "توجيه تلقائي" : "Auto-route to unit"}
              </Button>
            </div>
          </section>

          <section className="space-y-2 rounded-xl border bg-card p-4">
            <h3 className="text-sm font-semibold">{ar ? "التقييم" : "Assessment"}</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: ar ? "الأثر على الطلبة" : "Student impact", value: impact, set: setImpact },
                { label: ar ? "قابلية التنفيذ" : "Feasibility", value: feasibility, set: setFeasibility },
                { label: ar ? "التوافق الاستراتيجي" : "Strategic alignment", value: alignment, set: setAlignment },
              ].map((f) => (
                <div key={f.label}>
                  <Label className="text-xs">{f.label} (1–5)</Label>
                  <Input
                    value={f.value}
                    onChange={(e) => f.set(e.target.value.replace(/\D/g, "").slice(0, 1))}
                    className="w-20"
                  />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {RECOMMENDATIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRecommendation(r)}
                  className={`rounded-full border px-3 py-1 text-xs capitalize ${
                    recommendation === r ? "border-primary bg-primary/10 font-medium" : "bg-surface"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <Textarea
              rows={2}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder={ar ? "مبررات التقييم" : "Assessment rationale"}
            />
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                run(() =>
                  assessSuggestionFn({
                    data: {
                      suggestionId: selected.id,
                      impact: Math.min(5, Math.max(1, Number(impact) || 3)),
                      feasibility: Math.min(5, Math.max(1, Number(feasibility) || 3)),
                      alignment: Math.min(5, Math.max(1, Number(alignment) || 3)),
                      recommendation,
                      rationale: rationale.trim() || null,
                    },
                  }).then(() => setRationale("")),
                )
              }
            >
              {ar ? "حفظ التقييم" : "Save assessment"}
            </Button>
            {detailQuery.data?.assessments.length ? (
              <ul className="space-y-2 pt-2">
                {detailQuery.data.assessments.map((a) => (
                  <li key={a.id} className="rounded-lg border bg-surface p-3 text-xs">
                    <p className="font-medium capitalize">{a.recommendation}</p>
                    <p className="text-muted-foreground">
                      {ar ? "الأثر" : "Impact"} {a.student_impact_score} · {ar ? "التنفيذ" : "Feasibility"}{" "}
                      {a.feasibility_score} · {ar ? "التوافق" : "Alignment"} {a.strategic_alignment_score}
                    </p>
                    {a.rationale ? <p className="mt-1 whitespace-pre-wrap">{a.rationale}</p> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="space-y-2 rounded-xl border bg-card p-4">
            <h3 className="text-sm font-semibold">{ar ? "القرار والنتيجة" : "Decision & outcome"}</h3>
            <Textarea
              rows={3}
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              placeholder={ar ? "ما الذي سيُبلَّغ به الطالب؟" : "What will the student be told?"}
            />
            <div>
              <Label className="text-xs">{ar ? "تاريخ التنفيذ المستهدف" : "Implementation target date"}</Label>
              <Input type="date" className="w-44" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              {(["planned", "implemented", "not_proceeding", "closed"] as const).map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={d === "planned" ? "default" : "outline"}
                  disabled={busy || outcome.trim().length < 10}
                  onClick={() =>
                    run(() =>
                      decideSuggestionFn({
                        data: {
                          suggestionId: selected.id,
                          decision: d,
                          outcomeEn: outcome.trim(),
                          targetDate: targetDate || null,
                        },
                      }).then(() => {
                        setOutcome("");
                        setTargetDate("");
                      }),
                    )
                  }
                >
                  {d === "planned"
                    ? ar
                      ? "مخطط للتنفيذ"
                      : "Plan it"
                    : d === "implemented"
                      ? ar
                        ? "تم التنفيذ"
                        : "Implemented"
                      : d === "not_proceeding"
                        ? ar
                          ? "لن يُنفذ"
                          : "Not proceeding"
                        : ar
                          ? "إغلاق"
                          : "Close"}
                </Button>
              ))}
            </div>
          </section>

          <section className="space-y-2 rounded-xl border bg-card p-4">
            <h3 className="text-sm font-semibold">{ar ? "تحديثات" : "Updates"}</h3>
            <Textarea
              rows={2}
              value={progress}
              onChange={(e) => setProgress(e.target.value)}
              placeholder={ar ? "تحديث تقدم للطالب" : "Progress update for the student"}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy || progress.trim().length < 3}
                onClick={() =>
                  run(() =>
                    postSuggestionUpdateFn({
                      data: { suggestionId: selected.id, textEn: progress.trim(), visibleToStudent: true },
                    }).then(() => setProgress("")),
                  )
                }
              >
                {ar ? "نشر للطالب" : "Post to student"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || progress.trim().length < 3}
                onClick={() =>
                  run(() =>
                    postSuggestionUpdateFn({
                      data: { suggestionId: selected.id, textEn: progress.trim(), visibleToStudent: false },
                    }).then(() => setProgress("")),
                  )
                }
              >
                {ar ? "ملاحظة داخلية" : "Internal note"}
              </Button>
            </div>
            {detailQuery.data?.updates.length ? (
              <ul className="space-y-2 pt-2">
                {detailQuery.data.updates.map((u) => (
                  <li key={u.id} className="rounded-lg border bg-surface p-3 text-xs">
                    <p className="text-muted-foreground">
                      {u.update_type} · {new Date(u.created_at).toLocaleString()}
                      {u.visible_to_student ? "" : ar ? " · داخلي" : " · internal"}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{ar ? u.update_text_ar : u.update_text_en}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
