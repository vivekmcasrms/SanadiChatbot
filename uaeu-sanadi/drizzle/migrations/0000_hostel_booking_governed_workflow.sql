CREATE TABLE public.hostel_student_records (
 student_id uuid PRIMARY KEY, home_city text NOT NULL, verified_by uuid NOT NULL, verified_at timestamptz NOT NULL DEFAULT now(), source_reference text NOT NULL
);
GRANT SELECT ON public.hostel_student_records TO authenticated;
GRANT ALL ON public.hostel_student_records TO service_role;
ALTER TABLE public.hostel_student_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY hostel_record_read ON public.hostel_student_records FOR SELECT TO authenticated USING (student_id=auth.uid() OR (public.has_role(auth.uid(),'system_admin') AND NOT public.is_access_revoked(auth.uid())));
CREATE TABLE public.hostel_bookings (
 case_id uuid PRIMARY KEY REFERENCES public.cases(id), student_id uuid NOT NULL, home_city text NOT NULL, completed_credits integer NOT NULL, rule_version text NOT NULL DEFAULT 'hostel-v1', eligible_room_type text NOT NULL, eligible_hostels text[] NOT NULL, stage text NOT NULL DEFAULT 'submitted', hostel text, room_number text, check_in_date date, staff_note text, assigned_by uuid, assigned_at timestamptz, confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.hostel_bookings TO authenticated;
GRANT ALL ON public.hostel_bookings TO service_role;
ALTER TABLE public.hostel_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY hostel_booking_read ON public.hostel_bookings FOR SELECT TO authenticated USING (public.can_access_case(case_id,auth.uid()));
CREATE UNIQUE INDEX hostel_one_active_student ON public.hostel_bookings(student_id) WHERE stage NOT IN ('cancelled','completed','closed');
CREATE OR REPLACE FUNCTION public.hostel_city_normalized(_city text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$ SELECT lower(regexp_replace(trim(coalesce(_city,'')),'[\s‐‑–—-]+','','g')) $$;
CREATE OR REPLACE FUNCTION public.save_hostel_verified_city(_student_id uuid,_home_city text,_source text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'system_admin') OR public.is_access_revoked(auth.uid()) THEN RAISE EXCEPTION 'Not authorised'; END IF;
 IF length(trim(_home_city))<2 OR length(trim(_source))<3 OR NOT EXISTS(SELECT 1 FROM public.student_profiles WHERE user_id=_student_id) THEN RAISE EXCEPTION 'Verified city and source are required'; END IF;
 INSERT INTO public.hostel_student_records(student_id,home_city,verified_by,source_reference) VALUES(_student_id,trim(_home_city),auth.uid(),trim(_source)) ON CONFLICT(student_id) DO UPDATE SET home_city=excluded.home_city,verified_by=excluded.verified_by,verified_at=now(),source_reference=excluded.source_reference;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'hostel.verified_city_updated','student',_student_id,jsonb_build_object('home_city',trim(_home_city),'source_reference',trim(_source)));
END $$;
REVOKE ALL ON FUNCTION public.save_hostel_verified_city(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_hostel_verified_city(uuid,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.submit_hostel_booking(_lang text DEFAULT 'en') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE city text; credits integer; roomtype text; hostellist text[]; cid uuid; existing uuid; ref text; unitid uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'student') OR public.is_access_revoked(auth.uid()) THEN RAISE EXCEPTION 'Student access required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':hostel',0));
 SELECT case_id INTO existing FROM public.hostel_bookings WHERE student_id=auth.uid() AND stage NOT IN ('cancelled','completed','closed') LIMIT 1;
 IF existing IS NOT NULL THEN SELECT case_number INTO ref FROM public.cases WHERE id=existing; RETURN jsonb_build_object('caseId',existing,'reference',ref,'existing',true); END IF;
 SELECT home_city INTO city FROM public.hostel_student_records WHERE student_id=auth.uid();
 SELECT completed_credit_hours INTO credits FROM public.student_profiles WHERE user_id=auth.uid();
 IF city IS NULL OR trim(city)='' THEN RAISE EXCEPTION 'Registered home city is not verified'; END IF;
 IF public.hostel_city_normalized(city) IN ('alain','العين') THEN RAISE EXCEPTION 'Students from Al Ain are not eligible for hostel accommodation'; END IF;
 IF credits IS NULL OR credits<0 THEN RAISE EXCEPTION 'Completed credit hours are unavailable'; END IF;
 IF credits>=60 THEN roomtype:='single'; hostellist:=ARRAY['A']; ELSE roomtype:='double';hostellist:=ARRAY['B','C'];END IF;
 SELECT id INTO unitid FROM public.service_units WHERE code IN ('HOUSING','HOUS') AND is_active ORDER BY CASE WHEN code='HOUSING' THEN 0 ELSE 1 END LIMIT 1;
 IF unitid IS NULL THEN RAISE EXCEPTION 'Student Housing is not available to receive requests'; END IF;
 INSERT INTO public.cases(student_id,case_type,title,description,service_unit_id,language,human_review_required,next_action_en,next_action_ar) VALUES(auth.uid(),'service_request','Hostel Room Booking',format('Verified home city: %s. Completed credits: %s. Eligible room: %s. Eligible hostel(s): %s. Room availability and booking must be confirmed by Housing staff.',city,credits,roomtype,array_to_string(hostellist,', ')),unitid,CASE WHEN _lang='ar' THEN 'ar'::public.lang_code ELSE 'en'::public.lang_code END,true,'Housing staff will check availability and assign a room','سيراجع موظف السكن توفر الغرف ويحدد الغرفة') RETURNING id,case_number INTO cid,ref;
 INSERT INTO public.hostel_bookings(case_id,student_id,home_city,completed_credits,eligible_room_type,eligible_hostels) VALUES(cid,auth.uid(),city,credits,roomtype,hostellist);
 INSERT INTO public.case_status_history(case_id,to_status,changed_by,note) VALUES(cid,'submitted',auth.uid(),'Hostel booking request submitted after verified eligibility check');
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'hostel.submitted','case',cid,jsonb_build_object('home_city',city,'completed_credits',credits,'eligible',true,'room_type',roomtype,'hostels',hostellist,'rule_version','hostel-v1'));
 INSERT INTO public.notification_events(event_type,entity_type,entity_id,recipient_profile_id,channel,title,body,action_url,status,processed_at,case_id,dedupe_key) VALUES('hostel_submitted','case',cid,auth.uid(),'in_app',CASE WHEN _lang='ar' THEN 'تم تقديم طلب السكن '||ref ELSE 'Hostel request submitted: '||ref END,CASE WHEN _lang='ar' THEN 'سيراجع موظف السكن توفر الغرف. لم يتم تأكيد حجز غرفة بعد.' ELSE 'Housing staff will check room availability. No room booking has been confirmed yet.' END,'/requests/'||cid,'delivered',now(),cid,'hostel-submitted:'||cid);
 RETURN jsonb_build_object('caseId',cid,'reference',ref,'unitId',unitid,'existing',false);
END $$;
REVOKE ALL ON FUNCTION public.submit_hostel_booking(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_hostel_booking(text) TO authenticated;
CREATE OR REPLACE FUNCTION public.update_hostel_booking(_case_id uuid,_action text,_hostel text DEFAULT NULL,_room text DEFAULT NULL,_check_in date DEFAULT NULL,_note text DEFAULT NULL,_verified_available boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b public.hostel_bookings; c public.cases; newstage text; newstatus public.case_status; message_en text; message_ar text; cid_city text; credits integer;
BEGIN
 IF auth.uid() IS NULL OR public.is_access_revoked(auth.uid()) OR NOT (public.has_role(auth.uid(),'service_officer') OR public.has_role(auth.uid(),'service_owner') OR public.has_role(auth.uid(),'service_manager') OR public.has_role(auth.uid(),'system_admin')) OR NOT public.can_access_case(_case_id,auth.uid()) THEN RAISE EXCEPTION 'Not authorised to act on this hostel request'; END IF;
 SELECT * INTO c FROM public.cases WHERE id=_case_id FOR UPDATE;
 SELECT * INTO b FROM public.hostel_bookings WHERE case_id=_case_id FOR UPDATE;
 IF b.case_id IS NULL THEN RAISE EXCEPTION 'Hostel request not found'; END IF;
 IF b.stage IN ('cancelled','completed','closed') THEN RAISE EXCEPTION 'This hostel request is no longer active'; END IF;
 SELECT home_city INTO cid_city FROM public.hostel_student_records WHERE student_id=b.student_id;
 SELECT completed_credit_hours INTO credits FROM public.student_profiles WHERE user_id=b.student_id;
 IF _action IN ('assign','confirm') THEN
 IF cid_city IS NULL OR public.hostel_city_normalized(cid_city) IN ('alain','العين') OR credits IS NULL OR credits<0 THEN RAISE EXCEPTION 'Current verified student data does not establish eligibility'; END IF;
 IF (credits>=60) IS DISTINCT FROM (b.eligible_room_type='single') THEN RAISE EXCEPTION 'Academic record changed. Review room eligibility before assignment'; END IF;
 END IF;
 IF _action='assign' THEN
 IF NOT _hostel=ANY(b.eligible_hostels) OR coalesce(trim(_room),'')='' OR NOT _verified_available THEN RAISE EXCEPTION 'An eligible hostel, real room number and staff-verified availability are required'; END IF;
 IF EXISTS(SELECT 1 FROM public.hostel_bookings WHERE case_id<>_case_id AND hostel=_hostel AND room_number=trim(_room) AND stage IN ('room_assigned','confirmed') GROUP BY hostel,room_number HAVING count(*)>=CASE WHEN b.eligible_room_type='single' THEN 1 ELSE 2 END) THEN RAISE EXCEPTION 'The room has no remaining places in registered bookings'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('hostel-room:'||_hostel||':'||trim(_room),0));
 IF EXISTS(SELECT 1 FROM public.hostel_bookings WHERE case_id<>_case_id AND hostel=_hostel AND room_number=trim(_room) AND stage IN ('room_assigned','confirmed') GROUP BY hostel,room_number HAVING count(*)>=CASE WHEN b.eligible_room_type='single' THEN 1 ELSE 2 END) THEN RAISE EXCEPTION 'Room booking conflict'; END IF;
 UPDATE public.hostel_bookings SET hostel=_hostel,room_number=trim(_room),check_in_date=_check_in,staff_note=_note,assigned_by=auth.uid(),assigned_at=now(),confirmed_at=NULL WHERE case_id=_case_id;
 newstage:='room_assigned';newstatus:='placement_allocated';message_en:='Room assigned: Hostel '||_hostel||', room '||trim(_room)||'. Booking awaits confirmation.';message_ar:='تم تحديد الغرفة: سكن '||_hostel||'، غرفة '||trim(_room)||'. الحجز بانتظار التأكيد.';
 ELSIF _action='confirm' THEN
 IF b.stage<>'room_assigned' OR b.room_number IS NULL THEN RAISE EXCEPTION 'Assign a real room before confirming'; END IF;
 newstage:='confirmed';newstatus:='in_progress'; UPDATE public.hostel_bookings SET confirmed_at=now() WHERE case_id=_case_id;
 message_en:='Hostel booking confirmed: Hostel '||b.hostel||', room '||b.room_number;message_ar:='تم تأكيد حجز السكن: سكن '||b.hostel||'، غرفة '||b.room_number;
 ELSIF _action='cancel' THEN
 IF length(trim(coalesce(_note,'')))<5 THEN RAISE EXCEPTION 'Cancellation reason is required'; END IF;
 newstage:='cancelled';newstatus:='withdrawn';message_en:='Hostel booking cancelled: '||_note;message_ar:='تم إلغاء حجز السكن: '||_note;
 ELSIF _action='complete' THEN
 IF b.stage<>'confirmed' THEN RAISE EXCEPTION 'Confirm the booking before completion'; END IF;
 newstage:='completed';newstatus:='resolved';message_en:='Hostel request completed: Hostel '||b.hostel||', room '||b.room_number;message_ar:='اكتمل طلب السكن: سكن '||b.hostel||'، غرفة '||b.room_number;
 ELSE RAISE EXCEPTION 'Unsupported hostel action'; END IF;
 UPDATE public.hostel_bookings SET stage=newstage,updated_at=now() WHERE case_id=_case_id;
 UPDATE public.cases SET status=newstatus,next_action_en=message_en,next_action_ar=message_ar,outcome_en=CASE WHEN _action='complete' THEN message_en ELSE outcome_en END,outcome_ar=CASE WHEN _action='complete' THEN message_ar ELSE outcome_ar END,resolved_at=CASE WHEN _action='complete' THEN now() ELSE resolved_at END,last_activity_at=now() WHERE id=_case_id;
 INSERT INTO public.case_status_history(case_id,from_status,to_status,changed_by,note) VALUES(_case_id,c.status,newstatus,auth.uid(),CASE WHEN c.language='ar' THEN message_ar ELSE message_en END);
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'hostel.'||_action,'case',_case_id,jsonb_build_object('previous_stage',b.stage,'stage',newstage,'hostel',coalesce(_hostel,b.hostel),'room_number',coalesce(_room,b.room_number),'check_in_date',_check_in,'note',_note,'verified_available',_verified_available));
 INSERT INTO public.notification_events(event_type,entity_type,entity_id,recipient_profile_id,channel,title,body,action_url,status,processed_at,case_id,dedupe_key) VALUES('hostel_'||newstage,'case',_case_id,b.student_id,'in_app',CASE WHEN c.language='ar' THEN 'تحديث طلب السكن '||c.case_number ELSE 'Hostel request update: '||c.case_number END,CASE WHEN c.language='ar' THEN message_ar ELSE message_en END,'/requests/'||_case_id,'delivered',now(),_case_id,'hostel:'||_case_id||':'||newstage||':'||extract(epoch from now()));
 RETURN jsonb_build_object('ok',true,'stage',newstage);
END $$;
REVOKE ALL ON FUNCTION public.update_hostel_booking(uuid,text,text,text,date,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_hostel_booking(uuid,text,text,text,date,text,boolean) TO authenticated;