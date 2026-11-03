import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { UaeuLogo } from "@/components/UaeuLogo";
import { apiUrl } from "@/lib/auth-token";

type SurveySetting = {
  caseNumber: string;
  serviceType: string;
  scriptUrl: string;
  fullSequenceCode: string;
  webLinkingId: string;
  language: string;
};

type PulseWindow = Window & {
  jQuery?: unknown;
  CustomerPulse?: unknown;
  wsMyAppModel?: {
    initSurveySSB: (
      sequence: string, linking: string, transaction: string,
      user: string, email: string, phone: string, emiratesId: string, language: string,
    ) => void;
  };
};

const JQUERY_URL = "https://code.jquery.com/jquery-3.7.1.min.js";

function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = [...document.scripts].find((script) => script.src === url);
    if (existing?.dataset["loaded"] === "true") return resolve();
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => { script.dataset["loaded"] = "true"; resolve(); }, { once: true });
    script.addEventListener("error", () => {
      script.remove();
      reject(new Error("Survey widget could not load."));
    }, { once: true });
    if (!existing) {
      script.src = url;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

async function waitForPulse(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((window as PulseWindow).CustomerPulse) return;
    await new Promise((resolve) => window.setTimeout(resolve, 200));
  }
  throw new Error("Survey widget is unavailable. Please try again later.");
}

export const Route = createFileRoute("/survey")({
  head: () => ({ meta: [
    { title: "Customer Pulse survey — Sanadi" },
    { name: "robots", content: "noindex, nofollow" },
    { name: "referrer", content: "no-referrer" },
  ] }),
  component: SurveyPage,
});

function SurveyPage() {
  const [setting, setSetting] = useState<SurveySetting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);

  const openSurvey = useCallback(async (details: SurveySetting) => {
    setOpening(true);
    setError(null);
    try {
      const pulse = window as PulseWindow;
      if (!pulse.jQuery) await loadScript(JQUERY_URL);
      await loadScript(details.scriptUrl);
      await waitForPulse();
      if (!pulse.wsMyAppModel?.initSurveySSB) throw new Error("Survey widget is unavailable.");
      pulse.wsMyAppModel.initSurveySSB(
        details.fullSequenceCode, details.webLinkingId, details.caseNumber,
        "", "", "", "", details.language || "en",
      );
    } catch {
      setError("The survey could not be opened. Please try again later.");
    } finally {
      setOpening(false);
    }
  }, []);

  useEffect(() => {
    const data = new URLSearchParams(window.location.search).get("data");
    if (!data) {
      setError("This survey link is invalid or expired.");
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    fetch(apiUrl(`/api/survey/open?data=${encodeURIComponent(data)}`), {
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
    }).then(async (response) => {
      if (!response.ok) throw new Error("Survey unavailable");
      return response.json() as Promise<SurveySetting>;
    }).then((details) => {
      if (controller.signal.aborted) return;
      setSetting(details);
      setLoading(false);
      void openSurvey(details);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setError("This survey link is invalid, expired, or currently unavailable.");
      setLoading(false);
    });
    return () => controller.abort();
  }, [openSurvey]);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col justify-center gap-6 p-6">
      <div className="flex items-center gap-3">
        <UaeuLogo className="h-9" />
        <div>
          <p className="text-sm font-semibold">United Arab Emirates University</p>
          <p className="text-xs text-muted-foreground">جامعة الإمارات العربية المتحدة</p>
        </div>
      </div>
      <section className="rounded-xl border bg-card p-6 card-shadow">
        <h1 className="text-xl font-semibold">Customer Pulse survey</h1>
        {loading ? <p className="mt-4 text-sm text-muted-foreground">Preparing your survey…</p> : null}
        {setting ? (
          <>
            <p className="mt-4 text-sm text-muted-foreground">
              {setting.serviceType} · Reference {setting.caseNumber}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              The survey should open automatically. If it does not, select the button below.
            </p>
            <button
              type="button"
              disabled={opening}
              onClick={() => void openSurvey(setting)}
              className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {opening ? "Opening survey…" : "Open survey"}
            </button>
          </>
        ) : null}
        {error ? <p role="alert" className="mt-4 text-sm text-destructive">{error}</p> : null}
      </section>
    </main>
  );
}
