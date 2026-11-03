-- Real cases may never be assigned to demo staff accounts.
CREATE OR REPLACE FUNCTION public.guard_real_case_demo_assignee()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL AND NOT coalesce(NEW.is_demo,false)
     AND coalesce((SELECT is_demo_account FROM public.profiles WHERE id = NEW.assigned_to), false) THEN
    RAISE EXCEPTION 'A real case cannot be assigned to a demo staff account';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_real_case_demo_assignee ON public.cases;
CREATE TRIGGER trg_guard_real_case_demo_assignee
  BEFORE INSERT OR UPDATE OF assigned_to, is_demo ON public.cases
  FOR EACH ROW EXECUTE FUNCTION public.guard_real_case_demo_assignee();

-- Read-only data-classification audit for administrators.
CREATE OR REPLACE FUNCTION public.admin_data_classification_audit()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'system_admin') THEN
    RAISE EXCEPTION 'Administrator access required';
  END IF;
  SELECT jsonb_build_object(
    'counts', jsonb_build_array(
      jsonb_build_object('area','student_profiles','real',(SELECT count(*) FROM student_profiles WHERE is_demo_record IS FALSE),'demo',(SELECT count(*) FROM student_profiles WHERE is_demo_record IS TRUE),'unclassified',(SELECT count(*) FROM student_profiles WHERE is_demo_record IS NULL)),
      jsonb_build_object('area','staff_accounts','real',(SELECT count(*) FROM profiles WHERE is_demo_account IS FALSE),'demo',(SELECT count(*) FROM profiles WHERE is_demo_account IS TRUE),'unclassified',(SELECT count(*) FROM profiles WHERE is_demo_account IS NULL)),
      jsonb_build_object('area','hostels','real',(SELECT count(*) FROM hostels WHERE is_demo_record IS FALSE),'demo',(SELECT count(*) FROM hostels WHERE is_demo_record IS TRUE),'unclassified',(SELECT count(*) FROM hostels WHERE is_demo_record IS NULL)),
      jsonb_build_object('area','hostel_rooms','real',(SELECT count(*) FROM hostel_rooms WHERE is_demo_record IS FALSE),'demo',(SELECT count(*) FROM hostel_rooms WHERE is_demo_record IS TRUE),'unclassified',(SELECT count(*) FROM hostel_rooms WHERE is_demo_record IS NULL)),
      jsonb_build_object('area','transfer_capacity','real',(SELECT count(*) FROM programme_transfer_capacity WHERE is_demo_record IS FALSE),'demo',(SELECT count(*) FROM programme_transfer_capacity WHERE is_demo_record IS TRUE),'unclassified',(SELECT count(*) FROM programme_transfer_capacity WHERE is_demo_record IS NULL)),
      jsonb_build_object('area','transfer_rules','real',(SELECT count(*) FROM transfer_programme_rules WHERE is_demo_record IS FALSE),'demo',(SELECT count(*) FROM transfer_programme_rules WHERE is_demo_record IS TRUE),'unclassified',(SELECT count(*) FROM transfer_programme_rules WHERE is_demo_record IS NULL)),
      jsonb_build_object('area','course_equivalencies','real',(SELECT count(*) FROM programme_course_equivalencies WHERE is_demo_record IS FALSE),'demo',(SELECT count(*) FROM programme_course_equivalencies WHERE is_demo_record IS TRUE),'unclassified',(SELECT count(*) FROM programme_course_equivalencies WHERE is_demo_record IS NULL)),
      jsonb_build_object('area','appointment_slots','real',(SELECT count(*) FROM appointment_slots WHERE is_demo_record IS FALSE),'demo',(SELECT count(*) FROM appointment_slots WHERE is_demo_record IS TRUE),'unclassified',(SELECT count(*) FROM appointment_slots WHERE is_demo_record IS NULL)),
      jsonb_build_object('area','cases','real',(SELECT count(*) FROM cases WHERE is_demo IS FALSE),'demo',(SELECT count(*) FROM cases WHERE is_demo IS TRUE),'unclassified',(SELECT count(*) FROM cases WHERE is_demo IS NULL)),
      jsonb_build_object('area','suggestions','real',(SELECT count(*) FROM suggestions WHERE is_demo IS FALSE),'demo',(SELECT count(*) FROM suggestions WHERE is_demo IS TRUE),'unclassified',(SELECT count(*) FROM suggestions WHERE is_demo IS NULL)),
      jsonb_build_object('area','impact_baselines','real',(SELECT count(*) FROM service_impact_baselines WHERE is_demo IS FALSE),'demo',(SELECT count(*) FROM service_impact_baselines WHERE is_demo IS TRUE),'unclassified',(SELECT count(*) FROM service_impact_baselines WHERE is_demo IS NULL))
    ),
    'crossReferences', jsonb_build_object(
      'realStudentDemoProfileFlag', (SELECT count(*) FROM student_profiles sp JOIN profiles p ON p.id = sp.user_id WHERE sp.is_demo_record IS TRUE AND p.is_demo_account IS FALSE),
      'realCasesWithDemoStudent', (SELECT count(*) FROM cases c JOIN student_profiles sp ON sp.user_id = c.student_id WHERE c.is_demo IS FALSE AND sp.is_demo_record IS TRUE),
      'demoCasesWithRealStudent', (SELECT count(*) FROM cases c JOIN student_profiles sp ON sp.user_id = c.student_id WHERE c.is_demo IS TRUE AND sp.is_demo_record IS FALSE),
      'realCasesAssignedToDemoStaff', (SELECT count(*) FROM cases c JOIN profiles p ON p.id = c.assigned_to WHERE c.is_demo IS FALSE AND p.is_demo_account IS TRUE),
      'realStudentsInDemoRooms', (SELECT count(*) FROM hostel_bookings hb JOIN student_profiles sp ON sp.user_id = hb.student_id JOIN hostels h ON right(h.code,1) = hb.hostel JOIN hostel_rooms r ON r.hostel_id = h.id AND r.room_number = hb.room_number WHERE hb.stage IN ('room_assigned','confirmed') AND sp.is_demo_record IS FALSE AND (r.is_demo_record OR h.is_demo_record)),
      'demoRoomsInRealHostels', (SELECT count(*) FROM hostel_rooms r JOIN hostels h ON h.id = r.hostel_id WHERE r.is_demo_record IS DISTINCT FROM h.is_demo_record)
    ),
    'generatedAt', now()
  ) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.admin_data_classification_audit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_data_classification_audit() TO authenticated;
REVOKE ALL ON FUNCTION public.guard_real_case_demo_assignee() FROM PUBLIC, anon, authenticated;