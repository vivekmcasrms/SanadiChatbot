CREATE TABLE public.transfer_assessments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),student_id uuid NOT NULL,target_programme_id uuid NOT NULL,assessment jsonb NOT NULL,fingerprint text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.transfer_assessments TO authenticated; GRANT ALL ON public.transfer_assessments TO service_role;
ALTER TABLE public.transfer_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_transfer_assessment ON public.transfer_assessments FOR SELECT TO authenticated USING (student_id=auth.uid() AND NOT public.is_access_revoked(auth.uid()));
CREATE OR REPLACE FUNCTION public.prepare_programme_transfer(_target uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE report jsonb; aid uuid;
BEGIN IF NOT public.has_role(auth.uid(),'student') OR public.is_access_revoked(auth.uid()) THEN RAISE EXCEPTION 'Student access required';END IF;
 report:=public.assess_programme_transfer(_target);
 INSERT INTO public.transfer_assessments(student_id,target_programme_id,assessment,fingerprint) VALUES(auth.uid(),_target,report,md5(report::text)) RETURNING id INTO aid;
 RETURN report||jsonb_build_object('assessmentId',aid);
END $$;
REVOKE ALL ON FUNCTION public.prepare_programme_transfer(uuid) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.prepare_programme_transfer(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.submit_programme_transfer(_assessment uuid,_lang text DEFAULT 'en') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.transfer_assessments;r public.intercollege_transfer_requests;live jsonb;cid uuid;ref text;unitid uuid;staffid uuid;targetid uuid;sp public.student_profiles;course jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'student') OR public.is_access_revoked(auth.uid()) THEN RAISE EXCEPTION 'Student access required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':programme-transfer',0));
 SELECT * INTO r FROM public.intercollege_transfer_requests WHERE student_id=auth.uid() AND submission_key=_assessment::text;
 IF r.id IS NOT NULL THEN RETURN jsonb_build_object('caseId',r.case_id,'reference',r.transfer_number,'existing',true);END IF;
 SELECT * INTO a FROM public.transfer_assessments WHERE id=_assessment AND student_id=auth.uid();
 IF a.id IS NULL THEN RAISE EXCEPTION 'Assessment not found';END IF;
 IF EXISTS(SELECT 1 FROM public.intercollege_transfer_requests WHERE student_id=auth.uid() AND case_id IS NOT NULL AND transfer_status NOT IN ('completed','cancelled','failed','rejected')) THEN RAISE EXCEPTION 'An active transfer request already exists';END IF;
 SELECT * INTO sp FROM public.student_profiles WHERE user_id=auth.uid() FOR UPDATE;
 PERFORM 1 FROM public.transfer_student_evidence WHERE student_id=auth.uid() FOR UPDATE;
 PERFORM 1 FROM public.transfer_programme_rules WHERE programme_id=a.target_programme_id FOR UPDATE;
 PERFORM 1 FROM public.programme_transfer_capacity WHERE programme_id=a.target_programme_id FOR UPDATE;
 PERFORM 1 FROM public.academic_programs WHERE id=a.target_programme_id FOR UPDATE;
 PERFORM 1 FROM public.university_services WHERE code='SVC-TRANSFER-ICT' FOR UPDATE;
 live:=public.assess_programme_transfer(a.target_programme_id);
 IF NOT coalesce((live->>'canSubmit')::boolean,false) THEN RAISE EXCEPTION 'TRANSFER_BLOCKED: %',live->'failures'||(live->'operational');END IF;
 IF md5(live::text)<>a.fingerprint THEN RAISE EXCEPTION 'STALE_ANALYSIS';END IF;
 SELECT id INTO unitid FROM public.service_units WHERE code='REG' AND is_active;
 IF unitid IS NULL THEN RAISE EXCEPTION 'Registration unit unavailable';END IF;
 SELECT s.user_id INTO staffid FROM public.staff_profiles s JOIN public.service_staff ss ON ss.staff_profile_id=s.user_id WHERE ss.service_unit_id=unitid AND ss.is_active AND ss.can_receive_cases AND s.is_active AND s.availability_status='available' AND NOT public.is_access_revoked(s.user_id) ORDER BY s.last_assigned_at NULLS FIRST LIMIT 1;
 INSERT INTO public.cases(student_id,case_type,title,description,service_unit_id,assigned_to,language,human_review_required,is_demo,next_action_en,next_action_ar) VALUES(auth.uid(),'service_request','Programme / College Transfer',format('Transfer from %s to %s. Eligibility and credit-impact evidence attached. Student confirmed a request for authorised university review, not an automatic programme change.',live->>'source',live->>'target'),unitid,staffid,CASE WHEN _lang='ar' THEN 'ar'::public.lang_code ELSE 'en'::public.lang_code END,true,sp.is_demo_record,'Registration staff will review your transfer request','سيراجع موظف القبول والتسجيل طلب التحويل') RETURNING id,case_number INTO cid,ref;
 PERFORM set_config('sanadi.transfer_write','allowed',true);
 INSERT INTO public.intercollege_transfer_requests(student_id,source_college_id,source_programme_id,target_college_id,target_programme_id,current_gpa,completed_credits,retained_credits,non_applicable_credits,unknown_credits,additional_credits_required,transfer_count_before,eligibility_status,analysis_snapshot,analysis_version,student_confirmed_at,acknowledgement_version,transfer_status,requires_human_review,rule_version,capacity_id,seats_before,case_id,transfer_number,submission_key)
 VALUES(auth.uid(),sp.college_id,sp.program_id,(live->>'targetCollegeId')::uuid,a.target_programme_id,sp.cumulative_gpa,sp.completed_credit_hours,(live->>'retained')::integer,(live->>'nonApplicable')::integer,(live->>'unknown')::integer,coalesce((live->>'additionalCredits')::integer,0),(live->>'previousTransfers')::integer,'eligible',live,a.fingerprint,now(),live->>'ruleVersion','human_review_required',true,live->>'ruleVersion',(live->>'capacityId')::uuid,(live->>'seats')::integer,cid,ref,_assessment::text) RETURNING * INTO r;
 FOR course IN SELECT value FROM jsonb_array_elements(live->'courses') LOOP
 INSERT INTO public.intercollege_transfer_course_impact(transfer_request_id,source_course_id,source_course_code,course_title,course_title_ar,original_credit_hours,impact_type,credits_accepted,counts_toward_degree) VALUES(r.id,(course->>'sourceId')::uuid,course->>'code',course->>'titleEn',course->>'titleAr',(course->>'credits')::integer,course->>'type',(course->>'accepted')::integer,(course->>'accepted')::integer>0);
 END LOOP;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'transfer.submitted','case',cid,jsonb_build_object('assessment',live,'student_confirmed',true,'assessment_id',a.id));
 INSERT INTO public.case_status_history(case_id,to_status,changed_by,note) VALUES(cid,'submitted',auth.uid(),'Programme transfer request submitted with verified eligibility and informed confirmation');
 INSERT INTO public.notification_events(event_type,entity_type,entity_id,recipient_profile_id,channel,title,body,action_url,status,processed_at,case_id,dedupe_key) VALUES('transfer_submitted','case',cid,auth.uid(),'in_app',CASE WHEN _lang='ar' THEN 'تم تقديم طلب التحويل '||ref ELSE 'Transfer request submitted: '||ref END,CASE WHEN _lang='ar' THEN 'طلبك بانتظار مراجعة القبول والتسجيل. لم يتغير برنامجك.' ELSE 'Registration staff will review your request. Your programme has not changed.' END,'/requests/'||cid,'delivered',now(),cid,'transfer-submitted:'||cid);
 RETURN jsonb_build_object('caseId',cid,'reference',ref,'unitId',unitid,'existing',false);
END $$;
REVOKE ALL ON FUNCTION public.submit_programme_transfer(uuid,text) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.submit_programme_transfer(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.review_programme_transfer(_case uuid,_action text,_note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.intercollege_transfer_requests;c public.cases;live jsonb;newstage text;newstatus public.case_status;uid uuid:=auth.uid();body_en text;body_ar text;
BEGIN
 IF uid IS NULL OR public.is_access_revoked(uid) OR NOT public.can_access_case(_case,uid) THEN RAISE EXCEPTION 'Not authorised';END IF;
 SELECT * INTO c FROM public.cases WHERE id=_case FOR UPDATE;
 IF NOT public.has_role(uid,'system_admin') AND NOT EXISTS(SELECT 1 FROM public.service_staff ss JOIN public.staff_profiles s ON s.user_id=ss.staff_profile_id WHERE s.user_id=uid AND s.is_active AND ss.is_active AND ss.service_unit_id=c.service_unit_id AND ss.can_approve_actions AND NOT public.is_access_revoked(s.user_id)) THEN RAISE EXCEPTION 'Authorised Registration approval required';END IF;
 IF length(trim(coalesce(_note,'')))<5 THEN RAISE EXCEPTION 'Decision reason required';END IF;
 SELECT * INTO r FROM public.intercollege_transfer_requests WHERE case_id=_case FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Transfer request not found';END IF;
 IF (_action='approve' AND r.approved_at IS NOT NULL) OR (_action='reject' AND r.transfer_status='rejected') OR (_action='complete' AND r.transfer_status='completed') THEN RETURN jsonb_build_object('ok',true,'existing',true);END IF;
 IF r.transfer_status IN ('completed','cancelled','rejected','failed') THEN RAISE EXCEPTION 'Transfer no longer active';END IF;
 IF _action='approve' THEN
 PERFORM 1 FROM public.programme_transfer_capacity WHERE id=r.capacity_id FOR UPDATE;
 live:=public.assess_programme_transfer(r.target_programme_id,r.student_id);
 IF NOT coalesce((live->>'canSubmit')::boolean,false) OR md5(live::text)<>r.analysis_version THEN RAISE EXCEPTION 'Eligibility or academic consequences changed; obtain a fresh informed student confirmation';END IF;
 UPDATE public.programme_transfer_capacity SET reserved_transfer_seats=reserved_transfer_seats+1 WHERE id=r.capacity_id AND available_transfer_seats>0;
 IF NOT FOUND THEN RAISE EXCEPTION 'NO_AVAILABLE_SEATS';END IF;
 newstage:='pending_execution';newstatus:='in_progress';body_en:='Your programme transfer request has been approved. Registration must complete the authorised academic process.';body_ar:='تمت الموافقة على طلب التحويل. سيكمل القبول والتسجيل الإجراء الأكاديمي المعتمد.';
 ELSIF _action='reject' THEN
 IF r.approved_at IS NOT NULL THEN UPDATE public.programme_transfer_capacity SET reserved_transfer_seats=greatest(reserved_transfer_seats-1,0) WHERE id=r.capacity_id;END IF;
 newstage:='rejected';newstatus:='rejected';body_en:='Your programme transfer request has been rejected: '||_note;body_ar:='تم رفض طلب التحويل: '||_note;
 ELSIF _action='complete' THEN
 IF r.approved_at IS NULL THEN RAISE EXCEPTION 'Approval required before completion';END IF;
 UPDATE public.programme_transfer_capacity SET reserved_transfer_seats=greatest(reserved_transfer_seats-1,0),assigned_transfer_seats=assigned_transfer_seats+1 WHERE id=r.capacity_id;
 newstage:='completed';newstatus:='resolved';body_en:='Registration has marked your transfer request completed: '||_note;body_ar:='أكمل القبول والتسجيل طلب التحويل: '||_note;
 ELSE RAISE EXCEPTION 'Unsupported action';END IF;
 PERFORM set_config('sanadi.transfer_write','allowed',true);
 UPDATE public.intercollege_transfer_requests SET transfer_status=newstage,owner_notes=_note,approved_at=CASE WHEN _action='approve' THEN now() ELSE approved_at END,approved_by=CASE WHEN _action='approve' THEN uid ELSE approved_by END,executed_at=CASE WHEN _action='complete' THEN now() ELSE executed_at END,updated_at=now() WHERE id=r.id;
 UPDATE public.cases SET status=newstatus,next_action_en=body_en,next_action_ar=body_ar,outcome_en=CASE WHEN _action IN ('reject','complete') THEN body_en ELSE outcome_en END,outcome_ar=CASE WHEN _action IN ('reject','complete') THEN body_ar ELSE outcome_ar END,resolved_at=CASE WHEN _action='complete' THEN now() ELSE resolved_at END WHERE id=_case;
 INSERT INTO public.case_status_history(case_id,from_status,to_status,changed_by,note) VALUES(_case,c.status,newstatus,uid,_note);
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(uid,'transfer.'||_action,'case',_case,jsonb_build_object('previous_stage',r.transfer_status,'stage',newstage,'reason',_note));
 INSERT INTO public.notification_events(event_type,entity_type,entity_id,recipient_profile_id,channel,title,body,action_url,status,processed_at,case_id,dedupe_key) VALUES('transfer_'||_action,'case',_case,r.student_id,'in_app',CASE WHEN c.language='ar' THEN 'تحديث طلب التحويل '||c.case_number ELSE 'Transfer request update: '||c.case_number END,CASE WHEN c.language='ar' THEN body_ar ELSE body_en END,'/requests/'||_case,'delivered',now(),_case,'transfer:'||_case||':'||_action);
 RETURN jsonb_build_object('ok',true,'stage',newstage);
END $$;
REVOKE ALL ON FUNCTION public.review_programme_transfer(uuid,text,text) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.review_programme_transfer(uuid,text,text) TO authenticated;