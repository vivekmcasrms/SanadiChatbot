ALTER TABLE public.conversation_state ADD COLUMN IF NOT EXISTS state_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.conversation_state ADD COLUMN IF NOT EXISTS state_conflicts integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.conversation_state.state_version IS 'Optimistic-concurrency version; every write must match the version it read and increment it.';
COMMENT ON COLUMN public.conversation_state.state_conflicts IS 'Count of concurrent-turn conflicts detected and merged for this conversation.';