
DROP POLICY IF EXISTS "users upload own evidence" ON storage.objects;
DROP POLICY IF EXISTS "users update own evidence" ON storage.objects;
DROP POLICY IF EXISTS "users delete own evidence" ON storage.objects;

CREATE OR REPLACE FUNCTION public.can_write_case_evidence(_name text, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE parts text[]; seg text;
BEGIN
  parts := storage.foldername(_name);
  IF parts[1] IS DISTINCT FROM _user_id::text THEN
    RETURN false;
  END IF;
  seg := parts[2];
  IF seg ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN public.can_access_case(seg::uuid, _user_id);
  END IF;
  -- staging folders (e.g. assistant chat) stay scoped to the owner's folder
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.can_write_case_evidence(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_write_case_evidence(text, uuid) TO authenticated;

CREATE POLICY "users upload own evidence" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'case-evidence' AND public.can_write_case_evidence(name, auth.uid()));

CREATE POLICY "users update own evidence" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'case-evidence' AND public.can_write_case_evidence(name, auth.uid()))
  WITH CHECK (bucket_id = 'case-evidence' AND public.can_write_case_evidence(name, auth.uid()));

CREATE POLICY "users delete own evidence" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'case-evidence' AND public.can_write_case_evidence(name, auth.uid()));
