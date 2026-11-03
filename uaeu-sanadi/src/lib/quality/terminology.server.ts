/** Approved bilingual terminology. Server only. */
import type { Db } from "../agent/tools.server";
import { getCached } from "./cache.server";

export type Term = {
  category: string;
  en: string;
  ar: string;
  altEn: string[];
  altAr: string[];
  abbreviation: string | null;
};

export async function loadApprovedTerms(db: Db): Promise<Term[]> {
  return getCached(db, {
    key: "bilingual_terms:v1",
    category: "bilingual_terminology",
    ttlSeconds: 900,
    load: async () => {
      const { data } = await db
        .from("bilingual_terms")
        .select("term_category, canonical_en, canonical_ar, alternative_en, alternative_ar, abbreviation")
        .eq("is_active", true)
        .limit(200);
      return (data ?? []).map((t) => ({
        category: t.term_category,
        en: t.canonical_en,
        ar: t.canonical_ar,
        altEn: Array.isArray(t.alternative_en) ? (t.alternative_en as string[]) : [],
        altAr: Array.isArray(t.alternative_ar) ? (t.alternative_ar as string[]) : [],
        abbreviation: t.abbreviation,
      }));
    },
  });
}

/** Compact glossary injected into the system prompt so wording stays consistent. */
export async function glossaryPrompt(db: Db, lang: "en" | "ar", message: string): Promise<string> {
  const terms = await loadApprovedTerms(db);
  const text = message.toLowerCase();
  const relevant = terms.filter((t) =>
    [t.en, t.ar, t.abbreviation ?? "", ...t.altEn, ...t.altAr]
      .filter(Boolean)
      .some((v) => text.includes(v.toLowerCase())),
  );
  const chosen = (relevant.length ? relevant : terms).slice(0, 14);
  if (!chosen.length) return "";
  const lines = chosen.map((t) => `- ${t.en} = ${t.ar}${t.abbreviation ? ` (${t.abbreviation})` : ""}`);
  return [
    lang === "ar"
      ? "المصطلحات المعتمدة (استخدم المقابل العربي حرفياً):"
      : "Approved terminology (use these exact terms in each language):",
    ...lines,
    "Never translate course codes, case numbers, confirmation codes or official identifiers.",
  ].join("\n");
}
