CREATE OR REPLACE FUNCTION public.can_manage_knowledge(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id
    AND role IN ('knowledge_manager','knowledge_approver','system_admin'))
   AND NOT public.is_access_revoked(_user_id)
$function$;

CREATE OR REPLACE FUNCTION public.can_approve_knowledge(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id
    AND role IN ('knowledge_approver','system_admin'))
   AND NOT public.is_access_revoked(_user_id)
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_integrations(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id
    AND role IN ('integration_admin','system_admin'))
   AND NOT public.is_access_revoked(_user_id)
$function$;

CREATE OR REPLACE FUNCTION public.can_monitor_all_units(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NOT public.is_access_revoked(_user_id)
     AND (
       public.has_role(_user_id, 'system_admin')
       OR public.has_role(_user_id, 'leadership_viewer')
       OR EXISTS (
            SELECT 1 FROM public.case_monitor_grants g
             WHERE g.user_id = _user_id AND g.is_active AND g.scope = 'all_units'
          )
     );
$function$;

CREATE OR REPLACE FUNCTION public.can_monitor_cases(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NOT public.is_access_revoked(_user_id)
     AND (
       public.can_monitor_all_units(_user_id)
       OR public.has_role(_user_id, 'auditor')
       OR public.has_role(_user_id, 'service_manager')
       OR EXISTS (SELECT 1 FROM public.case_monitor_grants g WHERE g.user_id = _user_id AND g.is_active)
     );
$function$;

CREATE OR REPLACE FUNCTION public.case_monitor_units(_user_id uuid)
 RETURNS TABLE(service_unit_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT u.id FROM public.service_units u
   WHERE public.can_monitor_all_units(_user_id)
  UNION
  SELECT unnest(g.unit_ids) FROM public.case_monitor_grants g
   WHERE g.user_id = _user_id AND g.is_active AND g.scope = 'units'
     AND NOT public.is_access_revoked(_user_id)
  UNION
  SELECT o.service_unit_id FROM public.owned_service_units(_user_id) o
   WHERE NOT public.is_access_revoked(_user_id);
$function$;