CREATE TABLE public.appointment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_unit_id uuid REFERENCES public.service_units(id) ON DELETE SET NULL,
  appointment_mode text NOT NULL DEFAULT 'PREFERRED_TIME_REQUEST',
  preferred_datetime timestamptz NOT NULL,
  alternative_datetime timestamptz,
  confirmed_datetime timestamptz,
  assigned_staff_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assignment_method text,
  assigned_at timestamptz,
  workload_at_assignment numeric,
  request_status text NOT NULL DEFAULT 'REQUESTED',
  confirmation_status text NOT NULL DEFAULT 'AWAITING_OFFICE_CONFIRMATION',
  office_response_at timestamptz,
  student_response_at timestamptz,
  purpose text,
  decline_reason text,
  location text,
  language text NOT NULL DEFAULT 'en',
  reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.appointment_requests TO authenticated;
GRANT ALL ON public.appointment_requests TO service_role;

ALTER TABLE public.appointment_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students read their own appointment requests"
ON public.appointment_requests FOR SELECT TO authenticated
USING (student_id = auth.uid() OR (case_id IS NOT NULL AND public.can_access_case(case_id, auth.uid())));

CREATE POLICY "Students create their own appointment requests"
ON public.appointment_requests FOR INSERT TO authenticated
WITH CHECK (student_id = auth.uid());

CREATE POLICY "Student or responsible staff update the request"
ON public.appointment_requests FOR UPDATE TO authenticated
USING (student_id = auth.uid() OR (case_id IS NOT NULL AND public.can_access_case(case_id, auth.uid())))
WITH CHECK (student_id = auth.uid() OR (case_id IS NOT NULL AND public.can_access_case(case_id, auth.uid())));

CREATE INDEX idx_appointment_requests_student ON public.appointment_requests(student_id, request_status);
CREATE INDEX idx_appointment_requests_staff ON public.appointment_requests(assigned_staff_id, request_status);
CREATE INDEX idx_appointment_requests_case ON public.appointment_requests(case_id);

CREATE TRIGGER update_appointment_requests_updated_at
BEFORE UPDATE ON public.appointment_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();