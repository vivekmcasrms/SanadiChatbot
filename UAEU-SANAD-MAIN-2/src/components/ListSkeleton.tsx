import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shape-matched placeholder for card lists (requests, alerts, chats).
 * Mirrors the real card layout so the page does not jump when data lands.
 */
export function CardListSkeleton({ rows = 3, lines = 2 }: { rows?: number; lines?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-xl border bg-card p-4 card-shadow">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="ms-auto h-3 w-20" />
          </div>
          <div className="mt-3 space-y-2">
            {Array.from({ length: lines }).map((__, j) => (
              <Skeleton key={j} className={j === lines - 1 ? "h-3 w-1/2" : "h-3 w-full"} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}