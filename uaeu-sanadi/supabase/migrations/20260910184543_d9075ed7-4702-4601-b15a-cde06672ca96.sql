-- Handover package: everything a staff member needs when Sanadi hands a case over.
CREATE TABLE IF NOT EXISTS public.case_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL UNIQUE REFERENCES public.cases(id) ON DELETE CASCADE,
  student_name text,
  student_number text,
  student_email text,
  service_unit_id uuid REFERENCES public.service_units(id),
  unit_name_en text,
  unit_name_ar text,
  interaction_type text,
  summary_en text,
  summary_ar text,
  conversation_context jsonb NOT NULL DEFAULT '[]'::jsonb,
  verified_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  actions_taken jsonb NOT NULL DEFAULT '[]'::jsonb,
  unresolved_issue text,
  recommended_action text,
  priority text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.case_handovers TO authenticated;
GRANT ALL ON public.case_handovers TO service_role;
ALTER TABLE public.case_handovers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read handovers for cases they may access"
ON public.case_handovers FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()) AND public.can_access_case(case_id, auth.uid()));

-- Structured exception log: detection, recovery and escalation, kept internal.
CREATE TABLE IF NOT EXISTS public.exception_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  user_id uuid,
  case_id uuid,
  conversation_id uuid,
  detail text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  recovered boolean NOT NULL DEFAULT false,
  recovery_action text,
  escalated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS exception_events_code_idx ON public.exception_events (code, created_at DESC);

GRANT SELECT ON public.exception_events TO authenticated;
GRANT ALL ON public.exception_events TO service_role;
ALTER TABLE public.exception_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers read exception events"
ON public.exception_events FOR SELECT TO authenticated
USING (public.is_manager(auth.uid()));