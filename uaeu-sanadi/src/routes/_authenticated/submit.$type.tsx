import { useEffect, useMemo, useState } from "react";
import { toastError } from "@/lib/errors/toast";
import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Phone, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  getEmergencyPathwaysFn,
  previewInteractionFn,
  submitInteractionFn,
} from "@/lib/interactions.functions";
import { INTERACTION_LABEL, type InteractionType } from "@/lib/interactions/types";
import { useAuth } from "@/lib/auth";
import { pick, useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/submit/$type")({
  head: () => ({
    meta: [
      { title: "New request — Sanadi | UAEU" },
      {
        name: "description",
        content:
          "Ask a question, submit a suggestion, report a problem or raise an urgent alert — Sanadi classifies, routes and tracks it to closure.",
      },
      { property: "og:title", content: "New request — Sanadi | UAEU" },
      {
        property: "og:description",
        content: "Submit a question, suggestion, complaint or alert and track it to resolution.",
      },
    ],
  }),
  component: SubmitPage,
});

const MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

const SHORTCUTS: Record<string, InteractionType> = {
  query: "query",
  question: "query",
  complaint: "complaint",
  problem: "complaint",
  suggestion: "suggestion",
  alert: "alert",
  emergency: "alert",
};

function SubmitPage() {
  const { type } = useParams({ from: "/_authenticated/submit/$type" });
  const hint: InteractionType = SHORTCUTS[type] ?? "complaint";
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const { user } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [unitId, setUnitId] = useState<string>("");
  const [incidentDate, setIncidentDate] = useState("");
  const [location, setLocation] = useState("");
  const [desired, setDesired] = useState("");
  const [benefit, setBenefit] = useState("");
  const [urgency, setUrgency] = useState("medium");
  const [confidentiality, setConfidentiality] = useState("standard");
  const [anonymous, setAnonymous] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof submitInteractionFn>> | null>(null);

  const isComplaint = hint === "complaint";
  const isSuggestion = hint === "suggestion";
  const isAlert = hint === "alert";

  const unitsQuery = useQuery({
    queryKey: ["units"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_units")
        .select("id, code, name_en, name_ar")
        .eq("is_active", true)
        .order("name_en");
      if (error) throw error;
      return data;
    },
  });

  const categoriesQuery = useQuery({
    queryKey: ["case_categories", hint],
    enabled: !isAlert,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("case_categories")
        .select("id, code, name_en, name_ar, is_sensitive, default_unit_id, case_type")
        .eq("case_type", isSuggestion ? "suggestion" : "complaint")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const emergencyQuery = useQuery({
    queryKey: ["emergency-pathways", lang],
    enabled: isAlert,
    queryFn: () => getEmergencyPathwaysFn({ data: { lang } }),
  });

  // Live classification: the shortcut is only a hint, Sanadi decides the type.
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewInteractionFn>> | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const ready = title.trim().length >= 4 && description.trim().length >= 15;

  useEffect(() => {
    if (!ready) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    const timer = setTimeout(() => {
      previewInteractionFn({
        data: {
          title: title.trim(),
          description: description.trim(),
          shortcutHint: hint,
          urgencyHint: isComplaint ? (urgency as "low" | "medium" | "high" | "critical") : null,
        },
      })
        .then((r) => {
          if (!cancelled) setPreview(r);
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setPreviewing(false);
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [title, description, hint, urgency, isComplaint, ready]);

  const selectedCategory = useMemo(
    () => categoriesQuery.data?.find((c) => c.id === categoryId) ?? null,
    [categoriesQuery.data, categoryId],
  );

  const totalSteps = 3;

  function validateStep() {
    if (step === 1 && !ready) {
      toast.error(t("min_length"));
      return false;
    }
    return true;
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const accepted: File[] = [];
    for (const file of Array.from(list)) {
      if (!ALLOWED.includes(file.type) || file.size > MAX_SIZE) {
        toast.error(`${file.name}: ${t("evidence_hint")}`);
        continue;
      }
      accepted.push(file);
    }
    setFiles((prev) => [...prev, ...accepted]);
  }

  async function submit() {
    if (!user) return;
    setBusy(true);
    try {
      // One backend pipeline for chat and shortcuts: classify → route → SLA →
      // create → orchestrate → acknowledge.
      const submitted = await submitInteractionFn({
        data: {
          title: title.trim(),
          description: description.trim(),
          shortcutHint: hint,
          urgencyHint: isAlert ? null : (urgency as "low" | "medium" | "high" | "critical"),
          categoryId: categoryId || null,
          unitId: unitId || selectedCategory?.default_unit_id || null,
          desiredResolution: desired.trim() || null,
          expectedBenefit: benefit.trim() || null,
          incidentDate: incidentDate || null,
          confidentiality,
          isAnonymous: anonymous,
          location: location.trim() || null,
          lang,
        },
      });

      if (submitted.kind === "case" && files.length) {
        for (const file of files) {
          const path = `${user.id}/${submitted.id}/${crypto.randomUUID()}-${file.name}`;
          const { error: upErr } = await supabase.storage.from("case-evidence").upload(path, file);
          if (upErr) throw upErr;
          await supabase.from("case_evidence").insert({
            case_id: submitted.id,
            uploaded_by: user.id,
            storage_path: path,
            file_name: file.name,
            mime_type: file.type,
            size_bytes: file.size,
          });
        }
      }

      setResult(submitted);
    } catch (error) {
      toastError(error, lang);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const label = INTERACTION_LABEL[result.interactionType];
    return (
      <div className="mx-auto max-w-lg rounded-2xl border bg-card p-8 text-center card-shadow">
        <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold">{t("submitted_title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {ar ? result.acknowledgementAr : result.acknowledgementEn}
        </p>
        <p className="mt-3 text-lg font-semibold tracking-wide">{result.reference}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {ar ? label.ar : label.en} · {ar ? result.classification.serviceLabel.ar : result.classification.serviceLabel.en}
        </p>
        {result.linkedSuggestionId ? (
          <p className="mt-3 rounded-lg border bg-surface p-3 text-xs text-muted-foreground">
            {ar
              ? "لاحظ سندي فكرة تحسين ضمن رسالتك وأنشأ اقتراحاً مرتبطاً للجهة نفسها."
              : "Sanadi also detected an improvement idea in your message and linked a suggestion for the same unit."}
          </p>
        ) : null}
        {result.emergencyContacts.length ? (
          <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-start text-xs">
            <p className="font-semibold text-destructive">
              {ar ? "مسارات الطوارئ المعتمدة" : "Approved emergency pathways"}
            </p>
            <ul className="mt-2 space-y-1">
              {result.emergencyContacts.map((c) => (
                <li key={c.label} className="flex items-center gap-2">
                  <Phone className="size-3" aria-hidden />
                  <span>{c.label}</span>
                  {c.phone ? <span className="font-medium">{c.phone}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="mt-6 flex justify-center gap-2">
          {result.kind === "case" ? (
            <Button asChild>
              <Link to="/requests/$caseId" params={{ caseId: result.id }}>
                {t("go_to_case")}
              </Link>
            </Button>
          ) : (
            <Button asChild>
              <Link to="/requests">{t("my_requests")}</Link>
            </Button>
          )}
          <Button variant="outline" onClick={() => navigate({ to: "/assistant" })}>
            {t("nav_assistant")}
          </Button>
        </div>
      </div>
    );
  }

  const heading = isSuggestion
    ? t("new_suggestion")
    : isAlert
      ? ar
        ? "تنبيه / طوارئ"
        : "Alert / Emergency"
      : hint === "query"
        ? ar
          ? "طرح سؤال"
          : "Ask a question"
        : t("new_complaint");

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold">{heading}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {isSuggestion
          ? t("suggestion_intro")
          : isAlert
            ? ar
              ? "استخدم هذا النموذج للحالات العاجلة المستمرة التي تتطلب استجابة فورية."
              : "Use this for urgent, ongoing situations that need an immediate response."
            : t("complaint_intro")}
      </p>

      {isAlert ? (
        <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold text-destructive">
            <AlertTriangle className="size-4" aria-hidden />
            {ar ? "سندي ليس بديلاً عن خدمات الطوارئ" : "Sanadi is not a replacement for emergency services"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {ar
              ? "في حالات الخطر المباشر على الحياة أو السلامة، استخدم قنوات الطوارئ الرسمية المعتمدة فوراً."
              : "For immediate danger to life or safety, use the official approved emergency channels right away."}
          </p>
          {(emergencyQuery.data ?? []).length ? (
            <ul className="mt-3 space-y-1 text-xs">
              {(emergencyQuery.data ?? []).map((c) => (
                <li key={c.label} className="flex items-center gap-2">
                  <Phone className="size-3" aria-hidden />
                  <span>{c.label}</span>
                  {c.phone ? <span className="font-medium">{c.phone}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <p className="mt-4 text-xs text-muted-foreground">
        {t("step")} {step} {t("of")} {totalSteps}
      </p>
      <div className="mt-2 h-1.5 w-full rounded-full bg-secondary">
        <div
          className="h-1.5 rounded-full bg-primary transition-all"
          style={{ width: `${(step / totalSteps) * 100}%` }}
        />
      </div>

      <div className="mt-6 space-y-5 rounded-2xl border bg-card p-6 card-shadow">
        {step === 1 ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="title">{t("title_label")}</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">{t("describe_label")}</Label>
              <Textarea
                id="description"
                rows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={4000}
              />
            </div>
            {isAlert ? (
              <div className="space-y-2">
                <Label htmlFor="location">{ar ? "الموقع" : "Location"}</Label>
                <Input
                  id="location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  maxLength={200}
                  placeholder={ar ? "المبنى / الغرفة / المنطقة" : "Building / room / area"}
                />
              </div>
            ) : null}
            <ClassificationHint preview={preview} previewing={previewing} hint={hint} />
          </>
        ) : null}

        {step === 2 ? (
          <>
            {!isAlert ? (
              <div className="space-y-2">
                <Label>{t("category_label")}</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("category_label")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(categoriesQuery.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {pick(c, "name", lang)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label>
                {t("affected_service")} <span className="text-muted-foreground">({t("optional")})</span>
              </Label>
              <Select value={unitId} onValueChange={setUnitId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("affected_service")} />
                </SelectTrigger>
                <SelectContent>
                  {(unitsQuery.data ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {pick(u, "name", lang)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isSuggestion ? (
              <div className="space-y-2">
                <Label htmlFor="benefit">{t("expected_benefit")}</Label>
                <Textarea id="benefit" rows={3} value={benefit} onChange={(e) => setBenefit(e.target.value)} />
              </div>
            ) : null}

            {isComplaint || hint === "query" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="incident">{t("incident_date")}</Label>
                  <Input
                    id="incident"
                    type="date"
                    value={incidentDate}
                    onChange={(e) => setIncidentDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="desired">{t("desired_resolution")}</Label>
                  <Textarea id="desired" rows={3} value={desired} onChange={(e) => setDesired(e.target.value)} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{t("urgency")}</Label>
                    <Select value={urgency} onValueChange={setUrgency}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">{t("urg_low")}</SelectItem>
                        <SelectItem value="medium">{t("urg_medium")}</SelectItem>
                        <SelectItem value="high">{t("urg_high")}</SelectItem>
                        <SelectItem value="critical">{t("urg_critical")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t("confidentiality")}</Label>
                    <Select value={confidentiality} onValueChange={setConfidentiality}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">{t("conf_standard")}</SelectItem>
                        <SelectItem value="confidential">{t("conf_confidential")}</SelectItem>
                        <SelectItem value="anonymous">{t("conf_anonymous")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-3">
                  <Label htmlFor="evidence">{t("evidence")}</Label>
                  <p className="text-xs text-muted-foreground">{t("evidence_hint")}</p>
                  <label
                    htmlFor="evidence"
                    className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground hover:border-primary/50"
                  >
                    <Upload className="size-4" aria-hidden />
                    {t("attach")}
                  </label>
                  <input
                    id="evidence"
                    type="file"
                    multiple
                    className="sr-only"
                    accept={ALLOWED.join(",")}
                    onChange={(e) => addFiles(e.target.files)}
                  />
                  <ul className="space-y-1 text-xs">
                    {files.map((file) => (
                      <li key={file.name} className="rounded border bg-surface px-3 py-2">
                        {file.name}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : null}

            {isSuggestion ? (
              <div className="flex items-center justify-between rounded-lg border bg-surface p-3">
                <Label htmlFor="anon" className="text-sm">
                  {t("anonymous_toggle")}
                </Label>
                <Switch id="anon" checked={anonymous} onCheckedChange={setAnonymous} />
              </div>
            ) : null}
          </>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4">
            <ReviewBlock
              title={title}
              description={description}
              extra={isSuggestion ? benefit : desired}
              label={isSuggestion ? t("expected_benefit") : t("desired_resolution")}
            />
            <ClassificationHint preview={preview} previewing={previewing} hint={hint} />
          </div>
        ) : null}

        <div className="flex justify-between gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => (step === 1 ? navigate({ to: "/assistant" }) : setStep(step - 1))}
            disabled={busy}
          >
            {step === 1 ? t("cancel") : t("back")}
          </Button>
          {step < totalSteps ? (
            <Button onClick={() => validateStep() && setStep(step + 1)}>{t("next")}</Button>
          ) : (
            <Button onClick={submit} disabled={busy}>
              {busy ? t("loading") : t("submit")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Shows the student, in plain language, what Sanadi understood and where it goes. */
function ClassificationHint({
  preview,
  previewing,
  hint,
}: {
  preview: Awaited<ReturnType<typeof previewInteractionFn>> | null;
  previewing: boolean;
  hint: InteractionType;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  if (previewing && !preview) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        {ar ? "سندي يفهم طلبك…" : "Sanadi is reading your request…"}
      </p>
    );
  }
  if (!preview) return null;
  const label = INTERACTION_LABEL[preview.interactionType];
  const service = ar ? preview.serviceLabel.ar : preview.serviceLabel.en;
  return (
    <div className="rounded-lg border bg-surface p-3 text-xs">
      <p className="font-medium">
        {ar ? "سندي سيتعامل مع هذا كـ" : "Sanadi will handle this as"}{" "}
        <span className="text-primary">{ar ? label.ar : label.en}</span>{" "}
        {ar ? "ويوجهه إلى" : "and route it to"} <span className="text-primary">{service}</span>.
      </p>
      {preview.interactionType !== hint ? (
        <p className="mt-1 text-muted-foreground">
          {ar
            ? "تم تعديل النوع بناءً على محتوى رسالتك — لا حاجة لإعادة الإرسال."
            : "The type was adjusted from your shortcut based on what you wrote — no need to resubmit elsewhere."}
        </p>
      ) : null}
    </div>
  );
}

function ReviewBlock({
  title,
  description,
  extra,
  label,
}: {
  title: string;
  description: string;
  extra: string;
  label: string;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-3 rounded-lg border bg-surface p-4 text-sm">
      <h2 className="font-semibold">{t("review_submit")}</h2>
      <div>
        <p className="text-xs text-muted-foreground">{t("title_label")}</p>
        <p className="font-medium">{title}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{t("describe_label")}</p>
        <p className="whitespace-pre-wrap">{description}</p>
      </div>
      {extra ? (
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="whitespace-pre-wrap">{extra}</p>
        </div>
      ) : null}
    </div>
  );
}
