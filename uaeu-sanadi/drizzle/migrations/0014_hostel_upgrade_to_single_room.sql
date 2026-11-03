CREATE OR REPLACE FUNCTION public.list_available_hostel_rooms() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE city text; credits integer; roomtype text; hostellist text[]; is_demo boolean; rooms jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'student') OR public.is_access_revoked(auth.uid()) THEN RAISE EXCEPTION 'Student access required'; END IF;
 SELECT home_city INTO city FROM public.hostel_student_records WHERE student_id=auth.uid();
 SELECT completed_credit_hours, coalesce(is_demo_record,false) INTO credits, is_demo FROM public.student_profiles WHERE user_id=auth.uid();
 IF city IS NULL OR trim(city)='' THEN RETURN jsonb_build_object('eligible',false,'reason','missing_city','rooms','[]'::jsonb); END IF;
 IF public.hostel_city_normalized(city) IN ('alain','العين') THEN RETURN jsonb_build_object('eligible',false,'reason','al_ain','rooms','[]'::jsonb); END IF;
 IF credits IS NULL OR credits<0 THEN RETURN jsonb_build_object('eligible',false,'reason','missing_credits','rooms','[]'::jsonb); END IF;
 IF credits>=60 THEN roomtype:='single'; hostellist:=ARRAY['A']; ELSE roomtype:='double'; hostellist:=ARRAY['B','C']; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('hostel',h.code,'roomNumber',r.room_number,'roomType',r.room_type,'floor',r.floor,'capacity',r.capacity,'availableBeds',r.capacity - coalesce((SELECT count(*) FROM public.hostel_bookings hb WHERE hb.hostel=right(h.code,1) AND hb.room_number=r.room_number AND hb.stage IN ('room_assigned','confirmed')),0)) ORDER BY h.code, r.room_number),'[]'::jsonb) INTO rooms
 FROM public.hostel_rooms r JOIN public.hostels h ON h.id=r.hostel_id
 WHERE h.is_active AND r.status='available' AND r.is_demo_record=is_demo AND h.is_demo_record=is_demo
   AND right(h.code,1)=ANY(hostellist)
   AND (roomtype='double' OR r.room_type ILIKE '%single%')
   AND r.capacity - coalesce((SELECT count(*) FROM public.hostel_bookings hb WHERE hb.hostel=right(h.code,1) AND hb.room_number=r.room_number AND hb.stage IN ('room_assigned','confirmed')),0) > 0;
 RETURN jsonb_build_object('eligible',true,'roomType',roomtype,'hostels',hostellist,'rooms',rooms);
END $$;
REVOKE ALL ON FUNCTION public.list_available_hostel_rooms() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_available_hostel_rooms() TO authenticated;

CREATE OR REPLACE FUNCTION public.book_hostel_room(_hostel text,_room_number text,_lang text DEFAULT 'en') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE city text; credits integer; roomtype text; hostellist text[]; cid uuid; existing uuid; existing_hostel text; ref text; unitid uuid; is_demo boolean; room public.hostel_rooms; hcode text; taken integer; upgraded boolean := false;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'student') OR public.is_access_revoked(auth.uid()) THEN RAISE EXCEPTION 'Student access required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':hostel',0));
 SELECT home_city INTO city FROM public.hostel_student_records WHERE student_id=auth.uid();
 SELECT completed_credit_hours, coalesce(is_demo_record,false) INTO credits, is_demo FROM public.student_profiles WHERE user_id=auth.uid();
 IF city IS NULL OR trim(city)='' THEN RAISE EXCEPTION 'Registered home city is not verified'; END IF;
 IF public.hostel_city_normalized(city) IN ('alain','العين') THEN RAISE EXCEPTION 'Students from Al Ain are not eligible for hostel accommodation'; END IF;
 IF credits IS NULL OR credits<0 THEN RAISE EXCEPTION 'Completed credit hours are unavailable'; END IF;
 IF credits>=60 THEN roomtype:='single'; hostellist:=ARRAY['A']; ELSE roomtype:='double'; hostellist:=ARRAY['B','C']; END IF;
 SELECT case_id, hostel INTO existing, existing_hostel FROM public.hostel_bookings WHERE student_id=auth.uid() AND stage NOT IN ('cancelled','completed','closed') LIMIT 1;
 IF existing IS NOT NULL THEN
   IF NOT (credits>=60 AND existing_hostel IN ('B','C') AND _hostel='A') THEN
     SELECT case_number INTO ref FROM public.cases WHERE id=existing;
     RETURN jsonb_build_object('caseId',existing,'reference',ref,'existing',true);
   END IF;
   UPDATE public.hostel_bookings SET stage='cancelled' WHERE case_id=existing;
   INSERT INTO public.case_status_history(case_id,to_status,changed_by,note) VALUES(existing,'cancelled',auth.uid(),'Student moved to a single room in Hostel A after reaching 60 completed credits; previous bed released.');
   INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'hostel.upgraded_to_single','case',existing,jsonb_build_object('from_hostel',existing_hostel,'completed_credits',credits,'rule_version','hostel-v2-direct'));
   upgraded:=true;
 END IF;
 IF NOT _hostel=ANY(hostellist) OR coalesce(trim(_room_number),'')='' THEN RAISE EXCEPTION 'The selected room is not eligible for your room type'; END IF;
 hcode:='HST-'||_hostel;
 SELECT r.* INTO room FROM public.hostel_rooms r JOIN public.hostels h ON h.id=r.hostel_id
  WHERE h.code=hcode AND h.is_active AND r.room_number=trim(_room_number) AND r.status='available'
    AND r.is_demo_record=is_demo AND h.is_demo_record=is_demo FOR UPDATE OF r;
 IF room.id IS NULL THEN RAISE EXCEPTION 'This room is not available'; END IF;
 IF credits>=60 AND room.room_type NOT ILIKE '%single%' THEN RAISE EXCEPTION 'The selected room is not eligible for your room type'; END IF;
 SELECT count(*) INTO taken FROM public.hostel_bookings WHERE hostel=_hostel AND room_number=trim(_room_number) AND stage IN ('room_assigned','confirmed');
 IF taken>=room.capacity THEN RAISE EXCEPTION 'This room was just booked by another student. Please choose another available room.'; END IF;
 SELECT id INTO unitid FROM public.service_units WHERE code IN ('HOUSING','HOUS') AND is_active ORDER BY CASE WHEN code='HOUSING' THEN 0 ELSE 1 END LIMIT 1;
 IF unitid IS NULL THEN RAISE EXCEPTION 'Student Housing is not available to receive requests'; END IF;
 INSERT INTO public.cases(student_id,case_type,title,description,service_unit_id,language,human_review_required,status,next_action_en,next_action_ar) VALUES(auth.uid(),'service_request','Hostel Room Booking',format('Verified home city: %s. Completed credits: %s. Booked instantly: Hostel %s, room %s (first-come-first-served).',city,credits,_hostel,trim(_room_number)),unitid,CASE WHEN _lang='ar' THEN 'ar'::public.lang_code ELSE 'en'::public.lang_code END,false,'confirmed',format('Room confirmed: Hostel %s, room %s. Contact Housing for check-in arrangements.',_hostel,trim(_room_number)),format('تم تأكيد الغرفة: سكن %s، غرفة %s. تواصل مع السكن لترتيبات الدخول.',_hostel,trim(_room_number))) RETURNING id,case_number INTO cid,ref;
 INSERT INTO public.hostel_bookings(case_id,student_id,home_city,completed_credits,eligible_room_type,eligible_hostels,stage,hostel,room_number,assigned_at,confirmed_at) VALUES(cid,auth.uid(),city,credits,roomtype,hostellist,'confirmed',_hostel,trim(_room_number),now(),now());
 UPDATE public.hostel_rooms SET occupied_beds=taken+1, available_beds=room.capacity-(taken+1), updated_at=now() WHERE id=room.id;
 INSERT INTO public.case_status_history(case_id,to_status,changed_by,note) VALUES(cid,'confirmed',auth.uid(),'Hostel room booked instantly from live availability (first-come-first-served)');
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'hostel.booked_instantly','case',cid,jsonb_build_object('home_city',city,'completed_credits',credits,'room_type',roomtype,'hostel',_hostel,'room_number',trim(_room_number),'upgraded_from',existing_hostel,'rule_version','hostel-v2-direct'));
 INSERT INTO public.notification_events(event_type,entity_type,entity_id,recipient_profile_id,channel,title,body,action_url,status,processed_at,case_id,dedupe_key) VALUES('hostel_confirmed','case',cid,auth.uid(),'in_app',CASE WHEN _lang='ar' THEN 'تم تأكيد حجز السكن '||ref ELSE 'Hostel booking confirmed: '||ref END,CASE WHEN _lang='ar' THEN format('تم حجز غرفتك فوراً: سكن %s، غرفة %s.',_hostel,trim(_room_number)) ELSE format('Your room is booked instantly: Hostel %s, room %s.',_hostel,trim(_room_number)) END,'/requests/'||cid,'delivered',now(),cid,'hostel-booked:'||cid);
 RETURN jsonb_build_object('caseId',cid,'reference',ref,'unitId',unitid,'existing',false,'upgraded',upgraded,'hostel',_hostel,'roomNumber',trim(_room_number));
END $$;
REVOKE ALL ON FUNCTION public.book_hostel_room(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.book_hostel_room(text,text,text) TO authenticated;