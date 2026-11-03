import { useEffect, useState } from "react";
import { markNotificationsReadFn } from "@/lib/notifications/student.functions";
import { toastError } from "@/lib/errors/toast";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusChip, UrgencyChip } from "@/components/StatusChip";
import { ACTOR_LABEL, INTERACTION_LABEL, type InteractionType } from "@/lib/interactions/types";
import { StudentCasePanel } from "@/components/StudentCasePanel";
import { AppointmentRequestPanel } from "@/components/AppointmentRequestPanel";
import { apiFetch } from "@/lib/auth-token";
import { useAuth } from "@/lib/auth";
import { isServiceOwnerOnly } from "@/lib/nav";
import { StaffCaseWorkspace } from "@/components/StaffCaseWorkspace";
import { ResponsibleStaffCard } from "@/components/ResponsibleStaffCard";
import { CaseActivityTimeline } from "@/components/CaseActivityTimeline";
import { CaseMeetingCard } from "@/components/CaseMeetingCard";
import { CaseOutcomeCard } from "@/components/CaseOutcomeCard";
import { HandoverPackageCard } from "@/components/HandoverPackageCard";
import { pick, useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/requests/$caseId")({
  head: () => ({
    meta: [
      { title: "Case details — Sanadi | UAEU" },
      { name: "description", content: "Follow the timeline, messages and evidence of your university case." },
      { property: "og:title", content: "Case details — Sanadi | UAEU" },
      { property: "og:description", content: "Status, timeline and messages for your case." },
    ],
  }),
  component: CaseDetail,
});

type CaseDetailRow = {
  id: string;
  case_number: string;
  title: string;
  description: string | null;
  status: string;
  urgency: string;
  case_type: string | null;
  current_responsible_actor: string | null;
  created_at: string;
  expected_resolution_date: string | null;
  resolution_due_at: string | null;
  satisfaction_rating: number | null;
  outcome_en: string | null;
  outcome_ar: string | null;
  related_internship_assignment_id: string | null;
  meeting_at: string | null;
  meeting_mode: string | null;
  meeting_location: string | null;
  meeting_note: string | null;
  service_units: { name_en: string | null; name_ar: string | null } | null;
  case_categories: { name_en: string | null; name_ar: string | null } | null;
};

function CaseDetail() {
  const { caseId } = useParams({ from: "/_authenticated/requests/$caseId" });
  const { t, lang } = useI18n();
  const { user, roles, isStaff } = useAuth();
  // Service Owners open the same case page from their queues and need the
  // handling actions they are authorised for, in place.
  const ownerOnly = isServiceOwnerOnly(roles);
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");
  const [escalation, setEscalation] = useState("");
  const [busy, setBusy] = useState(false);

  const caseQuery = useQuery({
    queryKey: ["case", caseId],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const rows = await apiFetch<CaseDetailRow[]>(`/api/v1/data/cases?select=id,case_number,title,description,status,urgency,case_type,current_responsible_actor,created_at,expected_resolution_date,resolution_due_at,service_unit_id,category_id,satisfaction_rating,outcome_en,outcome_ar,related_internship_assignment_id,meeting_at,meeting_mode,meeting_location,meeting_note,service_units:service_unit_id(name_en,name_ar),case_categories:category_id(name_en,name_ar)&id=eq.${caseId}&limit=1`);
      return rows[0] ?? null;
    },
  });

  // Opening the request clears its unread notifications.
  const markRead = markNotificationsReadFn;
  useEffect(() => {
    if (!user?.id) return;
    void markRead({ data: { ids: [], caseId, all: false } }).then(() =>
      queryClient.invalidateQueries({ queryKey: ["my-notifications"] }),
    );
  }, [caseId, user?.id, markRead, queryClient]);



  const timelineQuery = useQuery({
    queryKey: ["case-timeline", caseId],
    queryFn: async () => {
      return apiFetch<{ id: string; to_status: string; note: string | null; created_at: string }[]>(`/api/v1/data/case_status_history?select=id,to_status,note,created_at&case_id=eq.${caseId}&order=created_at.asc`);
    },
  });

  const commentsQuery = useQuery({
    queryKey: ["case-comments", caseId],
    queryFn: async () => {
      return apiFetch<{ id: string; body: string; author_id: string; is_info_request: boolean; created_at: string }[]>(`/api/v1/data/case_comments?select=id,body,author_id,is_info_request,created_at&case_id=eq.${caseId}&order=created_at.asc`);
    },
  });

  const evidenceQuery = useQuery({
    queryKey: ["case-evidence", caseId],
    queryFn: async () => {
      return apiFetch<{ id: string; file_name: string; storage_path: string }[]>(`/api/v1/data/case_evidence?select=id,file_name,storage_path&case_id=eq.${caseId}`);
    },
  });

  async function sendReply() {
    if (!user || reply.trim().length < 2) return;
    setBusy(true);
    try {
      await apiFetch("/api/v1/data/case_comments", { method: "POST", body: JSON.stringify({ case_id: caseId, author_id: user.id, body: reply.trim(), is_internal: false }) });
    } catch (error) {
      setBusy(false);
      toastError(error, lang);
      return;
    }
    setBusy(false);
    setReply("");
    void queryClient.invalidateQueries({ queryKey: ["case-comments", caseId] });
  }

  async function escalate() {
    if (!user || escalation.trim().length < 5) { toast.error(t("min_length")); return; }
    try {
      await apiFetch("/api/v1/data/case_escalations", { method: "POST", body: JSON.stringify({ case_id: caseId, raised_by: user.id, reason: escalation.trim() }) });
    } catch (error) {
      toastError(error, lang);
      return;
    }
    setEscalation("");
    toast.success(t("escalated_ok"));
  }

  async function rate(value: number) {
    try {
      await apiFetch(`/api/v1/data/cases?id=eq.${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        body: JSON.stringify({ satisfaction_rating: value }),
      });
    } catch (error) {
      toastError(error, lang);
      return;
    }
    toast.success(t("satisfaction_thanks"));
    void queryClient.invalidateQueries({ queryKey: ["case", caseId] });
  }

  async function openEvidence(path: string) {
    try {
      const data = await apiFetch<{ signedURL: string }>(`/api/v1/storage/object/sign/case-evidence/${encodeURIComponent(path)}?expiresIn=60`);
      window.open(data.signedURL, "_blank", "noopener");
    } catch {
      toast.error(t("error_generic"));
    }
  }

  if (caseQuery.isLoading) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  if (caseQuery.isError || !caseQuery.data)
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{t("error_generic")}</p>
        <Button variant="outline" asChild>
          <Link to="/requests">{t("my_requests")}</Link>
        </Button>
      </div>
    );

  const item = caseQuery.data;
  const unit = item.service_units ? pick(item.service_units, "name", lang) : "—";
  const category = item.case_categories ? pick(item.case_categories, "name", lang) : "—";
  const closed = item.status === "closed" || item.status === "resolved";

  return (
    <div className="space-y-6">
      {ownerOnly ? (
        <Link
          to="/owner-console"
          search={{ tab: "attention" }}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          {lang === "ar" ? "يحتاج انتباهك" : "Needs your attention"}
        </Link>
      ) : (
        <Link to="/requests" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /> {t("my_requests")}
        </Link>
      )}

      <header className="rounded-2xl border bg-card p-5 card-shadow">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">{item.case_number}</h1>
          <StatusChip status={item.status} />
          {item.case_type ? (
            <span className="rounded-full border px-2 py-0.5 text-xs">
              {lang === "ar"
                ? (INTERACTION_LABEL[item.case_type as InteractionType]?.ar ?? item.case_type)
                : (INTERACTION_LABEL[item.case_type as InteractionType]?.en ?? item.case_type)}
            </span>
          ) : null}
          {item.current_responsible_actor ? (
            <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted-foreground">
              {lang === "ar"
                ? (ACTOR_LABEL[item.current_responsible_actor as keyof typeof ACTOR_LABEL]?.ar ?? "")
                : (ACTOR_LABEL[item.current_responsible_actor as keyof typeof ACTOR_LABEL]?.en ?? "")}
            </span>
          ) : null}
          <UrgencyChip urgency={item.urgency} />
        </div>
        <p className="mt-2 text-sm">{item.title}</p>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">{t("category_label")}</dt>
            <dd className="font-medium">{category}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("submitted_on")}</dt>
            <dd className="font-medium">{new Date(item.created_at).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("responsible_unit")}</dt>
            <dd className="font-medium">{unit}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("expected_resolution")}</dt>
            <dd className="font-medium">{item.expected_resolution_date ?? item.resolution_due_at?.slice(0, 10) ?? "—"}</dd>
          </div>
        </dl>
        <p className="mt-4 whitespace-pre-wrap text-sm text-muted-foreground">{item.description}</p>
      </header>

      <ResponsibleStaffCard caseId={item.id} />

      {/* A meeting the responsible staff member set on this same request. */}
      <CaseMeetingCard
        meetingAt={item.meeting_at}
        mode={item.meeting_mode}
        location={item.meeting_location}
        note={item.meeting_note}
        unitName={unit}
      />

      {/* A preferred-time meeting request, when this case carries one. */}
      <AppointmentRequestPanel caseId={item.id} />

      {/* Staff open the case with the full handover already in front of them. */}
      {isStaff ? <HandoverPackageCard caseId={item.id} /> : null}

      {ownerOnly ? <StaffCaseWorkspace caseId={item.id} /> : null}


      {/* The result, in plain language, with the ways to question it in place. */}
      <CaseOutcomeCard caseId={caseId} />

      <StudentCasePanel caseId={caseId} status={item.status} />

      {/* Students read the plain-language account of what happened; staff keep
          the exact status timeline they work from. */}
      <CaseActivityTimeline caseId={caseId} />

      {ownerOnly ? (
        <section className="rounded-2xl border bg-card p-5 card-shadow">
          <h2 className="text-sm font-semibold">{t("timeline")}</h2>
          <ol className="mt-3 space-y-3">
            {(timelineQuery.data ?? []).map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 text-sm">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden />
                <div>
                  <StatusChip status={entry.to_status} />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(entry.created_at).toLocaleString()}
                    {entry.note ? ` — ${entry.note}` : ""}
                  </p>
                </div>
              </li>
            ))}
            {!timelineQuery.data?.length ? (
              <li className="text-xs text-muted-foreground">{t("none_yet")}</li>
            ) : null}
          </ol>
        </section>
      ) : null}

      <section className="rounded-2xl border bg-card p-5 card-shadow">
        <h2 className="text-sm font-semibold">{t("messages")}</h2>
        <div className="mt-3 space-y-3">
          {commentsQuery.data?.length ? (
            commentsQuery.data.map((c) => (
              <div key={c.id} className="rounded-lg border bg-surface p-3 text-sm">
                {c.is_info_request ? (
                  <p className="mb-1 text-xs font-medium text-warning-foreground">{t("request_info")}</p>
                ) : null}
                <p className="mb-1 text-xs font-medium text-primary">
                  {c.author_id === user?.id
                    ? lang === "ar"
                      ? "أنت"
                      : "You"
                    : lang === "ar"
                      ? "فريق الخدمة"
                      : "Service team"}
                </p>
                <p className="whitespace-pre-wrap">{c.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">{new Date(c.created_at).toLocaleString()}</p>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">{t("none_yet")}</p>
          )}
        </div>
        <div className="mt-4 space-y-2">
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            placeholder={t("write_message")}
          />
          <Button size="sm" onClick={sendReply} disabled={busy || !reply.trim()}>
            {t("send_message")}
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5 card-shadow">
        <h2 className="text-sm font-semibold">{t("evidence")}</h2>
        {evidenceQuery.data?.length ? (
          <ul className="mt-3 space-y-2">
            {evidenceQuery.data.map((file) => (
              <li key={file.id}>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => openEvidence(file.storage_path)}>
                  <Download className="size-4" aria-hidden />
                  {file.file_name}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">{t("none_yet")}</p>
        )}
      </section>

      {closed ? (
        <section className="rounded-2xl border bg-card p-5 card-shadow">
          <h2 className="text-sm font-semibold">{t("satisfaction")}</h2>
          <div className="mt-3 flex gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <Button
                key={value}
                size="sm"
                variant={item.satisfaction_rating === value ? "default" : "outline"}
                onClick={() => rate(value)}
                aria-label={`${value}`}
              >
                <Star className="size-4" aria-hidden /> {value}
              </Button>
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border bg-card p-5 card-shadow">
          <h2 className="text-sm font-semibold">{t("escalate")}</h2>
          <Textarea
            className="mt-3"
            rows={2}
            value={escalation}
            onChange={(e) => setEscalation(e.target.value)}
            placeholder={t("escalate_reason")}
          />
          <Button className="mt-2" size="sm" variant="outline" onClick={escalate}>
            {t("escalate")}
          </Button>
        </section>
      )}
    </div>
  );
}
