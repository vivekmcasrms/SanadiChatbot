CREATE OR REPLACE FUNCTION public.authorize_hostel_booking_update() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NOT NULL AND (public.is_access_revoked(auth.uid()) OR NOT public.is_housing_staff(auth.uid()) OR NOT public.can_access_case(NEW.case_id,auth.uid())) THEN RAISE EXCEPTION 'Only authorised Housing staff can update hostel bookings'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hostel_staff_update_authorization BEFORE UPDATE ON public.hostel_bookings FOR EACH ROW EXECUTE FUNCTION public.authorize_hostel_booking_update();