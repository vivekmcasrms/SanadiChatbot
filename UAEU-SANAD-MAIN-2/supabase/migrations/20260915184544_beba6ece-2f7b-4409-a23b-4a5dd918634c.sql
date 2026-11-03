ALTER TABLE public.exception_events
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS student_message text,
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scenario text;

CREATE INDEX IF NOT EXISTS exception_events_is_test_idx ON public.exception_events (is_test, created_at DESC);