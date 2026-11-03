ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS fallback_provider text,
  ADD COLUMN IF NOT EXISTS fallback_model text,
  ADD COLUMN IF NOT EXISTS reasoning_effort text NOT NULL DEFAULT 'none';

ALTER TABLE public.model_routing_rules
  ADD COLUMN IF NOT EXISTS fallback_provider text,
  ADD COLUMN IF NOT EXISTS reasoning_effort text;