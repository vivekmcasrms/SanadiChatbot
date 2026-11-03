-- 1. Revocation also covers disabled (banned) and deleted sign-in accounts.
CREATE OR REPLACE FUNCTION public.is_access_revoked(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND access_revoked_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _user_id AND ((u.banned_until IS NOT NULL AND u.banned_until > now()) OR u.deleted_at IS NOT NULL));
$$;

-- 2. Single source of effective roles. Revoked/disabled accounts keep only "student".
CREATE OR REPLACE FUNCTION public.active_roles(_user_id uuid)
RETURNS public.app_role[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE revoked boolean; result public.app_role[];
BEGIN
  -- Callers may read their own roles; administrators and server (no session) may read anyone's.
  IF auth.uid() IS NOT NULL AND auth.uid() <> _user_id AND NOT public.has_role(auth.uid(), 'system_admin') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  revoked := public.is_access_revoked(_user_id);
  SELECT coalesce(array_agg(role ORDER BY role), '{}') INTO result
  FROM public.user_roles WHERE user_id = _user_id AND (role = 'student' OR NOT revoked);
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.active_roles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.active_roles(uuid) TO authenticated, service_role;

-- 3. No new case assignments to revoked, disabled or non-staff accounts. History is untouched.
CREATE OR REPLACE FUNCTION public.guard_case_assignee_active()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to)
     AND (public.is_access_revoked(NEW.assigned_to) OR NOT public.is_staff(NEW.assigned_to)) THEN
    RAISE EXCEPTION 'Cases cannot be assigned to a revoked or non-staff account';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_case_assignee_active ON public.cases;
CREATE TRIGGER trg_guard_case_assignee_active
  BEFORE INSERT OR UPDATE OF assigned_to ON public.cases
  FOR EACH ROW EXECUTE FUNCTION public.guard_case_assignee_active();
REVOKE ALL ON FUNCTION public.guard_case_assignee_active() FROM PUBLIC, anon, authenticated;

-- 4. Close anonymous access to existing privileged functions.
REVOKE EXECUTE ON FUNCTION public.can_read_case_evidence(text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_transfer_assignment() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.release_hostel_bed() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_hostel_case_lifecycle() FROM PUBLIC, anon;

-- 5. New functions are never executable anonymously by default.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;