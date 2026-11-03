create extension if not exists vector;

alter table public.document_chunks add column if not exists embedding vector(1536);
alter table public.web_page_chunks add column if not exists embedding vector(1536);

create index if not exists document_chunks_embedding_idx on public.document_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists web_page_chunks_embedding_idx on public.web_page_chunks using hnsw (embedding vector_cosine_ops);

drop function if exists public.search_knowledge_passages(text, text, integer, text, integer, integer, text[]);

CREATE OR REPLACE FUNCTION public.search_knowledge_passages(
  p_query text,
  p_lang text DEFAULT 'en'::text,
  p_clearance integer DEFAULT 1,
  p_domain text DEFAULT NULL::text,
  p_limit integer DEFAULT 5,
  p_candidates integer DEFAULT 40,
  p_section_terms text[] DEFAULT '{}'::text[],
  p_query_embedding text DEFAULT NULL::text
)
 RETURNS TABLE(source_type text, source_id uuid, chunk_id uuid, title text, section_title text, snippet text, citation_url text, owning_unit text, version text, effective_date date, confidentiality text, knowledge_domain text, language text, document_type text, page_number integer, lexical_score numeric, fuzzy_score numeric, semantic_score numeric, authority numeric, score numeric, stale boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH q AS (
  SELECT
    coalesce(
      to_tsquery('simple', nullif(array_to_string(ARRAY(
        SELECT DISTINCT lex FROM unnest(tsvector_to_array(to_tsvector('simple', coalesce(p_query, '')))) AS lex
        WHERE length(lex) > 2
      ), ' | '), '')),
      ''::tsquery
    ) AS tsq,
    ARRAY(
      SELECT DISTINCT lex FROM unnest(tsvector_to_array(to_tsvector('simple', coalesce(p_query, '')))) AS lex
      WHERE length(lex) > 2
    ) AS words,
    lower(coalesce(p_query, '')) AS raw,
    CURRENT_DATE AS today,
    ARRAY(SELECT lower(t) FROM unnest(coalesce(p_section_terms, '{}'::text[])) AS t WHERE length(t) > 2) AS sect,
    nullif(trim(coalesce(p_query_embedding, '')), '')::vector(1536) AS qvec,
    CASE
      WHEN p_clearance >= 4 THEN ARRAY['public','student_authenticated','staff_only','restricted','highly_restricted']
      WHEN p_clearance = 3 THEN ARRAY['public','student_authenticated','staff_only','restricted']
      WHEN p_clearance = 2 THEN ARRAY['public','student_authenticated','staff_only']
      ELSE ARRAY['public','student_authenticated']
    END AS allowed
),
chunks AS (
  SELECT
    'document'::text AS source_type,
    d.id AS source_id,
    c.id AS chunk_id,
    d.title,
    c.section_title,
    left(c.content, 900) AS snippet,
    d.citation_url,
    CASE WHEN p_lang = 'ar' THEN u.name_ar ELSE u.name_en END AS owning_unit,
    d.version,
    d.effective_date,
    d.confidentiality_level AS confidentiality,
    coalesce(d.knowledge_domain, 'general') AS knowledge_domain,
    d.language::text AS language,
    d.document_type,
    c.page_number,
    ts_rank_cd(c.search_vector, q.tsq, 32)::numeric AS lexical_score,
    word_similarity(q.raw, left(c.content, 2000))::numeric AS fuzzy_score,
    (CASE WHEN q.qvec IS NOT NULL AND c.embedding IS NOT NULL
          THEN greatest(0, 1 - (c.embedding <=> q.qvec)) ELSE 0 END)::numeric AS semantic_score,
    (CASE d.document_type
       WHEN 'policy' THEN 1.0 WHEN 'regulation' THEN 1.0
       WHEN 'procedure' THEN 0.9 WHEN 'guide' THEN 0.8
       WHEN 'service_guide' THEN 0.8 ELSE 0.7 END)::numeric AS authority,
    false AS stale
  FROM public.document_chunks c
  JOIN public.knowledge_documents d ON d.id = c.document_id
  LEFT JOIN public.service_units u ON u.id = coalesce(d.owner_unit_id, d.service_unit_id)
  CROSS JOIN q
  WHERE c.is_active
    AND d.is_active AND d.deleted_at IS NULL
    AND d.approval_status = 'approved'
    AND d.is_current
    AND d.superseded_by_document_id IS NULL
    AND (d.effective_date IS NULL OR d.effective_date <= q.today)
    AND (d.expiry_date IS NULL OR d.expiry_date >= q.today)
    AND d.confidentiality_level = ANY (q.allowed)
    AND (p_domain IS NULL OR coalesce(d.knowledge_domain, 'general') IN (p_domain, 'general'))
    AND (c.search_vector @@ q.tsq
         OR word_similarity(q.raw, left(c.content, 2000)) > 0.3
         OR (q.qvec IS NOT NULL AND c.embedding IS NOT NULL AND (c.embedding <=> q.qvec) < 0.62)
         OR EXISTS (SELECT 1 FROM unnest(q.sect) AS t
                    WHERE lower(coalesce(c.section_title, '')) LIKE '%' || t || '%'
                       OR lower(coalesce(c.section_path, '')) LIKE '%' || t || '%'))
),
faqs AS (
  SELECT
    'faq'::text, f.id, NULL::uuid,
    CASE WHEN p_lang = 'ar' THEN f.question_ar ELSE f.question_en END,
    f.source_section,
    left(CASE WHEN p_lang = 'ar' THEN f.answer_ar ELSE f.answer_en END, 900),
    NULL::text,
    CASE WHEN p_lang = 'ar' THEN u.name_ar ELSE u.name_en END,
    NULL::text,
    f.effective_date,
    'student_authenticated'::text,
    coalesce(f.knowledge_domain, 'general'),
    p_lang,
    'faq'::text,
    NULL::int,
    ts_rank_cd(f.search_vector, q.tsq, 32)::numeric,
    word_similarity(q.raw, coalesce(f.question_en, '') || ' ' || coalesce(f.question_ar, ''))::numeric,
    0::numeric,
    0.6::numeric,
    false
  FROM public.faq_items f
  CROSS JOIN q
  LEFT JOIN public.service_units u ON u.id = f.service_unit_id
  WHERE f.is_active
    AND f.approval_status = 'approved'
    AND (f.effective_date IS NULL OR f.effective_date <= q.today)
    AND (f.expiry_date IS NULL OR f.expiry_date >= q.today)
    AND (p_domain IS NULL OR coalesce(f.knowledge_domain, 'general') IN (p_domain, 'general'))
    AND (f.search_vector @@ q.tsq
         OR word_similarity(q.raw, coalesce(f.question_en, '') || ' ' || coalesce(f.question_ar, '')) > 0.35)
),
webs AS (
  SELECT
    'web_source'::text, w.id, wc.id,
    coalesce(wc.page_title, w.title),
    wc.section_title,
    left(wc.content, 900),
    wc.source_url,
    CASE WHEN p_lang = 'ar' THEN u.name_ar ELSE u.name_en END,
    NULL::text, NULL::date,
    w.confidentiality_level,
    coalesce(w.knowledge_domain, 'general'),
    wc.language,
    'web_page'::text,
    NULL::int,
    ts_rank_cd(wc.search_vector, q.tsq, 32)::numeric,
    word_similarity(q.raw, left(wc.content, 2000))::numeric,
    (CASE WHEN q.qvec IS NOT NULL AND wc.embedding IS NOT NULL
          THEN greatest(0, 1 - (wc.embedding <=> q.qvec)) ELSE 0 END)::numeric,
    0.85::numeric,
    (w.change_detected
      OR w.last_successful_fetch_at IS NULL
      OR w.last_successful_fetch_at < now() - interval '120 days')
  FROM public.web_page_chunks wc
  JOIN public.web_knowledge_sources w ON w.id = wc.web_source_id
  CROSS JOIN q
  LEFT JOIN public.service_units u ON u.id = w.owner_unit_id
  WHERE wc.is_active
    AND w.is_active
    AND w.approval_status = 'approved'
    AND w.confidentiality_level = ANY (q.allowed)
    AND (p_domain IS NULL OR coalesce(w.knowledge_domain, 'general') IN (p_domain, 'general'))
    AND (wc.search_vector @@ q.tsq
         OR word_similarity(q.raw, left(wc.content, 2000)) > 0.3
         OR (q.qvec IS NOT NULL AND wc.embedding IS NOT NULL AND (wc.embedding <=> q.qvec) < 0.62)
         OR EXISTS (SELECT 1 FROM unnest(q.sect) AS t
                    WHERE lower(coalesce(wc.section_title, '')) LIKE '%' || t || '%'))
),
unioned AS (
  SELECT * FROM chunks
  UNION ALL SELECT * FROM faqs
  UNION ALL SELECT * FROM webs
),
scored AS (
  SELECT
    u.*,
    (
      0.24 * least(coalesce(u.lexical_score, 0), 1.0)
      + 0.20 * (
          SELECT coalesce(
            count(*) FILTER (
              WHERE position(w IN lower(coalesce(u.title,'') || ' ' || coalesce(u.section_title,'') || ' ' || coalesce(u.snippet,''))) > 0
            )::numeric / nullif(count(*), 0), 0)
          FROM unnest(q.words) AS w
        )
      + 0.10 * least(coalesce(u.fuzzy_score, 0), 1.0)
      + 0.22 * least(coalesce(u.semantic_score, 0), 1.0)
      + 0.18 * u.authority
      + CASE WHEN u.language = p_lang THEN 0.05 ELSE 0 END
      + CASE WHEN u.chunk_id IS NOT NULL THEN 0.03 ELSE 0 END
      + CASE WHEN u.section_title IS NOT NULL AND EXISTS (
               SELECT 1 FROM unnest(q.sect) AS t WHERE lower(u.section_title) LIKE '%' || t || '%')
             THEN 0.45 ELSE 0 END
      - CASE WHEN array_length(q.sect, 1) IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM unnest(q.sect) AS t
                                  WHERE lower(coalesce(u.section_title,'')) LIKE '%' || t || '%'
                                     OR lower(coalesce(u.title,'')) LIKE '%' || t || '%')
             THEN 0.12 ELSE 0 END
      + CASE WHEN u.section_title IS NOT NULL AND EXISTS (
               SELECT 1 FROM unnest(q.words) AS w WHERE position(w IN lower(u.section_title)) > 0)
             THEN 0.10 ELSE 0 END
      - CASE WHEN u.stale THEN 0.15 ELSE 0 END
      - CASE
          WHEN u.effective_date IS NOT NULL
            THEN least(greatest((CURRENT_DATE - u.effective_date)::numeric / 3650.0, 0), 0.05)
          ELSE 0.02 END
    )::numeric AS score
  FROM unioned u CROSS JOIN q
)
SELECT
  s.source_type, s.source_id, s.chunk_id, s.title, s.section_title, s.snippet,
  s.citation_url, s.owning_unit, s.version, s.effective_date, s.confidentiality,
  s.knowledge_domain, s.language, s.document_type, s.page_number,
  s.lexical_score, s.fuzzy_score, s.semantic_score, s.authority, s.score, s.stale
FROM (SELECT * FROM scored ORDER BY score DESC LIMIT p_candidates) s
ORDER BY s.score DESC
LIMIT p_limit;
$function$;

REVOKE ALL ON FUNCTION public.search_knowledge_passages(text, text, integer, text, integer, integer, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_knowledge_passages(text, text, integer, text, integer, integer, text[], text) TO authenticated, service_role;