DO $do$
DECLARE
  f oid;
  src text;
  args text;
  ret text;
BEGIN
  SELECT p.oid, p.prosrc, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)
    INTO f, src, args, ret
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'search_knowledge_passages';

  src := replace(src,
    'AND (p_domain IS NULL OR coalesce(d.knowledge_domain, ''general'') = p_domain)',
    'AND (p_domain IS NULL OR coalesce(d.knowledge_domain, ''general'') IN (p_domain, ''general''))');
  src := replace(src,
    'AND (p_domain IS NULL OR coalesce(f.knowledge_domain, ''general'') = p_domain)',
    'AND (p_domain IS NULL OR coalesce(f.knowledge_domain, ''general'') IN (p_domain, ''general''))');
  src := replace(src,
    'AND (p_domain IS NULL OR coalesce(w.knowledge_domain, ''general'') = p_domain)',
    'AND (p_domain IS NULL OR coalesce(w.knowledge_domain, ''general'') IN (p_domain, ''general''))');

  src := replace(src,
    '             THEN 0.20 ELSE 0 END',
    '             THEN 0.45 ELSE 0 END
      - CASE WHEN array_length(q.sect, 1) IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM unnest(q.sect) AS t
                                  WHERE lower(coalesce(u.section_title,'''')) LIKE ''%'' || t || ''%''
                                     OR lower(coalesce(u.title,'''')) LIKE ''%'' || t || ''%'')
             THEN 0.12 ELSE 0 END');

  IF position('0.45 ELSE 0 END' IN src) = 0 THEN
    RAISE EXCEPTION 'section boost patch did not apply';
  END IF;
  IF position('IN (p_domain, ''general'')' IN src) = 0 THEN
    RAISE EXCEPTION 'domain patch did not apply';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.search_knowledge_passages(%s) RETURNS %s LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$%s$fn$',
    args, ret, src);
END
$do$;

REVOKE ALL ON FUNCTION public.search_knowledge_passages(text, text, integer, text, integer, integer, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_knowledge_passages(text, text, integer, text, integer, integer, text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_knowledge_passages(text, text, integer, text, integer, integer, text[]) TO authenticated, service_role;