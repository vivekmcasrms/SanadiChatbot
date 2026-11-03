CREATE OR REPLACE FUNCTION public.validate_hostel_booking_change() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE inventory public.hostel_rooms; real_inventory boolean; mapped_hostel uuid;
BEGIN
 IF NEW.eligible_room_type NOT IN ('single','double') OR NEW.completed_credits<0 OR public.hostel_city_normalized(NEW.home_city) IN ('','alain','العين') THEN RAISE EXCEPTION 'Invalid verified hostel eligibility'; END IF;
 IF (NEW.completed_credits>=60) IS DISTINCT FROM (NEW.eligible_room_type='single') THEN RAISE EXCEPTION 'Room eligibility does not match credits'; END IF;
 IF NEW.stage NOT IN ('submitted','room_assigned','confirmed','cancelled','completed','closed') THEN RAISE EXCEPTION 'Invalid hostel booking stage'; END IF;
 IF NEW.stage IN ('room_assigned','confirmed','completed') THEN
 IF NEW.hostel IS NULL OR NOT NEW.hostel=ANY(NEW.eligible_hostels) OR coalesce(trim(NEW.room_number),'')='' THEN RAISE EXCEPTION 'An eligible hostel and actual room are required'; END IF;
 SELECT id INTO mapped_hostel FROM public.hostels WHERE code IN ('HST-'||NEW.hostel,'HOSTEL-'||NEW.hostel,NEW.hostel) AND is_active AND NOT is_demo_record LIMIT 1;
 SELECT EXISTS(SELECT 1 FROM public.hostel_rooms r JOIN public.hostels h ON h.id=r.hostel_id WHERE NOT r.is_demo_record AND NOT h.is_demo_record) INTO real_inventory;
 IF real_inventory THEN
 SELECT * INTO inventory FROM public.hostel_rooms WHERE hostel_id=mapped_hostel AND room_number=NEW.room_number AND NOT is_demo_record FOR UPDATE;
 IF inventory.id IS NULL OR inventory.status NOT IN ('available','open') THEN RAISE EXCEPTION 'Room is not available in authoritative inventory'; END IF;
 IF (NEW.eligible_room_type='single' AND lower(inventory.room_type) NOT LIKE '%single%') OR (NEW.eligible_room_type='double' AND lower(inventory.room_type) NOT SIMILAR TO '%(double|twin)%') THEN RAISE EXCEPTION 'Inventory room type does not match eligibility'; END IF;
 IF TG_OP='INSERT' OR NEW.hostel IS DISTINCT FROM OLD.hostel OR NEW.room_number IS DISTINCT FROM OLD.room_number THEN
 IF inventory.available_beds<1 THEN RAISE EXCEPTION 'No places available'; END IF;
 END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('hostel-room:'||NEW.hostel||':'||NEW.room_number,0));
 IF (SELECT count(*) FROM public.hostel_bookings WHERE case_id<>NEW.case_id AND hostel=NEW.hostel AND room_number=NEW.room_number AND stage IN ('room_assigned','confirmed','completed','closed')) >= (CASE WHEN NEW.eligible_room_type='single' THEN 1 ELSE 2 END) THEN RAISE EXCEPTION 'Room capacity exceeded'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hostel_booking_validation BEFORE INSERT OR UPDATE ON public.hostel_bookings FOR EACH ROW EXECUTE FUNCTION public.validate_hostel_booking_change();
CREATE OR REPLACE FUNCTION public.sync_hostel_case_lifecycle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b public.hostel_bookings;
BEGIN
 IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 SELECT * INTO b FROM public.hostel_bookings WHERE case_id=NEW.id;
 IF b.case_id IS NULL THEN RETURN NEW; END IF;
 IF NEW.status IN ('resolved','closed') AND b.stage NOT IN ('confirmed','completed','closed','cancelled') THEN RAISE EXCEPTION 'A hostel booking must be confirmed before completion or closure'; END IF;
 IF NEW.status='closed' THEN UPDATE public.hostel_bookings SET stage='closed',updated_at=now() WHERE case_id=NEW.id;
 ELSIF NEW.status='resolved' THEN UPDATE public.hostel_bookings SET stage='completed',updated_at=now() WHERE case_id=NEW.id;
 ELSIF NEW.status='withdrawn' THEN UPDATE public.hostel_bookings SET stage='cancelled',updated_at=now() WHERE case_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hostel_case_lifecycle AFTER UPDATE OF status ON public.cases FOR EACH ROW EXECUTE FUNCTION public.sync_hostel_case_lifecycle();