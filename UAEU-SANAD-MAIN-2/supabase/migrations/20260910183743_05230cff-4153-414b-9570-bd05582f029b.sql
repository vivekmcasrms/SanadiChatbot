ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS access_revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_revoked_by uuid,
  ADD COLUMN IF NOT EXISTS access_revoked_reason text;

CREATE INDEX IF NOT EXISTS profiles_access_revoked_idx ON public.profiles (access_revoked_at) WHERE access_revoked_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.is_access_revoked(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND access_revoked_at IS NOT NULL);
$function$;

REVOKE ALL ON FUNCTION public.is_access_revoked(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_access_revoked(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
     AND (_role = 'student'::app_role OR NOT public.is_access_revoked(_user_id));
$function$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id
    AND role IN ('service_officer','service_owner','service_manager','knowledge_manager','system_admin','auditor','leadership_viewer'))
   AND NOT public.is_access_revoked(_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.is_manager(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id
    AND role IN ('service_manager','system_admin'))
   AND NOT public.is_access_revoked(_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.can_see_all_cases(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id
    AND role IN ('service_manager','system_admin','auditor','leadership_viewer'))
   AND NOT public.is_access_revoked(_user_id);
$function$;