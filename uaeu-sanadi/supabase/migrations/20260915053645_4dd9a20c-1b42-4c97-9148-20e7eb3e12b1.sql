ALTER TABLE public.exception_events ADD COLUMN IF NOT EXISTS trace_id text;
CREATE INDEX IF NOT EXISTS exception_events_created_at_idx ON public.exception_events (created_at DESC);
CREATE INDEX IF NOT EXISTS exception_events_trace_idx ON public.exception_events (trace_id);