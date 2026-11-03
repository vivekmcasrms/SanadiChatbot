ALTER TABLE public.exception_events ADD COLUMN IF NOT EXISTS component text;
ALTER TABLE public.exception_events ADD COLUMN IF NOT EXISTS exception_type text;
CREATE INDEX IF NOT EXISTS exception_events_component_idx ON public.exception_events (component, created_at DESC);
COMMENT ON COLUMN public.exception_events.component IS 'Sanadi component where the failure occurred (hostel, transfer, holds, rag, ...).';
COMMENT ON COLUMN public.exception_events.exception_type IS 'Failure class: unavailable, forbidden, invalid, timeout, backend.';