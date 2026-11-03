/**
 * Smart suggestion consolidation. Server only.
 *
 * Twenty students asking for more hostel buses is one decision, not twenty
 * reviews. This groups open suggestions into themes by term overlap so a
 * Service Owner reviews a theme with its demand signal instead of a queue.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

const STOP = new Set([
  "the","a","an","and","or","to","of","for","in","on","at","is","are","be","with","more","please","we","i","my","our","students","student","should","need","needs","university","uaeu","it","this","that","have","has","can","would","make","better",
  "في","من","على","إلى","عن","مع","هذا","هذه","التي","الذي","أن","إن","يجب","الطلاب","الطالب","الجامعة","اكثر","أكثر","يرجى",
]);

function terms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

export type SuggestionTheme = {
  key: string;
  labelEn: string;
  labelAr: string;
  count: number;
  votes: number;
  unitId: string | null;
  unitNameEn: string | null;
  unitNameAr: string | null;
  oldestAt: string;
  items: { id: string; referenceNumber: string; title: string; status: string; votes: number; createdAt: string }[];
};

const THRESHOLD = 0.34;

/** Groups every open suggestion into themes, largest demand first. */
export async function buildSuggestionThemes(db: Db, limit = 300): Promise<SuggestionTheme[]> {
  const { data } = await db
    .from("suggestions")
    .select("id, reference_number, title, description, status, vote_count, created_at, service_unit_id, service_units:service_unit_id (name_en, name_ar)")
    .is("deleted_at", null)
    .not("status", "in", "(implemented,closed,not_proceeding)")
    .order("created_at", { ascending: true })
    .limit(limit);

  const rows = (data ?? []).map((s) => ({
    ...s,
    terms: terms(`${s.title} ${s.description}`),
    unit: (s.service_units ?? null) as { name_en: string; name_ar: string } | null,
  }));

  const clusters: { seed: (typeof rows)[number]; members: typeof rows }[] = [];
  for (const row of rows) {
    const hit = clusters.find(
      (c) => c.seed.service_unit_id === row.service_unit_id && similarity(c.seed.terms, row.terms) >= THRESHOLD,
    );
    if (hit) hit.members.push(row);
    else clusters.push({ seed: row, members: [row] });
  }

  return clusters
    .map<SuggestionTheme>((c) => ({
      key: c.seed.id,
      labelEn: c.seed.title,
      labelAr: c.seed.title,
      count: c.members.length,
      votes: c.members.reduce((n, m) => n + (m.vote_count ?? 0), 0),
      unitId: c.seed.service_unit_id,
      unitNameEn: c.seed.unit?.name_en ?? null,
      unitNameAr: c.seed.unit?.name_ar ?? null,
      oldestAt: c.members[0]!.created_at,
      items: c.members.map((m) => ({
        id: m.id,
        referenceNumber: m.reference_number,
        title: m.title,
        status: m.status,
        votes: m.vote_count ?? 0,
        createdAt: m.created_at,
      })),
    }))
    .sort((a, b) => b.count - a.count || b.votes - a.votes);
}