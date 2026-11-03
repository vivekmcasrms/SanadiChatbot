import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared responsive layout primitives.
 *
 * Every new Sanadi surface should compose these instead of re-inventing
 * one-off breakpoint CSS, so mobile/tablet behaviour is inherited by default.
 */

/** Page-level container: safe gutters on phones, comfortable width on desktop. */
export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full min-w-0 max-w-6xl space-y-5 sm:space-y-6", className)}>{children}</div>;
}

/** Page heading block with fluid typography and wrapping actions. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "grid grid-cols-[minmax(0,1fr)] items-start gap-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-balance text-lg font-semibold tracking-tight sm:text-xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Card grid: 1 column on phones, 2 on tablets, configurable on desktop. */
export function CardGrid({
  children,
  className,
  columns = 3,
}: {
  children: ReactNode;
  className?: string;
  columns?: 2 | 3 | 4;
}) {
  return (
    <div
      className={cn(
        "grid gap-3 sm:grid-cols-2 sm:gap-4",
        columns === 3 && "lg:grid-cols-3",
        columns === 4 && "lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Wrapper for genuinely tabular (administrative) data.
 * Keeps the table intact but confines horizontal scrolling to the component,
 * never the page, and hints that the region scrolls on touch devices.
 */
export function ResponsiveTable({
  children,
  className,
  hint,
}: {
  children: ReactNode;
  className?: string;
  hint?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="-mx-1 overflow-x-auto overscroll-x-contain px-1 [scrollbar-width:thin]">
        <div className="min-w-[36rem]">{children}</div>
      </div>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground md:hidden">{hint}</p> : null}
    </div>
  );
}

/** Renders table-like data as cards on small screens and children on larger ones. */
export function MobileCards({
  cards,
  children,
  className,
}: {
  cards: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="space-y-3 md:hidden">{cards}</div>
      <div className="hidden md:block">{children}</div>
    </div>
  );
}

/** Action row: stacked full-width buttons on phones, inline on larger screens. */
export function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 [&>*]:w-full sm:flex-row sm:flex-wrap sm:items-center sm:[&>*]:w-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Definition-list style facts that never overflow narrow screens. */
export function FactGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", className)}>{children}</dl>;
}
