ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS meeting_at timestamptz,
  ADD COLUMN IF NOT EXISTS meeting_mode text,
  ADD COLUMN IF NOT EXISTS meeting_location text,
  ADD COLUMN IF NOT EXISTS meeting_note text,
  ADD COLUMN IF NOT EXISTS meeting_set_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS meeting_set_at timestamptz;

ALTER TABLE public.cases
  ADD CONSTRAINT cases_meeting_mode_check
  CHECK (meeting_mode IS NULL OR meeting_mode IN ('in_person','online','phone'));

CREATE INDEX IF NOT EXISTS cases_meeting_at_idx ON public.cases (meeting_at) WHERE meeting_at IS NOT NULL;