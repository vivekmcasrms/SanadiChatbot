ALTER TABLE public.staff_profiles
  ADD COLUMN IF NOT EXISTS staff_code text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS availability_status text NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS last_assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_profiles_availability_status_check') THEN
    ALTER TABLE public.staff_profiles
      ADD CONSTRAINT staff_profiles_availability_status_check
      CHECK (availability_status IN ('available','unavailable','on_leave'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_profiles_staff_code_key') THEN
    ALTER TABLE public.staff_profiles ADD CONSTRAINT staff_profiles_staff_code_key UNIQUE (staff_code);
  END IF;
END $$;

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS assignment_method text,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS workload_at_assignment numeric,
  ADD COLUMN IF NOT EXISTS needs_assignment_attention boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_cases_assigned_to_status ON public.cases (assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_staff_profiles_unit_active ON public.staff_profiles (service_unit_id, is_active, availability_status);