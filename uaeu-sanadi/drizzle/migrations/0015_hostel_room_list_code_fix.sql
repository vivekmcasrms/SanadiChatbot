-- 0015: fix hostel room listing. list_available_hostel_rooms extracted the hostel
-- letter with substring(h.code from 6), which is correct for 6-char codes
-- ('HOUS-A') but returns an empty string for the current 5-char codes ('HST-A'),
-- so the room list was always empty even when beds were free. Read the last
-- character instead, and report the bare letter (A/B/C) so book_hostel_room
-- receives the value it validates against.
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
 SELECT coalesce(jsonb_agg(jsonb_build_object('hostel',right(h.code,1),'roomNumber',r.room_number,'roomType',r.room_type,'floor',r.floor,'capacity',r.capacity,'availableBeds',r.capacity - coalesce((SELECT count(*) FROM public.hostel_bookings hb WHERE hb.hostel=right(h.code,1) AND hb.room_number=r.room_number AND hb.stage IN ('room_assigned','confirmed')),0)) ORDER BY h.code, r.room_number),'[]'::jsonb) INTO rooms
 FROM public.hostel_rooms r JOIN public.hostels h ON h.id=r.hostel_id
 WHERE h.is_active AND r.status='available' AND r.is_demo_record=is_demo AND h.is_demo_record=is_demo
   AND right(h.code,1)=ANY(hostellist)
   AND (roomtype='double' OR r.room_type ILIKE '%single%')
   AND r.capacity - coalesce((SELECT count(*) FROM public.hostel_bookings hb WHERE hb.hostel=right(h.code,1) AND hb.room_number=r.room_number AND hb.stage IN ('room_assigned','confirmed')),0) > 0;
 RETURN jsonb_build_object('eligible',true,'roomType',roomtype,'hostels',hostellist,'rooms',rooms);
END $$;
REVOKE ALL ON FUNCTION public.list_available_hostel_rooms() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_available_hostel_rooms() TO authenticated;
