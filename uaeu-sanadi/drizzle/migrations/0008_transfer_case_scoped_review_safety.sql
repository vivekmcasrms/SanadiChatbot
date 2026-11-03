DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.assess_programme_transfer(uuid,uuid)'::regprocedure) INTO definition;
 definition:=replace(definition,'AND NOT public.is_staff(auth.uid())','AND NOT EXISTS (SELECT 1 FROM public.intercollege_transfer_requests tr JOIN public.cases cs ON cs.id=tr.case_id JOIN public.service_units su ON su.id=cs.service_unit_id JOIN public.service_staff ss ON ss.service_unit_id=su.id JOIN public.staff_profiles st ON st.user_id=ss.staff_profile_id WHERE tr.student_id=_student AND tr.target_programme_id=_target AND su.code=''REG'' AND public.can_access_case(cs.id,auth.uid()) AND st.user_id=auth.uid() AND st.is_active AND ss.is_active AND ss.can_approve_actions)');
 definition:=replace(definition,'IF jsonb_typeof(entry.value)<>''number'' OR jsonb_typeof(evidence.scores->entry.key) IS DISTINCT FROM ''number'' THEN actual:=NULL; ELSE actual:=(evidence.scores->>entry.key)::numeric; END IF;','IF entry.key=''gpa'' THEN actual:=sp.cumulative_gpa; ELSIF jsonb_typeof(entry.value)<>''number'' OR jsonb_typeof(evidence.scores->entry.key) IS DISTINCT FROM ''number'' THEN actual:=NULL; ELSE actual:=(evidence.scores->>entry.key)::numeric; END IF;');
 EXECUTE definition;
 SELECT pg_get_functiondef('public.review_programme_transfer(uuid,text,text)'::regprocedure) INTO definition;
 definition:=replace(definition,'IF length(trim(coalesce(_note,','IF NOT EXISTS(SELECT 1 FROM public.service_units WHERE id=c.service_unit_id AND code=''REG'' AND is_active) THEN RAISE EXCEPTION ''Registration ownership required'';END IF; IF length(trim(coalesce(_note,');
 definition:=replace(definition,'md5(live::text)<>r.analysis_version','(live - ''seats'') IS DISTINCT FROM (r.analysis_snapshot - ''seats'')');
 definition:=replace(definition,'IF r.approved_at IS NULL THEN RAISE EXCEPTION ''Approval required before completion'';END IF;','IF r.approved_at IS NULL THEN RAISE EXCEPTION ''Approval required before completion'';END IF; IF NOT EXISTS(SELECT 1 FROM public.student_profiles WHERE user_id=r.student_id AND program_id=r.target_programme_id AND college_id=r.target_college_id) THEN RAISE EXCEPTION ''University academic record must confirm the target programme before completion'';END IF;');
 EXECUTE definition;
END $migration$;
CREATE OR REPLACE FUNCTION public.guard_transfer_case_status() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status AND EXISTS(SELECT 1 FROM public.intercollege_transfer_requests WHERE case_id=NEW.id AND transfer_status NOT IN ('completed','rejected','cancelled','failed')) AND NEW.status IN ('resolved','closed','rejected','withdrawn') THEN RAISE EXCEPTION 'Use the authorised transfer decision before completing this case'; END IF;RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.guard_case_transfer_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.case_id IS NOT NULL THEN
 IF auth.uid() IS NULL OR public.is_access_revoked(auth.uid()) OR NOT public.can_access_case(OLD.case_id,auth.uid()) OR (NOT public.has_role(auth.uid(),'system_admin') AND NOT EXISTS(SELECT 1 FROM public.cases c JOIN public.service_units u ON u.id=c.service_unit_id JOIN public.service_staff ss ON ss.service_unit_id=u.id JOIN public.staff_profiles s ON s.user_id=ss.staff_profile_id WHERE c.id=OLD.case_id AND u.code='REG' AND s.user_id=auth.uid() AND s.is_active AND ss.is_active AND ss.can_approve_actions)) THEN RAISE EXCEPTION 'Authorised Registration decision required';END IF;
 IF NEW.case_id IS DISTINCT FROM OLD.case_id OR NEW.student_id IS DISTINCT FROM OLD.student_id OR NEW.analysis_snapshot IS DISTINCT FROM OLD.analysis_snapshot OR NEW.target_programme_id IS DISTINCT FROM OLD.target_programme_id OR NEW.capacity_id IS DISTINCT FROM OLD.capacity_id THEN RAISE EXCEPTION 'Confirmed transfer evidence is immutable';END IF;
 END IF;
 IF NEW.case_id IS NOT NULL AND current_setting('sanadi.transfer_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'Use the governed transfer workflow';END IF;RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.can_review_programme_transfer(_case uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT auth.uid() IS NOT NULL AND NOT public.is_access_revoked(auth.uid()) AND public.can_access_case(_case,auth.uid()) AND EXISTS(SELECT 1 FROM public.cases c JOIN public.service_units u ON u.id=c.service_unit_id WHERE c.id=_case AND u.code='REG' AND u.is_active AND (public.has_role(auth.uid(),'system_admin') OR EXISTS(SELECT 1 FROM public.service_staff ss JOIN public.staff_profiles s ON s.user_id=ss.staff_profile_id WHERE ss.service_unit_id=u.id AND s.user_id=auth.uid() AND s.is_active AND ss.is_active AND ss.can_approve_actions)));
$$;
REVOKE ALL ON FUNCTION public.can_review_programme_transfer(uuid) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.can_review_programme_transfer(uuid) TO authenticated;