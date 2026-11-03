/**
 * Client-safe library contracts: normalised catalogue shapes, student-friendly
 * availability mapping and deterministic citation building.
 * No provider details and no secrets live here.
 */
import type { Lang } from "../agent-types";

export type LibraryAvailability =
  | "available"
  | "on_loan"
  | "reference_only"
  | "electronic"
  | "in_processing"
  | "unavailable"
  | "unknown";

export type LibraryHolding = {
  library: string | null;
  collection: string | null;
  floor: string | null;
  shelf: string | null;
  callNumber: string | null;
  status: LibraryAvailability;
  providerStatus: string | null;
  dueDate: string | null;
};

export type LibraryResourceType =
  | "book"
  | "ebook"
  | "journal"
  | "article"
  | "conference_paper"
  | "thesis"
  | "report"
  | "database"
  | "multimedia"
  | "reference"
  | "other";

export type LibraryResource = {
  id: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  year: number | null;
  type: LibraryResourceType;
  providerType: string | null;
  publisher: string | null;
  isbn: string | null;
  issn: string | null;
  doi: string | null;
  journalTitle: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  language: string | null;
  subjects: string[];
  summary: string | null;
  onlineUrl: string | null;
  requiresSignIn: boolean;
  catalogueUrl: string | null;
  availability: LibraryAvailability;
  holdings: LibraryHolding[];
  copies: number;
  relevance: number;
  /** Provider that produced this record, e.g. "OCLC". */
  provider?: string | null;
  oclcNumber?: string | null;
  edition?: string | null;
  /** true = held by UAEU, false = WorldCat only, null = not verified. */
  heldByInstitution?: boolean | null;
  localHoldingCount?: number | null;
  accessScope?: "uaeu" | "uaeu_electronic" | "worldcat" | "unknown";
  isElectronic?: boolean;
  sourceCheckedAt?: string;
};

export type LibrarySearchParams = {
  query?: string;
  title?: string;
  author?: string;
  subject?: string;
  isbn?: string;
  yearFrom?: number;
  yearTo?: number;
  language?: string;
  types?: LibraryResourceType[];
  availableOnly?: boolean;
  electronicOnly?: boolean;
  branch?: string;
  limit?: number;
  offset?: number;
  /** Fields the student explicitly asked to see (e.g. author, catalogue link). */
  requestedFields?: Array<"author" | "title" | "catalogue_link" | "availability">;
  /** The student's own-language topic when it was translated for the catalogue. */
  originalTopic?: string;
};

export type LibrarySearchStatus = "ok" | "empty" | "disabled" | "unavailable" | "error";

export type LibrarySearchResponse = {
  status: LibrarySearchStatus;
  provider: string | null;
  retrievedAt: string;
  total: number;
  results: LibraryResource[];
  latencyMs: number;
  error: string | null;
};

export const AVAILABILITY_LABEL: Record<LibraryAvailability, { en: string; ar: string }> = {
  available: { en: "Available", ar: "متاح" },
  on_loan: { en: "On Loan", ar: "معار" },
  reference_only: { en: "Reference Only", ar: "للاطلاع الداخلي فقط" },
  electronic: { en: "Electronic Access", ar: "مصدر إلكتروني" },
  in_processing: { en: "In Processing", ar: "قيد المعالجة" },
  unavailable: { en: "Unavailable", ar: "غير متاح" },
  unknown: { en: "Status Unknown", ar: "الحالة غير معروفة" },
};

export const RESOURCE_TYPE_LABEL: Record<LibraryResourceType, { en: string; ar: string }> = {
  book: { en: "Book", ar: "كتاب" },
  ebook: { en: "E-book", ar: "كتاب إلكتروني" },
  journal: { en: "Journal", ar: "دورية" },
  article: { en: "Journal Article", ar: "مقالة علمية" },
  conference_paper: { en: "Conference Paper", ar: "ورقة مؤتمر" },
  thesis: { en: "Thesis / Dissertation", ar: "رسالة علمية" },
  report: { en: "Report", ar: "تقرير" },
  database: { en: "Database", ar: "قاعدة بيانات" },
  multimedia: { en: "Multimedia", ar: "وسائط متعددة" },
  reference: { en: "Reference Material", ar: "مرجع" },
  other: { en: "Resource", ar: "مصدر" },
};

export const label = (map: { en: string; ar: string }, lang: Lang) => (lang === "ar" ? map.ar : map.en);

/**
 * Student-facing status. "Held at UAEU" is never presented as "Available"
 * unless an item-level status confirms it, and a WorldCat hit is never
 * presented as a local holding.
 */
export type LibraryStatusKey =
  | "available"
  | "online"
  | "on_loan"
  | "reference_only"
  | "held_unconfirmed"
  | "worldcat_only"
  | "unknown";

export const STATUS_LABEL: Record<LibraryStatusKey, { en: string; ar: string }> = {
  available: { en: "Available at UAEU", ar: "متاح في الجامعة" },
  online: { en: "Online access", ar: "وصول إلكتروني" },
  on_loan: { en: "On loan", ar: "معار حالياً" },
  reference_only: { en: "Reference only", ar: "للاطلاع الداخلي" },
  held_unconfirmed: { en: "At UAEU · availability not confirmed", ar: "في الجامعة · التوفر غير مؤكد" },
  worldcat_only: { en: "WorldCat only", ar: "وورلد كات فقط" },
  unknown: { en: "Availability unknown", ar: "التوفر غير معروف" },
};

export const STATUS_TONE: Record<LibraryStatusKey, string> = {
  available: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  online: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  on_loan: "bg-amber-500/14 text-amber-700 dark:text-amber-300",
  reference_only: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  held_unconfirmed: "bg-primary/10 text-primary",
  worldcat_only: "bg-muted text-muted-foreground",
  unknown: "bg-muted text-muted-foreground",
};

/** Derives the student-facing status from verified provider data only. */
export function resolveStatus(r: LibraryResource): LibraryStatusKey {
  const itemStatus = (r.holdings ?? []).find((h) => h.status !== "unknown")?.status;
  if (itemStatus === "available") return "available";
  if (itemStatus === "on_loan") return "on_loan";
  if (itemStatus === "reference_only") return "reference_only";
  const held = r.heldByInstitution === true || (r.localHoldingCount ?? 0) > 0;
  if (held && r.onlineUrl) return "online";
  if (held) return "held_unconfirmed";
  if (r.heldByInstitution === false) return "worldcat_only";
  return "unknown";
}


export type CitationStyle = "apa" | "ieee" | "harvard";

export type BuiltCitation = { style: CitationStyle; text: string; needsReview: boolean; missing: string[] };

const surnameFirst = (name: string) => {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.trim();
  const last = parts[parts.length - 1];
  const initials = parts.slice(0, -1).map((p) => `${p[0]?.toUpperCase()}.`).join(" ");
  return `${last}, ${initials}`;
};

const initialsFirst = (name: string) => {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.trim();
  const last = parts[parts.length - 1];
  const initials = parts.slice(0, -1).map((p) => `${p[0]?.toUpperCase()}.`).join(" ");
  return `${initials} ${last}`;
};

/**
 * Citations are derived only from catalogue metadata. Nothing is invented: a
 * missing publisher, DOI or page range is reported instead of guessed.
 */
export function buildCitation(resource: LibraryResource, style: CitationStyle): BuiltCitation {
  const missing: string[] = [];
  if (!resource.authors.length) missing.push("authors");
  if (!resource.year) missing.push("year");
  const isArticle = resource.type === "article" || resource.type === "conference_paper";
  if (isArticle) {
    if (!resource.journalTitle) missing.push("source title");
    if (!resource.pages) missing.push("pages");
  } else if (!resource.publisher) {
    missing.push("publisher");
  }

  const year = resource.year ? String(resource.year) : "n.d.";
  const authors = resource.authors;
  let text: string;

  if (style === "apa") {
    const list = authors.length
      ? authors.map(surnameFirst).join(authors.length > 1 ? ", & " : "")
      : resource.title;
    const source = isArticle
      ? [resource.journalTitle, resource.volume, resource.issue ? `(${resource.issue})` : null, resource.pages]
          .filter(Boolean)
          .join(", ")
      : resource.publisher;
    text = [
      authors.length ? `${list} (${year}).` : `(${year}).`,
      `${resource.title}.`,
      source ? `${source}.` : null,
      resource.doi ? `https://doi.org/${resource.doi}` : null,
    ]
      .filter(Boolean)
      .join(" ");
  } else if (style === "ieee") {
    const list = authors.length ? authors.map(initialsFirst).join(", ") : "";
    const source = isArticle
      ? [
          resource.journalTitle,
          resource.volume ? `vol. ${resource.volume}` : null,
          resource.issue ? `no. ${resource.issue}` : null,
          resource.pages ? `pp. ${resource.pages}` : null,
        ]
          .filter(Boolean)
          .join(", ")
      : resource.publisher;
    text = [
      list ? `${list},` : null,
      `"${resource.title},"`,
      source ? `${source},` : null,
      `${year}.`,
      resource.doi ? `doi: ${resource.doi}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
  } else {
    const list = authors.length ? authors.map(surnameFirst).join(" and ") : resource.title;
    const source = isArticle
      ? [resource.journalTitle, resource.volume, resource.issue ? `(${resource.issue})` : null, resource.pages]
          .filter(Boolean)
          .join(", ")
      : resource.publisher;
    text = [
      `${list} ${year},`,
      `${resource.title},`,
      source ? `${source}.` : null,
      resource.doi ? `doi: ${resource.doi}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return { style, text: text.replace(/\s+/g, " ").trim(), needsReview: missing.length > 0, missing };
}
