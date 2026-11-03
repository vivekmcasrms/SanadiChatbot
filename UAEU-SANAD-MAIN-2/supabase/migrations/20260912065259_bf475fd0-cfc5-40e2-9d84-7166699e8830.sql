-- 1) Tighten case-evidence writes: staging only in the approved 'chat' folder,
--    exactly one folder level, per-case folder still requires case access.
CREATE OR REPLACE FUNCTION public.can_write_case_evidence(_name text, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $func$
DECLARE parts text[]; seg text;
BEGIN
  parts := storage.foldername(_name);
  IF parts[1] IS DISTINCT FROM _user_id::text THEN
    RETURN false;
  END IF;
  -- exactly one folder level below the owner's folder: no arbitrary nesting
  IF array_length(parts, 1) IS DISTINCT FROM 2 THEN
    RETURN false;
  END IF;
  seg := parts[2];
  IF seg ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN public.can_access_case(seg::uuid, _user_id);
  END IF;
  -- staging folders are restricted to the approved assistant staging area
  RETURN seg = 'chat';
END;
$func$;

-- 2) Staff may view profile PII only for students they actually work with
--    (assigned case or same service unit). Admins and auditors keep oversight access.
CREATE OR REPLACE FUNCTION public.staff_can_view_profile(_viewer uuid, _profile uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $func$
  SELECT
    public.has_role(_viewer, 'system_admin')
    OR public.has_role(_viewer, 'auditor')
    OR EXISTS (
      SELECT 1
      FROM public.cases c
      WHERE c.student_id = _profile
        AND (
          c.assigned_to = _viewer
          OR c.service_unit_id = public.staff_unit(_viewer)
          OR EXISTS (
            SELECT 1
            FROM public.staff_profiles sp
            WHERE sp.user_id = _viewer
              AND sp.service_unit_id = c.service_unit_id
              AND sp.is_active
          )
          OR EXISTS (
            SELECT 1
            FROM public.service_staff ss
            JOIN public.staff_profiles sp ON sp.user_id = ss.staff_profile_id
            WHERE sp.user_id = _viewer
              AND ss.service_unit_id = c.service_unit_id
              AND ss.is_active
          )
        )
    );
$func$;

DROP POLICY IF EXISTS "own profile" ON public.profiles;
CREATE POLICY "own profile" ON public.profiles
FOR SELECT USING (
  id = auth.uid()
  OR public.staff_can_view_profile(auth.uid(), id)
);

-- 3) Knowledge files: scope access to the owning unit of the linked knowledge
--    document. Unlinked staging uploads and unit-less documents stay accessible
--    to knowledge managers; system admins keep full access.
CREATE OR REPLACE FUNCTION public.can_access_knowledge_file(_name text, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $func$
DECLARE doc_unit uuid;
BEGIN
  IF NOT public.can_manage_knowledge(_user_id) THEN
    RETURN false;
  END IF;
  IF public.has_role(_user_id, 'system_admin') THEN
    RETURN true;
  END IF;
  SELECT kd.owner_unit_id INTO doc_unit
  FROM public.knowledge_documents kd
  WHERE kd.storage_path = _name
  LIMIT 1;
  IF NOT FOUND OR doc_unit IS NULL THEN
    RETURN true; -- staging upload or document without an owning unit
  END IF;
  RETURN doc_unit = public.staff_unit(_user_id);
END;
$func$;

DROP POLICY IF EXISTS knowledge_files_read ON storage.objects;
DROP POLICY IF EXISTS knowledge_files_insert ON storage.objects;
DROP POLICY IF EXISTS knowledge_files_update ON storage.objects;
DROP POLICY IF EXISTS knowledge_files_delete ON storage.objects;

CREATE POLICY knowledge_files_read ON storage.objects
FOR SELECT USING (
  bucket_id = 'knowledge-files'
  AND public.can_access_knowledge_file(name, auth.uid())
);
CREATE POLICY knowledge_files_insert ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'knowledge-files'
  AND public.can_access_knowledge_file(name, auth.uid())
);
CREATE POLICY knowledge_files_update ON storage.objects
FOR UPDATE USING (
  bucket_id = 'knowledge-files'
  AND public.can_access_knowledge_file(name, auth.uid())
) WITH CHECK (
  bucket_id = 'knowledge-files'
  AND public.can_access_knowledge_file(name, auth.uid())
);
CREATE POLICY knowledge_files_delete ON storage.objects
FOR DELETE USING (
  bucket_id = 'knowledge-files'
  AND public.can_access_knowledge_file(name, auth.uid())
);

-- 4) Remove PUBLIC and anonymous EXECUTE from every SECURITY DEFINER function.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM public, anon', f.sig);
  END LOOP;
END $$;

-- 5) Internal-only SECURITY DEFINER functions (triggers, backend jobs,
--    admin-client RPCs) must not be callable by ordinary signed-in users.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND p.proname IN (
        'handle_new_user',
        'claim_notification_deliveries',
        'expire_student_documents',
        'purge_expired_documents',
        'next_document_reference',
        'burn_verification_token',
        'tombstone_document_verification',
        'verify_student_document',
        'track_case_responsibility',
        'log_service_availability_change'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', f.sig);
  END LOOP;
END $$;

-- 6) Ensure authenticated EXECUTE on the SECURITY DEFINER helpers the app and
--    its RLS policies legitimately call (in case any relied on the PUBLIC default).
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND p.proname NOT IN (
        'handle_new_user',
        'claim_notification_deliveries',
        'expire_student_documents',
        'purge_expired_documents',
        'next_document_reference',
        'burn_verification_token',
        'tombstone_document_verification',
        'verify_student_document',
        'track_case_responsibility',
        'log_service_availability_change'
      )
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;