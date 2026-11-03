CREATE TABLE public.transfer_student_evidence (student_id uuid PRIMARY KEY, previous_transfers integer NOT NULL, scores jsonb NOT NULL DEFAULT '{}'::jsonb, source_reference text NOT NULL, verified_by uuid NOT NULL, verified_at timestamptz NOT NULL DEFAULT now(), is_demo_record boolean NOT NULL DEFAULT false);
GRANT SELECT ON public.transfer_student_evidence TO authenticated; GRANT ALL ON public.transfer_student_evidence TO service_role;
ALTER TABLE public.transfer_student_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY transfer_evidence_read ON public.transfer_student_evidence FOR SELECT TO authenticated USING (NOT public.is_access_revoked(auth.uid()) AND (student_id=auth.uid() OR public.has_role(auth.uid(),'system_admin')));
CREATE TABLE public.transfer_programme_rules (programme_id uuid PRIMARY KEY REFERENCES public.academic_programs(id), rule_version text NOT NULL, requirements jsonb NOT NULL DEFAULT '{}'::jsonb, accepting_transfers boolean NOT NULL DEFAULT false, source_reference text NOT NULL, verified_by uuid NOT NULL, verified_at timestamptz NOT NULL DEFAULT now(), is_demo_record boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.transfer_programme_rules TO authenticated; GRANT ALL ON public.transfer_programme_rules TO service_role;
ALTER TABLE public.transfer_programme_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY transfer_rules_read ON public.transfer_programme_rules FOR SELECT TO authenticated USING (NOT public.is_access_revoked(auth.uid()));
ALTER TABLE public.programme_course_equivalencies ADD COLUMN university_verified_at timestamptz, ADD COLUMN source_reference text, ADD COLUMN is_demo_record boolean NOT NULL DEFAULT true;
ALTER TABLE public.intercollege_transfer_requests ADD COLUMN case_id uuid REFERENCES public.cases(id), ADD COLUMN approved_at timestamptz, ADD COLUMN approved_by uuid, ADD COLUMN unknown_credits integer, ADD COLUMN submission_key text;
CREATE UNIQUE INDEX transfer_request_case_unique ON public.intercollege_transfer_requests(case_id) WHERE case_id IS NOT NULL;
CREATE UNIQUE INDEX transfer_submission_key_unique ON public.intercollege_transfer_requests(student_id,submission_key) WHERE submission_key IS NOT NULL;
CREATE OR REPLACE FUNCTION public.assess_programme_transfer(_target uuid,_student uuid DEFAULT auth.uid()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE sp public.student_profiles; tp public.academic_programs; sourcep public.academic_programs; evidence public.transfer_student_evidence; rules public.transfer_programme_rules; cap public.programme_transfer_capacity; service jsonb; sid uuid; failed jsonb:='[]'; operational jsonb:='[]'; checks jsonb:='[]'; impacts jsonb:='[]'; entry record; course record; mapping public.programme_course_equivalencies; mapping_count integer; actual numeric; minimum numeric; used_targets uuid[]:='{}'; retained integer:=0; lost integer:=0; unknown integer:=0; histcredits integer:=0; prior integer; accepted integer; mode text; academic_ok boolean; target_remaining integer; current_remaining integer; extra integer;
BEGIN
 IF auth.uid() IS NULL OR public.is_access_revoked(auth.uid()) OR (_student<>auth.uid() AND NOT public.has_role(auth.uid(),'system_admin') AND NOT public.is_staff(auth.uid())) THEN RAISE EXCEPTION 'Not authorised'; END IF;
 SELECT * INTO sp FROM public.student_profiles WHERE user_id=_student;
 SELECT * INTO tp FROM public.academic_programs WHERE id=_target;
 SELECT * INTO sourcep FROM public.academic_programs WHERE id=sp.program_id;
 IF sp.user_id IS NULL OR sp.program_id IS NULL OR sp.account_status<>'active' THEN failed:=failed||jsonb_build_array('academic_record_unavailable'); END IF;
 IF sp.completed_credit_hours IS NULL THEN failed:=failed||jsonb_build_array('credits_unavailable'); ELSIF sp.completed_credit_hours<12 THEN failed:=failed||jsonb_build_array('below_minimum_credits'); ELSIF sp.completed_credit_hours>36 THEN failed:=failed||jsonb_build_array('above_maximum_credits'); END IF;
 IF sp.cumulative_gpa IS NULL THEN failed:=failed||jsonb_build_array('gpa_unavailable'); ELSIF sp.cumulative_gpa<2.50 THEN failed:=failed||jsonb_build_array('gpa_below_minimum'); END IF;
 SELECT * INTO evidence FROM public.transfer_student_evidence WHERE student_id=_student AND is_demo_record=sp.is_demo_record;
 IF evidence.student_id IS NULL THEN failed:=failed||jsonb_build_array('history_unavailable'); ELSE
 SELECT greatest(evidence.previous_transfers,count(*)::integer) INTO prior FROM public.intercollege_transfer_requests WHERE student_id=_student AND transfer_status='completed';
 IF prior>0 THEN failed:=failed||jsonb_build_array('previous_transfer_exists'); END IF; END IF;
 SELECT * INTO rules FROM public.transfer_programme_rules WHERE programme_id=_target AND is_demo_record=sp.is_demo_record;
 IF rules.programme_id IS NULL THEN failed:=failed||jsonb_build_array('target_rules_unavailable'); ELSE
 FOR entry IN SELECT key,value FROM jsonb_each(rules.requirements) LOOP
 IF jsonb_typeof(entry.value)<>'number' OR jsonb_typeof(evidence.scores->entry.key) IS DISTINCT FROM 'number' THEN actual:=NULL; ELSE actual:=(evidence.scores->>entry.key)::numeric; END IF;
 IF jsonb_typeof(entry.value)<>'number' THEN minimum:=NULL;failed:=failed||jsonb_build_array('conflicting_policy'); ELSE minimum:=entry.value::text::numeric; END IF;
 checks:=checks||jsonb_build_array(jsonb_build_object('field',entry.key,'minimum',minimum,'actual',actual,'passed',actual IS NOT NULL AND actual>=minimum));
 IF actual IS NULL OR minimum IS NULL OR actual<minimum THEN failed:=failed||jsonb_build_array('entry_requirement:'||entry.key); END IF;
 END LOOP; END IF;
 academic_ok:=jsonb_array_length(failed)=0;
 SELECT id INTO sid FROM public.university_services WHERE code='SVC-TRANSFER-ICT';
 service:=public.get_service_availability(sid);
 IF NOT coalesce((service->>'is_available')::boolean,false) THEN operational:=operational||jsonb_build_array('service_closed'); END IF;
 IF tp.id IS NULL OR NOT tp.is_active OR tp.id=sp.program_id OR NOT coalesce(rules.accepting_transfers,false) THEN operational:=operational||jsonb_build_array('target_not_accepting'); END IF;
 SELECT * INTO cap FROM public.programme_transfer_capacity WHERE programme_id=_target AND is_active AND is_demo_record=sp.is_demo_record AND academic_term_id=sp.current_academic_term_id ORDER BY updated_at DESC LIMIT 1;
 IF cap.id IS NULL OR cap.available_transfer_seats IS NULL THEN operational:=operational||jsonb_build_array('capacity_unavailable'); ELSIF cap.available_transfer_seats<1 THEN operational:=operational||jsonb_build_array('no_available_seats'); END IF;
 FOR course IN SELECT h.course_id,max(h.credits_earned) credits,c.code,c.title_en,c.title_ar FROM public.student_course_history h JOIN public.courses c ON c.id=h.course_id WHERE h.student_id=_student AND h.completion_status IN ('completed','passed') AND h.credits_earned>0 GROUP BY h.course_id,c.code,c.title_en,c.title_ar ORDER BY c.code LOOP
 histcredits:=histcredits+course.credits; accepted:=0;mode:='manual_review';
 SELECT count(*) INTO mapping_count FROM public.programme_course_equivalencies WHERE source_programme_id=sp.program_id AND target_programme_id=_target AND source_course_id=course.course_id AND approved_status='approved' AND university_verified_at IS NOT NULL AND source_reference IS NOT NULL AND is_demo_record=sp.is_demo_record AND effective_from<=current_date AND (effective_to IS NULL OR effective_to>=current_date);
 IF mapping_count=1 THEN
 SELECT * INTO mapping FROM public.programme_course_equivalencies WHERE source_programme_id=sp.program_id AND target_programme_id=_target AND source_course_id=course.course_id AND approved_status='approved' AND university_verified_at IS NOT NULL AND source_reference IS NOT NULL AND is_demo_record=sp.is_demo_record AND effective_from<=current_date AND (effective_to IS NULL OR effective_to>=current_date);
 IF NOT mapping.counts_toward_degree THEN mode:='not_applicable';lost:=lost+course.credits;
 ELSIF mapping.target_course_id IS NOT NULL AND NOT mapping.target_course_id=ANY(used_targets) THEN accepted:=least(course.credits,mapping.credit_hours_accepted);retained:=retained+accepted;unknown:=unknown+course.credits-accepted;used_targets:=array_append(used_targets,mapping.target_course_id);mode:=CASE WHEN mapping.counts_as_core THEN 'counts_core' ELSE 'counts_elective' END;
 ELSE unknown:=unknown+course.credits; END IF;
 ELSE unknown:=unknown+course.credits;END IF;
 impacts:=impacts||jsonb_build_array(jsonb_build_object('sourceId',course.course_id,'code',course.code,'titleEn',course.title_en,'titleAr',course.title_ar,'credits',course.credits,'accepted',accepted,'type',mode));
 END LOOP;
 unknown:=unknown+greatest(coalesce(sp.completed_credit_hours,0)-histcredits,0);
 IF histcredits>coalesce(sp.completed_credit_hours,0) THEN failed:=failed||jsonb_build_array('academic_credit_conflict');academic_ok:=false; END IF;
 IF unknown>0 THEN operational:=operational||jsonb_build_array('equivalency_unavailable'); END IF;
 IF unknown=0 AND tp.total_credit_hours IS NOT NULL AND sourcep.total_credit_hours IS NOT NULL THEN target_remaining:=greatest(tp.total_credit_hours-retained,0);current_remaining:=greatest(sourcep.total_credit_hours-sp.completed_credit_hours,0);extra:=greatest(target_remaining-current_remaining,0); END IF;
 RETURN jsonb_build_object('studentId',_student,'sourceId',sp.program_id,'sourceCollegeId',sp.college_id,'source',sourcep.name_en,'sourceAr',sourcep.name_ar,'targetId',_target,'targetCollegeId',tp.college_id,'target',tp.name_en,'targetAr',tp.name_ar,'gpa',sp.cumulative_gpa,'credits',sp.completed_credit_hours,'previousTransfers',prior,'academicallyEligible',academic_ok,'canSubmit',academic_ok AND jsonb_array_length(operational)=0,'failures',failed,'operational',operational,'requirements',checks,'seats',cap.available_transfer_seats,'capacityId',cap.id,'serviceOpen',coalesce((service->>'is_available')::boolean,false),'retained',retained,'nonApplicable',lost,'unknown',unknown,'courses',impacts,'currentRemaining',current_remaining,'targetRemaining',target_remaining,'additionalCredits',extra,'additionalSemesters',NULL,'ruleVersion',coalesce(rules.rule_version,'unavailable'),'baseRuleVersion','transfer-v1','isDemo',sp.is_demo_record);
END $$;
REVOKE ALL ON FUNCTION public.assess_programme_transfer(uuid,uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.assess_programme_transfer(uuid,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.guard_case_transfer_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN IF NEW.case_id IS NOT NULL AND current_setting('sanadi.transfer_write',true) IS DISTINCT FROM 'allowed' THEN RAISE EXCEPTION 'Use the governed transfer workflow'; END IF; RETURN NEW; END $$;
CREATE TRIGGER governed_transfer_evidence BEFORE INSERT OR UPDATE ON public.intercollege_transfer_requests FOR EACH ROW EXECUTE FUNCTION public.guard_case_transfer_evidence();