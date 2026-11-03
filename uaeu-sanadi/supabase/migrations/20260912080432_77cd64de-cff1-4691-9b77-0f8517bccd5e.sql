ALTER TABLE public.service_units ADD COLUMN IF NOT EXISTS appointment_enabled boolean NOT NULL DEFAULT false;

UPDATE public.service_units SET appointment_enabled = true WHERE code = 'CAREER';

CREATE TABLE IF NOT EXISTS public.staff_availability_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_unit_id uuid NOT NULL REFERENCES public.service_units(id) ON DELETE CASCADE,
  staff_profile_id uuid REFERENCES public.staff_profiles(user_id) ON DELETE SET NULL,
  appointment_type_id uuid REFERENCES public.appointment_types(id) ON DELETE SET NULL,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute integer NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  slot_minutes integer NOT NULL DEFAULT 30 CHECK (slot_minutes > 0),
  capacity integer NOT NULL DEFAULT 1 CHECK (capacity > 0),
  location text,
  meeting_link text,
  valid_from date NOT NULL DEFAULT current_date,
  valid_to date,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_availability_rules_window CHECK (end_minute > start_minute)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_availability_rules TO authenticated;
GRANT ALL ON public.staff_availability_rules TO service_role;

ALTER TABLE public.staff_availability_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage availability rules" ON public.staff_availability_rules
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'system_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'system_admin'::app_role));

CREATE POLICY "staff read own availability rules" ON public.staff_availability_rules
  FOR SELECT TO authenticated
  USING (staff_profile_id = auth.uid());

CREATE TRIGGER trg_availability_rules_updated BEFORE UPDATE ON public.staff_availability_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.generate_availability_slots(_rule_id uuid, _weeks integer DEFAULT 4)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.staff_availability_rules%ROWTYPE;
  d date;
  horizon date;
  t timestamptz;
  slot_end timestamptz;
  created integer := 0;
BEGIN
  IF NOT has_role(auth.uid(), 'system_admin'::app_role) THEN
    RAISE EXCEPTION 'not authorised';
  END IF;
  SELECT * INTO r FROM public.staff_availability_rules WHERE id = _rule_id;
  IF r.id IS NULL OR NOT r.is_active OR r.appointment_type_id IS NULL THEN
    RETURN 0;
  END IF;
  horizon := LEAST(COALESCE(r.valid_to, current_date + (_weeks * 7)), current_date + (_weeks * 7));
  d := GREATEST(r.valid_from, current_date);
  WHILE d <= horizon LOOP
    IF EXTRACT(DOW FROM d)::int = r.weekday THEN
      t := (d::timestamp + make_interval(mins => r.start_minute)) AT TIME ZONE 'Asia/Dubai';
      WHILE (t + make_interval(mins => r.slot_minutes)) <= ((d::timestamp + make_interval(mins => r.end_minute)) AT TIME ZONE 'Asia/Dubai') LOOP
        slot_end := t + make_interval(mins => r.slot_minutes);
        IF t > now() AND NOT EXISTS (
          SELECT 1 FROM public.appointment_slots s
           WHERE s.appointment_type_id = r.appointment_type_id
             AND s.start_time = t
             AND s.staff_profile_id IS NOT DISTINCT FROM r.staff_profile_id
        ) THEN
          INSERT INTO public.appointment_slots
            (appointment_type_id, staff_profile_id, start_time, end_time, capacity, status, location, meeting_link, data_source, is_demo_record)
          VALUES
            (r.appointment_type_id, r.staff_profile_id, t, slot_end, r.capacity, 'open', r.location, r.meeting_link, 'admin', false);
          created := created + 1;
        END IF;
        t := slot_end;
      END LOOP;
    END IF;
    d := d + 1;
  END LOOP;
  RETURN created;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_availability_slots(uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.generate_availability_slots(uuid, integer) TO authenticated;