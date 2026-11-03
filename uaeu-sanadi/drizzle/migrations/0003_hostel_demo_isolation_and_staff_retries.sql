DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef(oid) INTO definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='submit_hostel_booking';
 definition:=replace(definition,'INSERT INTO public.hostel_bookings(case_id','UPDATE public.cases SET is_demo_record=coalesce((SELECT is_demo_record FROM public.student_profiles WHERE user_id=auth.uid()),false) WHERE id=cid; INSERT INTO public.hostel_bookings(case_id');
 EXECUTE definition;
 SELECT pg_get_functiondef(oid) INTO definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='update_hostel_booking';
 definition:=replace(definition,'IF b.stage IN (''cancelled'',''completed'',''closed'') THEN','IF (_action=''confirm'' AND b.stage=''confirmed'') OR (_action=''complete'' AND b.stage=''completed'') OR (_action=''cancel'' AND b.stage=''cancelled'') OR (_action=''assign'' AND b.stage=''room_assigned'' AND b.hostel=_hostel AND b.room_number=trim(_room) AND b.check_in_date IS NOT DISTINCT FROM _check_in) THEN RETURN jsonb_build_object(''ok'',true,''stage'',b.stage); END IF; IF b.stage IN (''cancelled'',''completed'',''closed'') THEN');
 EXECUTE definition;
END $$;
CREATE OR REPLACE FUNCTION public.hostel_demo_room_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.room_number IS NOT NULL AND NOT coalesce((SELECT is_demo_record FROM public.student_profiles WHERE user_id=NEW.student_id),false) AND EXISTS(SELECT 1 FROM public.hostel_rooms r JOIN public.hostels h ON h.id=r.hostel_id WHERE h.code IN ('HST-'||NEW.hostel,'HOSTEL-'||NEW.hostel,NEW.hostel) AND r.room_number=NEW.room_number AND (r.is_demo_record OR h.is_demo_record)) THEN RAISE EXCEPTION 'Demo rooms cannot be assigned to a real student'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hostel_demo_room_isolation BEFORE INSERT OR UPDATE ON public.hostel_bookings FOR EACH ROW EXECUTE FUNCTION public.hostel_demo_room_guard();