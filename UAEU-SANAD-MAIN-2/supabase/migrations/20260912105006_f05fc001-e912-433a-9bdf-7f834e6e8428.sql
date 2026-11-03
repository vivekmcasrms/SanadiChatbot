-- 1. Direct assignment always grants access
DROP POLICY IF EXISTS "staff read unit cases" ON public.cases;
CREATE POLICY "staff read unit cases" ON public.cases
FOR SELECT TO authenticated
USING (
  public.can_see_all_cases(auth.uid())
  OR (public.is_staff(auth.uid()) AND (assigned_to = auth.uid() OR public.owns_service_unit(auth.uid(), service_unit_id)))
);

DROP POLICY IF EXISTS "staff update unit cases" ON public.cases;
CREATE POLICY "staff update unit cases" ON public.cases
FOR UPDATE TO authenticated
USING (
  public.can_see_all_cases(auth.uid())
  OR (public.is_staff(auth.uid()) AND (assigned_to = auth.uid() OR public.owns_service_unit(auth.uid(), service_unit_id)))
);

CREATE OR REPLACE FUNCTION public.can_access_case(_case_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.cases c WHERE c.id = _case_id AND (
      c.student_id = _user_id
      OR public.can_see_all_cases(_user_id)
      OR (public.is_staff(_user_id) AND (c.assigned_to = _user_id OR public.owns_service_unit(_user_id, c.service_unit_id)))
    )
  );
$function$;

-- 2. Emergency unit for fire / smoke / life-safety routing
INSERT INTO public.service_units (code, name_en, name_ar, is_active, email, contact_email, phone_extension)
SELECT 'OES', 'Operations and Emergency Section', 'قسم العمليات والطوارئ', true, 'OES@uaeu.ac.ae', 'OES@uaeu.ac.ae', '6888'
WHERE NOT EXISTS (SELECT 1 FROM public.service_units WHERE code = 'OES');