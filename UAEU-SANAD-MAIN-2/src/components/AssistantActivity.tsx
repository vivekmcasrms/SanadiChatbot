import { useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { buildActivitySteps } from "@/lib/agent-activity";
import type { Lang } from "@/lib/agent-types";

/**
 * "What Sanadi did" — a small expandable list built strictly from the tools
 * that really executed in the turn. Nothing technical is shown: no tool names,
 * no identifiers, no queries.
 */
export function AssistantActivity({
  activity,
  routedTo,
  lang,
}: {
  activity: string[];
  routedTo?: string | null;
  lang: Lang;
}) {
  const [open, setOpen] = useState(false);
  const steps = buildActivitySteps(activity, lang);
  if (routedTo) {
    steps.push(
      lang === "ar" ? `حوّلت المتابعة إلى ${routedTo}` : `Routed follow-up to ${routedTo}`,
    );
  }
  if (!steps.length) return null;

  return (
    <div className="rounded-xl border bg-card/60 px-3 py-2 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-start text-muted-foreground hover:text-foreground"
      >
        <span>{lang === "ar" ? "ما الذي قام به سندي" : "What Sanadi did"}</span>
        <ChevronDown className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open ? (
        <ul className="mt-2 space-y-1.5">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-muted-foreground">
              <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
              <span>{step}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
