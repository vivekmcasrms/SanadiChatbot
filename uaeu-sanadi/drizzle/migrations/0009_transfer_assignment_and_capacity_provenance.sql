ALTER TABLE public.programme_transfer_capacity ADD COLUMN university_verified_at timestamptz,ADD COLUMN source_reference text;
DO $migration$ DECLARE definition text;BEGIN
 SELECT pg_get_functiondef('public.configure_transfer_capacity(uuid,uuid,integer,text,boolean)'::regprocedure) INTO definition;
 definition:=replace(definition,'SET total_transfer_seats=_seats,is_active=true,updated_at=now()','SET total_transfer_seats=_seats,is_active=true,updated_at=now(),university_verified_at=now(),source_reference=_source');
 definition:=replace(definition,'programme_id,academic_term_id,total_transfer_seats,is_active,is_demo_record) VALUES(_programme,_term,_seats,true,_demo)','programme_id,academic_term_id,total_transfer_seats,is_active,is_demo_record,university_verified_at,source_reference) VALUES(_programme,_term,_seats,true,_demo,now(),_source)');EXECUTE definition;
 SELECT pg_get_functiondef('public.assess_programme_transfer(uuid,uuid)'::regprocedure) INTO definition;
 definition:=replace(definition,'AND is_active AND is_demo_record=sp.is_demo_record AND academic_term_id=sp.current_academic_term_id','AND is_active AND university_verified_at IS NOT NULL AND source_reference IS NOT NULL AND is_demo_record=sp.is_demo_record AND academic_term_id=sp.current_academic_term_id');EXECUTE definition;
END $migration$;
CREATE OR REPLACE FUNCTION public.notify_transfer_assignment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.cases;
BEGIN
 IF NEW.case_id IS NULL THEN RETURN NEW;END IF;SELECT * INTO c FROM public.cases WHERE id=NEW.case_id;
 IF c.assigned_to IS NOT NULL THEN
 INSERT INTO public.case_assignments(case_id,assigned_to,assigned_by,service_unit_id) VALUES(c.id,c.assigned_to,auth.uid(),c.service_unit_id);
 INSERT INTO public.notification_events(event_type,entity_type,entity_id,recipient_profile_id,channel,title,body,action_url,status,processed_at,case_id,dedupe_key) VALUES('case_assigned','case',c.id,c.assigned_to,'in_app','Transfer review assigned: '||c.case_number,'Review the student-confirmed transfer evidence in Admission & Registration.','/requests/'||c.id,'delivered',now(),c.id,'transfer-assignment:'||c.id);
 END IF;RETURN NEW;END $$;
CREATE TRIGGER transfer_assignment_notification AFTER INSERT ON public.intercollege_transfer_requests FOR EACH ROW EXECUTE FUNCTION public.notify_transfer_assignment();