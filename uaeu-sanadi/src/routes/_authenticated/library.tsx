import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  BookOpen,
  Clock,
  ExternalLink,
  FileText,
  GraduationCap,
  Laptop,
  Library,
  MapPin,
  Newspaper,
  Quote,
  Search,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { getLibraryOverview, getLibraryRecordDetails, searchLibraryCatalogue } from "@/lib/library.functions";
import {
  RESOURCE_TYPE_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  buildCitation,
  label,
  resolveStatus,
  type CitationStyle,
  type LibraryResource,
  type LibraryResourceType,
} from "@/lib/library/types";

export const Route = createFileRoute("/_authenticated/library")({
  head: () => ({
    meta: [
      { title: "Ask the Librarian — Sanadi | UAEU" },
      {
        name: "description",
        content:
          "Find books, articles, theses, e-resources and library information with Sanadi, grounded in the live UAEU library catalogue.",
      },
      { property: "og:title", content: "Ask the Librarian — Sanadi | UAEU" },
      {
        property: "og:description",
        content: "Search books, articles and theses, check UAEU availability and get library information with Sanadi.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LibraryPage,
});

const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

const TYPE_STYLE: Record<
  LibraryResourceType,
  { icon: typeof BookOpen; accent: string; chip: string }
> = {
  book: { icon: BookOpen, accent: "bg-primary", chip: "bg-primary/10 text-primary" },
  ebook: { icon: Laptop, accent: "bg-sky-500", chip: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
  journal: { icon: Newspaper, accent: "bg-teal-500", chip: "bg-teal-500/12 text-teal-700 dark:text-teal-300" },
  article: { icon: FileText, accent: "bg-indigo-500", chip: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300" },
  conference_paper: { icon: FileText, accent: "bg-indigo-500", chip: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300" },
  thesis: { icon: GraduationCap, accent: "bg-amber-500", chip: "bg-amber-500/14 text-amber-700 dark:text-amber-300" },
  report: { icon: FileText, accent: "bg-slate-500", chip: "bg-muted text-muted-foreground" },
  database: { icon: Laptop, accent: "bg-sky-500", chip: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
  multimedia: { icon: Laptop, accent: "bg-rose-500", chip: "bg-rose-500/12 text-rose-700 dark:text-rose-300" },
  reference: { icon: BookOpen, accent: "bg-violet-500", chip: "bg-violet-500/12 text-violet-700 dark:text-violet-300" },
  other: { icon: BookOpen, accent: "bg-muted-foreground", chip: "bg-muted text-muted-foreground" },
};

type Chip = { en: string; ar: string; query: string; queryAr: string };

const CHIPS: Chip[] = [
  { en: "📚 Find a book", ar: "📚 ابحث عن كتاب", query: "deep learning book", queryAr: "كتاب الذكاء الاصطناعي" },
  { en: "📰 Journal articles", ar: "📰 مقالات علمية", query: "renewable energy article", queryAr: "مقال الطاقة المتجددة" },
  { en: "🎓 Theses", ar: "🎓 الرسائل العلمية", query: "artificial intelligence thesis", queryAr: "رسالة عن الذكاء الاصطناعي" },
  { en: "💻 E-books", ar: "💻 كتب إلكترونية", query: "data science e-book", queryAr: "كتاب إلكتروني علم البيانات" },
  { en: "📍 Available at UAEU", ar: "📍 متاح في الجامعة", query: "machine learning available now", queryAr: "تعلم الآلة متاح الآن" },
];

/** One catalogue record, rendered only from verified provider metadata. */
function ResultCard({
  resource,
  ar,
  lang,
  onCite,
}: {
  resource: LibraryResource;
  ar: boolean;
  lang: "en" | "ar";
  onCite: (r: LibraryResource) => void;
}) {
  const detailsFn = useServerFn(getLibraryRecordDetails);
  const [open, setOpen] = useState(false);
  const details = useQuery({
    queryKey: ["library-record", resource.id],
    queryFn: () => detailsFn({ data: { oclcNumber: resource.oclcNumber ?? resource.id } }),
    enabled: open && Boolean(resource.oclcNumber ?? resource.id),
    staleTime: 60_000,
  });

  const r: LibraryResource = (details.data?.record as LibraryResource | null | undefined) ?? resource;
  const status = resolveStatus(r);
  const style = TYPE_STYLE[r.type] ?? TYPE_STYLE.other;
  const Icon = style.icon;
  const holding = (r.holdings ?? []).find((h) => h.callNumber || h.library || h.collection);
  const meta = [r.year ? String(r.year) : null, label(RESOURCE_TYPE_LABEL[r.type], lang), r.publisher].filter(Boolean);

  return (
    <li className="relative overflow-hidden rounded-xl border bg-card card-shadow transition-shadow hover:shadow-md">
      <span className={`absolute inset-y-0 start-0 w-1 ${style.accent}`} aria-hidden />
      <div className="p-3 ps-4 sm:p-4 sm:ps-5">
        <div className="flex items-start gap-3">
          <span className={`hidden size-9 shrink-0 items-center justify-center rounded-lg sm:flex ${style.chip}`}>
            <Icon className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold leading-snug break-words sm:text-[0.95rem]">{r.title}</h3>
            {r.authors.length ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.authors.slice(0, 3).join(" · ")}</p>
            ) : null}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.chip}`}>
                {label(RESOURCE_TYPE_LABEL[r.type], lang)}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[status]}`}>
                {label(STATUS_LABEL[status], lang)}
              </span>
              {meta.length ? (
                <span className="truncate text-[11px] text-muted-foreground">{meta.join(" · ")}</span>
              ) : null}
            </div>
          </div>
        </div>

        {holding && (status === "available" || status === "on_loan" || status === "reference_only") ? (
          <div className="mt-3 rounded-lg bg-muted/50 p-2.5 text-xs">
            <p className="font-medium">{ar ? "أين تجده" : "Where to find it"}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-muted-foreground">
              <MapPin className="size-3.5" aria-hidden />
              {[holding.library, holding.collection, holding.shelf].filter(Boolean).join(" · ")}
            </p>
            {holding.callNumber ? (
              <p className="mt-0.5 font-mono text-[11px]" dir="ltr">
                {holding.callNumber}
              </p>
            ) : null}
            {holding.dueDate ? (
              <p className="mt-0.5 text-muted-foreground">
                {(ar ? "تعود في " : "Due back ") + holding.dueDate}
              </p>
            ) : null}
          </div>
        ) : null}

        {open ? (
          <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
            {r.summary ? <p className="text-foreground/80">{r.summary}</p> : null}
            {r.subjects.length ? <p>{(ar ? "الموضوعات: " : "Subjects: ") + r.subjects.slice(0, 6).join(" · ")}</p> : null}
            {r.isbn ? (
              <p dir="ltr" className="font-mono text-[11px]">
                ISBN {r.isbn}
              </p>
            ) : null}
            {r.doi ? (
              <p dir="ltr" className="font-mono text-[11px] break-all">
                DOI {r.doi}
              </p>
            ) : null}
            <p>
              {(ar ? "المصدر: فهرس المكتبة · تم التحقق " : "Source: library catalogue · checked ") +
                new Date(details.data?.checkedAt ?? r.sourceCheckedAt ?? Date.now()).toLocaleTimeString()}
            </p>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          {r.onlineUrl ? (
            <Button asChild size="sm">
              <a href={r.onlineUrl} target="_blank" rel="noreferrer">
                <BookOpen className="size-3.5" aria-hidden />
                {ar ? "الوصول الإلكتروني" : "Access online"}
              </a>
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
            {details.isFetching
              ? ar
                ? "جارٍ التحميل…"
                : "Loading…"
              : open
                ? ar
                  ? "إخفاء التفاصيل"
                  : "Hide details"
                : ar
                  ? "التفاصيل والتوفر"
                  : "Details"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onCite(r)}>
            <Quote className="size-3.5" aria-hidden />
            {ar ? "اقتباس" : "Cite"}
          </Button>
          {r.catalogueUrl ? (
            <Button asChild size="sm" variant="ghost">
              <a href={r.catalogueUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" aria-hidden />
                {ar ? "السجل" : "Record"}
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function LibraryPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const fetchOverview = useServerFn(getLibraryOverview);
  const runSearch = useServerFn(searchLibraryCatalogue);

  const [term, setTerm] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [citeFor, setCiteFor] = useState<LibraryResource | null>(null);
  const [citeStyle, setCiteStyle] = useState<CitationStyle>("apa");

  const overview = useQuery({ queryKey: ["library-overview"], queryFn: () => fetchOverview() });

  const search = useQuery({
    queryKey: ["library-search", submitted, lang],
    queryFn: () => runSearch({ data: { query: submitted, limit: 15, lang } }),
    enabled: submitted.trim().length > 1,
  });

  const days = ar ? DAYS_AR : DAYS_EN;
  const results = useMemo(() => search.data?.results ?? [], [search.data]);
  const visible = showAll ? results.slice(0, 15) : results.slice(0, 5);
  const failed =
    search.data &&
    (search.data.status === "disabled" || search.data.status === "unavailable" || search.data.status === "error");

  const runQuery = (q: string) => {
    setTerm(q);
    setSubmitted(q);
    setShowAll(false);
  };

  /** One honest sentence about the top results, derived from returned metadata. */
  const summaryLine = () => {
    const top = results.slice(0, 5);
    if (!top.length) return null;
    const online = top.filter((r) => Boolean(r.onlineUrl)).length;
    const onShelf = top.filter((r) => resolveStatus(r) === "available").length;
    const parts: string[] = [
      ar ? `وجدت ${top.length} نتائج قوية.` : `I found ${top.length} strong matches.`,
    ];
    if (online) parts.push(ar ? `${online} منها متاحة إلكترونياً الآن.` : `${online} can be opened online right away.`);
    if (onShelf) parts.push(ar ? `${onShelf} متاحة على الرف في الجامعة.` : `${onShelf} are on the shelf at UAEU.`);
    return parts.join(" ");
  };

  const branch = overview.data?.branches?.[0];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Library className="size-5 text-primary" aria-hidden />
          {ar ? "اسأل أمين المكتبة" : "Ask the Librarian"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {ar
            ? "ابحث عن الكتب والمقالات والرسائل والمصادر الإلكترونية ومعلومات المكتبة مع سندي."
            : "Find books, articles, theses, e-resources and library information with Sanadi."}
        </p>
      </header>

      {/* Ask Sanadi */}
      <section className="rounded-2xl border bg-gradient-to-br from-primary/8 via-card to-card p-4 card-shadow sm:p-5">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            runQuery(term.trim());
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground" aria-hidden />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              className="h-11 ps-9"
              placeholder={ar ? "اسأل سندي: كتب عن التعلم العميق…" : "Ask Sanadi: books about deep learning…"}
              aria-label={ar ? "اسأل سندي عن المكتبة" : "Ask Sanadi about the library"}
            />
          </div>
          <Button type="submit" className="h-11 sm:w-36">
            <Sparkles className="size-4" aria-hidden />
            {ar ? "اسأل سندي" : "Ask Sanadi"}
          </Button>
        </form>

        <div className="mt-3 flex flex-wrap gap-2">
          {CHIPS.map((c) => (
            <button
              key={c.en}
              type="button"
              onClick={() => runQuery(ar ? c.queryAr : c.query)}
              className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              {ar ? c.ar : c.en}
            </button>
          ))}
          <Link
            to="/assistant"
            search={{ ask: ar ? "ما هي ساعات عمل المكتبة اليوم؟" : "What are the library opening hours today?" }}
            className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            {ar ? "🕒 ساعات المكتبة" : "🕒 Library hours"}
          </Link>
        </div>

        {/* Compact today card */}
        {branch ? (
          <details className="group mt-3 rounded-xl border bg-background/70 p-3">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
              <Clock className="size-4 text-primary" aria-hidden />
              <span className="font-medium">{ar ? branch.location.nameAr : branch.location.nameEn}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  branch.isOpenNow
                    ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {branch.isOpenNow ? (ar ? "مفتوحة الآن" : "Open now") : ar ? "مغلقة الآن" : "Closed now"}
              </span>
              <span className="text-xs text-muted-foreground">
                {branch.isOpenNow && branch.todayClosesAt
                  ? ar
                    ? `تغلق ${branch.todayClosesAt}`
                    : `Closes ${branch.todayClosesAt}`
                  : branch.nextOpenDay !== null
                    ? ar
                      ? `تفتح ${days[branch.nextOpenDay]} ${branch.nextOpenAt}`
                      : `Opens ${days[branch.nextOpenDay]} ${branch.nextOpenAt}`
                    : ""}
              </span>
              <span className="ms-auto text-xs text-primary group-open:hidden">
                {ar ? "ساعات الأسبوع" : "Weekly hours"}
              </span>
            </summary>
            <ul className="mt-2 space-y-1 text-xs">
              {branch.week.map((d) => (
                <li key={d.dayOfWeek} className="flex justify-between gap-3">
                  <span>{days[d.dayOfWeek]}</span>
                  <span className="text-muted-foreground" dir="ltr">
                    {d.closed ? (ar ? "مغلقة" : "Closed") : `${d.opensAt} – ${d.closesAt}`}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {/* Results */}
      {submitted ? (
        <section className="space-y-3">
          {search.isFetching ? (
            <ul className="space-y-3">
              {[0, 1, 2].map((i) => (
                <li key={i} className="h-24 animate-pulse rounded-xl border bg-muted/40" />
              ))}
            </ul>
          ) : null}

          {!search.isFetching && failed ? (
            <div className="rounded-xl border bg-card p-4 text-sm card-shadow">
              <p>
                {ar
                  ? "لا أستطيع الوصول إلى فهرس المكتبة الآن، لكن يمكنني المساعدة في ساعات العمل وقواعد الإعارة والخدمات."
                  : "I can’t reach the live library catalogue right now, but I can still help with library hours, borrowing rules and services."}
              </p>
              <Button asChild variant="outline" size="sm" className="mt-2">
                <Link to="/assistant" search={{ ask: ar ? "ما هي خدمات المكتبة؟" : "What services does the library provide?" }}>
                  {ar ? "اسأل سندي" : "Ask Sanadi"}
                </Link>
              </Button>
            </div>
          ) : null}

          {!search.isFetching && !failed && results.length === 0 ? (
            <div className="rounded-xl border bg-card p-4 text-sm card-shadow">
              <p className="font-medium">{ar ? "لا توجد نتائج مطابقة" : "No exact matches found"}</p>
              <p className="mt-1 text-muted-foreground">
                {ar ? "يمكنني توسيع البحث أو تجربة مصطلحات قريبة." : "I can broaden the search or try related terms."}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => runQuery(submitted.split(/\s+/).slice(0, 2).join(" "))}>
                  {ar ? "توسيع البحث" : "Broaden search"}
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link to="/assistant" search={{ ask: submitted }}>
                    {ar ? "اسأل سندي" : "Ask Sanadi"}
                  </Link>
                </Button>
              </div>
            </div>
          ) : null}

          {!search.isFetching && results.length ? (
            <>
              <p className="text-sm text-muted-foreground">{summaryLine()}</p>
              <ul className="space-y-3">
                {visible.map((r) => (
                  <ResultCard key={r.id} resource={r} ar={ar} lang={lang} onCite={setCiteFor} />
                ))}
              </ul>
              {!showAll && results.length > 5 ? (
                <Button variant="outline" size="sm" onClick={() => setShowAll(true)}>
                  {ar ? "عرض المزيد" : "Show more"}
                </Button>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {ar
                  ? "هل تريد تحسين النتائج؟ اطلب من سندي: «فقط المتاحة الآن» أو «فقط الكتب الإلكترونية»."
                  : "Want to refine these? Ask Sanadi: “only the ones available now” or “e-books only”."}
              </p>
            </>
          ) : null}
        </section>
      ) : null}

      {/* Citation dialog */}
      <Dialog open={Boolean(citeFor)} onOpenChange={(open) => !open && setCiteFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ar ? "إنشاء اقتباس" : "Build a citation"}</DialogTitle>
            <DialogDescription>
              {ar
                ? "يُبنى الاقتباس من بيانات الفهرس الموثقة فقط."
                : "Citations are built only from verified catalogue metadata."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            {(["apa", "ieee", "harvard"] as CitationStyle[]).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={citeStyle === s ? "default" : "outline"}
                onClick={() => setCiteStyle(s)}
              >
                {s.toUpperCase()}
              </Button>
            ))}
          </div>
          {citeFor ? (
            <>
              <p className="rounded-lg border bg-muted/40 p-3 text-sm leading-relaxed" dir="ltr">
                {buildCitation(citeFor, citeStyle).text}
              </p>
              {buildCitation(citeFor, citeStyle).needsReview ? (
                <p className="text-xs text-muted-foreground">
                  {ar ? "تحقق من هذه الحقول الناقصة: " : "Check these missing details: "}
                  {buildCitation(citeFor, citeStyle).missing.join(", ")}
                </p>
              ) : null}
              <DialogFooter>
                <Button
                  onClick={() => {
                    void navigator.clipboard.writeText(buildCitation(citeFor, citeStyle).text);
                    toast.success(ar ? "تم نسخ الاقتباس" : "Citation copied");
                  }}
                >
                  {ar ? "نسخ الاقتباس" : "Copy citation"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
