import { isAgentStage, stageLabel } from "@/lib/agent-activity";
import type { Lang } from "@/lib/agent-types";

/** Minimal typing indicator — no stage-by-stage narration for the student. */
export function AssistantTyping() {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2" aria-live="polite" aria-label="Assistant is typing">
      <span className="h-2 w-2 animate-bounce rounded-full bg-primary/60 [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-primary/60 [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-primary/60" />
    </div>
  );
}

/**
 * Shown only while Sanadi is actively working: one short, friendly line naming
 * the service that is doing the work. Falls back to plain dots when no stage
 * has arrived yet.
 */
export function AssistantWorking({
  stage,
  statusText,
  lang,
}: {
  stage: string | null;
  /** Status line produced by the backend for the agent handling this turn. */
  statusText?: string | null;
  lang: Lang;
}) {
  const label = statusText ?? (stage && isAgentStage(stage) ? stageLabel(stage, lang) : null);
  if (!label) return <AssistantTyping />;
  return (
    <div className="flex items-center gap-2 px-3 py-2" aria-live="polite">
      <span className="flex items-center gap-1" aria-hidden>
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60" />
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
