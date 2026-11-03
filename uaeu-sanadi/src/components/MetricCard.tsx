import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function MetricCard({
  label,
  value,
  hint,
  tone = "default",
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "warning" | "danger" | "success";
  icon?: ReactNode;
}) {
  return (
    <div className="card-shadow rounded-xl border bg-card p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">
          {label}
        </p>
        {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
      </div>
      <p
        className={cn(
          "mt-1.5 text-xl font-semibold tabular-nums sm:mt-2 sm:text-2xl",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
          tone === "danger" && "text-destructive",
          tone === "success" && "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground sm:text-xs">{hint}</p> : null}
    </div>
  );
}