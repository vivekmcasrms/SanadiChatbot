DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef(oid) INTO definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='submit_hostel_booking';
 definition:=replace(definition,'UPDATE public.cases SET is_demo_record=','UPDATE public.cases SET is_demo=');
 EXECUTE definition;
END $$;