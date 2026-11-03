CREATE OR REPLACE FUNCTION public.verify_student_document(_token text, _client_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  d public.issued_documents;
  display_name text;
  parts text[];
  effective_status text;
  thash text := encode(sha256(convert_to(COALESCE(_token,''), 'UTF8')), 'hex');
  chash text := left(COALESCE(NULLIF(btrim(_client_hash), ''), 'unknown'), 128);
  per_minute integer;
  per_hour integer;
  tomb public.document_verification_tombstones;
BEGIN
  SELECT count(*) INTO per_minute FROM public.document_verification_attempts
   WHERE client_hash = chash AND created_at > now() - interval '1 minute';
  SELECT count(*) INTO per_hour FROM public.document_verification_attempts
   WHERE client_hash = chash AND created_at > now() - interval '1 hour';

  IF per_minute >= 10 OR per_hour >= 60 THEN
    INSERT INTO public.document_verification_attempts (token_hash, client_hash, outcome)
    VALUES (thash, chash, 'rate_limited');
    RETURN jsonb_build_object('found', false, 'rateLimited', true);
  END IF;

  IF _token IS NULL OR length(_token) < 32 OR _token !~ '^[A-Za-z0-9_-]+$' OR _token LIKE 'burned-%' THEN
    INSERT INTO public.document_verification_attempts (token_hash, client_hash, outcome)
    VALUES (thash, chash, 'malformed');
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT * INTO d FROM public.issued_documents WHERE secure_verification_token = _token;
  IF d.id IS NULL THEN
    SELECT * INTO tomb FROM public.document_verification_tombstones WHERE token_hash = thash;
    IF tomb.token_hash IS NOT NULL THEN
      INSERT INTO public.document_verification_attempts (token_hash, client_hash, outcome)
      VALUES (thash, chash, 'unavailable');
      RETURN jsonb_build_object('found', true, 'status', 'unavailable');
    END IF;
    INSERT INTO public.document_verification_attempts (token_hash, client_hash, outcome)
    VALUES (thash, chash, 'not_found');
    RETURN jsonb_build_object('found', false);
  END IF;

  -- Verification validity follows expires_at only; file retention is separate.
  effective_status := CASE
      WHEN d.document_status = 'deleted_by_student' OR d.deleted_by IS NOT NULL THEN 'withdrawn'
      WHEN d.verification_status = 'revoked' OR d.document_status = 'revoked' THEN 'withdrawn'
      WHEN d.document_status = 'expired' THEN 'expired'
      WHEN d.expires_at IS NOT NULL AND d.expires_at < now() THEN 'expired'
      ELSE d.document_status END;

  UPDATE public.issued_documents
     SET verification_count = verification_count + 1,
         secure_verification_token = CASE
           WHEN effective_status <> 'valid'
             THEN 'burned-' || replace(gen_random_uuid()::text, '-', '')
           ELSE secure_verification_token END
   WHERE id = d.id;

  IF effective_status <> 'valid' THEN
    INSERT INTO public.document_verification_tombstones (token_hash, reference_number, reason)
    VALUES (thash, d.reference_number, effective_status)
    ON CONFLICT (token_hash) DO NOTHING;
  END IF;

  INSERT INTO public.document_events (document_id, reference_number, event_type, actor_type, details)
  VALUES (d.id, d.reference_number, 'verified', 'public',
          jsonb_build_object('status', effective_status, 'client', chash));

  INSERT INTO public.document_verification_attempts (token_hash, client_hash, outcome)
  VALUES (thash, chash, effective_status);

  IF effective_status <> 'valid' THEN
    RETURN jsonb_build_object('found', true, 'status', 'unavailable', 'reference', d.reference_number);
  END IF;

  parts := string_to_array(btrim(COALESCE(d.snapshot->>'studentName','')), ' ');
  display_name := COALESCE(d.snapshot->>'studentName','');
  IF array_length(parts,1) > 2 THEN
    display_name := parts[1] || ' ' || left(parts[2],1) || '. ' || parts[array_length(parts,1)];
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'status', 'valid',
    'documentType', d.document_type,
    'titleEn', d.title_en,
    'titleAr', d.title_ar,
    'reference', d.reference_number,
    'studentName', display_name,
    'studentNameAr', d.snapshot->>'studentNameAr',
    'programme', d.snapshot->>'programmeEn',
    'programmeAr', d.snapshot->>'programmeAr',
    'college', d.snapshot->>'collegeEn',
    'collegeAr', d.snapshot->>'collegeAr',
    'issuedAt', d.issued_at,
    'expiresAt', d.expires_at,
    'fileAvailable', (d.file_path IS NOT NULL AND d.retention_expires_at > now()),
    'language', d.language,
    'documentHash', d.document_hash,
    'digitallySigned', d.digitally_signed,
    'isDemoDocument', d.is_demo_document
  );
END; $function$;