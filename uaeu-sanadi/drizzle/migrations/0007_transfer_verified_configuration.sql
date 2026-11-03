CREATE OR REPLACE FUNCTION public.configure_transfer_rules(_programme uuid,_version text,_requirements jsonb,_accepting boolean,_source text,_demo boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e record;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'system_admin') OR public.is_access_revoked(auth.uid()) THEN RAISE EXCEPTION 'Administrator required';END IF;
 IF length(trim(_source))<5 OR length(trim(_version))<1 OR jsonb_typeof(_requirements)<>'object' THEN RAISE EXCEPTION 'Verified source, version and structured requirements required';END IF;
 FOR e IN SELECT key,value FROM jsonb_each(_requirements) LOOP IF e.key NOT IN ('high_school','english','algebra','calculus','physics','mathematics','gpa') OR jsonb_typeof(e.value)<>'number' OR e.value::text::numeric<0 THEN RAISE EXCEPTION 'Invalid numeric requirement';END IF;END LOOP;
 INSERT INTO public.transfer_programme_rules(programme_id,rule_version,requirements,accepting_transfers,source_reference,verified_by,is_demo_record) VALUES(_programme,_version,_requirements,_accepting,_source,auth.uid(),_demo) ON CONFLICT(programme_id) DO UPDATE SET rule_version=excluded.rule_version,requirements=excluded.requirements,accepting_transfers=excluded.accepting_transfers,source_reference=excluded.source_reference,verified_by=auth.uid(),verified_at=now(),is_demo_record=excluded.is_demo_record,updated_at=now();
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'transfer.rules_verified','programme',_programme,jsonb_build_object('version',_version,'source',_source,'requirements',_requirements,'demo',_demo));
END $$;
REVOKE ALL ON FUNCTION public.configure_transfer_rules(uuid,text,jsonb,boolean,text,boolean) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.configure_transfer_rules(uuid,text,jsonb,boolean,text,boolean) TO authenticated;
CREATE OR REPLACE FUNCTION public.verify_transfer_student(_student uuid,_previous integer,_scores jsonb,_source text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE demo boolean;e record;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'system_admin') OR public.is_access_revoked(auth.uid()) THEN RAISE EXCEPTION 'Administrator required';END IF;
 IF _previous<0 OR length(trim(_source))<5 OR jsonb_typeof(_scores)<>'object' THEN RAISE EXCEPTION 'Verified history and numeric scores required';END IF;
 FOR e IN SELECT key,value FROM jsonb_each(_scores) LOOP IF e.key NOT IN ('high_school','english','algebra','calculus','physics','mathematics','gpa') OR jsonb_typeof(e.value)<>'number' OR e.value::text::numeric<0 THEN RAISE EXCEPTION 'Invalid numeric score';END IF;END LOOP;
 SELECT is_demo_record INTO demo FROM public.student_profiles WHERE user_id=_student;
 IF demo IS NULL THEN RAISE EXCEPTION 'Student not found';END IF;
 INSERT INTO public.transfer_student_evidence(student_id,previous_transfers,scores,source_reference,verified_by,is_demo_record) VALUES(_student,_previous,_scores,_source,auth.uid(),demo) ON CONFLICT(student_id) DO UPDATE SET previous_transfers=excluded.previous_transfers,scores=excluded.scores,source_reference=excluded.source_reference,verified_by=auth.uid(),verified_at=now(),is_demo_record=excluded.is_demo_record;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'transfer.student_evidence_verified','student',_student,jsonb_build_object('source',_source,'previous_transfers',_previous,'score_fields',array(select jsonb_object_keys(_scores))));
END $$;
REVOKE ALL ON FUNCTION public.verify_transfer_student(uuid,integer,jsonb,text) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.verify_transfer_student(uuid,integer,jsonb,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.configure_transfer_capacity(_programme uuid,_term uuid,_seats integer,_source text,_demo boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'system_admin') OR public.is_access_revoked(auth.uid()) THEN RAISE EXCEPTION 'Administrator required';END IF;
 IF _seats<0 OR length(trim(_source))<5 THEN RAISE EXCEPTION 'Verified capacity and source required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('transfer-capacity:'||_programme||':'||_term,0));
 IF EXISTS(SELECT 1 FROM public.programme_transfer_capacity WHERE programme_id=_programme AND academic_term_id=_term AND is_demo_record=_demo) THEN
 UPDATE public.programme_transfer_capacity SET total_transfer_seats=_seats,is_active=true,updated_at=now() WHERE programme_id=_programme AND academic_term_id=_term AND is_demo_record=_demo AND reserved_transfer_seats+assigned_transfer_seats<=_seats;
 IF NOT FOUND THEN RAISE EXCEPTION 'Capacity cannot be less than reserved and assigned seats';END IF;
 ELSE INSERT INTO public.programme_transfer_capacity(programme_id,academic_term_id,total_transfer_seats,is_active,is_demo_record) VALUES(_programme,_term,_seats,true,_demo);END IF;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'transfer.capacity_verified','programme',_programme,jsonb_build_object('source',_source,'term',_term,'total_seats',_seats,'demo',_demo));
END $$;
REVOKE ALL ON FUNCTION public.configure_transfer_capacity(uuid,uuid,integer,text,boolean) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.configure_transfer_capacity(uuid,uuid,integer,text,boolean) TO authenticated;
CREATE OR REPLACE FUNCTION public.verify_transfer_equivalency(_mapping uuid,_source text,_demo boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'system_admin') OR public.is_access_revoked(auth.uid()) THEN RAISE EXCEPTION 'Administrator required';END IF;
 IF length(trim(_source))<5 THEN RAISE EXCEPTION 'University equivalency source required';END IF;
 UPDATE public.programme_course_equivalencies SET university_verified_at=now(),source_reference=_source,is_demo_record=_demo WHERE id=_mapping AND approved_status='approved';IF NOT FOUND THEN RAISE EXCEPTION 'Approved mapping not found';END IF;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'transfer.equivalency_verified','equivalency',_mapping,jsonb_build_object('source',_source,'demo',_demo));END $$;
REVOKE ALL ON FUNCTION public.verify_transfer_equivalency(uuid,text,boolean) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.verify_transfer_equivalency(uuid,text,boolean) TO authenticated;
CREATE OR REPLACE FUNCTION public.guard_transfer_case_status() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN IF NEW.status IS DISTINCT FROM OLD.status AND EXISTS(SELECT 1 FROM public.intercollege_transfer_requests WHERE case_id=NEW.id AND transfer_status NOT IN ('completed','rejected','cancelled','failed')) AND NEW.status IN ('resolved','closed','rejected','withdrawn') AND current_setting('sanadi.transfer_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'Use the authorised transfer decision before completing this case';END IF;RETURN NEW;END $$;
CREATE TRIGGER transfer_case_completion_guard BEFORE UPDATE OF status ON public.cases FOR EACH ROW EXECUTE FUNCTION public.guard_transfer_case_status();