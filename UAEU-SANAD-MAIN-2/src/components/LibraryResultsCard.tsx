/**
 * Live library catalogue results rendered in chat.
 *
 * Everything shown here comes from the catalogue response captured on the
 * server, so reopening an old chat shows exactly the same verified data.
 */
import { useState } from "react";
import { BookOpen, ExternalLink, MapPin, Search } from "lucide-react";
import type { LibraryResultsCard as LibraryCard } from "@/lib/agent-types";
import { Button } from "@/components/ui/button";

const AVAILABILITY_TONE: Record<string, string> = {
  available: "bg-success/10 text-success border-success/30",
  electronic: "bg-primary/10 text-primary border-primary/30",
  on_loan: "bg-warning/10 text-warning border-warning/30",
  reference_only: "bg-muted text-muted-foreground border-border",
};

export function LibraryResultsCard({
  card,
  lang,
  onAsk,
}: {
  card: LibraryCard;
  lang: "en" | "ar";
  onAsk?: (question: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const ar = lang === "ar";
  const visible = showAll ? card.results : card.results.slice(0, 5);
  if (!card.results.length) return null;

  return (
    <div className="mt-3 rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <BookOpen className="h-4 w-4 text-primary" aria-hidden />
        <span>
          {ar
            ? `نتائج فهرس المكتبة (${card.totalMatches} نتيجة)`
            : `Library catalogue results (${card.totalMatches} matches)`}
        </span>
      </div>

      <ul className="space-y-3">
        {visible.map((r) => (
          <li key={r.id} className="rounded-lg border border-border/60 p-3">
            {r.courseCode ? (
              <span className="mb-1 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {r.courseCode}
              </span>
            ) : null}
            <p className="text-sm font-semibold leading-snug">{r.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {[r.authors.join(", "), r.year ?? null, r.typeLabel].filter(Boolean).join(" · ")}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
              <span
                className={`rounded-full border px-2 py-0.5 ${
                  AVAILABILITY_TONE[r.availability] ?? "bg-muted text-muted-foreground border-border"
                }`}
              >
                {r.availabilityLabel}
              </span>
              {r.callNumber ? (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <MapPin className="h-3 w-3" aria-hidden />
                  {[r.library, r.floor, r.shelf, r.callNumber].filter(Boolean).join(" · ")}
                </span>
              ) : null}
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              {r.onlineUrl ? (
                <Button asChild size="sm" variant="secondary" className="h-7 text-xs">
                  <a href={r.onlineUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-1 h-3 w-3" aria-hidden />
                    {ar ? "فتح المصدر الإلكتروني" : "Open online resource"}
                  </a>
                </Button>
              ) : null}
              {r.catalogueUrl ? (
                <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                  <a href={r.catalogueUrl} target="_blank" rel="noreferrer">
                    {ar ? "عرض في الفهرس" : "View in catalogue"}
                  </a>
                </Button>
              ) : null}
              {onAsk ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() =>
                    onAsk(
                      ar
                        ? `ابحث عن مصادر مشابهة لـ "${r.title}"`
                        : `Find resources similar to "${r.title}"`,
                    )
                  }
                >
                  <Search className="mr-1 h-3 w-3" aria-hidden />
                  {ar ? "مصادر مشابهة" : "Find similar"}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {!showAll && card.results.length > 5 ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-3 h-7 text-xs"
          onClick={() => setShowAll(true)}
        >
          {ar ? "عرض المزيد" : "Show more"}
        </Button>
      ) : null}

      <p className="mt-3 text-[11px] text-muted-foreground">
        {ar
          ? `المصدر: ${card.provider ?? "فهرس مكتبة جامعة الإمارات"} — بيانات حية.`
          : `Source: ${card.provider ?? "UAEU Library catalogue"} — live availability.`}
      </p>
    </div>
  );
}
