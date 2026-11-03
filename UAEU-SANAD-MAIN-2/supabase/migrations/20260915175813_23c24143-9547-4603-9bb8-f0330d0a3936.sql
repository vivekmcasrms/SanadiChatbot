CREATE TABLE public.chat_action_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid,
  message_id uuid,
  action_key text NOT NULL,
  action_type text NOT NULL,
  created_case_id uuid,
  reference_number text,
  result_message text,
  receipt jsonb,
  idempotency_key text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX chat_action_completions_key_idx
  ON public.chat_action_completions (idempotency_key);
CREATE INDEX chat_action_completions_conv_idx
  ON public.chat_action_completions (student_id, conversation_id);

GRANT SELECT, INSERT ON public.chat_action_completions TO authenticated;
GRANT ALL ON public.chat_action_completions TO service_role;

ALTER TABLE public.chat_action_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students read their own completed chat actions"
  ON public.chat_action_completions FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR public.can_monitor_cases(auth.uid()));

CREATE POLICY "Students record their own completed chat actions"
  ON public.chat_action_completions FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid());

CREATE TRIGGER update_chat_action_completions_updated_at
  BEFORE UPDATE ON public.chat_action_completions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();