ALTER TABLE public.issued_documents
  ADD COLUMN IF NOT EXISTS file_cleanup_status text,
  ADD COLUMN IF NOT EXISTS file_cleanup_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS file_cleanup_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS file_cleanup_error text,
  ADD COLUMN IF NOT EXISTS file_removed_at timestamptz;

ALTER TABLE public.issued_documents DROP CONSTRAINT IF EXISTS issued_documents_file_cleanup_status_chk;
ALTER TABLE public.issued_documents ADD CONSTRAINT issued_documents_file_cleanup_status_chk
  CHECK (file_cleanup_status IS NULL OR file_cleanup_status IN ('pending','removed','failed'));

CREATE INDEX IF NOT EXISTS issued_documents_file_cleanup_idx
  ON public.issued_documents (retention_expires_at) WHERE file_path IS NOT NULL;

-- Step 1+2: pick files due for removal and mark them pending. Rows stay.
CREATE OR REPLACE FUNCTION public.claim_document_file_cleanup(_limit integer DEFAULT 100)
RETURNS TABLE(id uuid, reference_number text, file_path text, attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT d.id FROM public.issued_documents d
     WHERE d.file_path IS NOT NULL
       AND (d.retention_expires_at <= now()
            OR d.deleted_at IS NOT NULL
            OR d.document_status IN ('deleted_by_student','revoked','expired'))
       AND (d.file_cleanup_status IS NULL
            -- failed: retry with backoff (15 min x attempts, max 6 h)
            OR (d.file_cleanup_status = 'failed'
                AND d.file_cleanup_last_attempt_at < now() - LEAST(d.file_cleanup_attempts, 24) * interval '15 minutes')
            -- pending that never finished (crashed run) is retried after 1 h
            OR (d.file_cleanup_status = 'pending' AND d.file_cleanup_last_attempt_at < now() - interval '1 hour'))
     ORDER BY d.retention_expires_at NULLS FIRST
     LIMIT GREATEST(_limit, 1)
     FOR UPDATE OF d SKIP LOCKED
  )
  UPDATE public.issued_documents t
     SET file_cleanup_status = 'pending',
         file_cleanup_attempts = t.file_cleanup_attempts + 1,
         file_cleanup_last_attempt_at = now()
    FROM due WHERE t.id = due.id
  RETURNING t.id, t.reference_number, t.file_path, t.file_cleanup_attempts;
END; $$;

-- Steps 4+5: record the verified outcome. Only success clears the file path.
CREATE OR REPLACE FUNCTION public.complete_document_file_cleanup(_id uuid, _removed boolean, _error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE d public.issued_documents;
BEGIN
  SELECT * INTO d FROM public.issued_documents WHERE id = _id FOR UPDATE;
  IF d.id IS NULL THEN RETURN; END IF;
  IF _removed THEN
    UPDATE public.issued_documents
       SET file_path = NULL, file_removed_at = now(), file_cleanup_status = 'removed', file_cleanup_error = NULL
     WHERE id = _id;
    INSERT INTO public.document_events (document_id, reference_number, event_type, actor_type, details)
    VALUES (d.id, d.reference_number, 'file_removed', 'system', jsonb_build_object('attempts', d.file_cleanup_attempts));
  ELSE
    UPDATE public.issued_documents
       SET file_cleanup_status = 'failed', file_cleanup_error = left(COALESCE(_error,'unknown'), 300)
     WHERE id = _id;
    INSERT INTO public.document_events (document_id, reference_number, event_type, actor_type, details)
    VALUES (d.id, d.reference_number, 'file_cleanup_failed', 'system',
            jsonb_build_object('attempts', d.file_cleanup_attempts, 'error', left(COALESCE(_error,'unknown'), 300)));
  END IF;
END; $$;

-- Step 7: metadata is purged only once the file is confirmed gone AND
-- verification has ended (validity date passed, revoked, or withdrawn).
CREATE OR REPLACE FUNCTION public.purge_expired_documents(_limit integer DEFAULT 200)
RETURNS TABLE(id uuid, reference_number text, file_path text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT d.id, d.reference_number, d.file_path, d.document_type, d.student_id, d.issued_at,
           CASE
             WHEN d.deleted_by IS NOT NULL OR d.document_status = 'deleted_by_student' THEN 'Student Requested'
             WHEN d.document_status = 'revoked' THEN 'Administrator Action'
             ELSE 'Automatic Retention Expiry'
           END AS deletion_type
      FROM public.issued_documents d
     WHERE d.file_path IS NULL
       AND (d.file_cleanup_status = 'removed' OR d.file_cleanup_status IS NULL)
       AND (d.expires_at <= now()
            OR d.deleted_at IS NOT NULL
            OR d.document_status IN ('deleted_by_student', 'revoked'))
     ORDER BY d.issued_at
     LIMIT GREATEST(_limit, 1)
     FOR UPDATE OF d SKIP LOCKED
  ), audit AS (
    INSERT INTO public.document_deletion_records
      (document_id, reference_number, document_type, student_id, created_at, deleted_at, deletion_type, actor_type, actor_id)
    SELECT due.id, due.reference_number, due.document_type, due.student_id, due.issued_at, now(), due.deletion_type,
           CASE WHEN due.deletion_type = 'Student Requested' THEN 'student'
                WHEN due.deletion_type = 'Administrator Action' THEN 'human' ELSE 'system' END, NULL
      FROM due ON CONFLICT (document_id) DO NOTHING RETURNING 1
  ), unlink AS (
    UPDATE public.issued_documents t SET superseded_by = NULL FROM due WHERE t.superseded_by = due.id RETURNING 1
  ), del AS (
    DELETE FROM public.issued_documents t USING due WHERE t.id = due.id RETURNING t.id
  )
  SELECT due.id, due.reference_number, due.file_path FROM due JOIN del ON del.id = due.id;
END; $function$;

-- Student withdrawal no longer deletes the row first: it marks the letter
-- withdrawn; the file is removed next and the row purged afterwards.
CREATE OR REPLACE FUNCTION public.purge_my_issued_document(_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE d public.issued_documents; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO d FROM public.issued_documents WHERE id = _document_id FOR UPDATE;
  IF d.id IS NULL OR d.student_id <> uid OR d.document_status = 'deleted_by_student' THEN
    RAISE EXCEPTION 'This document is not available.';
  END IF;
  UPDATE public.issued_documents
     SET document_status = 'deleted_by_student', deleted_at = now(), deleted_by = uid,
         deletion_reason = 'Student Requested',
         file_cleanup_status = CASE WHEN d.file_path IS NULL THEN file_cleanup_status ELSE 'pending' END,
         file_cleanup_attempts = file_cleanup_attempts + CASE WHEN d.file_path IS NULL THEN 0 ELSE 1 END,
         file_cleanup_last_attempt_at = now()
   WHERE id = d.id;
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (uid, 'document.withdrawn', 'issued_document', d.id,
          jsonb_build_object('reference', d.reference_number, 'documentType', d.document_type, 'deletionType', 'Student Requested'));
  RETURN jsonb_build_object('id', d.id, 'reference', d.reference_number, 'filePath', d.file_path);
END; $function$;

REVOKE ALL ON FUNCTION public.claim_document_file_cleanup(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_document_file_cleanup(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_document_file_cleanup(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_document_file_cleanup(uuid, boolean, text) TO service_role;