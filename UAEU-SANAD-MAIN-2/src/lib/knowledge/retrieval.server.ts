/**
 * Single authoritative knowledge retrieval path for Sanadi.
 *
 * Both the Agent Orchestrator and the Knowledge Center rehearsal call
 * `retrieveKnowledge()`. Ranking happens inside Postgres
 * (`search_knowledge_passages`): a hybrid of full-text relevance, trigram
 * fuzzy similarity, source authority, language match and recency, filtered by
 * approval status, effective/expiry dates, domain and the caller's
 * confidentiality clearance. Nothing is scanned in application memory.
 */
import type { Db } from "../agent/tools.server";
import { type CenterPermissions, clearanceFor } from "./permissions.server";
import { neutraliseForPrompt } from "./processing.server";

export type RetrievedSource = {
  sourceType: "document" | "faq" | "web_source";
  sourceId: string;
  chunkId: string | null;
  title: string;
  snippet: string;
  sectionTitle: string | null;
  pageNumber: number | null;
  citationUrl: string | null;
  owningUnit: string | null;
  version: string | null;
  effectiveDate: string | null;
  confidentiality: string;
  domain: string;
  documentType: string | null;
  relevance: number;
  lexical: number;
  fuzzy: number;
  semantic: number;
  authority: number;
  score: number;
  language: string;
  stale: boolean;
};

export type RetrievalOutcome = {
  passages: RetrievedSource[];
  candidateCount: number;
  durationMs: number;
  domain: string | null;
  groundingStatus: "grounded" | "weak" | "no_evidence" | "policy_conflict";
  conflicts: ReturnType<typeof detectConflicts>;
  cacheHit: boolean;
};

/** Confidence floor below which a passage is not worth grounding an answer on. */
export const MIN_GROUNDING_SCORE = 0.32;
/** Default passage budget sent into the model prompt. */
export const DEFAULT_PASSAGE_LIMIT = 5;

export const KNOWLEDGE_DOMAINS = [
  "registration",
  "withdrawal",
  "internship",
  "housing",
  "transfer",
  "documents",
  "library",
  "career",
  "complaints",
  "institution",
  "general",
] as const;
export type KnowledgeDomain = (typeof KNOWLEDGE_DOMAINS)[number];

const DOMAIN_HINTS: Record<Exclude<KnowledgeDomain, "general">, RegExp> = {
  // Checked first: questions about how the university is organised must reach
  // official institutional pages rather than an unrelated service policy.
  institution:
    /((how many|number of|list( of)?|what are|which)\s+(the\s+)?(colleges?|faculties|schools|departments?|programs?|programmes?|majors?|campus(es)?)|uaeu\s+(colleges?|departments?|structure|about)|كم\s*(عدد)?\s*(الكليات|الأقسام|البرامج)|(قائمة|ما هي)\s*(الكليات|الأقسام|البرامج|التخصصات))/i,
  registration: /(regist|enrol|add\s*and\s*drop|credit hours?|overload|prerequisit|section|hold|تسجيل|حذف|إضافة|ساعات معتمدة|متطلب سابق|حجز)/i,
  withdrawal: /(withdraw|drop the course|late withdrawal|semester withdrawal|grade of w|انسحاب|الانسحاب)/i,
  internship: /(internship|training|placement|co-?op|تدريب|التدريب العملي)/i,
  housing: /(housing|hostel|dorm|residence|room|bed|roommate|سكن|الغرفة|السكن الجامعي|سرير)/i,
  transfer: /(transfer|change (my )?(college|major|programme|program)|تحويل|تغيير التخصص)/i,
  documents: /(letter|transcript|certificate|enrol\w* letter|to whom it may concern|document|وثيقة|إفادة|كشف درجات|شهادة|خطاب)/i,
  library: /(librar|book|borrow|catalogue|database|citation|مكتبة|استعارة|كتاب|فهرس)/i,
  career: /(career|cv|resume|ats|interview|job|skill gap|مهني|سيرة ذاتية|مقابلة|وظيفة|مهارات)/i,
  complaints: /(complain|suggestion|escalat|grievance|شكوى|اقتراح|تصعيد)/i,
};

/** True when the question is about the university's own structure. */
export function isInstitutionalQuery(query: string): boolean {
  return DOMAIN_HINTS.institution.test(query);
}


/** Cheap deterministic domain hint so a query does not scan the whole corpus. */
export function inferDomain(query: string): KnowledgeDomain | null {
  for (const [domain, re] of Object.entries(DOMAIN_HINTS)) {
    if (re.test(query)) return domain as KnowledgeDomain;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Section-concept expansion                                            */
/* ------------------------------------------------------------------ */

/**
 * Students rarely use the exact heading word a policy uses ("objective" vs
 * "purpose" vs "why does this policy exist"). Each concept maps to the set of
 * heading words that answer it, so retrieval can boost the matching section.
 */
const SECTION_CONCEPTS: { probe: RegExp; terms: string[] }[] = [
  {
    probe: /(objective|purpose|aim|goal|intent|rationale|why .*(policy|exist)|الهدف|الأهداف|الغرض|الغاية|لماذا)/i,
    terms: ["objective", "purpose", "aim", "goal", "introduction", "overview", "الهدف", "الأهداف", "الغرض"],
  },
  {
    probe: /(scope|applies to|applicability|coverage|من ينطبق|النطاق|نطاق)/i,
    terms: ["scope", "applicability", "subject", "النطاق", "نطاق التطبيق", "الموضوع"],
  },
  {
    probe: /(defin|meaning of|terminology|التعريف|التعريفات|المصطلح)/i,
    terms: ["definitions", "terminology", "abbreviations", "التعريفات", "المصطلحات"],
  },
  {
    probe: /(procedure|process|steps|how (do|to)|الإجراء|الإجراءات|الخطوات|كيف)/i,
    terms: ["procedure", "procedures", "process", "implementation", "الإجراءات", "الإجراء"],
  },
  {
    probe: /(responsib|who is in charge|accountab|المسؤول|المسؤولية|المسؤوليات)/i,
    terms: ["responsibilities", "responsibility", "roles and responsibilities", "المسؤوليات"],
  },
  {
    probe: /(eligib|qualify|requirement|condition|الأهلية|الشروط|المتطلبات)/i,
    terms: ["eligibility", "requirements", "conditions", "الأهلية", "الشروط", "المتطلبات"],
  },
  {
    probe: /(penalt|sanction|violation|discipl|عقوب|مخالف)/i,
    terms: ["penalties", "sanctions", "enforcement", "compliance", "العقوبات", "المخالفات"],
  },
  {
    probe: /(exception|waiver|exempt|استثناء|إعفاء)/i,
    terms: ["exceptions", "الاستثناءات"],
  },
];

/** Heading terms worth boosting for this query (may be empty). */
export function sectionTermsFor(query: string): string[] {
  const out = new Set<string>();
  for (const { probe, terms } of SECTION_CONCEPTS) {
    if (probe.test(query)) terms.forEach((t) => out.add(t.toLowerCase()));
  }
  return [...out].slice(0, 12);
}


/* ------------------------------------------------------------------ */
/* Safe short-term cache for stable, non-personal policy lookups        */
/* ------------------------------------------------------------------ */

type CacheEntry = { value: RetrievedSource[]; expiresAt: number };
const passageCache = new Map<string, CacheEntry>();
let corpusVersion = "v1";
const CACHE_TTL_MS = 5 * 60 * 1000;
const PERSONAL = /\b(my|mine|i am|i'm|am i|do i|my own|رصيدي|معدلي|حالتي|هل أنا|لدي)\b/i;

/** Called whenever approved knowledge changes so cached passages are dropped. */
export function invalidateKnowledgeCache(reason = "knowledge_change"): void {
  passageCache.clear();
  corpusVersion = `v${Date.now().toString(36)}:${reason.slice(0, 12)}`;
}

export function knowledgeCorpusVersion(): string {
  return corpusVersion;
}

function normalise(query: string): string {
  return query.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function cacheKey(query: string, lang: string, domain: string | null, clearance: number, limit: number) {
  return `${corpusVersion}|${clearance}|${lang}|${domain ?? "*"}|${limit}|${normalise(query)}`;
}

/* ------------------------------------------------------------------ */
/* Retrieval                                                            */
/* ------------------------------------------------------------------ */

type RpcRow = {
  source_type: string;
  source_id: string;
  chunk_id: string | null;
  title: string;
  section_title: string | null;
  snippet: string;
  citation_url: string | null;
  owning_unit: string | null;
  version: string | null;
  effective_date: string | null;
  confidentiality: string;
  knowledge_domain: string;
  language: string;
  document_type: string | null;
  page_number: number | null;
  lexical_score: number | null;
  fuzzy_score: number | null;
  semantic_score: number | null;
  authority: number | null;
  score: number | null;
  stale: boolean;
};

function toSource(r: RpcRow): RetrievedSource {
  const lexical = Number(r.lexical_score ?? 0);
  const fuzzy = Number(r.fuzzy_score ?? 0);
  return {
    sourceType: (r.source_type as RetrievedSource["sourceType"]) ?? "document",
    sourceId: r.source_id,
    chunkId: r.chunk_id,
    title: r.title,
    snippet: neutraliseForPrompt(String(r.snippet ?? "").slice(0, 900)),
    sectionTitle: r.section_title,
    pageNumber: r.page_number,
    citationUrl: r.citation_url,
    owningUnit: r.owning_unit,
    version: r.version,
    effectiveDate: r.effective_date,
    confidentiality: r.confidentiality,
    domain: r.knowledge_domain ?? "general",
    documentType: r.document_type,
    relevance: Math.max(lexical, fuzzy, Number(r.semantic_score ?? 0)),
    lexical,
    fuzzy,
    semantic: Number(r.semantic_score ?? 0),
    authority: Number(r.authority ?? 0.7),
    score: Number(r.score ?? 0),
    language: r.language ?? "en",
    stale: Boolean(r.stale),
  };
}

/** Query vectors are small and repeat often; a short cache keeps latency flat. */
const queryVectorCache = new Map<string, { value: string | null; expiresAt: number }>();

async function queryEmbedding(query: string): Promise<string | null> {
  const key = normalise(query);
  const hit = queryVectorCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const { embedQuery } = await import("./embeddings.server");
  const value = await embedQuery(query.slice(0, 2000)).catch(() => null);
  queryVectorCache.set(key, { value, expiresAt: Date.now() + 30 * 60 * 1000 });
  return value;
}

export async function retrieveKnowledge(
  db: Db,
  query: string,
  opts: {
    lang: string;
    perms: CenterPermissions;
    limit?: number;
    /** Explicit domain scope; omit to let the query hint decide. */
    domain?: KnowledgeDomain | null;
    /** Set false to force a fresh read (approval rehearsal, benchmarks). */
    useCache?: boolean;
  },
): Promise<RetrievedSource[]> {
  const limit = opts.limit ?? DEFAULT_PASSAGE_LIMIT;
  const clearance = clearanceFor(opts.perms);
  const domain = opts.domain === undefined ? inferDomain(query) : opts.domain;
  const key = cacheKey(query, opts.lang, domain, clearance, limit);
  const cacheable = (opts.useCache ?? true) && !PERSONAL.test(query);

  if (cacheable) {
    const hit = passageCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
  }

  const sectionTerms = sectionTermsFor(query);
  const queryVector = await queryEmbedding(query);
  // The ranking function is backend-only (no EXECUTE for signed-in users): the
  // clearance argument is derived server-side from the caller's roles above and
  // must never be supplied by a client-side call.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const run = (scopedDomain: string | null) =>
    supabaseAdmin.rpc("search_knowledge_passages", {
      p_query: query.slice(0, 400),
      p_lang: opts.lang === "ar" ? "ar" : "en",
      p_clearance: clearance,
      p_limit: limit,
      p_candidates: Math.max(40, limit * 8),
      p_section_terms: sectionTerms,
      ...(queryVector ? { p_query_embedding: queryVector } : {}),
      ...(scopedDomain ? { p_domain: scopedDomain } : {}),
    } as never);


  let { data, error } = await run(domain);
  // Domain scoping is an efficiency hint, never a correctness trap: if the
  // scoped search finds nothing, fall back once to the full approved corpus.
  if (!error && domain && (!data || (data as RpcRow[]).length === 0)) {
    ({ data, error } = await run(null));
  }
  if (error) throw new Error(`Knowledge retrieval failed: ${error.message}`);

  const passages = ((data ?? []) as RpcRow[]).map(toSource);
  if (cacheable) passageCache.set(key, { value: passages, expiresAt: Date.now() + CACHE_TTL_MS });
  return passages;
}

/**
 * Retrieval + grounding assessment + logging in one call. This is what the
 * orchestrator and its tools use for every policy/knowledge question.
 */
export async function retrieveForGrounding(
  db: Db,
  query: string,
  opts: {
    lang: string;
    perms: CenterPermissions;
    limit?: number;
    domain?: KnowledgeDomain | null;
    conversationId?: string | null;
    messageId?: string | null;
    traceId?: string | null;
    log?: boolean;
  },
): Promise<RetrievalOutcome> {
  const started = Date.now();
  const limit = opts.limit ?? DEFAULT_PASSAGE_LIMIT;
  const domain = opts.domain === undefined ? inferDomain(query) : opts.domain;
  const before = passageCache.size;
  const candidates = await retrieveKnowledge(db, query, {
    lang: opts.lang,
    perms: opts.perms,
    limit: Math.max(limit, DEFAULT_PASSAGE_LIMIT),
    domain,
  });
  const durationMs = Date.now() - started;
  const cacheHit = durationMs < 5 && passageCache.size === before;

  // Section-aware filtering: when the question names a section (objective,
  // scope, eligibility…) and a document does have a matching section, its
  // other sections are noise and must not be cited as the answer.
  const terms = sectionTermsFor(query);
  const relevant = (p: RetrievedSource) =>
    terms.some((t) =>
      `${p.sectionTitle ?? ""} ${p.title}`.toLowerCase().includes(t) ||
      p.snippet.toLowerCase().includes(t),
    );
  let ranked = candidates;
  if (terms.length) {
    const matchedDocs = new Set(candidates.filter(relevant).map((p) => p.sourceId));
    if (matchedDocs.size) ranked = candidates.filter((p) => !matchedDocs.has(p.sourceId) || relevant(p));
  }

  // Relevance floor: a passage that matched nothing in the question (no
  // keyword, no fuzzy, no semantic similarity) only scored well on priors such
  // as document authority. Sending it to the model invites wrong answers from
  // an unrelated policy, so it is discarded before grounding.
  // Generic words appear in nearly every university document, so they cannot
  // establish that a passage is about the question.
  const GENERIC = new Set([
    "university", "uaeu", "student", "students", "policy", "policies", "service", "services",
    "what", "which", "many", "does", "the", "for", "and", "are", "how", "with", "from",
    "الجامعة", "الطالب", "الطلبة", "سياسة", "الخدمة", "الخدمات", "كم", "عدد", "هي", "ما",
  ]);
  const distinctive = normalise(query)
    .split(" ")
    .filter((w) => w.length > 3 && !GENERIC.has(w));
  const overlaps = (p: RetrievedSource) => {
    if (!distinctive.length) return true;
    const hay = `${p.title} ${p.sectionTitle ?? ""} ${p.snippet}`.toLowerCase();
    return distinctive.some((w) => hay.includes(w));
  };
  const topical = (p: RetrievedSource) =>
    overlaps(p) || p.semantic >= 0.4 || (terms.length > 0 && relevant(p));

  const passages = ranked
    .filter((p) => p.score >= MIN_GROUNDING_SCORE && topical(p))
    .slice(0, limit);
  const conflicts = detectConflicts(passages);
  const top = passages[0];
  const groundingStatus: RetrievalOutcome["groundingStatus"] = conflicts.length
    ? "policy_conflict"
    : !top
      ? "no_evidence"
      : top.score >= 0.45
        ? "grounded"
        : "weak";

  if (opts.log !== false) {
    void logRetrieval(db, {
      conversationId: opts.conversationId ?? null,
      messageId: opts.messageId ?? null,
      traceId: opts.traceId ?? null,
      query,
      domain,
      lang: opts.lang,
      durationMs,
      candidateCount: candidates.length,
      groundingStatus,
      entries: candidates.map((source, index) => ({
        source,
        rank: index + 1,
        selected: passages.includes(source),
        cited: passages.includes(source),
      })),
    }).catch(() => undefined);
  }

  return {
    passages,
    candidateCount: candidates.length,
    durationMs,
    domain,
    groundingStatus,
    conflicts,
    cacheHit,
  };
}

/** Numeric-threshold contradiction detection across the retrieved passages. */
export function detectConflicts(sources: RetrievedSource[]): {
  topic: string;
  severity: "low" | "medium" | "high" | "critical";
  one: RetrievedSource;
  two: RetrievedSource;
  statementOne: string;
  statementTwo: string;
}[] {
  const patterns: { topic: string; re: RegExp }[] = [
    { topic: "credit-hour threshold", re: /(\d{1,3})\s*(credit hours?|credits|ساعة معتمدة|ساعات معتمدة)/gi },
    { topic: "deadline week", re: /week\s*(?:number\s*)?(\d{1,2})|الأسبوع\s*(?:ال)?(\w+)/gi },
  ];
  const conflicts: ReturnType<typeof detectConflicts> = [];

  for (const { topic, re } of patterns) {
    const claims: { source: RetrievedSource; value: string; sentence: string }[] = [];
    for (const s of sources) {
      for (const match of s.snippet.matchAll(re)) {
        const value = String(match[1] ?? match[2] ?? "").toLowerCase();
        if (!value) continue;
        const idx = match.index ?? 0;
        claims.push({
          source: s,
          value,
          sentence: s.snippet.slice(Math.max(0, idx - 100), idx + 110).trim(),
        });
      }
    }
    for (let i = 0; i < claims.length; i += 1) {
      for (let j = i + 1; j < claims.length; j += 1) {
        const a = claims[i]!;
        const b = claims[j]!;
        if (a.value === b.value || a.source.sourceId === b.source.sourceId) continue;
        // Only comparable statements conflict: same topic wording nearby.
        const sameTopic =
          topic === "deadline week"
            ? /withdraw|انسحاب/i.test(a.sentence) && /withdraw|انسحاب/i.test(b.sentence)
            : true;
        if (!sameTopic) continue;
        const authoritative = a.source.authority >= 0.9 || b.source.authority >= 0.9;
        conflicts.push({
          topic,
          severity: authoritative ? "high" : "medium",
          one: a.source,
          two: b.source,
          statementOne: a.sentence,
          statementTwo: b.sentence,
        });
      }
    }
  }
  return conflicts.slice(0, 5);
}

/** Persists every retrieval event so AI Ops can show real retrieval activity. */
export async function logRetrieval(
  db: Db,
  event: {
    conversationId: string | null;
    messageId: string | null;
    traceId: string | null;
    query: string;
    domain: string | null;
    lang: string;
    durationMs: number;
    candidateCount: number;
    groundingStatus: string;
    entries: { source: RetrievedSource; rank: number; selected: boolean; cited: boolean }[];
  },
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const selectedCount = event.entries.filter((e) => e.selected).length;
  const rows = event.entries.length
    ? event.entries.map((e) => ({
        conversation_id: event.conversationId,
        message_id: event.messageId,
        source_type: e.source.sourceType,
        source_id: e.source.sourceId,
        chunk_id: e.source.chunkId,
        retrieval_score: e.source.score,
        authority_score: e.source.authority,
        lexical_score: e.source.lexical,
        fuzzy_score: e.source.fuzzy,
        selected_for_response: e.selected,
        citation_used: e.cited,
        language: event.lang,
        trace_id: event.traceId,
        query_text: event.query.slice(0, 500),
        knowledge_domain: event.domain,
        retrieval_duration_ms: event.durationMs,
        candidate_count: event.candidateCount,
        selected_count: selectedCount,
        grounding_status: event.groundingStatus,
        knowledge_version: knowledgeCorpusVersion(),
        source_title: e.source.title.slice(0, 300),
        section_title: e.source.sectionTitle,
        effective_date: e.source.effectiveDate,
        rank_position: e.rank,
      }))
    : [
        {
          conversation_id: event.conversationId,
          message_id: event.messageId,
          source_type: "none",
          source_id: null,
          chunk_id: null,
          retrieval_score: 0,
          authority_score: 0,
          selected_for_response: false,
          citation_used: false,
          language: event.lang,
          trace_id: event.traceId,
          query_text: event.query.slice(0, 500),
          knowledge_domain: event.domain,
          retrieval_duration_ms: event.durationMs,
          candidate_count: 0,
          selected_count: 0,
          grounding_status: event.groundingStatus,
          knowledge_version: knowledgeCorpusVersion(),
        },
      ];
  await supabaseAdmin.from("knowledge_retrieval_logs").insert(rows as never);
}

/** Compact, prompt-ready rendering of the selected passages. */
export function formatPassagesForPrompt(passages: RetrievedSource[], lang: string): string {
  if (!passages.length) return "";
  return passages
    .map((p, i) => {
      const meta = [
        p.title,
        p.sectionTitle ? `§ ${p.sectionTitle}` : null,
        p.version ? `v${p.version}` : null,
        p.effectiveDate ? `effective ${p.effectiveDate}` : null,
        p.owningUnit,
      ]
        .filter(Boolean)
        .join(" · ");
      return `[P${i + 1}] ${meta}\n${p.snippet}`;
    })
    .join("\n\n")
    .slice(0, lang === "ar" ? 6000 : 5000);
}
