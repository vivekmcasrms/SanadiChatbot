/**
 * Reusable list behaviour (search, filters, pagination, empty/error states).
 *
 * Behaviour is shared; visual design is not forced: student pages keep cards,
 * owner pages keep compact operational rows, admin pages keep tables.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { PAGE_SIZE_OPTIONS } from "@/lib/list-query";

/** Debounced, server-backed search box. Enter submits immediately. */
export function ListSearch({
  value,
  onChange,
  placeholder,
  delay = 350,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  delay?: number;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep in sync when the URL (back/forward, filter reset) changes the query.
  useEffect(() => setDraft(value), [value]);

  function schedule(next: string) {
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(next.trim()), delay);
  }

  function submitNow() {
    if (timer.current) clearTimeout(timer.current);
    onChange(draft.trim());
  }

  return (
    <div className="relative min-w-0 flex-1 sm:max-w-xs">
      <Search className="pointer-events-none absolute inset-inline-start-0 start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        value={draft}
        onChange={(e) => schedule(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submitNow();
        }}
        placeholder={placeholder ?? (ar ? "بحث…" : "Search…")}
        aria-label={placeholder ?? (ar ? "بحث" : "Search")}
        className="h-9 ps-8 pe-8"
      />
      {draft ? (
        <button
          type="button"
          aria-label={ar ? "مسح البحث" : "Clear search"}
          onClick={() => {
            setDraft("");
            if (timer.current) clearTimeout(timer.current);
            onChange("");
          }}
          className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

export type FilterOption = { key: string; label: string; count?: number | null };

/** Context-specific filter chips. Counts respect the caller's authorised scope. */
export function FilterChips({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: FilterOption[];
  value: string;
  onChange: (key: string) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => (
        <Button
          key={o.key}
          size="sm"
          variant={value === o.key ? "default" : "outline"}
          className="h-8"
          onClick={() => onChange(o.key)}
        >
          {o.label}
          {o.count != null ? (
            <Badge
              variant={value === o.key ? "secondary" : "outline"}
              className="ms-1.5 h-5 px-1.5 text-[11px] tabular-nums"
            >
              {o.count}
            </Badge>
          ) : null}
        </Button>
      ))}
    </div>
  );
}

/** Compact labelled dropdown used for status / SLA / sort / date selectors. */
export function ListSelect({
  label,
  value,
  options,
  onChange,
  width = "w-[170px]",
}: {
  label: string;
  value: string;
  options: { key: string; label: string }[];
  onChange: (key: string) => void;
  width?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={`h-9 ${width}`} aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.key} value={o.key}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Desktop: Previous / Page x of y / Next plus an optional "Showing 1–20 of 237".
 * Mobile: Previous / Next only, so the controls stay usable on a phone.
 */
export function Pagination({
  page,
  pageSize,
  pageCount,
  total,
  onPage,
  onPageSize,
  busy,
}: {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number | null;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
  busy?: boolean;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  // Nothing to page through: an empty or single short page needs no controls.
  if ((total ?? 0) === 0) return null;
  if (pageCount <= 1 && (total ?? 0) <= pageSize && !onPageSize) return null;

  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = total == null ? page * pageSize : Math.min(total, page * pageSize);

  return (
    <nav
      aria-label={ar ? "تنقل بين الصفحات" : "Pagination"}
      className="flex flex-wrap items-center justify-between gap-2 pt-1"
    >
      <p className="text-xs text-muted-foreground tabular-nums">
        {total == null
          ? ar
            ? `صفحة ${page}`
            : `Page ${page}`
          : ar
            ? `عرض ${first}–${last} من ${total}`
            : `Showing ${first}–${last} of ${total}`}
      </p>

      <div className="flex items-center gap-2">
        {onPageSize ? (
          <div className="hidden items-center gap-1.5 sm:flex">
            <span className="text-xs text-muted-foreground">{ar ? "لكل صفحة" : "Rows"}</span>
            <Select value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v))}>
              <SelectTrigger className="h-8 w-[74px]" aria-label={ar ? "عدد الصفوف" : "Rows per page"}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={page <= 1 || busy}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
          <span className="ms-1">{ar ? "السابق" : "Previous"}</span>
        </Button>
        <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
          {ar ? `صفحة ${page} من ${pageCount}` : `Page ${page} of ${pageCount}`}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={page >= pageCount || busy}
          onClick={() => onPage(page + 1)}
        >
          <span className="me-1">{ar ? "التالي" : "Next"}</span>
          <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
        </Button>
      </div>
    </nav>
  );
}

/** Filters can legitimately return nothing — never show database language. */
export function ListEmpty({ title, hint }: { title?: string; hint?: string }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      <p className="text-sm font-medium">{title ?? (ar ? "لا توجد نتائج مطابقة" : "No matching results")}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {hint ?? (ar ? "جرّب تعديل عوامل التصفية أو البحث." : "Try adjusting your filters or search.")}
      </p>
    </div>
  );
}

/** Human error state with a retry — never SQL/Supabase wording. */
export function ListError({ onRetry }: { onRetry?: () => void }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center">
      <p className="text-sm text-destructive">
        {ar ? "تعذّر تحميل هذه القائمة الآن." : "We couldn't load this list right now."}
      </p>
      {onRetry ? (
        <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
          <RefreshCw className="me-1.5 size-4" aria-hidden />
          {ar ? "إعادة المحاولة" : "Retry"}
        </Button>
      ) : null}
    </div>
  );
}
