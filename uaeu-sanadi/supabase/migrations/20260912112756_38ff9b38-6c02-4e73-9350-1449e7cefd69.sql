-- 1) Case evidence: staff read limited to cases they may access
CREATE OR REPLACE FUNCTION public.can_read_case_evidence(_name text, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE parts text[]; seg text;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  parts := storage.foldername(_name);
  IF parts[1] = _user_id::text THEN RETURN true; END IF;
  IF NOT public.is_staff(_user_id) THEN RETURN false; END IF;
  IF array_length(parts, 1) < 2 THEN RETURN false; END IF;
  seg := parts[2];
  IF seg ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN public.can_access_case(seg::uuid, _user_id);
  END IF;
  RETURN false;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.can_read_case_evidence(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_read_case_evidence(text, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "users read own evidence" ON storage.objects;
CREATE POLICY "users read own evidence"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'case-evidence' AND public.can_read_case_evidence(name, auth.uid()));

-- 2) Student profile visibility scoped to actual case involvement
CREATE OR REPLACE FUNCTION public.staff_can_view_profile(_viewer uuid, _profile uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    public.has_role(_viewer, 'system_admin')
    OR public.has_role(_viewer, 'auditor')
    OR EXISTS (
      SELECT 1
      FROM public.cases c
      WHERE c.student_id = _profile
        AND (
          c.assigned_to = _viewer
          OR public.owns_service_unit(_viewer, c.service_unit_id)
          OR (
            c.assigned_to IS NULL
            AND (
              c.service_unit_id = public.staff_unit(_viewer)
              OR EXISTS (
                SELECT 1 FROM public.staff_profiles sp
                WHERE sp.user_id = _viewer AND sp.service_unit_id = c.service_unit_id AND sp.is_active
              )
              OR EXISTS (
                SELECT 1
                FROM public.service_staff ss
                JOIN public.staff_profiles sp ON sp.user_id = ss.staff_profile_id
                WHERE sp.user_id = _viewer AND ss.service_unit_id = c.service_unit_id AND ss.is_active
              )
            )
          )
        )
    );
$function$;

-- 3) Issued student letters: explicit, documented write rules (backend only)
DROP POLICY IF EXISTS "no client writes to student letters" ON storage.objects;
CREATE POLICY "no client writes to student letters"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id <> 'student-letters');

DROP POLICY IF EXISTS "no client updates to student letters" ON storage.objects;
CREATE POLICY "no client updates to student letters"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id <> 'student-letters')
WITH CHECK (bucket_id <> 'student-letters');

DROP POLICY IF EXISTS "no client deletes of student letters" ON storage.objects;
CREATE POLICY "no client deletes of student letters"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id <> 'student-letters');

-- 4) Privileged SECURITY DEFINER routines: backend-only execution
REVOKE EXECUTE ON FUNCTION public.reserve_hostel_bed(uuid, uuid, date, uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_hostel_allocation(uuid, uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_internship_seat(uuid, numeric, uuid, uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.change_internship_assignment(uuid, uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decide_internship_clearance(uuid, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_intercollege_transfer(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_hostel_bed(uuid, uuid, date, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_hostel_allocation(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_internship_seat(uuid, numeric, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.change_internship_assignment(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_internship_clearance(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_intercollege_transfer(uuid, text) TO service_role;